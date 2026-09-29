"""One durable scan slice. Called by Vercel or locally with server credentials.

Each invocation claims one Supabase lease and persists discovery/analysis before
releasing it. The existing stage_hunter engine performs ranking and scoring.
"""

from __future__ import annotations

import json
import os
import re
import shutil
import tempfile
import threading
import time
import uuid
from collections import Counter
from datetime import datetime, timezone
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from urllib.parse import urlsplit, parse_qsl

import yaml


MODE_LIMITS = {
    "Rapide": (24, 8, 4, 6),
    "Complet": (45, 16, 6, 8),
    "Maximum": (70, 25, 8, 10),
    "Exhaustif 1h": (240, 30, 8, 12),
}

# A quick scan must have a finite total cost across Vercel invocations. The
# persisted telemetry is the authority; process memory is never required.
SCAN_TOTAL_LIMITS = {
    "Rapide": (400, 600),
    "Complet": (1200, 1800),
    "Maximum": (2500, 3600),
    "Exhaustif 1h": (5000, 7200),
}

DEFERRED_DECISIONS = {"budget_skip", "time_deferred"}
TEMPORARY_DECISIONS = {"retry", "protected_access"}
MAX_DEFER_ATTEMPTS = 6
MAX_NETWORK_ATTEMPTS = 3
TELEMETRY_NUMBERS = (
    "wall_seconds", "active_seconds", "cpu_seconds", "network_seconds",
    "supabase_seconds", "gap_since_previous_invocation_seconds", "supabase_calls",
    "supabase_bytes_sent", "supabase_bytes_received", "bytes_downloaded",
    "pages_fetched", "sites", "queries", "candidates_discovered",
    "candidates_attempted", "pages_processed", "retained",
    "rejected_after_examination", "deferred", "temporarily_unavailable",
    "parsing_analysis_cpu_seconds", "filtered_non_public",
)
_PROCESS_SCAN_LOCK = threading.Lock()
_WORKER_LOCAL = threading.local()


class ScanCancelled(Exception):
    pass


def utc_now():
    return datetime.now(timezone.utc).isoformat()


def payload_bytes(value):
    return len(json.dumps(value, ensure_ascii=False, default=str).encode("utf-8"))


def prefetch_class(url, title=""):
    """Return an explainable hint. Only unequivocal advertising is excluded."""
    parsed = urlsplit(url or "")
    host = (parsed.hostname or "").lower()
    path = parsed.path.lower()
    label = (title or "").lower()
    if host.endswith(("doubleclick.net", "googleadservices.com")) or path.startswith(("/aclk", "/aclick", "/ads/")):
        return "filtered", "Lien publicitaire"
    query_keys = {key.lower() for key, _ in parse_qsl(parsed.query)}
    search_path = bool(re.search(r"/(?:search(?:-results)?|jobs/search|emploi)(?:/|$)", path))
    generic_title = bool(re.search(r"(?:^jobs at |^emplois? |\d[\d\s]* (?:emplois?|jobs?)\b|search results|résultats? de recherche)", label))
    if search_path or (path in ("", "/", "/jobs", "/careers") and generic_title) or (query_keys & {"q", "query", "keywords", "term"} and generic_title):
        return "listing", "Page de résultats ou portail à explorer avec quota"
    return "offer", "Lien individuel probable"


class Store:
    def __init__(self):
        self.url = os.environ["SUPABASE_URL"].rstrip("/")
        self.key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
        self.calls = 0
        self.bytes_sent = 0
        self.bytes_received = 0
        self.seconds = 0.0
        self.last_recorded_calls = 0
        self.invocation_id = str(uuid.uuid4())
        self.invocation_started_at = utc_now()
        self.phase_started = None
        self.phase_counts = {}
        self.engine = None
        self.local_connection = None
        self.existing_urls = set()
        self.saved_in_job_urls = set()
        self.source_yield = {}

    def request(self, path, method="GET", body=None, prefer=None):
        data = None if body is None else json.dumps(body, ensure_ascii=False).encode("utf-8")
        started = time.perf_counter()
        self.calls += 1
        self.bytes_sent += len(data or b"")
        headers = {"apikey": self.key, "Authorization": f"Bearer {self.key}",
                   "Content-Type": "application/json"}
        if prefer:
            headers["Prefer"] = prefer
        request = urllib.request.Request(f"{self.url}/rest/v1/{path}", data=data,
                                         headers=headers, method=method)
        try:
            with urllib.request.urlopen(request, timeout=25) as response:
                raw = response.read()
                self.bytes_received += len(raw)
                return json.loads(raw) if raw else None
        except urllib.error.HTTPError as error:
            details = error.read(400).decode("utf-8", errors="replace")
            raise RuntimeError(f"Supabase HTTP {error.code}: {details}") from error
        finally:
            self.seconds += time.perf_counter() - started

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

    def begin_phase(self, name, engine=None):
        self.phase_started = (name, utc_now(), time.perf_counter(), time.process_time(),
                              self.calls, self.bytes_sent, self.bytes_received, self.seconds)
        self.phase_counts = {}
        self.engine = engine
        if engine is not None:
            enable_fetch_telemetry(engine)
            engine._cloud_fetch_stats = {"bytes_downloaded": 0, "network_seconds": 0.0,
                                         "pages_fetched": 0, "http_errors_by_domain": {}}


def enable_fetch_telemetry(engine):
    """Observe the existing fetch path without changing local scanner behavior."""
    if hasattr(engine, "_cloud_original_fetch"):
        return
    import threading
    engine._cloud_original_fetch = engine.fetch
    engine._cloud_fetch_lock = threading.Lock()
    engine._cloud_domain_lock = threading.Lock()
    engine._cloud_domain_semaphores = {}

    def observed_fetch(url):
        started = time.perf_counter()
        domain = engine.dom(url)
        with engine._cloud_domain_lock:
            semaphore = engine._cloud_domain_semaphores.setdefault(domain, threading.Semaphore(2))
        try:
            with semaphore:
                return engine._cloud_original_fetch(url)
        finally:
            meta = getattr(engine._HTTP_LOCAL, "last_fetch_meta", {}) or {}
            stats = getattr(engine, "_cloud_fetch_stats", None)
            if stats is not None:
                with engine._cloud_fetch_lock:
                    stats["network_seconds"] += time.perf_counter() - started
                    stats["pages_fetched"] += 1
                    stats["bytes_downloaded"] += int(meta.get("bytes_read") or 0)
                    code = meta.get("http_status")
                    if code and int(code) >= 400:
                        domain = engine.dom(url)
                        errors = stats["http_errors_by_domain"].setdefault(domain, {})
                        errors[str(code)] = errors.get(str(code), 0) + 1
    engine.fetch = observed_fetch


def record_phase(store, job, checkpoint, planned_calls=1):
    if store.phase_started is None:
        return checkpoint
    name, started_at, started, cpu_started, calls, sent, received, supabase_seconds = store.phase_started
    ended_at = utc_now()
    previous = (checkpoint.get("telemetry") or {}).get("last_end")
    previous_invocation = (checkpoint.get("telemetry") or {}).get("last_invocation_id")
    gap = max(0, (datetime.fromisoformat(started_at) - datetime.fromisoformat(previous)).total_seconds()) if previous and previous_invocation != store.invocation_id else 0
    fetch = getattr(store.engine, "_cloud_fetch_stats", {}) if store.engine else {}
    item = {"invocation_id": store.invocation_id, "invocation_started_at": store.invocation_started_at,
            "phase": name, "started_at": started_at, "ended_at": ended_at,
            "wall_seconds": round(time.perf_counter() - started, 3),
            "active_seconds": round(max(0, time.perf_counter() - started - (store.seconds - supabase_seconds)), 3),
            "cpu_seconds": round(time.process_time() - cpu_started, 3),
            "network_seconds": round(fetch.get("network_seconds", 0) + store.phase_counts.pop("search_network_seconds", 0), 3),
            "supabase_seconds": round(store.seconds - supabase_seconds, 3),
            "gap_since_previous_invocation_seconds": round(gap, 3),
            "supabase_calls": store.calls - getattr(store, "last_recorded_calls", calls) + planned_calls,
            "supabase_bytes_sent": store.bytes_sent - sent,
            "supabase_bytes_received": store.bytes_received - received,
            "bytes_downloaded": fetch.get("bytes_downloaded", 0),
            "pages_fetched": fetch.get("pages_fetched", 0),
            "http_errors_by_domain": fetch.get("http_errors_by_domain", {}),
            **store.phase_counts}
    telemetry = dict(checkpoint.get("telemetry") or {})
    totals = dict(telemetry.get("totals") or {})
    for key in TELEMETRY_NUMBERS:
        totals[key] = round(totals.get(key, 0) + item.get(key, 0), 3)
    telemetry["totals"] = totals
    by_phase = dict(telemetry.get("by_phase") or {})
    phase_total = dict(by_phase.get(name) or {})
    phase_total["batches"] = phase_total.get("batches", 0) + 1
    for key in ("wall_seconds", "supabase_seconds", "network_seconds", "parsing_analysis_cpu_seconds"):
        phase_total[key] = round(phase_total.get(key, 0) + item.get(key, 0), 3)
    by_phase[name] = phase_total
    telemetry["by_phase"] = by_phase
    telemetry["invocations"] = telemetry.get("invocations", 0) + int(previous_invocation != store.invocation_id)
    http_errors = dict(telemetry.get("http_errors_by_domain") or {})
    for domain, codes in item["http_errors_by_domain"].items():
        target = dict(http_errors.get(domain) or {})
        for code, count in codes.items():
            target[code] = target.get(code, 0) + count
        http_errors[domain] = target
    telemetry["http_errors_by_domain"] = http_errors
    retry_causes = dict(telemetry.get("retry_causes") or {})
    for cause, count in (item.get("retry_causes") or {}).items():
        retry_causes[cause] = retry_causes.get(cause, 0) + count
    telemetry["retry_causes"] = retry_causes
    backends = dict(telemetry.get("search_engines") or {})
    for backend, values in (item.get("search_engines") or {}).items():
        target = dict(backends.get(backend) or {})
        for key, count in values.items():
            target[key] = target.get(key, 0) + count
        backends[backend] = target
    telemetry["search_engines"] = backends
    telemetry["phases"] = (telemetry.get("phases") or [])[-199:] + [item]
    telemetry["last_end"] = ended_at
    telemetry["last_invocation_id"] = store.invocation_id
    checkpoint["telemetry"] = telemetry
    store.phase_started = None
    store.last_recorded_calls = store.calls + planned_calls
    return checkpoint


def prepare_engine(config, job, store=None):
    import stage_hunter as engine
    from datetime import datetime, timezone

    # Warm Vercel instances reuse the module globals from the previous slice.
    engine.ROOT = Path(engine.__file__).resolve().parent

    # The function bundle is read-only; diagnostics and the temporary SQLite DB
    # live only in /tmp. Supabase remains the durable source of truth.
    directory = Path(tempfile.mkdtemp(prefix="hunter-scan-"))
    _WORKER_LOCAL.temp_dirs = getattr(_WORKER_LOCAL, "temp_dirs", []) + [directory]
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
    # A genuine empty result is observed, then the other backend is sampled
    # on later queries; repeating the same query wastes the cloud budget.
    os.environ["WEB_RETRY_EMPTY_RESULTS"] = "0"

    def hook(msg, style=''):
        clean = str(msg).strip()
        keep = clean.startswith(("BUDGET PAGES", "ANALYSE terminée", "WEB terminé",
                                 "WEB COUPE-CIRCUIT", "LISTINGS — budget temps"))
        if store and job and clean and keep:
            try: store.event(job, clean)
            except Exception: pass
    engine.EVENT_HOOK = hook

    return engine, profile


def candidate_rows(store, job, rows, status="pending", profile=None):
    import stage_hunter as engine

    unique = {}
    for row in rows:
        url = row.get("url")
        if not url or not engine.safe_public_url(url):
            store.phase_counts["filtered_non_public"] = store.phase_counts.get("filtered_non_public", 0) + 1
            continue
        canonical = engine.canon(url)
        identity = engine.candidate_identity(url)
        if canonical and identity:
            kind, reason = prefetch_class(url, row.get("title", ""))
            effective_status = "filtered" if kind == "filtered" and status == "pending" else status
            decision = row.get("_candidate_decision") or {}
            if kind == "filtered" and status == "pending":
                decision = {"decision": "prefilter", "reason": reason, "reviewable": True}
            prior = store.source_yield.get(row.get("source") or engine.dom(url), {})
            history_bonus = round(12 * prior.get("retained", 0) / max(1, prior.get("candidates", 0))) if prior.get("candidates", 0) >= 5 else 0
            unique[identity] = {"job_id": job["id"], "user_id": job["user_id"],
                                "canonical_url": canonical, "identity": identity,
                                "payload": {k: v for k, v in row.items() if k != "_candidate_decision"},
                                "status": effective_status, "decision": decision,
                                "priority": (int(engine.listing_lead_priority(row, profile)) if profile else 0)
                                            + history_bonus - (20 if kind == "listing" else 0)}
    for start in range(0, len(unique), 100):
        batch = list(unique.values())[start:start + 100]
        store.request("hunter_scan_candidates?on_conflict=job_id,identity", "POST",
                      batch, "resolution=ignore-duplicates,return=minimal")
    return len(unique)


def still_owned(store, job):
    rows = store.rows("hunter_scan_jobs", f"id=eq.{job['id']}&select=lease_token,lease_until,cancel_requested,status")
    lease_until = rows[0].get("lease_until") if rows else None
    lease_valid = bool(lease_until) and datetime.fromisoformat(lease_until.replace("Z", "+00:00")) > datetime.now(timezone.utc)
    return (len(rows) == 1 and rows[0]["lease_token"] == job["lease_token"]
            and rows[0]["status"] == "running" and not rows[0]["cancel_requested"]
            and lease_valid)


def release(store, job, phase, checkpoint, progress, completed=False):
    checkpoint = record_phase(store, job, checkpoint)
    ok = store.rpc("hunter_release_scan_job", {
        "p_job_id": job["id"], "p_lease_token": job["lease_token"],
        "p_phase": phase, "p_checkpoint": checkpoint,
        "p_progress_percent": progress, "p_completed": completed,
    })
    if not ok:
        if settle_cancel(store, job):
            raise ScanCancelled("Scan annulé")
        raise RuntimeError("Le bail du scan a expiré avant l'enregistrement du checkpoint")


def settle_cancel(store, job):
    rows = store.rows("hunter_scan_jobs", f"id=eq.{job['id']}&select=lease_token,cancel_requested,status")
    if rows and rows[0]["lease_token"] == job["lease_token"] and rows[0]["cancel_requested"]:
        store.patch("hunter_scan_jobs", f"id=eq.{job['id']}&lease_token=eq.{job['lease_token']}&cancel_requested=eq.true",
                    {"status": "cancelled", "finished_at": utc_now(),
                     "lease_token": None, "lease_until": None})
        return True
    return False


def apply_decisions(store, job, changes):
    if not changes:
        return
    changed = store.rpc("hunter_apply_scan_decisions", {
        "p_job_id": job["id"], "p_lease_token": job["lease_token"], "p_rows": changes,
    })
    if changed != len(changes):
        if settle_cancel(store, job):
            raise ScanCancelled("Scan annulé")
        raise RuntimeError("Décisions non sauvegardées : bail perdu ou candidat absent")


def discover(store, job, engine, profile):
    checkpoint = dict(job.get("checkpoint") or {})
    checkpoint["failure_streak"] = 0
    query_limit, site_limit, _, _ = MODE_LIMITS[job["mode"]]
    direct_urls = engine.targeted_fixed_urls(profile)[:site_limit]
    queries = engine.build_search_queries(profile, emit_log=False)[:query_limit]
    direct_cursor = engine.safe_int(checkpoint.get("direct_cursor"), 0)
    web_cursor = engine.safe_int(checkpoint.get("web_cursor"), 0)

    if direct_cursor < len(direct_urls):
        # Preserve the local engine's URL discovery and filtering rules.
        subset = direct_urls[direct_cursor:direct_cursor + job.get("batch_size", 2)]
        direct_profile = {**profile, "_source_pack_urls": subset}
        os.environ["FIXED_SITE_LIMIT"] = str(len(subset))
        rows = engine.fixed_site_candidates(direct_profile)
        visited_sites = engine.SCAN_METRICS.get("fixed_sites_visited", 0)
        store.phase_counts = {"sites": visited_sites, "queries": 0, "candidates_discovered": len(rows),
                              "pages_processed": visited_sites}
        found = candidate_rows(store, job, rows, profile=profile)
        # A time-limited engine call can return before visiting its full lot.
        # Repeating a partial lot is safe because candidates have unique IDs.
        checkpoint["direct_cursor"] = direct_cursor + len(subset) if visited_sites >= len(subset) else direct_cursor
        if visited_sites < len(subset):
            checkpoint["retry_delay_seconds"] = 30
        else:
            checkpoint.pop("retry_delay_seconds", None)
        checkpoint["direct_candidates"] = engine.safe_int(checkpoint.get("direct_candidates"), 0) + found
        message = f"Sites directs {checkpoint['direct_cursor']}/{len(direct_urls)} · {found} candidat(s) collecté(s)"
    elif web_cursor < len(queries):
        subset = queries[web_cursor:web_cursor + job.get("batch_size", 4)]
        search_started = time.perf_counter()
        rows = engine.search_web(subset, engine.safe_int(os.getenv("SEARCH_RESULTS_PER_QUERY"), 8))
        web_metrics = engine.SCAN_METRICS.get("web", {})
        store.phase_counts = {"sites": 0, "queries": web_metrics.get("executed", len(subset)),
                              "candidates_discovered": len(rows), "pages_processed": 0,
                              "search_network_seconds": time.perf_counter() - search_started,
                              "search_engines": web_metrics.get("backends", {}),
                              "search_empty": web_metrics.get("empty", 0),
                              "search_failed": web_metrics.get("failed", 0)}
        found = candidate_rows(store, job, rows, profile=profile)
        executed = web_metrics.get("executed", 0)
        checkpoint["web_cursor"] = web_cursor + len(subset) if executed >= len(subset) else web_cursor
        if executed < len(subset):
            checkpoint["retry_delay_seconds"] = 30
        else:
            checkpoint.pop("retry_delay_seconds", None)
        checkpoint["web_candidates"] = engine.safe_int(checkpoint.get("web_candidates"), 0) + found
        message = f"Recherche web {checkpoint['web_cursor']}/{len(queries)} · {found} candidat(s) collecté(s)"
    else:
        store.event(job, "Découverte terminée. Analyse et notation des opportunités en cours.")
        release(store, job, "analyze", checkpoint, 45)
        return

    if not still_owned(store, job):
        return
    store.event(job, message)
    completed = direct_cursor >= len(direct_urls) and web_cursor >= len(queries)
    done = direct_cursor + web_cursor
    total = max(1, len(direct_urls) + len(queries))
    release(store, job, "analyze" if completed else "discover", checkpoint,
            45 if completed else min(44, round(done * 44 / total)))


OFFER_COLUMNS = ("url", "canonical_url", "title", "company", "location", "canton", "source",
                 "snippet", "body", "language", "duration", "start_date", "domain_category",
                 "skills_found", "score", "confidence", "reasons", "availability_status",
                 "review_decision", "reviewed_at", "discovered_at")
EXISTING_COLUMNS = ("url", "canonical_url", "title", "company", "source", "snippet",
                    "body", "score", "review_decision", "reviewed_at", "discovered_at")


def candidate_outcome(decision, previous=None):
    """A missing examination can never become a rejection."""
    previous = previous or {}
    kind = decision.get("decision", "retry")
    attempts = int(previous.get("attempts") or 0)
    deferrals = int(previous.get("deferrals") or 0)
    if kind in DEFERRED_DECISIONS:
        deferrals += 1
        status = "deferred" if deferrals < MAX_DEFER_ATTEMPTS else "unexamined"
    elif kind in ("retry", "empty_page") or (kind == "protected_access" and (decision.get("fetch") or {}).get("http_status") == 429):
        attempts += 1
        max_attempts = 2 if kind == "empty_page" else MAX_NETWORK_ATTEMPTS
        status = "retry" if attempts < max_attempts else "unavailable"
    elif kind in ("invalid_url", "gone"):
        status = "unavailable"
    elif kind == "protected_access":
        attempts += 1
        status = "unavailable"
    elif kind in ("known", "duplicate", "historical_duplicate"):
        status = "known"
    elif kind == "filtered":
        status = "filtered"
    elif kind in ("retained", "duplicate_merged"):
        attempts += 1
        status = "accepted"
    else:
        attempts += 1
        status = "rejected"
    return status, attempts, deferrals


def retry_delay_seconds(decision, attempts):
    code = (decision.get("fetch") or {}).get("http_status")
    if code == 429:
        return min(300, 120 * (2 ** max(0, attempts - 1)))
    return min(180, 30 * (2 ** max(0, attempts - 1)))


def update_domain_health(health, domain, decision, now=None):
    """Suspend repeated transport failures for ten minutes, then probe again."""
    now = now or datetime.now(timezone.utc)
    health = dict(health)
    kind = decision.get("decision")
    if kind in TEMPORARY_DECISIONS:
        row = dict(health.get(domain) or {})
        row["failures"] = row.get("failures", 0) + 1
        if row["failures"] >= 3:
            row["suspended_until"] = datetime.fromtimestamp(now.timestamp() + 600, timezone.utc).isoformat()
        health[domain] = row
    elif kind not in DEFERRED_DECISIONS:
        health.pop(domain, None)
    return health


def audit_candidate_rows(audits, engine):
    """Materialize listing children, including deferred and examined ones."""
    rows = {}
    for audit in audits:
        url = audit.get("original_url") or audit.get("official_url") or audit.get("url")
        if not url or not engine.safe_public_url(url):
            continue
        identity = engine.candidate_identity(url)
        status, attempts, deferrals = candidate_outcome(audit)
        rows[identity] = {"url": url, "title": audit.get("title") or "",
                          "source": audit.get("source") or engine.dom(url),
                          "origin": audit.get("origin") or "listing_recursive",
                          "_depth": audit.get("depth") or 0,
                          "_contract_hint": audit.get("contract_hint") or False,
                          "_candidate_decision": {"decision": audit.get("decision"),
                              "reason": audit.get("reason"), "attempts": attempts,
                              "deferrals": deferrals, "status": status,
                              "reviewable": status == "filtered",
                              "fetch": {key: (audit.get("fetch") or {}).get(key) for key in
                                        ("status", "http_status", "error_type", "bytes_read")}}}
    return list(rows.values())


def scan_limit_reached(job):
    pages_limit, wall_limit = SCAN_TOTAL_LIMITS[job["mode"]]
    totals = ((job.get("checkpoint") or {}).get("telemetry") or {}).get("totals") or {}
    pages = float(totals.get("pages_fetched") or 0)
    wall = float(totals.get("wall_seconds") or 0)
    if pages >= pages_limit:
        return f"Limite de sécurité du scan : {pages_limit} pages téléchargées"
    if wall >= wall_limit:
        return f"Limite de sécurité du scan : {wall_limit} secondes de traitement"
    return None


def analyze(store, job, engine, profile):
    limit_reason = scan_limit_reached(job)
    if limit_reason:
        checkpoint = dict(job.get("checkpoint") or {})
        checkpoint["partial_reason"] = limit_reason
        store.event(job, f"Scan partiel · {limit_reason}. Les pistes restantes restent en attente, sans rejet.")
        release(store, job, "finish", checkpoint, 96)
        return
    due_at = urllib.parse.quote(utc_now(), safe="")
    pending = store.rows("hunter_scan_candidates",
                         f"job_id=eq.{job['id']}&status=in.(pending,retry,deferred)&next_attempt_at=lte.{due_at}&select=id,payload,decision,priority&order=priority.desc,id.asc&limit=30")
    batch_limit = job.get("batch_size", 5)
    if len(pending) > batch_limit:
        # Reserve one slot for a source with little history. The choice is
        # deterministic inside the ordered window and cannot starve old rows.
        leading = pending[:batch_limit - 1]
        exploratory = next((row for row in reversed(pending[batch_limit - 1:])
                            if store.source_yield.get(row["payload"].get("source") or "", {}).get("candidates", 0) < 5),
                           pending[-1])
        pending = leading + [exploratory]
    checkpoint = dict(job.get("checkpoint") or {})
    health = dict(checkpoint.get("domain_health") or {})
    ready = []
    changes = []
    for candidate in pending:
        domain = engine.dom(candidate["payload"].get("url", ""))
        suspended_until = (health.get(domain) or {}).get("suspended_until")
        if suspended_until and datetime.fromisoformat(suspended_until) > datetime.now(timezone.utc):
            changes.append({"id": candidate["id"], "status": "deferred",
                            "next_attempt_at": suspended_until,
                            "decision": {**(candidate.get("decision") or {}),
                                         "decision": "domain_cooldown", "reason": "Domaine temporairement suspendu"}})
        else:
            ready.append(candidate)
    pending = ready
    if not pending:
        checkpoint["failure_streak"] = 0
        checkpoint["domain_health"] = health
        apply_decisions(store, job, changes)
        waiting = store.rows("hunter_scan_candidates",
                             f"job_id=eq.{job['id']}&status=in.(pending,retry,deferred)&select=next_attempt_at&order=next_attempt_at.asc&limit=1")
        if waiting:
            due = datetime.fromisoformat(waiting[0]["next_attempt_at"].replace("Z", "+00:00"))
            checkpoint["retry_delay_seconds"] = min(300, max(1, int((due - datetime.now(timezone.utc)).total_seconds()) + 1))
            release(store, job, "analyze", checkpoint, job["progress_percent"])
        else:
            checkpoint.pop("retry_delay_seconds", None)
            release(store, job, "finish", checkpoint, 96)
        return
    checkpoint.pop("retry_delay_seconds", None)
    store.phase_counts = {"candidates_attempted": len(pending), "pages_processed": 0,
                          "retained": 0, "rejected_after_examination": 0,
                          "deferred": 0, "temporarily_unavailable": 0,
                          "retry_causes": {}}
    if store.local_connection is None:
        store.local_connection = engine.init_db()
        _WORKER_LOCAL.connections = getattr(_WORKER_LOCAL, "connections", []) + [store.local_connection]
        existing = []
        for offset in range(0, 100000, 1000):
            page = store.rows("hunter_offers", f"profile_id=eq.{job['profile_id']}&user_id=eq.{job['user_id']}&select="
                              + ",".join(EXISTING_COLUMNS) + f"&order=id.asc&limit=1000&offset={offset}")
            existing.extend(page)
            if len(page) < 1000:
                break
        for offer in existing:
            values = [offer.get(column) for column in EXISTING_COLUMNS]
            store.local_connection.execute(f"INSERT OR IGNORE INTO offers ({','.join(EXISTING_COLUMNS)}) VALUES ({','.join('?' for _ in values)})", values)
        store.local_connection.commit()
        store.existing_urls = {offer["canonical_url"] for offer in existing}
        job_started = datetime.fromisoformat(job["created_at"].replace("Z", "+00:00"))
        store.saved_in_job_urls = {
            offer["canonical_url"] for offer in existing
            if offer.get("discovered_at") and
            datetime.fromisoformat(offer["discovered_at"].replace("Z", "+00:00")) >= job_started
        }
    connection = store.local_connection
    analysis_cpu_started = time.process_time()
    engine.ingest(connection, [candidate["payload"] for candidate in pending], profile)
    store.phase_counts["parsing_analysis_cpu_seconds"] = round(time.process_time() - analysis_cpu_started, 3)
    engine.close_decision_audit()
    if not still_owned(store, job):
        return

    existing_urls = store.existing_urls
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
    store.existing_urls.update(row["canonical_url"] for row in fresh)
    store.saved_in_job_urls.update(row["canonical_url"] for row in fresh)
    checkpoint["new_offers"] = checkpoint.get("new_offers", 0) + len(fresh)

    audits = []
    if engine.DECISION_AUDIT_PATH and engine.DECISION_AUDIT_PATH.exists():
        with engine.DECISION_AUDIT_PATH.open(encoding="utf-8") as source:
            audits = [json.loads(line) for line in source if line.strip()]
    # Persist children of listings before changing parent statuses or releasing
    # the lease. A crash afterwards leaves a durable, deduplicated queue.
    original_ids = {engine.candidate_identity(row["payload"].get("url", "")) for row in pending}
    children = [row for row in audit_candidate_rows(audits, engine)
                if engine.candidate_identity(row["url"]) not in original_ids]
    for status in ("deferred", "retry", "unavailable", "unexamined", "accepted", "rejected", "known", "filtered"):
        subset = [row for row in children if row["_candidate_decision"]["status"] == status]
        if subset:
            candidate_rows(store, job, subset, status=status, profile=profile)
    checkpoint["failure_streak"] = 0
    fresh_urls = {row["canonical_url"] for row in fresh}
    for candidate in pending:
        candidate_url = engine.canon(candidate["payload"].get("url", ""))
        matching = [row for row in audits if engine.canon(row.get("original_url", "")) == candidate_url]
        decision = matching[-1] if matching else {"decision": "retry", "reason": "Aucune décision enregistrée"}
        status, attempts, deferrals = candidate_outcome(decision, candidate.get("decision"))
        domain = engine.dom(candidate_url)
        health = update_domain_health(health, domain, decision)
        official_url = engine.canon(decision.get("official_url") or "")
        accepted = (status == "accepted" or candidate_url in fresh_urls or official_url in fresh_urls
                    or candidate_url in store.saved_in_job_urls or official_url in store.saved_in_job_urls)
        if accepted:
            status = "accepted"
        store.phase_counts["pages_processed"] += int(bool((decision.get("fetch") or {}).get("status")))
        store.phase_counts["retained"] += int(status == "accepted")
        store.phase_counts["rejected_after_examination"] += int(status == "rejected")
        store.phase_counts["deferred"] += int(status in ("deferred", "unexamined"))
        store.phase_counts["temporarily_unavailable"] += int(status in ("retry", "unavailable"))
        if status in ("retry", "unavailable"):
            cause = str(decision.get("reason") or decision.get("decision") or "inconnue")[:100]
            retry_causes = store.phase_counts["retry_causes"]
            retry_causes[cause] = retry_causes.get(cause, 0) + 1
        compact = {key: decision.get(key) for key in ("decision", "reason", "score", "confidence", "title", "official_url")}
        compact["fetch"] = {key: (decision.get("fetch") or {}).get(key) for key in
                            ("status", "http_status", "error_type", "bytes_read")}
        compact["attempts"] = attempts
        compact["deferrals"] = deferrals
        delay = (retry_delay_seconds(decision, attempts) if status == "retry" else
                 (20 if status == "deferred" and decision.get("decision") == "budget_skip" else
                  30 if status == "deferred" else 0))
        next_attempt = datetime.fromtimestamp(datetime.now(timezone.utc).timestamp() + delay, timezone.utc).isoformat()
        changes.append({"id": candidate["id"], "status": status, "decision": compact,
                        "next_attempt_at": next_attempt})
        checkpoint["analyzed"] = engine.safe_int(checkpoint.get("analyzed"), 0) + (1 if status in ("accepted", "rejected") else 0)
        checkpoint["accepted"] = engine.safe_int(checkpoint.get("accepted"), 0) + (1 if accepted else 0)
        checkpoint["rejected"] = engine.safe_int(checkpoint.get("rejected"), 0) + (1 if status == "rejected" else 0)
        if status == "rejected":
            category = decision.get("decision") or "unknown"
            rejection_types = dict(checkpoint.get("rejection_types") or {})
            rejection_types[category] = rejection_types.get(category, 0) + 1
            checkpoint["rejection_types"] = rejection_types
        status_tag = {"accepted": "✅ RETENUE", "rejected": "❌ ÉCARTÉE", "known": "♻️ DÉJÀ CONNUE",
                      "deferred": "⏳ DIFFÉRÉE", "unexamined": "⏳ NON EXAMINÉE",
                      "retry": "🔄 ACCÈS TEMPORAIRE", "unavailable": "⚠️ INACCESSIBLE"}[status]
        title_tag = decision.get('title') or candidate_url[:80]
        score_val = decision.get('score')
        score_tag = f"score {score_val}/100" if score_val is not None else "sans score"
        reason_tag = f" ({decision.get('reason')})" if decision.get('reason') else ""
        # Candidate decisions are durable in the candidate table; avoid a
        # second write per candidate to the event log.
    total = max(1, engine.safe_int(checkpoint.get("direct_candidates"), 0) + engine.safe_int(checkpoint.get("web_candidates"), 0))
    progress = min(95, 45 + round(50 * engine.safe_int(checkpoint.get("analyzed"), 0) / total))
    checkpoint["domain_health"] = health
    apply_decisions(store, job, changes)
    release(store, job, "analyze", checkpoint, progress)


def finish(store, job):
    if not still_owned(store, job):
        if settle_cancel(store, job):
            raise ScanCancelled("Scan annulé")
        raise RuntimeError("Bail expiré avant finalisation")
    checkpoint = dict(job.get("checkpoint") or {})
    discovered_count = 0
    for offset in range(0, 100000, 1000):
        page = store.rows("hunter_offers", f"profile_id=eq.{job['profile_id']}&user_id=eq.{job['user_id']}"
                          f"&discovered_at=gte.{urllib.parse.quote(job['created_at'])}&select=id&order=id.asc&limit=1000&offset={offset}")
        discovered_count += len(page)
        if len(page) < 1000:
            break
    counts = Counter()
    source_counts = {}
    retry_causes = Counter()
    prefilter_reasons = Counter()
    for offset in range(0, 100000, 1000):
        page = store.rows("hunter_scan_candidates",
                          f"job_id=eq.{job['id']}&user_id=eq.{job['user_id']}&select=status,decision,payload&order=id.asc&limit=1000&offset={offset}")
        counts.update(row["status"] for row in page)
        for row in page:
            domain = (row.get("payload") or {}).get("source") or "inconnu"
            source = source_counts.setdefault(domain[:100], {"candidates": 0, "retained": 0})
            source["candidates"] += 1
            source["retained"] += int(row["status"] == "accepted")
            decision = row.get("decision") or {}
            if row["status"] == "filtered":
                prefilter_reasons[str(decision.get("reason") or "inconnue")[:100]] += 1
            if row["status"] in ("retry", "unavailable"):
                retry_causes[str(decision.get("reason") or "inconnue")[:100]] += 1
        if len(page) < 1000:
            break
    summary = {"new": discovered_count, "rejected": counts["rejected"],
               "pending": counts["pending"] + counts["deferred"] + counts["retry"],
               "unexamined": counts["unexamined"],
               "deferred": counts["deferred"] + counts["unexamined"],
               "temporarily_unavailable": counts["retry"] + counts["unavailable"],
               "accepted_candidates": counts["accepted"],
               "filtered_pre_download": counts["filtered"],
               "direct_candidates": checkpoint.get("direct_candidates", 0),
               "web_candidates": checkpoint.get("web_candidates", 0),
               "rejection_types": checkpoint.get("rejection_types", {}),
               "engine": "stage_hunter", "checkpointed": True,
               "partial_reason": checkpoint.get("partial_reason")}
    # Summary PATCH, aggregate completion event and release RPC follow this
    # snapshot; count their calls without adding a second telemetry write.
    checkpoint = record_phase(store, job, checkpoint, planned_calls=3)
    telemetry = checkpoint.get("telemetry") or {}
    phases = telemetry.get("phases") or []
    totals = telemetry.get("totals") or {key: round(sum(phase.get(key, 0) for phase in phases), 3)
                                          for key in TELEMETRY_NUMBERS}
    http_errors = telemetry.get("http_errors_by_domain") or {}
    backend_totals = telemetry.get("search_engines") or {}
    phase_totals = telemetry.get("by_phase") or {}
    if totals.get("filtered_non_public"):
        prefilter_reasons["Lien non public ou URL invalide"] += totals["filtered_non_public"]
    summary["metrics"] = {"funnel": {
        "input_candidates": summary["direct_candidates"] + summary["web_candidates"],
        "expanded_candidates": counts["accepted"] + counts["rejected"],
        "retained": summary["new"], "closed": summary["rejection_types"].get("closed", 0),
        "filtered_pre_download": counts["filtered"],
        "rejected_after_examination": counts["rejected"],
        "deferred": summary["deferred"], "temporarily_unavailable": summary["temporarily_unavailable"],
        "low": summary["rejection_types"].get("rejected_low_score", 0),
        "listing": summary["rejection_types"].get("listing", 0),
        "irrelevant": sum(summary["rejection_types"].get(key, 0) for key in
                          ("not_an_offer", "rejected_contract", "rejected_eligibility")),
        "duplicate": sum(summary["rejection_types"].get(key, 0) for key in
                         ("known", "duplicate", "historical_duplicate")),
    }, "cloud": {"totals": totals, "phases": phases,
                   "http_errors_by_domain": http_errors,
                   "retry_causes": telemetry.get("retry_causes") or dict(retry_causes.most_common(20)),
                   "prefilter_reasons": dict(prefilter_reasons.most_common(10)),
                   "invocations": telemetry.get("invocations", len({phase["invocation_id"] for phase in phases}))},
       "phases": phase_totals,
       "web": {"executed": totals["queries"], "links": checkpoint.get("web_candidates", 0),
               "backends": backend_totals},
       "fixed_sites": {"visited": totals["sites"], "links": checkpoint.get("direct_candidates", 0)},
       "source_yield": source_counts, "recommendations": []}
    store.patch("hunter_scan_jobs", f"id=eq.{job['id']}&lease_token=eq.{job['lease_token']}", {"summary": summary})
    completion = "Scan partiel terminé" if summary["partial_reason"] else "Scan terminé"
    store.event(job, f"{completion} · {summary['new']} offre(s) retenue(s), {summary['rejected']} rejetée(s) après examen, {summary['deferred']} non examinée(s), {summary['temporarily_unavailable']} inaccessible(s).")
    release(store, job, "finish", checkpoint, 100, completed=True)


def run_slice(job_id=None):
    # The shared engine uses module globals and environment variables. A warm
    # Fluid Compute process may serve concurrent requests, so isolate them here.
    if not _PROCESS_SCAN_LOCK.acquire(blocking=False):
        return {"claimed": False, "busy": True}
    _WORKER_LOCAL.temp_dirs = []
    _WORKER_LOCAL.connections = []
    try:
        return _run_slice(job_id)
    finally:
        for connection in getattr(_WORKER_LOCAL, "connections", []):
            try:
                connection.close()
            except Exception:
                pass
        temp_root = Path(tempfile.gettempdir()).resolve()
        for directory in getattr(_WORKER_LOCAL, "temp_dirs", []):
            resolved = directory.resolve()
            if resolved.name.startswith("hunter-scan-") and resolved.is_relative_to(temp_root):
                shutil.rmtree(resolved, ignore_errors=True)
        _PROCESS_SCAN_LOCK.release()


def _run_slice(job_id=None):
    store = Store()
    invocation_started = time.perf_counter()
    budget = max(60, min(int(os.getenv("SCAN_INVOCATION_BUDGET_SECONDS", "225")), 230))
    deadline = invocation_started + budget
    cancelled = store.rows("hunter_scan_jobs", "cancel_requested=eq.true&status=in.(queued,running)&select=id,lease_until&limit=20")
    for job in cancelled:
        if not job["lease_until"] or job["lease_until"] < __import__("datetime").datetime.now(__import__("datetime").timezone.utc).isoformat():
            store.patch("hunter_scan_jobs", f"id=eq.{job['id']}", {"status": "cancelled",
                        "finished_at": __import__("datetime").datetime.now(__import__("datetime").timezone.utc).isoformat(),
                        "lease_token": None, "lease_until": None})
    completed_batches = 0
    cached_engine = cached_profile = None
    history_loaded = False
    last_duration = None
    last_phase = None
    target_job_id = job_id
    while time.perf_counter() < deadline - 45:
        claimed = store.rpc("hunter_claim_scan_job", {"p_job_id": target_job_id}) or []
        if not claimed:
            break
        job = claimed[0]
        # A dispatcher may claim any due job once, but an invocation may only
        # reuse engine globals, SQLite state and profile history for that job.
        target_job_id = job["id"]
        phase = job["phase"]
        remaining = deadline - time.perf_counter()
        base_size = {"discover": 2, "analyze": 5, "finish": 1}[phase]
        if phase == "discover" and (job.get("checkpoint") or {}).get("direct_cursor", 0) >= MODE_LIMITS[job["mode"]][1]:
            base_size = 4
        if last_phase == phase and last_duration is not None:
            if last_duration < 20 and remaining > 100:
                base_size = min(base_size * 2, 8)
            elif last_duration > 60:
                base_size = max(1, base_size // 2)
        job["batch_size"] = base_size
        phase_started = time.perf_counter()
        try:
            if phase == "finish":
                store.begin_phase(phase)
                if not still_owned(store, job):
                    break
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
                if cached_engine is None:
                    if not history_loaded:
                        previous = store.rows("hunter_scan_jobs",
                                              f"profile_id=eq.{job['profile_id']}&user_id=eq.{job['user_id']}&status=eq.completed&select=summary&order=finished_at.desc&limit=1")
                        prior_backends = (((previous[0].get("summary") or {}).get("metrics") or {}).get("web") or {}).get("backends", {}) if previous else {}
                        store.source_yield = (((previous[0].get("summary") or {}).get("metrics") or {}).get("source_yield") or {}) if previous else {}
                        weights = {name: values.get("results", 0) / max(1, values.get("attempts", 0))
                                   for name, values in prior_backends.items() if values.get("attempts", 0) >= 5}
                        os.environ["SEARCH_BACKEND_WEIGHTS"] = json.dumps(weights)
                        history_loaded = True
                    cached_engine, cached_profile = prepare_engine(config, job, store)
                cached_engine.RUN_STARTED = time.perf_counter()
                os.environ["SCAN_TIME_BUDGET_SECONDS"] = str(max(35, min(180, int(remaining - 30))))
                os.environ["SCAN_DEADLINE_RESERVE_SECONDS"] = "15"
                store.begin_phase(phase, cached_engine)
                if not still_owned(store, job):
                    break
                if phase == "discover":
                    discover(store, job, cached_engine, cached_profile)
                elif phase == "analyze":
                    analyze(store, job, cached_engine, cached_profile)
                else:
                    raise RuntimeError("Phase inconnue")
            completed_batches += 1
            last_duration = time.perf_counter() - phase_started
            last_phase = phase
            if phase == "finish":
                break
            current = store.rows("hunter_scan_jobs", f"id=eq.{job['id']}&select=status,cancel_requested,lease_token")
            if current and current[0]["cancel_requested"]:
                # Release was refused after a mid-batch cancellation; only the
                # holder of this token may settle it before lease expiry.
                if current[0]["lease_token"] == job["lease_token"]:
                    settle_cancel(store, job)
                break
            if current and current[0]["status"] in ("failed", "cancelled", "completed"):
                break
        except ScanCancelled:
            break
        except Exception as error:
            if still_owned(store, job):
                checkpoint = dict(job.get("checkpoint") or {})
                streak = checkpoint.get("failure_streak", 0) + 1
                checkpoint["failure_streak"] = streak
                store.event(job, f"Échec d'une étape : {str(error)[:220]}", "error")
                if streak >= 3:
                    store.patch("hunter_scan_jobs", f"id=eq.{job['id']}&lease_token=eq.{job['lease_token']}",
                                {"status": "failed", "finished_at": utc_now(),
                                 "error_message": str(error)[:500], "lease_token": None, "lease_until": None})
                else:
                    release(store, job, phase, checkpoint, job["progress_percent"])
            raise
    return {"claimed": completed_batches > 0, "job_id": target_job_id,
            "batches": completed_batches, "elapsed_seconds": round(time.perf_counter() - invocation_started, 2)}
