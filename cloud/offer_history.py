"""Cross-scan URL memory; the scan candidate table itself is periodically pruned."""

from __future__ import annotations

import urllib.parse

EXAMINED_DECISIONS = frozenset({
    "retained", "duplicate_merged", "known", "duplicate", "historical_duplicate",
    "rejected_low_score", "rejected_contract", "rejected_eligibility",
    "closed", "not_an_offer",
})


def known_identities(store, job, identities):
    """Return fetched identities for this profile in bounded Data API batches."""
    if not hasattr(store, "rows") or not identities:
        return {}
    found = {}
    unique = list(dict.fromkeys(str(value) for value in identities if value))
    for start in range(0, len(unique), 40):
        values = unique[start:start + 40]
        encoded = ",".join(urllib.parse.quote('"' + value.replace('"', '') + '"', safe="")
                           for value in values)
        query = (f"profile_id=eq.{job['profile_id']}&identity=in.({encoded})"
                 "&select=identity,status,decision,fetched_at")
        for row in store.rows("hunter_offer_history", query):
            if row.get("fetched_at") and row.get("status") in ("accepted", "rejected", "known"):
                found[row["identity"]] = row
    return found


def examined_history_rows(job, audits, engine):
    """Only cache pages that were actually downloaded and examined."""
    result = {}
    for audit in audits:
        if (audit.get("decision") not in EXAMINED_DECISIONS
                or (audit.get("fetch") or {}).get("status") != "ok"):
            continue
        url = audit.get("original_url") or audit.get("official_url") or ""
        if not engine.safe_public_url(url):
            continue
        identity = engine.candidate_identity(url)
        if not identity:
            continue
        kind = audit.get("decision")
        status = ("accepted" if kind in ("retained", "duplicate_merged") else
                  "known" if kind in ("known", "duplicate", "historical_duplicate") else "rejected")
        result[identity] = {
            "user_id": job["user_id"], "profile_id": job["profile_id"],
            "identity": identity, "canonical_url": engine.canon(url),
            "status": status, "title": str(audit.get("title") or "")[:500],
            "company": str(audit.get("company") or "")[:500],
            "location": str((audit.get("structured_fields") or {}).get("location") or "")[:500],
            "decision": {"decision": kind, "reason": audit.get("reason"),
                         "score": audit.get("score")},
        }
    return list(result.values())


def save_examined(store, job, audits, engine):
    rows = examined_history_rows(job, audits, engine)
    for start in range(0, len(rows), 100):
        store.request("hunter_offer_history?on_conflict=profile_id,identity", "POST",
                      rows[start:start + 100], "resolution=ignore-duplicates,return=minimal")
    return len(rows)
