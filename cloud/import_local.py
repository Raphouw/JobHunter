"""Import one local profile into the cloud account that owns it.

Dry run by default. Apply only after setting SUPABASE_URL and
SUPABASE_SERVICE_ROLE_KEY in the shell (never in the frontend).
"""

from __future__ import annotations

import argparse
import json
import os
import sqlite3
import urllib.error
import urllib.request
import uuid
from pathlib import Path

import yaml


ROOT = Path(__file__).resolve().parents[1]


def post_rows(table: str, rows: list[dict], conflict: str, *, url: str, key: str) -> None:
    if not rows:
        return
    target = f"{url.rstrip('/')}/rest/v1/{table}?on_conflict={conflict}"
    request = urllib.request.Request(
        target,
        data=json.dumps(rows, ensure_ascii=False).encode("utf-8"),
        headers={
            "apikey": key,
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
            "Prefer": "resolution=merge-duplicates,return=minimal",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            if response.status not in (200, 201, 204):
                raise RuntimeError(f"Supabase returned HTTP {response.status}")
    except urllib.error.HTTPError as error:
        details = error.read(1000).decode("utf-8", errors="replace")
        raise RuntimeError(f"Import {table}: HTTP {error.code}: {details}") from error


def prepare(profile_name: str, user_id: uuid.UUID) -> tuple[dict, list[dict]]:
    if not profile_name.replace("_", "").replace("-", "").isalnum():
        raise ValueError("Identifiant de profil invalide")
    path = ROOT / "config" / "profiles" / f"{profile_name}.yaml"
    if not path.is_file():
        raise FileNotFoundError(path)
    source = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    cloud_profile_id = str(uuid.uuid5(user_id, f"job-hunter:{profile_name}"))
    config = {key: value for key, value in source.items()
              if key not in {"id", "name", "integrations"} and not key.startswith("_")}
    profile = {
        "id": cloud_profile_id,
        "user_id": str(user_id),
        "name": str(source.get("name") or profile_name),
        "config": config,
    }

    database = ROOT / "output" / profile_name / "stage_hunter.sqlite3"
    if not database.is_file():
        return profile, []
    connection = sqlite3.connect(f"file:{database.as_posix()}?mode=ro", uri=True)
    connection.row_factory = sqlite3.Row
    try:
        source_offers = connection.execute(
            "SELECT * FROM offers WHERE status IN ('new','kept') ORDER BY id"
        ).fetchall()
    finally:
        connection.close()

    offers_by_url: dict[str, dict] = {}
    for row in source_offers:
        item = dict(row)
        canonical = str(item.get("canonical_url") or item.get("url") or "").strip()
        if not canonical:
            continue
        decision = item.get("review_decision") or ("keep" if item.get("status") == "kept" else "pending")
        if decision not in {"pending", "keep", "unsure", "reject"}:
            decision = "pending"
        offer = {
            "user_id": str(user_id),
            "profile_id": cloud_profile_id,
            "url": item.get("url") or canonical,
            "canonical_url": canonical,
            "review_decision": decision,
            "reviewed_at": item.get("reviewed_at"),
        }
        for key in ("title", "company", "location", "canton", "source", "snippet", "body",
                    "language", "duration", "start_date", "domain_category", "skills_found",
                    "reasons", "availability_status"):
            offer[key] = item.get(key) or ("unknown" if key == "availability_status" else "")
        for key in ("score", "confidence"):
            offer[key] = float(item.get(key) or 0)
        if item.get("discovered_at"):
            offer["discovered_at"] = item["discovered_at"]
        offers_by_url[canonical] = offer
    return profile, list(offers_by_url.values())


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--profile", required=True, help="Local profile ID, such as raphael")
    parser.add_argument("--user-id", required=True, help="Supabase Auth user UUID")
    parser.add_argument("--apply", action="store_true", help="Write to Supabase; default is read-only")
    args = parser.parse_args()
    owner = uuid.UUID(args.user_id)
    profile, offers = prepare(args.profile, owner)
    print(f"Profil {profile['name']}: {len(offers)} offres actives à importer pour {owner}.")
    if not args.apply:
        print("Simulation terminée. Ajouter --apply pour transférer les données.")
        return
    url = os.getenv("SUPABASE_URL", "")
    key = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
    if not url.startswith("https://") or not key:
        raise RuntimeError("SUPABASE_URL (HTTPS) et SUPABASE_SERVICE_ROLE_KEY requis dans l'environnement")
    post_rows("hunter_profiles", [profile], "id", url=url, key=key)
    for start in range(0, len(offers), 100):
        post_rows("hunter_offers", offers[start:start + 100], "profile_id,canonical_url", url=url, key=key)
    print(f"Import terminé: {len(offers)} offres. Ne jamais copier la clé service dans web/.")


if __name__ == "__main__":
    main()
