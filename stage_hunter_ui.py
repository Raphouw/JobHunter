from __future__ import annotations

import html
import json
import os
import re
import sqlite3
import subprocess
import sys
import time
from collections import deque
from contextlib import closing
from datetime import datetime
from pathlib import Path

import pandas as pd
import streamlit as st
import streamlit.components.v1 as components
import yaml
from dotenv import load_dotenv

import stage_hunter as hunter


ROOT = Path(__file__).resolve().parent
PROFILES_DIR = ROOT / "config" / "profiles"
SOURCES_FILE = ROOT / "config" / "sources.yaml"
OUTPUT_DIR = ROOT / "output"
SWIPER_DIR = ROOT / "components" / "job_swiper"
ANSI_RE = re.compile(r"\x1b\[[0-9;]*m")
load_dotenv(ROOT / ".env")
job_swiper = components.declare_component("stage_hunter_job_swiper", path=str(SWIPER_DIR))

MODE_SETTINGS = {
    "Rapide": {
        "SEARCH_QUERY_BUDGET": "24",
        "SEARCH_RESULTS_PER_QUERY": "6",
        "FIXED_SITE_LIMIT": "8",
        "MAX_LISTING_DETAILS": "25",
        "LISTING_CRAWL_DEPTH": "1",
        "MAX_RECURSIVE_LEADS": "60",
        "SEARCH_WORKERS": "4",
        "SCRAPE_WORKERS": "6",
        "SEARCH_RETRIES": "0",
        "SEARCH_TIMEOUT_SECONDS": "6",
        "WEB_PROBE_QUERIES": "8",
        "WEB_MIN_PRODUCTIVITY": "0.05",
        "HTTP_TIMEOUT_SECONDS": "8",
        "HTTP_RETRIES": "0",
        "MAX_IN_FLIGHT_PAGES": "8",
        "MAX_RESPONSE_BYTES": "3000000",
        "MAX_DIAGNOSTIC_LISTING_LEADS": "2000",
        "MAX_LEADS_PER_SUBLISTING": "12",
        "MAX_TOTAL_DETAIL_PAGES": "250",
        "MIN_LISTING_LEAD_PRIORITY": "4",
        "SCAN_TIME_BUDGET_SECONDS": "0",
    },
    "Complet": {
        "SEARCH_QUERY_BUDGET": "45",
        "SEARCH_RESULTS_PER_QUERY": "8",
        "FIXED_SITE_LIMIT": "16",
        "MAX_LISTING_DETAILS": "45",
        "LISTING_CRAWL_DEPTH": "2",
        "MAX_RECURSIVE_LEADS": "160",
        "SEARCH_WORKERS": "6",
        "SCRAPE_WORKERS": "8",
        "SEARCH_RETRIES": "0",
        "SEARCH_TIMEOUT_SECONDS": "8",
        "WEB_PROBE_QUERIES": "12",
        "WEB_MIN_PRODUCTIVITY": "0.04",
        "HTTP_TIMEOUT_SECONDS": "10",
        "HTTP_RETRIES": "1",
        "MAX_IN_FLIGHT_PAGES": "16",
        "MAX_RESPONSE_BYTES": "4000000",
        "MAX_DIAGNOSTIC_LISTING_LEADS": "3000",
        "MAX_LEADS_PER_SUBLISTING": "24",
        "MAX_TOTAL_DETAIL_PAGES": "800",
        "MIN_LISTING_LEAD_PRIORITY": "4",
        "SCAN_TIME_BUDGET_SECONDS": "0",
    },
    "Maximum": {
        "SEARCH_QUERY_BUDGET": "70",
        "SEARCH_RESULTS_PER_QUERY": "10",
        "FIXED_SITE_LIMIT": "25",
        "MAX_LISTING_DETAILS": "70",
        "LISTING_CRAWL_DEPTH": "3",
        "MAX_RECURSIVE_LEADS": "240",
        "SEARCH_WORKERS": "8",
        "SCRAPE_WORKERS": "10",
        "SEARCH_RETRIES": "1",
        "SEARCH_TIMEOUT_SECONDS": "10",
        "WEB_PROBE_QUERIES": "16",
        "WEB_MIN_PRODUCTIVITY": "0.03",
        "HTTP_TIMEOUT_SECONDS": "12",
        "HTTP_RETRIES": "1",
        "MAX_IN_FLIGHT_PAGES": "20",
        "MAX_RESPONSE_BYTES": "4000000",
        "MAX_DIAGNOSTIC_LISTING_LEADS": "4000",
        "MAX_LEADS_PER_SUBLISTING": "36",
        "MAX_TOTAL_DETAIL_PAGES": "1400",
        "MIN_LISTING_LEAD_PRIORITY": "3",
        "SCAN_TIME_BUDGET_SECONDS": "0",
    },
    "Exhaustif 1h": {
        "SEARCH_QUERY_BUDGET": "240",
        "SEARCH_RESULTS_PER_QUERY": "12",
        "FIXED_SITE_LIMIT": "30",
        "MAX_LISTING_DETAILS": "100",
        "LISTING_CRAWL_DEPTH": "3",
        "MAX_RECURSIVE_LEADS": "500",
        "SEARCH_WORKERS": "8",
        "SCRAPE_WORKERS": "12",
        "SEARCH_RETRIES": "1",
        "SEARCH_TIMEOUT_SECONDS": "8",
        "WEB_PROBE_QUERIES": "24",
        "WEB_MIN_PRODUCTIVITY": "0",
        "WEB_DISABLE_CIRCUIT_BREAKER": "1",
        "WEB_RETRY_EMPTY_RESULTS": "1",
        "HTTP_TIMEOUT_SECONDS": "10",
        "HTTP_RETRIES": "1",
        "MAX_LEADS_PER_SUBLISTING": "60",
        "MAX_TOTAL_DETAIL_PAGES": "2400",
        "MAX_IN_FLIGHT_PAGES": "16",
        "MAX_RESPONSE_BYTES": "3000000",
        "MAX_DIAGNOSTIC_LISTING_LEADS": "3000",
        "MIN_LISTING_LEAD_PRIORITY": "2",
        "SEARCH_ROLE_PAIR_LIMIT": "8",
        "SEARCH_INTENT_EXPANSION": "1",
        "SEARCH_SOURCE_QUERIES_PER_DOMAIN": "3",
        "SCAN_TIME_BUDGET_SECONDS": "3600",
        "SCAN_DEADLINE_RESERVE_SECONDS": "150",
    },
}


def slugify(value: str) -> str:
    import unicodedata

    value = "".join(
        char for char in unicodedata.normalize("NFD", str(value or ""))
        if unicodedata.category(char) != "Mn"
    ).lower()
    return re.sub(r"[^a-z0-9]+", "-", value).strip("-") or "profil"


def load_yaml(path: Path) -> dict:
    return yaml.safe_load(path.read_text(encoding="utf-8")) or {}


def save_yaml(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(
        yaml.safe_dump(data, allow_unicode=True, sort_keys=False, width=110),
        encoding="utf-8",
    )
    temporary.replace(path)


def profile_files() -> list[Path]:
    PROFILES_DIR.mkdir(parents=True, exist_ok=True)
    return sorted(PROFILES_DIR.glob("*.yaml"), key=lambda p: load_yaml(p).get("name", p.stem).lower())


def as_list(value) -> list[str]:
    if value is None:
        return []
    if isinstance(value, list):
        return [str(item) for item in value if str(item).strip()]
    return [str(value)] if str(value).strip() else []


def lines(value) -> str:
    return "\n".join(as_list(value))


def split_lines(value: str) -> list[str]:
    return list(dict.fromkeys(line.strip() for line in value.splitlines() if line.strip()))


def profile_output(profile: dict) -> Path:
    return OUTPUT_DIR / slugify(profile.get("id") or profile.get("name"))


def ensure_review_database(profile: dict) -> Path:
    database = profile_output(profile) / "stage_hunter.sqlite3"
    database.parent.mkdir(parents=True, exist_ok=True)
    with closing(sqlite3.connect(database, timeout=20)) as connection, connection:
        connection.execute("""CREATE TABLE IF NOT EXISTS offers(
            id INTEGER PRIMARY KEY,url TEXT UNIQUE,canonical_url TEXT,title TEXT,company TEXT,location TEXT,
            canton TEXT,source TEXT,snippet TEXT,body TEXT,language TEXT,duration TEXT,start_date TEXT,
            domain_category TEXT,skills_found TEXT,confidence REAL,page_type TEXT,discovered_at TEXT,
            score REAL,status TEXT DEFAULT 'new',reasons TEXT,gmail_seen INTEGER DEFAULT 0,
            review_decision TEXT,reviewed_at TEXT,review_note TEXT,sheet_synced INTEGER DEFAULT 0,
            availability_status TEXT DEFAULT 'unknown',availability_reason TEXT,last_checked_at TEXT,
            fingerprint TEXT,learned_adjustment REAL DEFAULT 0)""")
        columns = {row[1] for row in connection.execute("PRAGMA table_info(offers)")}
        added_review = "review_decision" not in columns
        added_synced = "sheet_synced" not in columns
        additions = {
            "url": "TEXT", "canonical_url": "TEXT", "title": "TEXT", "company": "TEXT",
            "location": "TEXT", "canton": "TEXT", "source": "TEXT", "snippet": "TEXT",
            "body": "TEXT", "language": "TEXT", "duration": "TEXT", "start_date": "TEXT",
            "domain_category": "TEXT", "skills_found": "TEXT", "confidence": "REAL",
            "page_type": "TEXT", "discovered_at": "TEXT", "score": "REAL",
            "status": "TEXT DEFAULT 'new'", "reasons": "TEXT", "gmail_seen": "INTEGER DEFAULT 0",
            "review_decision": "TEXT", "reviewed_at": "TEXT", "review_note": "TEXT",
            "sheet_synced": "INTEGER DEFAULT 0",
            "availability_status": "TEXT DEFAULT 'unknown'", "availability_reason": "TEXT",
            "last_checked_at": "TEXT", "fingerprint": "TEXT", "learned_adjustment": "REAL DEFAULT 0",
        }
        for name, sql_type in additions.items():
            if name not in columns:
                connection.execute(f"ALTER TABLE offers ADD COLUMN {name} {sql_type}")
        if added_review:
            connection.execute("""UPDATE offers SET review_decision=CASE
                WHEN status='kept' THEN 'keep' WHEN status='deleted' THEN 'reject'
                WHEN status='new' THEN 'pending' ELSE 'unsure' END""")
        if added_synced:
            connection.execute("UPDATE offers SET sheet_synced=CASE WHEN status='new' THEN 0 ELSE 1 END")
        connection.execute("""CREATE TABLE IF NOT EXISTS review_events(
            id INTEGER PRIMARY KEY, offer_id INTEGER NOT NULL, previous_decision TEXT,
            previous_status TEXT, decision TEXT NOT NULL, created_at TEXT NOT NULL)""")
        connection.execute("""CREATE TABLE IF NOT EXISTS profile_settings(
            key TEXT PRIMARY KEY, value TEXT, updated_at TEXT NOT NULL)""")
        connection.execute("""CREATE TABLE IF NOT EXISTS source_metrics(
            source TEXT NOT NULL,channel TEXT NOT NULL,runs INTEGER DEFAULT 0,attempts INTEGER DEFAULT 0,
            links INTEGER DEFAULT 0,retained INTEGER DEFAULT 0,rejected INTEGER DEFAULT 0,closed INTEGER DEFAULT 0,
            listings INTEGER DEFAULT 0,elapsed_ms INTEGER DEFAULT 0,last_run TEXT,
            PRIMARY KEY(source,channel))""")
        connection.execute("""CREATE TABLE IF NOT EXISTS scan_runs(
            id INTEGER PRIMARY KEY,started_at TEXT NOT NULL,finished_at TEXT,profile_id TEXT,
            settings_json TEXT,summary_json TEXT)""")
        connection.execute("""CREATE TABLE IF NOT EXISTS sheet_sync(
            offer_id INTEGER NOT NULL,sheet_id TEXT NOT NULL,tab TEXT NOT NULL,content_hash TEXT,
            synced_at TEXT NOT NULL,PRIMARY KEY(offer_id,sheet_id,tab))""")
    return database


def hydrate_google_from_database(profile: dict) -> None:
    database = ensure_review_database(profile)
    if not database.exists():
        return
    try:
        with closing(sqlite3.connect(database, timeout=10)) as connection, connection:
            settings = dict(connection.execute("SELECT key,value FROM profile_settings WHERE key LIKE 'google_%'"))
    except sqlite3.Error:
        return
    google = profile.setdefault("integrations", {}).setdefault("google", {})
    if not str(google.get("sheet_id") or "").strip() and settings.get("google_sheet_id"):
        google["sheet_id"] = settings["google_sheet_id"]
    if not str(google.get("response_tab") or "").strip() and settings.get("google_response_tab"):
        google["response_tab"] = settings["google_response_tab"]
    if not str(google.get("opportunity_tab") or "").strip() and settings.get("google_opportunity_tab"):
        google["opportunity_tab"] = settings["google_opportunity_tab"]


def persist_google_to_database(profile: dict) -> None:
    database = profile_output(profile) / "stage_hunter.sqlite3"
    database.parent.mkdir(parents=True, exist_ok=True)
    google = ((profile.get("integrations") or {}).get("google") or {})
    values = {
        "google_sheet_id": google.get("sheet_id", ""),
        "google_response_tab": google.get("response_tab", "Réponses"),
        "google_opportunity_tab": google.get("opportunity_tab", "Opportunités"),
    }
    with closing(sqlite3.connect(database, timeout=20)) as connection, connection:
        connection.execute("""CREATE TABLE IF NOT EXISTS profile_settings(
            key TEXT PRIMARY KEY, value TEXT, updated_at TEXT NOT NULL)""")
        timestamp = datetime.now().isoformat()
        for key, value in values.items():
            connection.execute("""INSERT INTO profile_settings(key,value,updated_at) VALUES(?,?,?)
                ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at""",
                (key, str(value or ""), timestamp))


def review_stats(profile: dict) -> dict[str, int]:
    database = ensure_review_database(profile)
    base = {"pending": 0, "keep": 0, "unsure": 0, "reject": 0, "ready": 0, "reviewed": 0}
    if not database.exists():
        return base
    with closing(sqlite3.connect(database, timeout=20)) as connection, connection:
        for decision, count in connection.execute("SELECT COALESCE(review_decision,'legacy'),COUNT(*) FROM offers GROUP BY review_decision"):
            if decision in base:
                base[decision] = int(count)
        base["pending"] = int(connection.execute("SELECT COUNT(*) FROM offers WHERE status='new' AND review_decision='pending'").fetchone()[0])
        base["ready"] = int(connection.execute("""SELECT COUNT(*) FROM offers WHERE status IN ('new','kept')
            AND review_decision IN ('keep','unsure') AND COALESCE(sheet_synced,0)=0""").fetchone()[0])
        base["reviewed"] = int(connection.execute("SELECT COUNT(*) FROM offers WHERE reviewed_at IS NOT NULL").fetchone()[0])
    return base


def next_review_offer(profile: dict, minimum_score: int = 0) -> dict | None:
    database = ensure_review_database(profile)
    if not database.exists():
        return None
    with closing(sqlite3.connect(database, timeout=20)) as connection, connection:
        connection.row_factory = sqlite3.Row
        row = connection.execute("""SELECT id,score,confidence,company,title,location,canton,language,duration,
            start_date,domain_category,skills_found,reasons,source,url,discovered_at,
            availability_status,availability_reason,learned_adjustment
            FROM offers WHERE status='new' AND review_decision='pending' AND score>=?
            ORDER BY score DESC,confidence DESC,id ASC LIMIT 1""", (minimum_score,)).fetchone()
        return dict(row) if row else None


def save_review_decision(profile: dict, offer_id: int, decision: str) -> bool:
    if decision not in {"keep", "unsure", "reject"}:
        return False
    database = ensure_review_database(profile)
    if not database.exists():
        return False
    status = {"keep": "kept", "unsure": "new", "reject": "deleted"}[decision]
    timestamp = datetime.now().isoformat()
    with closing(sqlite3.connect(database, timeout=20)) as connection, connection:
        previous = connection.execute("SELECT review_decision,status FROM offers WHERE id=?", (offer_id,)).fetchone()
        if not previous:
            return False
        connection.execute("""INSERT INTO review_events(offer_id,previous_decision,previous_status,decision,created_at)
            VALUES(?,?,?,?,?)""", (offer_id, previous[0], previous[1], decision, timestamp))
        connection.execute("""UPDATE offers SET review_decision=?,status=?,reviewed_at=?,sheet_synced=0
            WHERE id=?""", (decision, status, timestamp, offer_id))
    return True


def undo_last_review(profile: dict) -> str:
    database = ensure_review_database(profile)
    if not database.exists():
        return "Aucune décision à annuler."
    with closing(sqlite3.connect(database, timeout=20)) as connection, connection:
        event = connection.execute("""SELECT id,offer_id,previous_decision,previous_status
            FROM review_events ORDER BY id DESC LIMIT 1""").fetchone()
        if not event:
            return "Aucune décision à annuler."
        connection.execute("""UPDATE offers SET review_decision=?,status=?,reviewed_at=NULL,sheet_synced=0
            WHERE id=?""", (event[2] or "pending", event[3] or "new", event[1]))
        connection.execute("DELETE FROM review_events WHERE id=?", (event[0],))
    return "Dernière décision annulée."


def read_results(profile: dict) -> pd.DataFrame:
    database = ensure_review_database(profile)
    if not database.exists():
        return pd.DataFrame()
    with closing(sqlite3.connect(database)) as connection, connection:
        return pd.read_sql_query(
            """SELECT id,score,confidence,company,title,location,canton,language,duration,
                      start_date,domain_category,source,url,status,review_decision,discovered_at,reasons,
                      availability_status,availability_reason,learned_adjustment
               FROM offers
               WHERE status IN ('new','kept') AND review_decision IN ('keep','unsure')
               ORDER BY CASE review_decision WHEN 'keep' THEN 0 ELSE 1 END, score DESC""",
            connection,
        )


def read_diagnostics(profile: dict) -> dict:
    path = profile_output(profile) / "stage_hunter_diagnostics.json"
    if not path.exists():
        return {}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}


def read_source_health(profile: dict) -> pd.DataFrame:
    database = ensure_review_database(profile)
    with closing(sqlite3.connect(database, timeout=20)) as connection, connection:
        return pd.read_sql_query("""SELECT source,channel,runs,attempts,links,retained,rejected,closed,listings,
            elapsed_ms,last_run FROM source_metrics ORDER BY retained DESC,links DESC,attempts ASC""", connection)


def read_scan_history(profile: dict, limit: int = 12) -> pd.DataFrame:
    database = ensure_review_database(profile)
    with closing(sqlite3.connect(database, timeout=20)) as connection, connection:
        rows = connection.execute("""SELECT id,started_at,finished_at,summary_json FROM scan_runs
            WHERE profile_id=? ORDER BY id DESC LIMIT ?""", (slugify(profile.get("id") or profile.get("name")), limit)).fetchall()
    records = []
    for run_id, started_at, finished_at, raw_summary in rows:
        try:
            summary = json.loads(raw_summary or "{}")
        except json.JSONDecodeError:
            summary = {}
        records.append({
            "Scan": run_id, "Début": started_at, "Durée (s)": summary.get("duration_seconds"),
            "Trouvées": summary.get("new", 0), "Fermées": summary.get("closed", 0),
            "À swiper": summary.get("pending", 0), "Directes": summary.get("direct_candidates", 0),
            "Web": summary.get("web_candidates", 0),
        })
    return pd.DataFrame(records)


def reset_tinder_learning(profile: dict) -> None:
    database = ensure_review_database(profile)
    timestamp = datetime.now().isoformat()
    with closing(sqlite3.connect(database, timeout=20)) as connection, connection:
        connection.execute("""INSERT INTO profile_settings(key,value,updated_at) VALUES('learning_reset_at',?,?)
            ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at""", (timestamp, timestamp))


def set_learning_enabled(profile: dict, enabled: bool) -> None:
    database = ensure_review_database(profile)
    timestamp = datetime.now().isoformat()
    with closing(sqlite3.connect(database, timeout=20)) as connection, connection:
        connection.execute("""INSERT INTO profile_settings(key,value,updated_at) VALUES('learning_enabled',?,?)
            ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at""", ("1" if enabled else "0", timestamp))


def learning_settings(profile: dict) -> tuple[bool, str]:
    database = ensure_review_database(profile)
    with closing(sqlite3.connect(database, timeout=20)) as connection, connection:
        settings = dict(connection.execute("SELECT key,value FROM profile_settings WHERE key IN ('learning_enabled','learning_reset_at')"))
    return settings.get("learning_enabled", "1") != "0", settings.get("learning_reset_at", "")


def review_offer_catalog(profile: dict, limit: int = 300) -> list[dict]:
    """Return recent offers that can be replayed or removed during UI tests."""
    database = ensure_review_database(profile)
    with closing(sqlite3.connect(database, timeout=20)) as connection, connection:
        connection.row_factory = sqlite3.Row
        rows = connection.execute(
            """SELECT id,company,title,score,review_decision,status,discovered_at
               FROM offers
               ORDER BY COALESCE(reviewed_at,discovered_at) DESC,id DESC LIMIT ?""",
            (limit,),
        ).fetchall()
    return [dict(row) for row in rows]


def reset_offers_to_pending(profile: dict, offer_ids: list[int]) -> int:
    ids = sorted({int(value) for value in offer_ids})
    if not ids:
        return 0
    database = ensure_review_database(profile)
    placeholders = ",".join("?" for _ in ids)
    with closing(sqlite3.connect(database, timeout=20)) as connection, connection:
        cursor = connection.execute(
            f"""UPDATE offers SET review_decision='pending',status='new',reviewed_at=NULL,
                   review_note=NULL,sheet_synced=0 WHERE id IN ({placeholders})""",
            ids,
        )
        connection.execute(f"DELETE FROM review_events WHERE offer_id IN ({placeholders})", ids)
    return max(0, cursor.rowcount)


def delete_local_offers(profile: dict, offer_ids: list[int]) -> int:
    ids = sorted({int(value) for value in offer_ids})
    if not ids:
        return 0
    database = ensure_review_database(profile)
    placeholders = ",".join("?" for _ in ids)
    with closing(sqlite3.connect(database, timeout=20)) as connection, connection:
        connection.execute(f"DELETE FROM review_events WHERE offer_id IN ({placeholders})", ids)
        connection.execute(f"DELETE FROM sheet_sync WHERE offer_id IN ({placeholders})", ids)
        cursor = connection.execute(f"DELETE FROM offers WHERE id IN ({placeholders})", ids)
    return max(0, cursor.rowcount)


def default_profile(name: str) -> dict:
    identifier = slugify(name)
    return {
        "id": identifier,
        "name": name,
        "student": {
            "stage_type": "stage",
            "contract_types": ["stage", "internship"],
            "min_weeks": 20,
            "start_date": "",
            "end_date": "",
        },
        "target": {"job_titles": [], "sectors": []},
        "location": {
            "countries": ["France"],
            "priority_locations": [],
            "regions": [],
            "acceptable_language": ["fr", "en"],
        },
        "skills": {"core": [], "strong_domains": []},
        "interests": {"professional": [], "personal": [], "very_high": [], "high": []},
        "search": {
            "strategy": "profile",
            "mode": "complete",
            "query_budget": 45,
            "site_query_share": 0.35,
            "retry_empty_results": False,
            "allow_unconfirmed_contract": True,
            "use_manual_queries": True,
            "require_profile_relevance": True,
            "queries": [],
        },
        "sources": {"packs": ["france"], "custom_queries": [], "custom_domains": [], "custom_urls": []},
        "integrations": {
            "google": {
                "sheets_enabled": False,
                "gmail_enabled": False,
                "sheet_id": "",
                "auto_create_sheet": False,
                "response_tab": "Réponses",
                "opportunity_tab": f"Opportunités - {name}",
                "client_secret_file": "credentials/google_client_secret.json",
                "token_file": f"credentials/{identifier}/google_token.json",
            }
        },
    }


def injected_profile(path: Path) -> dict:
    return hunter.load_profile(str(path))


def preview_queries(path: Path, mode: str) -> tuple[list[str], dict, list[str]]:
    preview_keys=("SEARCH_QUERY_BUDGET","SEARCH_ROLE_PAIR_LIMIT","SEARCH_INTENT_EXPANSION","SEARCH_SOURCE_QUERIES_PER_DOMAIN")
    previous={key:os.environ.get(key) for key in preview_keys}
    for key in preview_keys:
        if key in MODE_SETTINGS[mode]:os.environ[key]=MODE_SETTINGS[mode][key]
        else:os.environ.pop(key,None)
    try:
        complete = injected_profile(path)
        queries = hunter.build_search_queries(complete, emit_log=False)
        components = hunter.profile_search_components(complete)
        urls = hunter.targeted_fixed_urls(complete)
        return queries, components, urls
    finally:
        for key,value in previous.items():
            if value is None:os.environ.pop(key,None)
            else:os.environ[key]=value


def ranked_queries_for_profile(profile: dict, queries: list[str]) -> list[str]:
    database = ensure_review_database(profile)
    with closing(sqlite3.connect(database, timeout=20)) as connection, connection:
        return hunter.rank_search_queries(connection, queries)


def save_search_debug_report(profile: dict, report: dict) -> Path:
    debug_dir = profile_output(profile) / "debug"
    debug_dir.mkdir(parents=True, exist_ok=True)
    destination = debug_dir / f"web_search_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
    destination.write_text(json.dumps(report, ensure_ascii=False, indent=2, default=str), encoding="utf-8")
    return destination


def phase_progress(line: str) -> float | None:
    web = re.search(r"WEB\s+(\d+)/(\d+)", line)
    if web:
        return 0.25 + 0.20 * int(web.group(1)) / max(1, int(web.group(2)))
    analysis = re.search(r"(?:ANALYSE|DÉTAIL)\s+(\d+)/(\d+)", line)
    if analysis:
        return 0.46 + 0.46 * int(analysis.group(1)) / max(1, int(analysis.group(2)))
    if "SITES FIXES" in line:
        return 0.18
    if "WEB COUPE-CIRCUIT" in line:
        return 0.45
    if "GMAIL" in line:
        return 0.60
    if "SHEETS" in line:
        return 0.96
    if "SCAN TERMINÉ" in line:
        return 1.0
    return None


def run_scan(profile_path: Path, profile: dict, settings: dict, status_box, progress_box, console_box, resume: bool = False) -> tuple[int, Path]:
    integration = ((profile.get("integrations") or {}).get("google") or {})
    command = [sys.executable, str(ROOT / "stage_hunter.py"), "scan", "--profile", str(profile_path)]
    if integration.get("sheets_enabled"):
        command.append("--sheets")
    if integration.get("gmail_enabled"):
        command.append("--gmail")
    if resume:
        command.append("--resume")

    environment = os.environ.copy()
    environment.update({key: str(value) for key, value in settings.items()})
    environment.update({"PYTHONUTF8": "1", "NO_COLOR": "1"})
    logs_dir = profile_output(profile) / "logs"
    logs_dir.mkdir(parents=True, exist_ok=True)
    log_path = logs_dir / f"scan_{datetime.now().strftime('%Y%m%d_%H%M%S')}.log"
    started = time.perf_counter()
    recent: deque[str] = deque(maxlen=160)
    last_render = 0.0
    latest_progress = 0.0
    process = subprocess.Popen(
        command,
        cwd=ROOT,
        env=environment,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        encoding="utf-8",
        errors="replace",
        bufsize=1,
    )
    assert process.stdout is not None
    with log_path.open("w", encoding="utf-8") as log_handle:
        for raw_line in process.stdout:
            clean = ANSI_RE.sub("", raw_line.rstrip())
            log_handle.write(clean + "\n")
            recent.append(clean)
            progress = phase_progress(clean)
            if progress is not None:
                latest_progress = min(progress, 1.0)
            now = time.perf_counter()
            important = any(marker in clean for marker in ("SCAN TERMINÉ", "budget temps atteint", "Traceback", "MemoryError"))
            if now - last_render >= 1.0 or important:
                elapsed = int(now - started)
                status_box.info(f"Scan en cours · {elapsed // 60:02d}:{elapsed % 60:02d} · {clean[-100:]}")
                progress_box.progress(latest_progress)
                console_box.code("\n".join(recent), language=None, height=380, wrap_lines=True)
                last_render = now
        log_handle.flush()
    return_code = process.wait()
    if recent:
        console_box.code("\n".join(recent), language=None, height=380, wrap_lines=True)
    elapsed = int(time.perf_counter() - started)
    if return_code == 0:
        progress_box.progress(1.0)
        status_box.success(f"Scan terminé en {elapsed // 60:02d}:{elapsed % 60:02d}")
    else:
        status_box.error(f"Arrêt avec le code {return_code}. Le journal est conservé.")
    return return_code, log_path


def google_paths(profile: dict) -> tuple[str, Path, Path]:
    google = ((profile.get("integrations") or {}).get("google") or {})
    sheet_id = str(google.get("sheet_id") or os.getenv("GOOGLE_SHEET_ID", "")).strip()
    secret = ROOT / str(google.get("client_secret_file") or "credentials/google_client_secret.json")
    token = ROOT / str(google.get("token_file") or "credentials/google_token.json")
    return sheet_id, secret, token


def run_google_command(profile_path: Path, command: str) -> tuple[bool, str]:
    result = subprocess.run(
        [sys.executable, str(ROOT / "stage_hunter.py"), command, "--profile", str(profile_path)],
        cwd=ROOT,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=90,
        env={**os.environ, "NO_COLOR": "1", "PYTHONUTF8": "1"},
    )
    output=ANSI_RE.sub("", (result.stdout + "\n" + result.stderr).strip())
    return result.returncode == 0, output


def run_scheduler_command(profile_path: Path, command: str, at: str = "07:00", frequency: str = "daily") -> tuple[bool, str]:
    arguments = [sys.executable, str(ROOT / "stage_hunter_scheduler.py"), command, "--profile", str(profile_path)]
    if command == "install":
        arguments += ["--at", at, "--frequency", frequency]
    result = subprocess.run(arguments, cwd=ROOT, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=30)
    return result.returncode == 0, (result.stdout + "\n" + result.stderr).strip()


st.set_page_config(page_title=f"{hunter.PRODUCT_NAME} V{hunter.VERSION}", page_icon="🎯", layout="wide", initial_sidebar_state="expanded")
st.markdown(
    """
    <style>
      :root {color-scheme:dark;--navy:#07111f;--panel:#0c1a2a;--line:#203a52;--cyan:#35d6c2;--violet:#8b7cff;--text:#eef6ff;--muted:#9fb2c7;}
      .stApp {background:radial-gradient(circle at 80% 0%,#12233d 0%,#081322 38%,#050c16 100%);color:var(--text);}
      [data-testid="stSidebar"] {background:#07111f;border-right:1px solid #1b3249;}
      [data-testid="stHeader"] {background:transparent;}
      .hero {padding:1.45rem 1.65rem;border:1px solid #244663;border-radius:20px;background:linear-gradient(125deg,rgba(53,214,194,.15),rgba(139,124,255,.13));margin-bottom:1rem;box-shadow:0 16px 45px rgba(0,0,0,.18);}
      .hero h1 {margin:0;color:#f5fbff;font-size:2.15rem;letter-spacing:-.03em;}
      .hero p {margin:.45rem 0 0;color:#abc0d4;font-size:1rem;}
      [data-testid="stMetric"] {background:linear-gradient(145deg,rgba(14,31,49,.98),rgba(9,21,36,.98));border:1px solid #25445e;padding:14px 16px;border-radius:15px;box-shadow:0 10px 30px rgba(0,0,0,.12);}
      [data-testid="stMetricLabel"] {color:#91a9bf;}
      .status-card {padding:1rem 1.1rem;border:1px solid #203a52;border-radius:15px;background:#0c1a2a;height:100%;}
      .status-card strong {font-size:1rem;color:#f1f7ff;}.status-card p {margin:.35rem 0 0;color:#9fb2c7;}
      .dot-ok,.dot-off,.dot-warn {display:inline-block;width:9px;height:9px;border-radius:50%;margin-right:7px;}
      .dot-ok {background:#35d6c2;box-shadow:0 0 12px #35d6c2}.dot-off {background:#66788b}.dot-warn {background:#f5b94c;}
      .section-note {color:#9fb2c7;margin-top:-.4rem;margin-bottom:1rem;}
      .stButton>button,.stDownloadButton>button {border-radius:11px;font-weight:700;min-height:2.7rem;}
      div[data-testid="stExpander"] {border:1px solid #203a52;border-radius:14px;background:rgba(8,19,33,.65);}
      div[data-testid="stDataFrame"] {border:1px solid #203a52;border-radius:14px;overflow:hidden;}
      code {font-size:.78rem!important;}
      /* Streamlit/BaseWeb mixes its light popovers with our dark page unless
         every interactive layer receives an explicit foreground/background. */
      input,textarea,[contenteditable="true"] {color:#eef6ff!important;-webkit-text-fill-color:#eef6ff!important;caret-color:#35d6c2!important;}
      input::placeholder,textarea::placeholder {color:#71869b!important;-webkit-text-fill-color:#71869b!important;opacity:1!important;}
      [data-baseweb="input"]>div,[data-baseweb="base-input"],
      [data-baseweb="select"]>div,[data-baseweb="textarea"]>div,
      [data-testid="stNumberInput"]>div>div {background:#0a1726!important;color:#eef6ff!important;border-color:#29465f!important;}
      [data-baseweb="select"] *,[data-baseweb="input"] *,[data-baseweb="textarea"] * {color:#eef6ff!important;}
      [data-baseweb="popover"],[data-baseweb="menu"],[role="listbox"] {background:#0b1928!important;color:#eef6ff!important;border:1px solid #29465f!important;}
      [role="option"] {background:#0b1928!important;color:#eef6ff!important;}
      [role="option"]:hover,[role="option"][aria-selected="true"] {background:#17344d!important;color:#ffffff!important;}
      [data-baseweb="tag"] {background:#21435d!important;color:#f4fbff!important;}
      [data-testid="stSelectbox"] svg,[data-testid="stMultiSelect"] svg,[data-testid="stDateInput"] svg {fill:#bcd3e7!important;color:#bcd3e7!important;}
      [data-testid="stCheckbox"] label,[data-testid="stRadio"] label,[data-testid="stToggle"] label {color:#dce9f5!important;}
      [data-testid="stSlider"] [role="slider"] {background:#35d6c2!important;border-color:#d6fffa!important;}
      [data-testid="stWidgetLabel"],label,p,span {text-shadow:none;}
      button[kind="secondary"],button[kind="primary"] {color:#f7fbff!important;}
      .block-container {max-width:1480px;padding-top:1.35rem;padding-bottom:3rem;}
      [data-baseweb="tab-list"] {gap:.35rem;background:rgba(7,17,31,.72);padding:.38rem;border:1px solid #1d3850;border-radius:14px;overflow-x:auto;}
      [data-baseweb="tab"] {height:2.75rem;border-radius:10px;padding:0 1rem;color:#9fb2c7!important;font-weight:700;white-space:nowrap;}
      [aria-selected="true"][data-baseweb="tab"] {background:linear-gradient(135deg,rgba(53,214,194,.17),rgba(139,124,255,.17));color:#f7fbff!important;}
      .eyebrow {font-size:.72rem;text-transform:uppercase;letter-spacing:.13em;color:#6fe1d1;font-weight:800;margin-bottom:.45rem;}
      .hero-grid {display:flex;justify-content:space-between;gap:1rem;align-items:center;flex-wrap:wrap;}
      .hero-version {padding:.45rem .7rem;border-radius:999px;border:1px solid #365978;background:#0b1c2f;color:#bcd3e7;font-size:.76rem;font-weight:800;}
      .mini-card {border:1px solid #203a52;border-radius:15px;padding:1rem;background:linear-gradient(145deg,rgba(12,26,42,.96),rgba(9,20,35,.96));height:100%;}
      .mini-card .kicker {color:#7f97ad;text-transform:uppercase;letter-spacing:.08em;font-size:.68rem;font-weight:800;}
      .mini-card .big {font-size:1.55rem;font-weight:850;color:#f5fbff;margin:.22rem 0;}
      .mini-card .sub {font-size:.78rem;color:#91a8bd;line-height:1.45;}
      .callout {border-left:3px solid #35d6c2;background:rgba(53,214,194,.07);padding:.85rem 1rem;border-radius:0 12px 12px 0;color:#bcd0e1;}
      .tinder-intro {display:flex;align-items:center;justify-content:space-between;gap:1rem;padding:1rem 1.15rem;margin:.7rem 0 1rem;border:1px solid #294b67;border-radius:16px;background:linear-gradient(120deg,rgba(53,214,194,.09),rgba(139,124,255,.08));}
      .tinder-intro strong {display:block;color:#f5fbff;font-size:1rem}.tinder-intro span {color:#93abc0;font-size:.82rem;}
      .tinder-keys {white-space:nowrap;padding:.42rem .7rem;border:1px solid #31526e;border-radius:999px;color:#cfe0ee!important;background:#0b1a2a;font-weight:750;}
      .danger-zone {border:1px solid rgba(238,91,115,.35);border-radius:14px;background:rgba(130,32,51,.08);padding:.2rem .85rem .8rem;}
    </style>
    """,
    unsafe_allow_html=True,
)

files = profile_files()
if not files:
    initial = PROFILES_DIR / "mon-profil.yaml"
    save_yaml(initial, default_profile("Mon profil"))
    files = profile_files()

labels = {path: load_yaml(path).get("name", path.stem) for path in files}
st.sidebar.markdown(f"## 🎯 {hunter.PRODUCT_NAME}")
st.sidebar.caption("V6.2.7 · exploration exhaustive stable")
requested_profile = str(st.query_params.get("profile", "") or "").strip()
preferred_path = st.session_state.get("preferred_profile_path")
preferred = next((path for path in files if path.stem == requested_profile), None)
if preferred is None:
    preferred = next((path for path in files if str(path) == preferred_path), files[0])
selected = st.sidebar.selectbox("Profil actif", files, index=files.index(preferred), format_func=lambda path: labels[path])
st.session_state["preferred_profile_path"] = str(selected)
if str(st.query_params.get("profile", "") or "") != selected.stem:
    st.query_params["profile"] = selected.stem
profile = load_yaml(selected)
hydrate_google_from_database(profile)
st.sidebar.caption("Chaque profil possède ses propres critères, historiques et exports.")

with st.sidebar.expander("＋ Créer un profil"):
    new_name = st.text_input("Prénom ou nom", placeholder="Ex. Marie", key="new-profile-name")
    if st.button("Créer", width="stretch", disabled=not new_name.strip()):
        new_profile = default_profile(new_name.strip())
        destination = PROFILES_DIR / f"{new_profile['id']}.yaml"
        if destination.exists():
            st.error("Ce profil existe déjà.")
        else:
            save_yaml(destination, new_profile)
            st.session_state["preferred_profile_path"] = str(destination)
            st.session_state["profile_onboarding"] = str(destination)
            st.query_params["profile"] = destination.stem
            st.rerun()

with st.sidebar.expander("🗑️ Supprimer un profil"):
    st.caption("Le profil disparaîtra de l’interface, mais ses résultats locaux, ses identifiants Google et son Sheet ne seront pas supprimés.")
    can_delete = len(files) > 1
    if not can_delete:
        st.info(f"Crée d’abord un autre profil : {hunter.PRODUCT_NAME} doit toujours en conserver au moins un.")
    delete_confirmation = st.checkbox(
        f"Je confirme la suppression de « {labels[selected]} »",
        key=f"delete-profile-{selected.stem}",
        disabled=not can_delete,
    )
    if st.button("Supprimer ce profil", type="secondary", width="stretch", disabled=not (can_delete and delete_confirmation)):
        deleted_dir = PROFILES_DIR / "_deleted"
        deleted_dir.mkdir(parents=True, exist_ok=True)
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        archived = deleted_dir / f"{selected.stem}_{timestamp}.yaml"
        selected.replace(archived)
        remaining = profile_files()
        st.session_state["preferred_profile_path"] = str(remaining[0])
        st.query_params["profile"] = remaining[0].stem
        st.session_state.pop("profile_onboarding", None)
        st.rerun()

google_cfg = ((profile.get("integrations") or {}).get("google") or {})
sheet_id, secret_path, token_path = google_paths(profile)
st.sidebar.markdown("---")
st.sidebar.caption(f"Google Sheets · {'activé' if google_cfg.get('sheets_enabled') else 'désactivé'}")
st.sidebar.caption(f"Gmail · {'activé' if google_cfg.get('gmail_enabled') else 'désactivé'}")

safe_name = html.escape(str(profile.get("name") or selected.stem))
st.markdown(
    f"""<div class="hero"><div class="hero-grid"><div><div class="eyebrow">Recherche d’opportunités personnalisée</div><h1>{hunter.PRODUCT_NAME}</h1>
    <p>Profil actif : <strong>{safe_name}</strong> · sources directes, validation multicouche et tri intelligent.</p></div><div class="hero-version">V6.2.7 · Deep Search</div></div></div>""",
    unsafe_allow_html=True,
)

dashboard_tab, tinder_tab, profile_tab, search_tab, diagnostic_tab, connections_tab, automation_tab, results_tab = st.tabs(
    ["🚀 Vue d’ensemble", "🔥 Tinder", "👤 Profil", "🔎 Recherche", "🩺 Diagnostic", "🔌 Connexions", "⏱ Automatisation", "📊 Résultats"]
)

with dashboard_tab:
    scan_flash = st.session_state.pop("scan_flash", None)
    if scan_flash:
        st.success(scan_flash)
    if st.session_state.get("profile_onboarding") == str(selected):
        st.success("Profil créé 🎉 Commence par renseigner ses métiers et compétences, puis ouvre Connexions pour créer son Google Sheet.")
        st.session_state.pop("profile_onboarding", None)
    frame = read_results(profile)
    current_review_stats = review_stats(profile)
    col1, col2, col3, col4, col5 = st.columns(5)
    col1.metric("Offres actives", len(frame))
    col2.metric("À swiper", current_review_stats["pending"])
    col3.metric("Score moyen", f"{frame['score'].mean():.0f}/100" if not frame.empty else "—")
    col4.metric("Score ≥ 70", int((frame["score"] >= 70).sum()) if not frame.empty else 0)
    col5.metric("Sources actives", frame["source"].nunique() if not frame.empty else 0)
    if current_review_stats["pending"]:
        st.info(f"🔥 {current_review_stats['pending']} nouvelle(s) offre(s) attendent ton tri dans Tinder des offres.")
    diagnostics = read_diagnostics(profile)
    if diagnostics:
        with st.expander("Diagnostic du dernier scan"):
            d1, d2, d3 = st.columns(3)
            d1.metric("Liens candidats", diagnostics.get("input_candidates", 0))
            d2.metric("Liens après listings", diagnostics.get("expanded_candidates", 0))
            d3.metric("Pistes de listings", len(diagnostics.get("listing_leads", [])))
            input_sources = diagnostics.get("input_sources") or {}
            retained_sources = diagnostics.get("retained_sources") or {}
            if input_sources:
                source_rows=[{"Source":source,"Liens candidats":count,"Offres retenues":retained_sources.get(source,0)} for source,count in input_sources.items()]
                st.dataframe(pd.DataFrame(source_rows),hide_index=True,width="stretch")
            rejection_reasons = diagnostics.get("rejection_reasons") or {}
            if rejection_reasons:
                st.markdown("**Pourquoi les pages ont été refusées**")
                st.dataframe(
                    pd.DataFrame([{"Motif": reason, "Pages": count} for reason, count in rejection_reasons.items()]),
                    hide_index=True,
                    width="stretch",
                )
            audit_path = profile_output(profile) / "stage_hunter_rejections.xlsx"
            if audit_path.exists():
                st.download_button(
                    "Télécharger l’audit des refus et leurs liens officiels",
                    audit_path.read_bytes(),
                    file_name=f"refus_stage_hunter_{profile.get('id','profil')}.xlsx",
                    mime="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                )
    if not google_cfg.get("sheets_enabled"):
        st.info("💡 Ce profil fonctionne en local. Pour retrouver et trier les offres à plusieurs endroits, tu peux créer automatiquement son Google Sheet dans l’onglet Connexions.")

    st.markdown("### Nouveau scan")
    st.markdown('<p class="section-note">Choisis la profondeur. Exhaustif 1h explore toutes les variantes métier × compétence × contrat et ne coupe pas le web après une sonde vide.</p>', unsafe_allow_html=True)
    configured_mode = str((profile.get("search") or {}).get("mode", "complete")).capitalize()
    mode = st.radio(
        "Profondeur",
        list(MODE_SETTINGS),
        index=list(MODE_SETTINGS).index(configured_mode) if configured_mode in MODE_SETTINGS else 1,
        horizontal=True,
        label_visibility="collapsed",
    )
    settings = dict(MODE_SETTINGS[mode])
    saved_overrides = ((profile.get("search") or {}).get("mode_overrides") or {}).get(mode.lower(), {})
    settings.update({key: str(value) for key, value in saved_overrides.items() if key in settings})
    if mode == "Exhaustif 1h":
        st.info(f"🔭 Scan de fond ponctuel : jusqu’à {settings['SEARCH_QUERY_BUDGET']} requêtes ciblées, {settings['MAX_TOTAL_DETAIL_PAGES']} pages candidates téléchargées après la découverte, {settings['MAX_RECURSIVE_LEADS']} fiches récursives au maximum et arrêt avant {int(settings['SCAN_TIME_BUDGET_SECONDS'])//60} minutes pour conserver le temps d’exporter les résultats.")
    with st.expander("⚙️ Régler l’effort et le parallélisme", expanded=False):
        st.caption("Plus de workers réduit la durée, mais une valeur très élevée peut provoquer des limitations temporaires des moteurs.")
        a1, a2, a3 = st.columns(3)
        settings["SEARCH_QUERY_BUDGET"] = str(a1.slider("Requêtes ciblées", 10, 300, int(settings["SEARCH_QUERY_BUDGET"]), 5))
        settings["SEARCH_RESULTS_PER_QUERY"] = str(a2.slider("Résultats par requête", 3, 20, int(settings["SEARCH_RESULTS_PER_QUERY"])))
        settings["FIXED_SITE_LIMIT"] = str(a3.slider("Listings fixes", 0, 30, int(settings["FIXED_SITE_LIMIT"])))
        b1, b2, b3 = st.columns(3)
        settings["SEARCH_WORKERS"] = str(b1.slider("Workers recherche", 1, 8, int(settings["SEARCH_WORKERS"])))
        settings["SCRAPE_WORKERS"] = str(b2.slider("Workers pages", 2, 12, int(settings["SCRAPE_WORKERS"])))
        settings["SEARCH_TIMEOUT_SECONDS"] = str(b3.slider("Timeout moteur (secondes)", 5, 20, int(settings["SEARCH_TIMEOUT_SECONDS"])))
        c1, c2 = st.columns(2)
        settings["LISTING_CRAWL_DEPTH"] = str(c1.slider("Profondeur des listings", 0, 3, int(settings["LISTING_CRAWL_DEPTH"])))
        settings["MAX_RECURSIVE_LEADS"] = str(c2.slider("Fiches ouvertes depuis les listings", 20, 500, int(settings["MAX_RECURSIVE_LEADS"]), 20))
        settings["MAX_TOTAL_DETAIL_PAGES"] = str(st.slider("Plafond global de pages candidates téléchargées", 100, 5000, int(settings["MAX_TOTAL_DETAIL_PAGES"]), 100))
        c3, c4 = st.columns(2)
        settings["MAX_LEADS_PER_SUBLISTING"] = str(c3.slider("Maximum par sous-listing", 5, 80, int(settings["MAX_LEADS_PER_SUBLISTING"]), 1))
        settings["WEB_PROBE_QUERIES"] = str(c4.slider("Sonde avant coupe-circuit web", 4, 64, int(settings["WEB_PROBE_QUERIES"]), 2))
        d1, d2, d3 = st.columns(3)
        settings["MAX_LISTING_DETAILS"] = str(d1.slider("Pistes lues par listing", 10, 120, int(settings["MAX_LISTING_DETAILS"]), 5))
        settings["HTTP_TIMEOUT_SECONDS"] = str(d2.slider("Timeout des pages (secondes)", 5, 20, int(settings["HTTP_TIMEOUT_SECONDS"])))
        settings["HTTP_RETRIES"] = str(d3.slider("Nouvelles tentatives HTTP", 0, 3, int(settings["HTTP_RETRIES"])))
        e1, e2, e3 = st.columns(3)
        budget_minutes=int(settings.get("SCAN_TIME_BUDGET_SECONDS","0"))//60
        settings["SCAN_TIME_BUDGET_SECONDS"] = str(e1.slider("Durée maximale (minutes, 0 = illimitée)", 0, 120, budget_minutes, 5)*60)
        settings["WEB_DISABLE_CIRCUIT_BREAKER"] = "1" if e2.toggle("Explorer malgré une sonde vide", value=settings.get("WEB_DISABLE_CIRCUIT_BREAKER","0")=="1") else "0"
        settings["WEB_RETRY_EMPTY_RESULTS"] = "1" if e3.toggle("Essayer le moteur de secours si vide", value=settings.get("WEB_RETRY_EMPTY_RESULTS","0")=="1") else "0"
        f1, f2 = st.columns(2)
        settings["MAX_IN_FLIGHT_PAGES"] = str(f1.slider("Pages simultanément conservées en RAM", 4, 48, int(settings.get("MAX_IN_FLIGHT_PAGES", 16)), 2))
        max_page_megabytes = max(1, int(settings.get("MAX_RESPONSE_BYTES", "4000000")) // 1_000_000)
        settings["MAX_RESPONSE_BYTES"] = str(f2.slider("Taille maximale d'une page (Mo)", 1, 10, max_page_megabytes) * 1_000_000)
        st.caption("Ces deux limites protègent la mémoire. Les augmenter n'accélère pas forcément le scan et peut rendre Windows ou le navigateur instable.")
        if st.button(f"Mémoriser ces réglages pour le mode {mode}", width="stretch"):
            profile.setdefault("search", {}).setdefault("mode_overrides", {})[mode.lower()] = settings
            profile["search"]["mode"] = mode.lower()
            save_yaml(selected, profile)
            st.success("Réglages mémorisés pour ce profil.")
    q1, q2, q3, q4, q5 = st.columns(5)
    q1.metric("Requêtes ciblées", settings["SEARCH_QUERY_BUDGET"])
    q2.metric("Workers recherche", settings["SEARCH_WORKERS"])
    q3.metric("Workers pages", settings["SCRAPE_WORKERS"])
    q4.metric("Listings fixes", settings["FIXED_SITE_LIMIT"])
    q5.metric("Budget temps", f'{int(settings.get("SCAN_TIME_BUDGET_SECONDS","0"))//60 or "∞"} min' if int(settings.get("SCAN_TIME_BUDGET_SECONDS","0")) else "Illimité")
    status_box = st.empty()
    progress_box = st.progress(0.0)
    with st.expander("Journal du scan", expanded=False):
        st.caption("Le journal conserve uniquement les 160 dernières lignes à l’écran. Le fichier complet reste enregistré.")
        console_box = st.empty()
        console_box.code("Le journal apparaîtra ici pendant le scan.", language=None, height=380, wrap_lines=True)
    if st.button("▶ Lancer le scan", type="primary", width="stretch"):
        code, log_file = run_scan(selected, profile, settings, status_box, progress_box, console_box)
        if code == 0:
            pending_after_scan = review_stats(profile)["pending"]
            st.session_state["scan_flash"] = f"Scan terminé · {pending_after_scan} offre(s) à examiner dans Tinder · journal {log_file.name}"
            st.session_state["preferred_profile_path"] = str(selected)
            st.query_params["profile"] = selected.stem
            st.rerun()
    resume_file = profile_output(profile) / "scan_resume.json"
    if resume_file.exists():
        st.caption("Un scan interrompu peut reprendre après la découverte. Ses réglages d'analyse enregistrés seront restaurés.")
        if st.button("↻ Reprendre le scan interrompu", width="stretch"):
            code, log_file = run_scan(selected, profile, settings, status_box, progress_box, console_box, resume=True)
            if code == 0:
                pending_after_scan = review_stats(profile)["pending"]
                st.session_state["scan_flash"] = f"Scan repris · {pending_after_scan} offre(s) à examiner dans Tinder · journal {log_file.name}"
                st.session_state["preferred_profile_path"] = str(selected)
                st.query_params["profile"] = selected.stem
                st.rerun()

with tinder_tab:
    tinder_flash = st.session_state.pop("tinder_flash", None)
    if tinder_flash:
        st.success(tinder_flash)
    stats = review_stats(profile)
    st.markdown("### 🔥 Tinder des offres")
    st.markdown('<p class="section-note">Les décisions sont sauvegardées immédiatement dans la base locale du profil. Rien n’est envoyé au Sheet avant validation.</p>', unsafe_allow_html=True)
    r1, r2, r3, r4 = st.columns(4)
    r1.metric("À examiner", stats["pending"])
    r2.metric("Gardées", stats["keep"])
    r3.metric("À revoir", stats["unsure"])
    r4.metric("Prêtes pour Sheets", stats["ready"])
    review_total = stats["pending"] + stats["keep"] + stats["unsure"] + stats["reject"]
    if review_total:
        st.progress((review_total - stats["pending"]) / review_total, text=f"Progression du tri · {review_total - stats['pending']}/{review_total}")
    st.markdown(
        '<div class="tinder-intro"><div><strong>Une offre à la fois, une décision claire</strong><span>Ouvre la fiche officielle avant de trancher. Ton choix est enregistré instantanément.</span></div><div class="tinder-keys">← Refuser · ↓ Doute · Garder →</div></div>',
        unsafe_allow_html=True,
    )

    learning_enabled, learning_reset_at = learning_settings(profile)
    with st.expander("🧠 Apprentissage à partir de mes choix", expanded=False):
        st.caption("Le prochain scan ajuste légèrement les scores selon les thèmes que tu gardes ou rejettes. L’ajustement est plafonné à ±12 points et reste visible dans les raisons du score.")
        new_learning_enabled = st.toggle("Activer l’apprentissage Tinder", value=learning_enabled)
        if new_learning_enabled != learning_enabled:
            set_learning_enabled(profile, new_learning_enabled);st.rerun()
        if learning_reset_at:
            st.caption(f"Apprentissage réinitialisé le {learning_reset_at[:19].replace('T', ' ')}")
        if st.button("Réinitialiser uniquement l’apprentissage", width="stretch"):
            reset_tinder_learning(profile);st.success("Les décisions restent enregistrées, mais elles ne pèseront plus dans les prochains scores.");st.rerun()

    controls_left, controls_right = st.columns([2, 1])
    minimum_review_score = controls_left.slider("Score minimum affiché", 0, 100, 0, 5, help="Les offres sous ce score restent dans la file et pourront être examinées plus tard.")
    if controls_right.button("↩ Annuler la dernière décision", width="stretch", disabled=stats["reviewed"] == 0):
        st.toast(undo_last_review(profile))
        st.rerun()

    offer = next_review_offer(profile, minimum_review_score)
    if offer:
        payload = {key: ("" if value is None else value) for key, value in offer.items()}
        swipe_result = job_swiper(offer=payload, default=None, key=f"job-swiper-{offer['id']}")
        if isinstance(swipe_result, dict) and swipe_result.get("decision") in {"keep", "unsure", "reject"}:
            if int(swipe_result.get("offer_id", 0)) == int(offer["id"]):
                save_review_decision(profile, int(offer["id"]), swipe_result["decision"])
                st.rerun()

        with st.expander("Le swipe ne répond pas ? Afficher les boutons de secours"):
            f1, f2, f3 = st.columns(3)
            if f1.button("❌ Supprimer", width="stretch", key=f"reject-{offer['id']}"):
                save_review_decision(profile, int(offer["id"]), "reject");st.rerun()
            if f2.button("🤔 Je ne sais pas", width="stretch", key=f"unsure-{offer['id']}"):
                save_review_decision(profile, int(offer["id"]), "unsure");st.rerun()
            if f3.button("💚 Garder", type="primary", width="stretch", key=f"keep-{offer['id']}"):
                save_review_decision(profile, int(offer["id"]), "keep");st.rerun()
    elif stats["pending"]:
        st.warning(f"Il reste {stats['pending']} offre(s), mais elles sont sous le score minimum sélectionné.")
    else:
        st.success("Toutes les nouvelles offres ont été examinées 🎉")

    st.markdown("#### Validation vers Google Sheets")
    if stats["ready"]:
        st.info(f"{stats['ready']} décision(s) Garder/À revoir sont prêtes à rejoindre l’onglet Opportunités. Les offres supprimées resteront uniquement dans l’historique local.")
    elif not stats["pending"]:
        st.caption("Aucune nouvelle décision n’attend d’être synchronisée.")
    if st.button("📤 Envoyer Garder + À revoir vers le Sheet", type="primary", width="stretch", disabled=not bool(sheet_id and stats["ready"])):
        ok, output = run_google_command(selected, "review-sync")
        (st.success if ok else st.error)(output or ("Décisions synchronisées" if ok else "Synchronisation impossible"))
    if not sheet_id:
        st.caption("Aucun Google Sheet n’est lié à ce profil. Les décisions restent sauvegardées localement et pourront être exportées après la connexion.")

    with st.expander("🧪 Réinitialiser des offres pour tester le Tinder", expanded=False):
        catalog = review_offer_catalog(profile)
        labels_by_id = {
            int(item["id"]): f'#{item["id"]} · {item.get("company") or "Entreprise inconnue"} — {item.get("title") or "Sans titre"} · {float(item.get("score") or 0):.0f}/100 · {item.get("review_decision") or "sans décision"}'
            for item in catalog
        }
        selected_offer_ids = st.multiselect(
            "Offres à modifier",
            options=list(labels_by_id),
            format_func=lambda offer_id: labels_by_id.get(offer_id, str(offer_id)),
            placeholder="Choisir une ou plusieurs offres…",
        )
        st.caption("Remettre dans Tinder conserve l’offre et efface sa décision. Supprimer localement l’oublie complètement : elle pourra être retrouvée lors d’un prochain scan.")
        reset_col, delete_col = st.columns(2)
        if reset_col.button("↩ Remettre dans Tinder", width="stretch", disabled=not selected_offer_ids):
            count = reset_offers_to_pending(profile, selected_offer_ids)
            st.session_state["tinder_flash"] = f"{count} offre(s) remise(s) dans la file Tinder."
            st.rerun()
        confirm_delete = st.checkbox("Je confirme la suppression locale des offres sélectionnées", disabled=not selected_offer_ids)
        if delete_col.button("🗑 Supprimer localement", width="stretch", disabled=not (selected_offer_ids and confirm_delete)):
            count = delete_local_offers(profile, selected_offer_ids)
            st.session_state["tinder_flash"] = f"{count} offre(s) supprimée(s) de la base locale."
            st.rerun()

with profile_tab:
    student = profile.get("student") or {}
    target = profile.get("target") or {}
    location = profile.get("location") or {}
    skills = profile.get("skills") or {}
    interests = profile.get("interests") or {}
    country_options = ["Switzerland", "France", "Belgium", "Germany", "Luxembourg", "Italy", "Spain", "Austria", "Netherlands", "United Kingdom", "United States", "Canada"]
    st.markdown("### Ce que la personne recherche")
    st.markdown('<p class="section-note">Ces champs construisent automatiquement les recherches et le score des offres.</p>', unsafe_allow_html=True)
    with st.form("profile_form"):
        a, b = st.columns(2)
        display_name = a.text_input("Nom du profil", profile.get("name", selected.stem))
        mode_labels = {
            "Stage / internship": "internship",
            "Emploi CDI / CDD": "employment",
            "Alternance / apprentissage": "alternance",
            "Freelance / mission": "freelance",
        }
        current_mode = hunter.profile_contract_mode(profile)
        current_label = {
            "internship": "Stage / internship",
            "employment": "Emploi CDI / CDD",
        }.get(current_mode, "Alternance / apprentissage" if "altern" in str(student.get("stage_type", "")).lower() else "Freelance / mission" if "freelance" in str(student.get("stage_type", "")).lower() else "Emploi CDI / CDD")
        search_kind = b.selectbox(
            "Type de recherche *",
            list(mode_labels),
            index=list(mode_labels).index(current_label),
            help="Ce choix est un filtre strict : un profil Emploi CDI/CDD écartera les stages, et inversement.",
        )
        contract_options = ["CDI", "CDD", "Temps plein", "Temps partiel", "Stage", "Internship", "Praktikum", "Alternance", "Apprentissage", "Freelance"]
        current_contracts = as_list(student.get("contract_types"))
        if not current_contracts:
            current_contracts = ["Stage", "Internship"] if search_kind == "Stage / internship" else ["CDI", "CDD"]
        canonical_contracts = {option.casefold(): option for option in contract_options}
        normalized_contracts = []
        for item in current_contracts:
            normalized = canonical_contracts.get(item.strip().casefold(), item.strip())
            if normalized and normalized not in normalized_contracts:
                normalized_contracts.append(normalized)
        # Older/custom YAML profiles may contain values that are not in the
        # built-in list. Streamlit requires every default to be an option,
        # even when accept_new_options=True.
        contract_options = contract_options + [item for item in normalized_contracts if item not in contract_options]
        contracts = a.multiselect(
            "Contrats acceptés *",
            contract_options,
            default=normalized_contracts,
            accept_new_options=True,
            help="Sélectionne uniquement les contrats réellement acceptés.",
        )
        min_weeks = b.number_input("Durée minimale (semaines)", min_value=0, max_value=104, value=int(student.get("min_weeks", 0)), help="Principalement utile pour les stages et missions temporaires.")
        start_date = a.text_input("Disponible à partir du", str(student.get("start_date") or ""), placeholder="AAAA-MM-JJ")
        end_date = b.text_input("Disponible jusqu’au", str(student.get("end_date") or ""), placeholder="AAAA-MM-JJ")
        current_countries = as_list(location.get("countries") or location.get("country"))
        countries = a.multiselect("Pays ciblés", country_options, default=current_countries, accept_new_options=True, help="Tu peux sélectionner plusieurs pays ou saisir un nouveau nom. Les traductions usuelles sont automatiques.")
        languages = b.text_input("Langues acceptées", ", ".join(as_list(location.get("acceptable_language"))), help="Codes courts : fr, en, de, it…")
        priority_locations = st.text_input("Villes ou régions prioritaires", ", ".join(as_list(location.get("priority_locations"))))
        st.markdown("#### 1. Métiers réellement visés")
        roles = st.text_area("Intitulés de poste acceptés — un par ligne", lines(target.get("job_titles")), height=125, help="Sois précis : développeur full-stack, ingénieur logiciel, développeur Java… Évite seulement « développement ».")
        red_flags = st.text_area("Mots interdits dans les intitulés — un par ligne", lines(target.get("red_flags")), height=90, help="Ex. senior, director ou doctoral. La règle regarde le titre de l'offre, jamais une recommandation ni la description de l'équipe.")
        c, d = st.columns(2)
        core = c.text_area("2. Compétences techniques", lines(skills.get("core")), height=220, help="Langages, frameworks et outils : Java, Spring, React, SQL, Git, IA…")
        strong = d.text_area("3. Domaines professionnels maîtrisés", lines(skills.get("strong_domains")), height=220, help="Ex. développement web, logiciel, systèmes embarqués, data, R&D.")
        current_sectors = target.get("sectors") or hunter.profile_professional_interests(profile)
        sectors = c.text_area("4. Secteurs/technologies souhaités", lines(current_sectors), height=145, help="Influence les recherches : SaaS, jeu vidéo, MedTech, SportTech… Mets « cyclisme » ici seulement si la personne veut réellement travailler dans cette industrie.")
        personal = d.text_area("5. Passions personnelles — contexte uniquement", lines(interests.get("personal")), height=145, help="Vélo, sport, musique… Ces mots ne génèrent aucune recherche et ne valident aucune offre.")
        require_relevance = st.checkbox("Écarter les offres sans lien clair avec le profil", value=bool((profile.get("search") or {}).get("require_profile_relevance", True)))
        save_profile = st.form_submit_button("Enregistrer le profil", type="primary", width="stretch")
    if save_profile:
        profile["name"] = display_name.strip() or profile.get("name")
        stage_type = {
            "Stage / internship": "stage / internship",
            "Emploi CDI / CDD": "emploi",
            "Alternance / apprentissage": "alternance / apprentissage",
            "Freelance / mission": "freelance / mission",
        }[search_kind]
        internship_contracts = {"stage", "internship", "praktikum", "trainee", "studentship"}
        employment_contracts = {"cdi", "cdd", "temps plein", "temps partiel", "permanent", "full-time", "part-time"}
        if search_kind == "Stage / internship":
            contracts = [item for item in contracts if item.strip().lower() in internship_contracts] or ["Stage", "Internship"]
        elif search_kind == "Emploi CDI / CDD":
            contracts = [item for item in contracts if item.strip().lower() in employment_contracts] or ["CDI", "CDD"]
        elif search_kind == "Alternance / apprentissage":
            contracts = [item for item in contracts if item.strip().lower() in {"alternance", "apprentissage", "apprenticeship"}] or ["Alternance", "Apprentissage"]
        else:
            contracts = [item for item in contracts if item.strip().lower() in {"freelance", "mission", "contractor"}] or ["Freelance"]
        profile.setdefault("student", {}).update({
            "stage_type": stage_type,
            "contract_types": contracts,
            "min_weeks": int(min_weeks), "start_date": start_date.strip(), "end_date": end_date.strip(),
        })
        profile.setdefault("target", {})["job_titles"] = split_lines(roles)
        profile["target"]["red_flags"] = split_lines(red_flags)
        profile.setdefault("target", {})["sectors"] = split_lines(sectors)
        profile.setdefault("location", {}).update({
            "countries": countries,
            "acceptable_language": [item.strip().lower() for item in languages.split(",") if item.strip()],
            "priority_locations": [item.strip() for item in priority_locations.split(",") if item.strip()],
        })
        profile.setdefault("skills", {}).update({"core": split_lines(core), "strong_domains": split_lines(strong)})
        profile.setdefault("interests", {})["personal"] = split_lines(personal)
        profile["interests"]["professional"] = split_lines(sectors)
        profile.setdefault("search", {})["require_profile_relevance"] = require_relevance
        available_packs = (load_yaml(SOURCES_FILE).get("packs") if SOURCES_FILE.exists() else {}) or {}
        wanted_countries = {hunter.country_aliases(country)[0] for country in countries}
        selected_packs = []
        for pack_name in as_list((profile.get("sources") or {}).get("packs")):
            pack = available_packs.get(pack_name, {})
            pack_countries = {hunter.country_aliases(country)[0] for country in as_list(pack.get("countries"))}
            # Geographic packs follow the selected countries. Thematic packs
            # (without a countries field) remain selected.
            if not pack_countries or wanted_countries & pack_countries:
                selected_packs.append(pack_name)
        for pack_name, pack in available_packs.items():
            pack_countries = {hunter.country_aliases(country)[0] for country in as_list(pack.get("countries"))}
            if wanted_countries & pack_countries and pack_name not in selected_packs:
                selected_packs.append(pack_name)
        profile.setdefault("sources", {})["packs"] = selected_packs
        save_yaml(selected, profile)
        st.success("Profil enregistré. Les prochaines requêtes utiliseront ces mots.")

with search_tab:
    catalog = (load_yaml(SOURCES_FILE).get("packs") if SOURCES_FILE.exists() else {}) or {}
    pack_labels = {key: value.get("label", key) for key, value in catalog.items()}
    source_cfg = profile.get("sources") or {}
    search_cfg = profile.get("search") or {}
    st.markdown("### Stratégie de découverte")
    st.markdown('<p class="section-note">Le moteur mélange objectif, métier, compétences et pays, puis interroge aussi les domaines et listings sélectionnés.</p>', unsafe_allow_html=True)
    with st.form("search_form"):
        packs = st.multiselect("Packs de sites fixes", list(catalog), default=[x for x in as_list(source_cfg.get("packs")) if x in catalog], format_func=lambda key: pack_labels[key])
        s1, s2 = st.columns(2)
        query_budget = s1.number_input("Budget en mode Complet", min_value=10, max_value=300, value=int(search_cfg.get("query_budget", 45)), help="Complet utilise 45 par défaut ; Exhaustif 1h peut monter à 240 sans modifier ce réglage permanent.")
        site_share = s2.slider("Part réservée aux domaines fixes", 0.10, 0.70, float(search_cfg.get("site_query_share", 0.35)), 0.05)
        use_manual = s1.checkbox("Ajouter mes requêtes manuelles", value=bool(search_cfg.get("use_manual_queries", True)))
        retry_empty = s2.checkbox("Retenter un autre moteur quand il n’y a aucun résultat", value=bool(search_cfg.get("retry_empty_results", False)), help="Déconseillé : cette option ralentit fortement les scans.")
        allow_unconfirmed = st.checkbox(
            "Conserver les offres techniques dont le type de contrat reste à vérifier",
            value=bool(search_cfg.get("allow_unconfirmed_contract", True)),
            help="Recommandé pour les pages chargées en JavaScript : elles restent visibles avec une confiance réduite au lieu d’être supprimées.",
        )
        custom_domains = st.text_area("Mes domaines à interroger — un par ligne", lines(source_cfg.get("custom_domains")), height=100, placeholder="careers.monentreprise.com\nmonjobboard.fr", help="Le moteur fabriquera une requête site: cohérente avec les mots du profil.")
        custom_urls = st.text_area("Mes pages de listings à visiter directement — une URL par ligne", lines(source_cfg.get("custom_urls")), height=100, placeholder="https://careers.monentreprise.com/jobs")
        manual_queries = st.text_area("Requêtes manuelles facultatives — une par ligne", lines(search_cfg.get("queries")), height=125)
        custom_queries = st.text_area("Requêtes supplémentaires liées aux packs", lines(source_cfg.get("custom_queries")), height=100)
        save_search = st.form_submit_button("Enregistrer la recherche", type="primary", width="stretch")
    if save_search:
        profile.setdefault("sources", {}).update({
            "packs": packs, "custom_queries": split_lines(custom_queries),
            "custom_domains": split_lines(custom_domains), "custom_urls": split_lines(custom_urls),
        })
        profile.setdefault("search", {}).update({
            "strategy": "profile", "query_budget": int(query_budget), "site_query_share": float(site_share),
            "retry_empty_results": retry_empty, "allow_unconfirmed_contract": allow_unconfirmed,
            "use_manual_queries": use_manual, "queries": split_lines(manual_queries),
        })
        save_yaml(selected, profile)
        st.success("Stratégie enregistrée.")
        st.rerun()

    preview_mode = st.segmented_control("Aperçu du mode", list(MODE_SETTINGS), default="Complet") or "Complet"
    queries, components, fixed_urls = preview_queries(selected, preview_mode)
    p1, p2, p3 = st.columns(3)
    p1.metric("Requêtes préparées", len(queries))
    p2.metric("Domaines/listings fixes", len(fixed_urls))
    p3.metric("Mots prioritaires", len(components.get("themes", [])))
    st.caption("Intentions : " + ", ".join(components.get("intents", [])) + " · Métiers : " + ", ".join(components.get("roles", [])[:8]))
    st.dataframe(pd.DataFrame({"#": range(1, len(queries) + 1), "Requête réellement lancée": queries}), hide_index=True, width="stretch", height=360)
    with st.expander("Listings visités directement"):
        if fixed_urls:
            st.code("\n".join(fixed_urls), language=None)
        else:
            st.info("Aucun listing fixe sélectionné.")

    st.markdown("#### 🧪 Banc de test du moteur web")
    st.caption("Teste une seule requête sans toucher à Gmail, Google Sheets ni à l’historique. Le rapport suit désormais tout le tunnel : moteur → listing → liens d’offres → décision simulée.")
    ranked_queries = ranked_queries_for_profile(profile, queries)
    if ranked_queries:
        selected_debug_query = st.selectbox(
            "Requête générée à tester",
            ranked_queries,
            help="L’ordre affiché tient compte de l’historique de rendement, comme pendant un vrai scan.",
        )
    else:
        selected_debug_query = ""
    custom_debug_query = st.text_input(
        "Ou saisir une requête libre",
        placeholder="Ex. internship embedded systems Switzerland",
        help="Si ce champ n’est pas vide, il remplace la requête sélectionnée au-dessus.",
    )
    backend_options = list(hunter.SUPPORTED_SEARCH_BACKENDS)
    configured_backends, _, _, _ = hunter.configured_search_backends()
    backend_labels = {
        "duckduckgo": "DuckDuckGo", "yahoo": "Yahoo / index Bing", "brave": "Brave",
        "google": "Google", "startpage": "Startpage", "mojeek": "Mojeek",
    }
    debug_left, debug_middle, debug_right = st.columns([2, 1, 1])
    debug_backends = debug_left.multiselect(
        "Moteurs à comparer", backend_options, default=configured_backends or ["duckduckgo", "yahoo"],
        format_func=lambda value: backend_labels.get(value, value),
    )
    debug_limit = debug_middle.slider("Résultats/moteur", 1, 10, 5)
    debug_timeout = debug_right.slider("Timeout", 5, 15, 7)
    inspect_debug_pages = st.toggle("Explorer les résultats et les offres trouvées dans les listings", value=True, help="Ouvre jusqu’à six résultats, extrait leurs cartes d’offres puis vérifie jusqu’à quatre fiches individuelles.")
    debug_listing_checks = st.slider("Fiches individuelles à vérifier dans ce test", 1, 12, 6, disabled=not inspect_debug_pages)
    effective_debug_query = custom_debug_query.strip() or selected_debug_query
    debug_key = f"search_debug_report_{selected.stem}"
    if st.button("▶ Tester le moteur maintenant", type="primary", width="stretch", disabled=not bool(effective_debug_query and debug_backends)):
        try:
            with st.spinner("Interrogation isolée des moteurs…"):
                complete_profile = injected_profile(selected)
                report = hunter.debug_web_search(
                    complete_profile,
                    effective_debug_query,
                    debug_backends,
                    limit=int(debug_limit),
                    timeout=int(debug_timeout),
                    inspect_pages=inspect_debug_pages,
                    max_page_checks=6,
                    max_listing_page_checks=int(debug_listing_checks),
                )
                report_path = save_search_debug_report(profile, report)
                report["report_file"] = str(report_path)
                st.session_state[debug_key] = report
        except Exception as error:
            st.exception(error)

    debug_report = st.session_state.get(debug_key)
    if debug_report:
        summary = debug_report.get("summary") or {}
        d1, d2, d3, d4, d5 = st.columns(5)
        d1.metric("Moteurs répondant", f'{summary.get("engines_with_results", 0)}/{summary.get("engines_tested", 0)}')
        d2.metric("Résultats bruts", summary.get("raw_results", 0))
        d3.metric("Liens uniques valides", summary.get("unique_valid_links", 0))
        d4.metric("Pistes uniques", summary.get("listing_leads_found", 0), help=f'{summary.get("listing_leads_raw", summary.get("listing_leads_found", 0))} piste(s) brute(s) avant dédoublonnage')
        d5.metric("Retenues simulées", summary.get("simulated_retained", 0))
        engine_rows = []
        for item in debug_report.get("engines", []):
            engine_rows.append({
                "Moteur": item.get("backend"), "État": item.get("status"),
                "Durée (s)": round(float(item.get("elapsed_ms", 0) or 0) / 1000, 2),
                "Bruts": item.get("raw_count", 0), "Liens valides": item.get("valid_links", item.get("valid_unique_links", 0)),
                "Nouveaux uniques": item.get("new_unique_links", item.get("valid_unique_links", 0)),
                "Type d’erreur": item.get("error_type", ""), "Message exact": item.get("error_message", ""),
            })
        if engine_rows:
            st.dataframe(pd.DataFrame(engine_rows), hide_index=True, width="stretch")
        raw_rows = debug_report.get("results") or []
        if raw_rows:
            with st.expander("Résultats bruts vus par les moteurs", expanded=True):
                raw_frame = pd.DataFrame(raw_rows).rename(columns={
                    "engine": "Moteur", "rank": "Rang", "title": "Titre", "url": "URL",
                    "domain": "Domaine", "snippet": "Extrait vu", "filter_status": "Filtre URL",
                })
                st.dataframe(
                    raw_frame[["Moteur", "Rang", "Titre", "Domaine", "Filtre URL", "URL", "Extrait vu"]],
                    hide_index=True, width="stretch", height=360,
                    column_config={"URL": st.column_config.LinkColumn("URL", display_text="Ouvrir")},
                )
        page_rows = debug_report.get("page_checks") or []
        if page_rows:
            with st.expander("Simulation de notre validation", expanded=True):
                page_frame = pd.DataFrame(page_rows).rename(columns={
                    "title": "Titre", "url": "URL", "domain": "Domaine", "html_chars": "HTML",
                    "text_chars": "Texte", "page_type": "Type de page", "classification_reason": "Preuve du type",
                    "contract_confirmed": "Contrat confirmé", "availability": "Disponibilité",
                    "decision": "Décision simulée", "decision_reason": "Motif",
                })
                st.dataframe(page_frame, hide_index=True, width="stretch", height=360, column_config={"URL": st.column_config.LinkColumn("URL", display_text="Ouvrir")})
        listing_rows = debug_report.get("listing_leads") or []
        if listing_rows:
            with st.expander("Offres détectées à l’intérieur des listings", expanded=True):
                listing_frame = pd.DataFrame(listing_rows).rename(columns={
                    "listing_url": "Listing source", "title": "Titre détecté", "company": "Entreprise",
                    "location": "Lieu", "url": "URL offre", "priority": "Priorité profil",
                    "has_detail_url": "Lien individuel trouvé",
                })
                st.dataframe(
                    listing_frame, hide_index=True, width="stretch", height=360,
                    column_config={
                        "Listing source": st.column_config.LinkColumn("Listing source", display_text="Listing"),
                        "URL offre": st.column_config.LinkColumn("URL offre", display_text="Ouvrir"),
                    },
                )
        listing_checks = debug_report.get("listing_page_checks") or []
        if listing_checks:
            with st.expander("Validation des premières offres extraites", expanded=True):
                checks_frame = pd.DataFrame(listing_checks).rename(columns={
                    "title": "Titre", "url": "URL", "listing_url": "Listing source", "domain": "Domaine",
                    "html_chars": "HTML", "text_chars": "Texte", "page_type": "Type de page",
                    "classification_reason": "Preuve du type", "contract_confirmed": "Contrat confirmé",
                    "availability": "Disponibilité", "decision": "Décision simulée", "decision_reason": "Motif",
                })
                st.dataframe(
                    checks_frame, hide_index=True, width="stretch", height=360,
                    column_config={
                        "URL": st.column_config.LinkColumn("URL", display_text="Offre"),
                        "Listing source": st.column_config.LinkColumn("Listing source", display_text="Listing"),
                    },
                )
        report_bytes = json.dumps(debug_report, ensure_ascii=False, indent=2, default=str).encode("utf-8")
        st.download_button("Télécharger le rapport de test JSON", report_bytes, file_name=f"web_debug_{selected.stem}.json", mime="application/json")

with diagnostic_tab:
    st.markdown("### 🩺 Santé du moteur")
    st.markdown('<p class="section-note">Le tunnel complet du dernier scan : où le temps est dépensé, quelles sources produisent et pourquoi les pages sont rejetées.</p>', unsafe_allow_html=True)
    diagnostics = read_diagnostics(profile)
    if not diagnostics:
        st.info("Lance un scan V6.2 pour générer le diagnostic détaillé.")
    else:
        runtime = diagnostics.get("runtime") or {}
        funnel = runtime.get("funnel") or diagnostics.get("stats") or {}
        web = runtime.get("web") or {}
        f1, f2, f3, f4, f5 = st.columns(5)
        f1.metric("Candidats initiaux", diagnostics.get("input_candidates", 0))
        f2.metric("Après listings", diagnostics.get("expanded_candidates", 0))
        f3.metric("Retenues", funnel.get("retained", 0))
        f4.metric("Fermées", funnel.get("closed", 0))
        f5.metric("Web évitées", web.get("skipped", 0))

        recommendations = list(runtime.get("recommendations") or [])
        input_count = max(1, int(diagnostics.get("input_candidates", 0) or 0))
        expanded_count = int(diagnostics.get("expanded_candidates", 0) or 0)
        if expanded_count > input_count * 4:
            recommendations.append("L’exploration des sous-listings multiplie fortement les pages : baisse le plafond récursif si la durée reste trop élevée.")
        retained_sources = diagnostics.get("retained_sources") or {}
        retained_total = sum(retained_sources.values())
        if retained_total and max(retained_sources.values(), default=0) / retained_total > .65:
            recommendations.append("Une seule source fournit plus de 65 % des résultats : ajoute des pages carrière officielles dans les sources personnalisées.")
        if funnel.get("closed", 0) > max(10, funnel.get("retained", 0) * 1.5):
            recommendations.append("Le volume d’offres fermées est élevé. Inspecte l’audit avant de durcir les filtres ; V6.2 ne se fie plus aux messages cachés dans le HTML.")
        if recommendations:
            st.markdown("#### Recommandations automatiques")
            for recommendation in dict.fromkeys(recommendations):
                st.markdown(f'<div class="callout">{html.escape(recommendation)}</div>', unsafe_allow_html=True)

        left, right = st.columns(2)
        with left:
            st.markdown("#### Rendement par source")
            source_yield = runtime.get("source_yield") or {}
            if source_yield:
                source_frame = pd.DataFrame([{"Source": key, **value} for key, value in source_yield.items()])
                source_frame = source_frame.rename(columns={"candidates": "Candidats", "retained": "Retenues", "yield_percent": "Rendement %"})
                st.dataframe(source_frame.sort_values(["Retenues", "Rendement %"], ascending=False), hide_index=True, width="stretch", height=330)
            else:
                st.caption("Les rendements détaillés apparaîtront après le prochain scan V6.2.")
        with right:
            st.markdown("#### Principaux rejets")
            rejection_reasons = diagnostics.get("rejection_reasons") or {}
            if rejection_reasons:
                rejection_frame = pd.DataFrame([{"Motif": key, "Pages": value} for key, value in rejection_reasons.items()]).sort_values("Pages", ascending=False)
                st.dataframe(rejection_frame, hide_index=True, width="stretch", height=330)

        st.markdown("#### Historique des scans")
        history = read_scan_history(profile)
        if not history.empty:
            st.dataframe(history, hide_index=True, width="stretch")
        else:
            st.caption("Le suivi longitudinal commence avec la V6.2.")

        with st.expander("Historique technique des sources"):
            health = read_source_health(profile)
            if health.empty:
                st.caption("Pas encore de métriques cumulées.")
            else:
                health["Rendement"] = (100 * health["retained"] / health["attempts"].clip(lower=1)).round(1)
                health["Temps moyen (s)"] = (health["elapsed_ms"] / health["attempts"].clip(lower=1) / 1000).round(2)
                st.dataframe(health, hide_index=True, width="stretch", height=420)
        diagnostic_path = profile_output(profile) / "stage_hunter_diagnostics.json"
        if diagnostic_path.exists():
            st.download_button("Télécharger le diagnostic JSON", diagnostic_path.read_bytes(), file_name=f"diagnostic_{profile.get('id','profil')}.json", mime="application/json")

with connections_tab:
    st.markdown("### Google Sheets et Gmail")
    st.markdown(f'<p class="section-note">Les connexions sont propres à chaque profil. {hunter.PRODUCT_NAME} reste utilisable sans Google.</p>', unsafe_allow_html=True)
    enabled_sheets = bool(google_cfg.get("sheets_enabled"))
    enabled_gmail = bool(google_cfg.get("gmail_enabled"))
    c1, c2, c3 = st.columns(3)
    c1.markdown(f'<div class="status-card"><strong><span class="dot-{"ok" if enabled_sheets else "off"}"></span>Google Sheets</strong><p>{"Activé" if enabled_sheets else "Désactivé"}</p></div>', unsafe_allow_html=True)
    c2.markdown(f'<div class="status-card"><strong><span class="dot-{"ok" if enabled_gmail else "off"}"></span>Gmail</strong><p>{"Activé" if enabled_gmail else "Désactivé"}</p></div>', unsafe_allow_html=True)
    ready = bool(sheet_id and secret_path.exists() and token_path.exists())
    c3.markdown(f'<div class="status-card"><strong><span class="dot-{"ok" if ready else "warn"}"></span>Configuration</strong><p>{"Identifiants présents" if ready else "Éléments manquants"}</p></div>', unsafe_allow_html=True)
    with st.form("connections_form"):
        g1, g2 = st.columns(2)
        sheets_enabled = g1.checkbox("Synchroniser Google Sheets", value=enabled_sheets)
        gmail_enabled = g2.checkbox("Lire Gmail", value=enabled_gmail)
        auto_create_sheet = st.checkbox("Créer automatiquement un Google Sheet si aucun identifiant n’est renseigné", value=bool(google_cfg.get("auto_create_sheet", False)))
        configured_sheet_id = st.text_input("Identifiant du Google Sheet", str(google_cfg.get("sheet_id") or ""), help="Vide = GOOGLE_SHEET_ID lu dans .env")
        response_tab = g1.text_input("Onglet historique/final", str(google_cfg.get("response_tab") or "Réponses"))
        opportunity_tab = g2.text_input("Onglet des opportunités", str(google_cfg.get("opportunity_tab") or "Opportunités"))
        save_connections = st.form_submit_button("Enregistrer les connexions", type="primary", width="stretch")
    if save_connections:
        profile.setdefault("integrations", {}).setdefault("google", {}).update({
            "sheets_enabled": sheets_enabled, "gmail_enabled": gmail_enabled,
            "auto_create_sheet": auto_create_sheet,
            "sheet_id": configured_sheet_id.strip(), "response_tab": response_tab.strip() or "Réponses",
            "opportunity_tab": opportunity_tab.strip() or "Opportunités",
        })
        save_yaml(selected, profile)
        persist_google_to_database(profile)
        st.success("Connexions enregistrées.")
        st.rerun()
    st.markdown("#### Assistant de connexion")
    st.caption("Sans Apps Script, les menus d’action sont traités au prochain scan ou avec le bouton de synchronisation ci-dessous.")
    if sheet_id:
        st.link_button("Ouvrir le Google Sheet", f"https://docs.google.com/spreadsheets/d/{sheet_id}", width="stretch")
    b1, b2, b3 = st.columns(3)
    if b1.button("Tester la connexion Google", width="stretch"):
        ok, output = run_google_command(selected, "google-check")
        (st.success if ok else st.error)(output or ("Connexion réussie" if ok else "Échec de connexion"))
    if b2.button("Renouveler l’autorisation Google", width="stretch"):
        ok, output = run_google_command(selected, "google-auth")
        (st.success if ok else st.error)(output or ("Autorisation réussie" if ok else "Échec d’autorisation"))
    if b3.button("Créer et relier un nouveau Sheet", type="primary", width="stretch"):
        ok, output = run_google_command(selected, "google-create-sheet")
        (st.success if ok else st.error)(output or ("Tableau créé" if ok else "Création impossible"))
        if ok:st.rerun()
    b4, b5 = st.columns(2)
    if b4.button("🎨 Mettre en forme / réparer le Sheet", width="stretch", disabled=not bool(sheet_id)):
        ok, output = run_google_command(selected, "google-setup-sheet")
        (st.success if ok else st.error)(output or ("Mise en forme appliquée" if ok else "Mise en forme impossible"))
    if b5.button("⚡ Synchroniser les actions maintenant", type="primary", width="stretch", disabled=not bool(sheet_id)):
        ok, output = run_google_command(selected, "actions")
        (st.success if ok else st.error)(output or ("Actions synchronisées" if ok else "Synchronisation impossible"))

with automation_tab:
    st.markdown("### ⏱ Scans récurrents")
    st.markdown('<p class="section-note">Programme un scan Windows pour ce profil. La tâche utilise exactement cette installation et conserve les résultats dans sa base locale.</p>', unsafe_allow_html=True)
    if os.name != "nt":
        st.info(f"La création automatique d’une tâche planifiée est disponible sous Windows. Le reste de {hunter.PRODUCT_NAME} fonctionne normalement sur ce système.")
    else:
        with st.form("scheduler_form"):
            s1, s2 = st.columns(2)
            schedule_time = s1.time_input("Heure du scan", value=datetime.strptime("07:00", "%H:%M").time())
            frequency_label = s2.selectbox("Fréquence", ["Tous les jours", "Du lundi au vendredi", "Chaque lundi"])
            create_schedule = st.form_submit_button("Créer ou mettre à jour la tâche Windows", type="primary", width="stretch")
        frequency = {"Tous les jours": "daily", "Du lundi au vendredi": "weekdays", "Chaque lundi": "weekly"}[frequency_label]
        if create_schedule:
            ok, output = run_scheduler_command(selected, "install", schedule_time.strftime("%H:%M"), frequency)
            (st.success if ok else st.error)(output)
        st.caption("La tâche est créée uniquement après avoir cliqué sur le bouton. Elle peut être supprimée à tout moment ci-dessous.")
        if st.button("Supprimer la tâche planifiée de ce profil", width="stretch"):
            ok, output = run_scheduler_command(selected, "remove")
            (st.success if ok else st.error)(output)
    st.markdown("#### Bon rythme conseillé")
    st.markdown("- **Stages très compétitifs** : un scan chaque matin.\n- **Recherche d’emploi classique** : lundi à vendredi.\n- **Veille passive** : un scan hebdomadaire.")

with results_tab:
    frame = read_results(profile)
    if frame.empty:
        st.info("Aucun résultat local pour ce profil. Lance un premier scan.")
    else:
        st.markdown("### Offres actives")
        left, right = st.columns([1, 2])
        minimum = left.slider("Score minimum", 0, 100, 30)
        status_values = sorted(frame["status"].dropna().unique().tolist())
        statuses = right.multiselect("Statuts", status_values, default=status_values)
        shown = frame[(frame["score"] >= minimum) & frame["status"].isin(statuses)].copy()
        shown["review_decision"] = shown["review_decision"].map({"keep": "💚 Garder", "unsure": "🤔 À revoir"}).fillna(shown["review_decision"])
        shown["availability_status"] = shown["availability_status"].map({"open": "🟢 Ouverte", "unknown": "🟠 À confirmer", "closed": "🔴 Fermée"}).fillna("🟠 À confirmer")
        display_columns = ["score", "confidence", "learned_adjustment", "availability_status", "review_decision", "company", "title", "location", "canton", "language", "duration", "source", "url", "status"]
        st.dataframe(
            shown[display_columns],
            width="stretch",
            hide_index=True,
            height=570,
            column_config={
                "url": st.column_config.LinkColumn("Lien", display_text="Ouvrir"),
                "score": st.column_config.ProgressColumn("Score", min_value=0, max_value=100, format="%.0f"),
                "confidence": st.column_config.ProgressColumn("Confiance", min_value=0, max_value=100, format="%.0f"),
                "learned_adjustment": st.column_config.NumberColumn("Tinder ±", format="%+.1f"),
                "availability_status": "Disponibilité",
                "review_decision": "Décision",
                "company": "Entreprise", "title": "Offre", "location": "Lieu", "canton": "Région",
                "language": "Langue", "duration": "Durée", "source": "Source", "status": "Statut",
            },
        )
        with st.expander("Répartition des offres par source"):
            summary = shown.groupby("source", dropna=False).agg(Offres=("id", "count"), Score_moyen=("score", "mean"), Meilleur_score=("score", "max")).reset_index().sort_values("Offres", ascending=False)
            summary["Score_moyen"] = summary["Score_moyen"].round(1)
            st.dataframe(summary, hide_index=True, width="stretch")
        export_path = profile_output(profile) / "stage_hunter.xlsx"
        if export_path.exists():
            st.download_button("Télécharger l’export Excel", export_path.read_bytes(), file_name=f"stage_hunter_{profile.get('id','profil')}.xlsx")
