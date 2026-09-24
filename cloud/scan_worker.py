"""One durable scan slice. Called by Vercel or locally with server credentials.

Each invocation claims one Supabase lease and persists discovery/analysis before
releasing it. The existing stage_hunter engine performs ranking and scoring.
"""

from __future__ import annotations

import json
import os
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

import yaml


MODE_LIMITS = {
    "Rapide": (24, 8, 4, 6),
    "Complet": (45, 16, 6, 8),
    "Maximum": (70, 25, 8, 10),
    "Exhaustif 1h": (240, 30, 8, 12),
}


class Store:
    def __init__(self):
        self.url = os.environ["SUPABASE_URL"].rstrip("/")
        self.key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]

    def request(self, path, method="GET", body=None, prefer=None):
        data = None if body is None else json.dumps(body, ensure_ascii=False).encode("utf-8")
        headers = {"apikey": self.key, "Authorization": f"Bearer {self.key}",
                   "Content-Type": "application/json"}
        if prefer:
            headers["Prefer"] = prefer
        request = urllib.request.Request(f"{self.url}/rest/v1/{path}", data=data,
                                         headers=headers, method=method)
        try:
            with urllib.request.urlopen(request, timeout=25) as response:
                raw = response.read()
                return json.loads(raw) if raw else None
        except urllib.error.HTTPError as error:
            details = error.read(400).decode("utf-8", errors="replace")
            raise RuntimeError(f"Supabase HTTP {error.code}: {details}") from error

    def rpc(self, name, body):
        return self.request(f"rpc/{name}", "POST", body)

    def rows(self, table, query):
        return self.request(f"{table}?{query}") or []

    def patch(self, table, query, body):
        self.request(f"{table}?{query}", "PATCH", body, "return=minimal")

    def event(self, job, message, level="info"):
        self.request("hunter_scan_events", "POST", {
            "job_id": job["id"], "user_id": job["user_id"],
            "message": str(message)[:1500], "level": level,
        }, "return=minimal")


def prepare_engine(config, job):
    import stage_hunter as engine
    from datetime import datetime, timezone

    # Warm Vercel instances reuse the module globals from the previous slice.
    engine.ROOT = Path(engine.__file__).resolve().parent

    # The function bundle is read-only; diagnostics and the temporary SQLite DB
    # live only in /tmp. Supabase remains the durable source of truth.
    directory = Path(tempfile.mkdtemp(prefix="hunter-scan-"))
    profile_file = directory / "profile.yaml"
    profile_file.write_text(yaml.safe_dump({**config, "id": job["profile_id"]},
                                           allow_unicode=True), encoding="utf-8")
    profile = engine.load_profile(str(profile_file))
    engine.ROOT = directory
    engine.RUN_STARTED = time.perf_counter()
    engine.RUN_STARTED_AT = datetime.now(timezone.utc)
    engine.configure_runtime(profile)
    query_limit, _, search_workers, scrape_workers = MODE_LIMITS[job["mode"]]
    os.environ.update({
        "SEARCH_QUERY_BUDGET": str(query_limit),
        "SCAN_TIME_BUDGET_SECONDS": "215",
        "SCAN_DEADLINE_RESERVE_SECONDS": "25",
        "MAX_TOTAL_DETAIL_PAGES": "18",
        "MAX_RECURSIVE_LEADS": "20",
        "LISTING_CRAWL_DEPTH": "1",
        "SCRAPE_WORKERS": str(scrape_workers),
        "SEARCH_WORKERS": str(search_workers),
        "HTTP_TIMEOUT_SECONDS": "12",
    })
    os.environ["WEB_DISABLE_CIRCUIT_BREAKER"] = "1" if job["mode"] == "Exhaustif 1h" else "0"
    os.environ["WEB_RETRY_EMPTY_RESULTS"] = "1" if job["mode"] == "Exhaustif 1h" else "0"
    return engine, profile


def candidate_rows(store, job, rows):
    import stage_hunter as engine

    unique = {}
    for row in rows:
        url = row.get("url")
        if not url or not engine.safe_public_url(url):
            continue
        canonical = engine.canon(url)
        if canonical:
            unique[canonical] = {"job_id": job["id"], "user_id": job["user_id"],
                                 "canonical_url": canonical, "payload": row}
    for start in range(0, len(unique), 100):
        batch = list(unique.values())[start:start + 100]
        store.request("hunter_scan_candidates?on_conflict=job_id,canonical_url", "POST",
                      batch, "resolution=ignore-duplicates,return=minimal")
    return len(unique)


def still_owned(store, job):
    rows = store.rows("hunter_scan_jobs", f"id=eq.{job['id']}&select=lease_token,cancel_requested,status")
    return (len(rows) == 1 and rows[0]["lease_token"] == job["lease_token"]
            and rows[0]["status"] == "running" and not rows[0]["cancel_requested"])


def release(store, job, phase, checkpoint, progress, completed=False):
    ok = store.rpc("hunter_release_scan_job", {
        "p_job_id": job["id"], "p_lease_token": job["lease_token"],
        "p_phase": phase, "p_checkpoint": checkpoint,
        "p_progress_percent": progress, "p_completed": completed,
    })
    if not ok:
        raise RuntimeError("Le bail du scan a expiré avant l'enregistrement du checkpoint")


def discover(store, job, engine, profile):
    checkpoint = dict(job.get("checkpoint") or {})
    checkpoint["failure_streak"] = 0
    query_limit, site_limit, _, _ = MODE_LIMITS[job["mode"]]
    direct_urls = engine.targeted_fixed_urls(profile)[:site_limit]
    queries = engine.build_search_queries(profile, emit_log=False)[:query_limit]
    direct_cursor = int(checkpoint.get("direct_cursor", 0))
    web_cursor = int(checkpoint.get("web_cursor", 0))

    if direct_cursor < len(direct_urls):
        # Preserve the local engine's URL discovery and filtering rules.
        subset = direct_urls[direct_cursor:direct_cursor + 2]
        direct_profile = {**profile, "_source_pack_urls": subset}
        os.environ["FIXED_SITE_LIMIT"] = str(len(subset))
        rows = engine.fixed_site_candidates(direct_profile)
        found = candidate_rows(store, job, rows)
        checkpoint["direct_cursor"] = direct_cursor + len(subset)
        checkpoint["direct_candidates"] = checkpoint.get("direct_candidates", 0) + found
        message = f"Sites directs {checkpoint['direct_cursor']}/{len(direct_urls)} · {found} candidat(s)"
    elif web_cursor < len(queries):
        subset = queries[web_cursor:web_cursor + 4]
        rows = engine.search_web(subset, int(os.getenv("SEARCH_RESULTS_PER_QUERY", "8")))
        found = candidate_rows(store, job, rows)
        checkpoint["web_cursor"] = web_cursor + len(subset)
        checkpoint["web_candidates"] = checkpoint.get("web_candidates", 0) + found
        message = f"Recherche web {checkpoint['web_cursor']}/{len(queries)} · {found} candidat(s)"
    else:
        store.event(job, "Découverte terminée. Analyse des candidats en cours.")
        release(store, job, "analyze", checkpoint, 45)
        return

    if not still_owned(store, job):
        return
    store.event(job, message)
    completed = checkpoint.get("direct_cursor", 0) >= len(direct_urls) and checkpoint.get("web_cursor", 0) >= len(queries)
    done = checkpoint.get("direct_cursor", 0) + checkpoint.get("web_cursor", 0)
    total = max(1, len(direct_urls) + len(queries))
    release(store, job, "analyze" if completed else "discover", checkpoint,
            45 if completed else min(44, round(done * 44 / total)))


OFFER_COLUMNS = ("url", "canonical_url", "title", "company", "location", "canton", "source",
                 "snippet", "body", "language", "duration", "start_date", "domain_category",
                 "skills_found", "score", "confidence", "reasons", "availability_status",
                 "review_decision", "discovered_at")


def analyze(store, job, engine, profile):
    pending = store.rows("hunter_scan_candidates",
                         f"job_id=eq.{job['id']}&status=in.(pending,retry)&select=id,payload,decision&order=id.asc&limit=5")
    checkpoint = dict(job.get("checkpoint") or {})
    if not pending:
        checkpoint["failure_streak"] = 0
        release(store, job, "finish", checkpoint, 96)
        return
    connection = engine.init_db()
    existing = store.rows("hunter_offers", f"profile_id=eq.{job['profile_id']}&select="
                          + ",".join(OFFER_COLUMNS) + "&limit=1000")
    for offer in existing:
        values = [offer.get(column) for column in OFFER_COLUMNS]
        connection.execute(f"INSERT OR IGNORE INTO offers ({','.join(OFFER_COLUMNS)}) VALUES ({','.join('?' for _ in values)})", values)
    connection.commit()
    engine.ingest(connection, [candidate["payload"] for candidate in pending], profile)
    engine.close_decision_audit()
    if not still_owned(store, job):
        return

    existing_urls = {offer["canonical_url"] for offer in existing}
    fresh = []
    connection.row_factory = __import__("sqlite3").Row
    for row in connection.execute("SELECT * FROM offers WHERE status='new'"):
        offer = dict(row)
        if offer.get("canonical_url") in existing_urls:
            continue
        fresh.append({"user_id": job["user_id"], "profile_id": job["profile_id"],
                      **{column: offer.get(column) for column in OFFER_COLUMNS}})
    for start in range(0, len(fresh), 100):
        store.request("hunter_offers?on_conflict=profile_id,canonical_url", "POST",
                      fresh[start:start + 100], "resolution=ignore-duplicates,return=minimal")
    checkpoint["new_offers"] = checkpoint.get("new_offers", 0) + len(fresh)

    audits = []
    if engine.DECISION_AUDIT_PATH and engine.DECISION_AUDIT_PATH.exists():
        with engine.DECISION_AUDIT_PATH.open(encoding="utf-8") as source:
            audits = [json.loads(line) for line in source if line.strip()]
    checkpoint["failure_streak"] = 0
    fresh_urls = {row["canonical_url"] for row in fresh}
    for candidate in pending:
        candidate_url = engine.canon(candidate["payload"].get("url", ""))
        matching = [row for row in audits if engine.canon(row.get("original_url", "")) == candidate_url]
        decision = matching[-1] if matching else {"decision": "retry", "reason": "Aucune décision enregistrée"}
        attempts = int((candidate.get("decision") or {}).get("attempts", 0)) + 1
        retry = decision["decision"] in ("retry", "time_deferred") and attempts < 3
        accepted = decision["decision"] in ("retained", "duplicate_merged") or candidate_url in fresh_urls
        status = "retry" if retry else ("accepted" if accepted else "rejected")
        compact = {key: decision.get(key) for key in ("decision", "reason", "score", "confidence", "title", "official_url")}
        compact["attempts"] = attempts
        store.patch("hunter_scan_candidates", f"id=eq.{candidate['id']}",
                    {"status": status, "decision": compact, "updated_at": __import__("datetime").datetime.now(__import__("datetime").timezone.utc).isoformat()})
        checkpoint["analyzed"] = checkpoint.get("analyzed", 0) + (0 if retry else 1)
        checkpoint["accepted"] = checkpoint.get("accepted", 0) + (1 if accepted and not retry else 0)
        checkpoint["rejected"] = checkpoint.get("rejected", 0) + (1 if status == "rejected" else 0)
        if status == "rejected":
            category = decision.get("decision") or "unknown"
            rejection_types = dict(checkpoint.get("rejection_types") or {})
            rejection_types[category] = rejection_types.get(category, 0) + 1
            checkpoint["rejection_types"] = rejection_types
        store.event(job, f"{status.upper()} · {decision.get('title') or candidate_url[:80]} · "
                         f"score {decision.get('score') if decision.get('score') is not None else '—'}")
    total = max(1, checkpoint.get("direct_candidates", 0) + checkpoint.get("web_candidates", 0))
    progress = min(95, 45 + round(50 * checkpoint["analyzed"] / total))
    release(store, job, "analyze", checkpoint, progress)


def finish(store, job):
    checkpoint = dict(job.get("checkpoint") or {})
    discovered = store.rows("hunter_offers", f"profile_id=eq.{job['profile_id']}&discovered_at=gte.{urllib.parse.quote(job['created_at'])}&select=id&limit=1000")
    summary = {"new": len(discovered), "rejected": checkpoint.get("rejected", 0),
               "direct_candidates": checkpoint.get("direct_candidates", 0),
               "web_candidates": checkpoint.get("web_candidates", 0),
               "rejection_types": checkpoint.get("rejection_types", {}),
               "engine": "stage_hunter", "checkpointed": True}
    summary["metrics"] = {"funnel": {
        "input_candidates": summary["direct_candidates"] + summary["web_candidates"],
        "expanded_candidates": checkpoint.get("analyzed", 0),
        "retained": summary["new"], "closed": summary["rejection_types"].get("closed", 0),
        "low": summary["rejection_types"].get("rejected_low_score", 0),
        "listing": summary["rejection_types"].get("listing", 0),
        "irrelevant": sum(summary["rejection_types"].get(key, 0) for key in
                          ("not_an_offer", "rejected_contract", "rejected_eligibility")),
        "duplicate": sum(summary["rejection_types"].get(key, 0) for key in
                         ("known", "duplicate", "historical_duplicate")),
    }, "phases": {}, "web": {}, "fixed_sites": {}, "recommendations": []}
    store.patch("hunter_scan_jobs", f"id=eq.{job['id']}&lease_token=eq.{job['lease_token']}", {"summary": summary})
    store.event(job, f"Scan terminé · {summary['new']} offre(s) retenue(s), {summary['rejected']} rejetée(s).")
    release(store, job, "finish", checkpoint, 100, completed=True)


def run_slice(job_id=None):
    store = Store()
    cancelled = store.rows("hunter_scan_jobs", "cancel_requested=eq.true&status=in.(queued,running)&select=id,lease_until&limit=20")
    for job in cancelled:
        if not job["lease_until"] or job["lease_until"] < __import__("datetime").datetime.now(__import__("datetime").timezone.utc).isoformat():
            store.patch("hunter_scan_jobs", f"id=eq.{job['id']}", {"status": "cancelled",
                        "finished_at": __import__("datetime").datetime.now(__import__("datetime").timezone.utc).isoformat(),
                        "lease_token": None, "lease_until": None})
    claimed = store.rpc("hunter_claim_scan_job", {"p_job_id": job_id}) or []
    if not claimed:
        return {"claimed": False}
    job = claimed[0]
    try:
        if job["phase"] == "finish":
            finish(store, job)
        else:
            config = (job.get("checkpoint") or {}).get("profile_config")
            if config is None:
                profile_rows = store.rows("hunter_profiles",
                                          f"id=eq.{job['profile_id']}&user_id=eq.{job['user_id']}&select=config")
                if not profile_rows:
                    raise RuntimeError("Profil supprimé")
                config = profile_rows[0]["config"]
                job["checkpoint"] = {**(job.get("checkpoint") or {}), "profile_config": config}
            engine, profile = prepare_engine(config, job)
            if job["phase"] == "discover":
                discover(store, job, engine, profile)
            elif job["phase"] == "analyze":
                analyze(store, job, engine, profile)
            else:
                raise RuntimeError("Phase inconnue")
        return {"claimed": True, "job_id": job["id"], "phase": job["phase"]}
    except Exception as error:
        if still_owned(store, job):
            checkpoint = dict(job.get("checkpoint") or {})
            streak = checkpoint.get("failure_streak", 0) + 1
            checkpoint["failure_streak"] = streak
            store.event(job, f"Échec d'une étape : {str(error)[:220]}", "error")
            if streak >= 3:
                store.patch("hunter_scan_jobs", f"id=eq.{job['id']}&lease_token=eq.{job['lease_token']}",
                            {"status": "failed", "finished_at": __import__("datetime").datetime.now(__import__("datetime").timezone.utc).isoformat(),
                             "error_message": str(error)[:500], "lease_token": None, "lease_until": None})
            else:
                release(store, job, job["phase"], checkpoint, job["progress_percent"])
        raise
