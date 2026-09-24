"""Local HTTP API and React frontend for Stage Hunter.

Run with ``python stage_hunter_web.py``. The server binds to loopback only.
"""
from __future__ import annotations

import json
import base64
import binascii
import hmac
import ipaddress
import mimetypes
import os
import re
import sqlite3
import subprocess
import sys
import threading
import time
import webbrowser
from collections import deque
from contextlib import closing
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import yaml
from dotenv import load_dotenv

import psutil

ROOT = Path(__file__).resolve().parent
load_dotenv(ROOT / ".env")
PROFILES = ROOT / "config" / "profiles"
DIST = ROOT / "web" / "dist"
MODES = {"Rapide": (24, 8, 4, 6), "Complet": (45, 16, 6, 8), "Maximum": (70, 25, 8, 10), "Exhaustif 1h": (240, 30, 8, 12)}
MODE_DURATIONS = {"Rapide": 180, "Complet": 600, "Maximum": 1500, "Exhaustif 1h": 3600}
SCAN = {
    "process": None,
    "process_pid": None,
    "profile": None,
    "profile_name": None,
    "mode": None,
    "started": None,
    "started_perf": None,
    "exit_code": None,
    "lines": deque(maxlen=1000),
    "retained_lines": deque(maxlen=1000),
    "removed_lines": deque(maxlen=1000),
    "error_lines": deque(maxlen=1000),
    "phase": "Prêt",
    "progress_percent": 0,
    "log_path": None,
    "current_action": {"text": "Moteur prêt", "type": "idle", "timestamp": ""},
    "recent_steps": [],
}
SCAN_LOCK = threading.Lock()


def is_loopback_host(host):
    try:
        return ipaddress.ip_address(host).is_loopback
    except ValueError:
        return host.lower() == "localhost"


def server_settings():
    host = os.getenv("STAGE_HUNTER_HOST", "127.0.0.1").strip()
    port = int(os.getenv("STAGE_HUNTER_PORT", "8501"))
    username = os.getenv("STAGE_HUNTER_WEB_USER", "").strip()
    password = os.getenv("STAGE_HUNTER_WEB_PASSWORD", "")
    if not host or not 1 <= port <= 65535:
        raise ValueError("Adresse ou port web invalide")
    if not is_loopback_host(host) and (not username or not password):
        raise ValueError("STAGE_HUNTER_WEB_USER et STAGE_HUNTER_WEB_PASSWORD sont requis pour une écoute réseau")
    return host, port, username, password


def get_system_telemetry(pid=None):
    try:
        vmem = psutil.virtual_memory()
        cpu = psutil.cpu_percent(interval=None)
        proc_mb = 0
        if pid:
            try:
                proc = psutil.Process(pid)
                # On Windows, .venv/Scripts/python.exe is a lightweight launcher stub (~3.3 MB)
                # which spawns the real Python interpreter as a child process.
                # We sum the RSS of the parent process and all recursive children to get the true footprint.
                total_rss = proc.memory_info().rss
                for child in proc.children(recursive=True):
                    try:
                        total_rss += child.memory_info().rss
                    except (psutil.NoSuchProcess, psutil.AccessDenied):
                        pass
                proc_mb = round(total_rss / (1024 * 1024), 1)
            except (psutil.NoSuchProcess, psutil.AccessDenied):
                proc_mb = 0
        return {
            "ram_used_pct": round(vmem.percent, 1),
            "ram_used_gb": round((vmem.total - vmem.available) / (1024 ** 3), 1),
            "ram_total_gb": round(vmem.total / (1024 ** 3), 1),
            "process_ram_mb": proc_mb,
            "cpu_pct": round(cpu, 1),
        }
    except Exception:
        return {"ram_used_pct": 0, "ram_used_gb": 0, "ram_total_gb": 0, "process_ram_mb": 0, "cpu_pct": 0}


def clean_reasons(text):
    if not text:
        return ""
    def _repl_pos(m):
        pts = m.group(1)
        details = (m.group(2) or "").strip()
        return f"Swiper +{pts} pts ({details})" if details else f"Swiper +{pts} pts"

    def _repl_neg(m):
        pts = m.group(1)
        details = (m.group(2) or "").strip()
        return f"Swiper -{pts} pts ({details})" if details else f"Swiper -{pts} pts"

    text = re.sub(r"(?:Apprentissage Tinder|Affinité profil)\s*\+?(\d+)(?:\s*\((.*?)\))?", _repl_pos, text, flags=re.IGNORECASE)
    text = re.sub(r"(?:Apprentissage Tinder|Affinité profil|Pénalité affinité)\s*-(\d+)(?:\s*\((.*?)\))?", _repl_neg, text, flags=re.IGNORECASE)
    text = re.sub(r"\btinder\b", "Swiper", text, flags=re.IGNORECASE)
    text = re.sub(r"\baffinité profil\b", "Swiper", text, flags=re.IGNORECASE)
    return text.strip()


def scan_state_payload():
    with SCAN_LOCK:
        running = SCAN["process"] is not None and (
            hasattr(SCAN["process"], "poll") and SCAN["process"].poll() is None
        )
        elapsed = 0
        percent = 0
        eta = 0
        if SCAN["started_perf"]:
            elapsed = max(0, round(time.perf_counter() - SCAN["started_perf"]))
            expected = MODE_DURATIONS.get(SCAN.get("mode"), 600)
            if running:
                p_val = SCAN.get("progress_percent", 5)
                # Fallback asymptotic percentage based on elapsed time without jumping to 96%
                fallback_time_pct = min(80, max(5, round((elapsed / expected) * 75)))
                percent = max(p_val, fallback_time_pct)
                if percent >= 10:
                    eta = max(10, round((elapsed / (percent / 100)) - elapsed))
                else:
                    eta = max(15, expected - elapsed)
            else:
                percent = 100 if SCAN["exit_code"] == 0 else 0
                eta = 0
        system = get_system_telemetry(SCAN.get("process_pid"))
        profile_name = SCAN.get("profile_name")
        if not profile_name and SCAN["profile"]:
            try:
                profile_name = read_profile(SCAN["profile"]).get("name")
            except Exception:
                profile_name = SCAN["profile"]
        return {
            "running": running,
            "profile": SCAN["profile"],
            "profile_name": profile_name or SCAN["profile"],
            "mode": SCAN["mode"],
            "started": SCAN["started"],
            "elapsed_seconds": elapsed,
            "percent": percent,
            "eta_seconds": eta,
            "phase": SCAN.get("phase", "En cours") if running else ("Terminé" if SCAN["exit_code"] == 0 else ("Erreur" if SCAN["exit_code"] is not None else "Prêt")),
            "exit_code": SCAN["exit_code"],
            "lines": list(SCAN["lines"]),
            "retained_lines": list(SCAN.get("retained_lines", [])),
            "removed_lines": list(SCAN.get("removed_lines", [])),
            "error_lines": list(SCAN.get("error_lines", [])),
            "system": system,
            "log_path": SCAN.get("log_path"),
            "current_action": SCAN.get("current_action", {"text": "Moteur prêt", "type": "idle", "timestamp": ""}),
            "recent_steps": list(SCAN.get("recent_steps", [])),
        }


def slug(value):
    import unicodedata
    value = "".join(c for c in unicodedata.normalize("NFD", str(value)) if unicodedata.category(c) != "Mn")
    return re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-") or "profil"


def profile_path(identifier):
    if not identifier or not re.fullmatch(r"[a-zA-Z0-9_-]+", identifier):
        raise ValueError("Identifiant de profil invalide")
    path = PROFILES / f"{identifier}.yaml"
    if not path.is_file():
        raise ValueError("Profil introuvable")
    return path


def read_profile(identifier):
    return yaml.safe_load(profile_path(identifier).read_text(encoding="utf-8")) or {}


def write_profile(identifier, data):
    path = profile_path(identifier)
    data["id"] = identifier
    temporary = path.with_suffix(".yaml.tmp")
    temporary.write_text(yaml.safe_dump(data, allow_unicode=True, sort_keys=False, width=110), encoding="utf-8")
    temporary.replace(path)


def database(identifier):
    return ROOT / "output" / slug(identifier) / "stage_hunter.sqlite3"


def ensure_database(identifier):
    path = database(identifier)
    path.parent.mkdir(parents=True, exist_ok=True)
    with closing(sqlite3.connect(path, timeout=20)) as conn, conn:
        conn.execute("CREATE TABLE IF NOT EXISTS offers(id INTEGER PRIMARY KEY,url TEXT UNIQUE,title TEXT,company TEXT,location TEXT,source TEXT,snippet TEXT,body TEXT,language TEXT,discovered_at TEXT,score REAL,status TEXT DEFAULT 'new',reasons TEXT,gmail_seen INTEGER DEFAULT 0)")
        columns = {row[1] for row in conn.execute("PRAGMA table_info(offers)")}
        additions = {"canton": "TEXT", "duration": "TEXT", "start_date": "TEXT", "domain_category": "TEXT",
                     "skills_found": "TEXT", "confidence": "REAL", "review_decision": "TEXT", "reviewed_at": "TEXT",
                     "sheet_synced": "INTEGER DEFAULT 0", "availability_status": "TEXT DEFAULT 'unknown'",
                     "availability_reason": "TEXT", "learned_adjustment": "REAL DEFAULT 0"}
        for name, kind in additions.items():
            if name not in columns:
                conn.execute(f"ALTER TABLE offers ADD COLUMN {name} {kind}")
        if "review_decision" not in columns:
            conn.execute("UPDATE offers SET review_decision=CASE WHEN status='kept' THEN 'keep' WHEN status='deleted' THEN 'reject' WHEN status='new' THEN 'pending' ELSE 'unsure' END")
        conn.execute("CREATE TABLE IF NOT EXISTS review_events(id INTEGER PRIMARY KEY,offer_id INTEGER NOT NULL,previous_decision TEXT,previous_status TEXT,decision TEXT NOT NULL,created_at TEXT NOT NULL)")
    return path


def rows(identifier, query, args=()):
    path = ensure_database(identifier)
    with closing(sqlite3.connect(path, timeout=20)) as conn:
        conn.row_factory = sqlite3.Row
        return [dict(row) for row in conn.execute(query, args)]


def snapshot(identifier):
    profile = read_profile(identifier)
    counts = {"pending": 0, "keep": 0, "unsure": 0, "reject": 0, "ready": 0}
    for row in rows(identifier, "SELECT review_decision,COUNT(*) AS n FROM offers GROUP BY review_decision"):
        if row["review_decision"] in counts:
            counts[row["review_decision"]] = row["n"]
    counts["pending"] = (rows(identifier, "SELECT COUNT(*) AS n FROM offers WHERE status='new' AND review_decision='pending'") or [{"n": 0}])[0]["n"]
    counts["ready"] = (rows(identifier, "SELECT COUNT(*) AS n FROM offers WHERE status IN ('new','kept') AND review_decision IN ('keep','unsure') AND COALESCE(sheet_synced,0)=0") or [{"n": 0}])[0]["n"]
    offers = rows(identifier, """SELECT id,score,confidence,company,title,location,canton,language,duration,start_date,
        domain_category,skills_found,reasons,source,url,discovered_at,availability_status,availability_reason,learned_adjustment,
        snippet, substr(body, 1, 4000) AS body_preview
        FROM offers WHERE status='new' AND review_decision='pending' ORDER BY score DESC,confidence DESC,id ASC""")
    for off in offers:
        off["reasons"] = clean_reasons(off.get("reasons", ""))
    results = rows(identifier, """SELECT id,score,confidence,company,title,location,canton,language,duration,start_date,
        domain_category,skills_found,reasons,source,url,discovered_at,availability_status,review_decision,learned_adjustment,
        snippet, substr(body, 1, 4000) AS body_preview
        FROM offers WHERE status IN ('new','kept') AND review_decision IN ('keep','unsure')
        ORDER BY CASE review_decision WHEN 'keep' THEN 0 ELSE 1 END,score DESC""")
    for res in results:
        res["reasons"] = clean_reasons(res.get("reasons", ""))
    diagnostic_path = database(identifier).parent / "stage_hunter_diagnostics.json"
    try:
        diagnostic = json.loads(diagnostic_path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        diagnostic = {}
    scan = scan_state_payload()
    return {"profile": profile, "stats": counts, "offers": offers, "results": results, "diagnostic": diagnostic,
            "scan": scan, "modes": list(MODES), "packs": (yaml.safe_load((ROOT / "config" / "sources.yaml").read_text(encoding="utf-8")) or {}).get("packs", {})}


def review(identifier, offer_id, decision):
    if decision not in {"keep", "unsure", "reject"}:
        raise ValueError("Décision invalide")
    path = database(identifier)
    if not path.exists():
        raise ValueError("Aucune offre disponible")
    with closing(sqlite3.connect(path, timeout=20)) as conn, conn:
        old = conn.execute("SELECT review_decision,status FROM offers WHERE id=? AND review_decision='pending' AND status='new'", (offer_id,)).fetchone()
        if old is None:
            raise ValueError("Cette offre a déjà été traitée")
        conn.execute("INSERT INTO review_events(offer_id,previous_decision,previous_status,decision,created_at) VALUES(?,?,?,?,?)",
                     (offer_id, old[0], old[1], decision, datetime.now().isoformat()))
        conn.execute("UPDATE offers SET review_decision=?,status=?,reviewed_at=?,sheet_synced=0 WHERE id=?",
                     (decision, {"keep": "kept", "unsure": "new", "reject": "deleted"}[decision], datetime.now().isoformat(), offer_id))


def undo(identifier):
    path = database(identifier)
    if not path.exists():
        return "Aucune décision à annuler."
    with closing(sqlite3.connect(path, timeout=20)) as conn, conn:
        event = conn.execute("SELECT id,offer_id,previous_decision,previous_status FROM review_events ORDER BY id DESC LIMIT 1").fetchone()
        if not event:
            return "Aucune décision à annuler."
        conn.execute("UPDATE offers SET review_decision=?,status=?,reviewed_at=NULL,sheet_synced=0 WHERE id=?",
                     (event[2] or "pending", event[3] or "new", event[1]))
        conn.execute("DELETE FROM review_events WHERE id=?", (event[0],))
    return "Dernière décision annulée."


def requeue_offers(identifier, offer_ids=None, all_unsure=False):
    path = database(identifier)
    if not path.exists():
        return 0
    with closing(sqlite3.connect(path, timeout=20)) as conn, conn:
        if all_unsure:
            cur = conn.execute("UPDATE offers SET review_decision='pending', status='new', reviewed_at=NULL, sheet_synced=0 WHERE review_decision='unsure'")
            return cur.rowcount
        elif offer_ids:
            placeholders = ",".join("?" for _ in offer_ids)
            cur = conn.execute(f"UPDATE offers SET review_decision='pending', status='new', reviewed_at=NULL, sheet_synced=0 WHERE id IN ({placeholders})", tuple(offer_ids))
            return cur.rowcount
    return 0


def delete_offer(identifier, offer_id):
    path = database(identifier)
    if not path.exists():
        return False
    with closing(sqlite3.connect(path, timeout=20)) as conn, conn:
        conn.execute("DELETE FROM review_events WHERE offer_id=?", (offer_id,))
        cur = conn.execute("DELETE FROM offers WHERE id=?", (offer_id,))
        return cur.rowcount > 0


def generate_csv(identifier):
    import csv
    import io
    data = rows(identifier, """SELECT id, score, confidence, company, title, location, canton, language, duration,
        start_date, domain_category, skills_found, reasons, source, url, review_decision, availability_status
        FROM offers WHERE review_decision IN ('keep', 'unsure')
        ORDER BY CASE review_decision WHEN 'keep' THEN 0 ELSE 1 END, score DESC""")
    output = io.StringIO()
    if data:
        writer = csv.DictWriter(output, fieldnames=list(data[0].keys()))
        writer.writeheader()
        writer.writerows(data)
    return output.getvalue().encode('utf-8-sig')


def reset_profile_data(identifier, mode="all"):
    path = database(identifier)
    if mode == "decisions":
        if path.exists():
            with closing(sqlite3.connect(path, timeout=20)) as conn:
                with conn:
                    conn.execute("DELETE FROM review_events")
                    cur = conn.execute("UPDATE offers SET review_decision='pending', status='new', reviewed_at=NULL, sheet_synced=0")
                    count = cur.rowcount
            return f"{count} offre(s) remise(s) en attente dans le Swiper."
        return "Aucune offre à réinitialiser."

    count = 0
    if path.exists():
        with closing(sqlite3.connect(path, timeout=20)) as conn:
            with conn:
                cur = conn.execute("SELECT COUNT(*) FROM offers")
                row = cur.fetchone()
                count = row[0] if row else 0
                conn.execute("DELETE FROM review_events")
                conn.execute("DELETE FROM offers")
                conn.execute("DELETE FROM source_metrics")
                conn.execute("DELETE FROM scan_runs")
                conn.execute("DELETE FROM sheet_sync")
            # VACUUM must run outside of an active transaction
            conn.isolation_level = None
            try:
                conn.execute("VACUUM")
            except sqlite3.OperationalError:
                pass

    out_dir = database(identifier).parent
    diag_file = out_dir / "stage_hunter_diagnostics.json"
    if diag_file.exists():
        try:
            diag_file.write_text("{}", encoding="utf-8")
        except OSError:
            pass
    for fn in ("stage_hunter.xlsx", "stage_hunter_listing_leads.xlsx", "stage_hunter_rejections.xlsx"):
        p = out_dir / fn
        if p.exists():
            try:
                p.unlink()
            except OSError:
                pass

    with SCAN_LOCK:
        if SCAN.get("profile") == identifier:
            SCAN["lines"].clear()
            for k in ("retained_lines", "removed_lines", "error_lines"):
                if k in SCAN:
                    SCAN[k].clear()
            SCAN["current_action"] = {"text": "Profil réinitialisé", "type": "idle", "timestamp": datetime.now().strftime("%H:%M:%S")}
            SCAN["recent_steps"] = []
            SCAN["exit_code"] = None
            SCAN["started"] = None
            SCAN["phase"] = "Prêt"

    return f"Historique réinitialisé ({count} offre(s) effacée(s)). Vos critères et réglages de profil sont conservés."


def extract_gemini_action(clean):
    low = clean.lower()
    m_list = re.search(r"CONFIG LISTING \d+/\d+\s*—\s*(https?://[^\s]+)", clean)
    if m_list:
        host = urlparse(m_list.group(1)).netloc.replace("www.", "")
        return {"text": f"Explore les offres sur {host}...", "type": "browse"}

    m_recon = re.search(r"RECONTRÔLE \d+/\d+\s*·\s*[^·]+\s*·\s*(.*)", clean)
    if m_recon:
        title = m_recon.group(1).strip()
        return {"text": f"Vérifie la disponibilité : {title[:55]}", "type": "revalidate"}

    m_web = re.search(r"WEB \d+/\d+\s*·\s*(.*)", clean)
    if m_web and "aucun résultat" not in low and "terminé" not in low:
        q = m_web.group(1).strip()
        return {"text": f"Recherche web active : « {q[:50]} »", "type": "search"}

    m_fixed = re.search(r"SITE FIXE\s*·\s*([^·]+)\s*·", clean)
    if m_fixed:
        site = m_fixed.group(1).strip()
        return {"text": f"Explore le listing carrières : {site}", "type": "browse"}

    if "sites fixes" in low and ("exploration" in low or "listing" in low):
        return {"text": "Exploration des portails et pages carrières...", "type": "browse"}

    m_ana = re.search(r"ANALYSE \d+/\d+\s*·\s*([^·]+)\s*·\s*(.*)", clean)
    if m_ana:
        comp = m_ana.group(1).strip()
        tit = m_ana.group(2).strip()
        return {"text": f"Démêle et analyse : {tit[:45]} ({comp})", "type": "analyze"}

    m_ret = re.search(r"→ RETENUE\s*·\s*(\d+/100)(.*)", clean)
    if m_ret:
        score_val = m_ret.group(1)
        rest = [part.strip() for part in m_ret.group(2).split("·") if part.strip()]
        tit = rest[-1] if rest else ""
        return {"text": f"★ Match retenu ({score_val}) : {tit[:45]}", "type": "match"}

    if "→ retirée" in low or "hors cible" in low:
        return {"text": "Écarte les fiches expirées ou hors critères", "type": "filter"}

    if "téléchargement" in low:
        return {"text": "Télécharge les fiches de poste...", "type": "download"}

    if "google" in low and "connexion" in low:
        return {"text": "Connexion aux services Google...", "type": "connect"}
    if "opportunités" in low or "synchronisation" in low:
        return {"text": "Synchronisation Google Sheets...", "type": "sync"}

    return None


def scan_worker(identifier, mode):
    profile = read_profile(identifier)
    path = profile_path(identifier)
    queries, sites, search_workers, scrape_workers = MODES[mode]
    budgets = {"Rapide": "240", "Complet": "720", "Maximum": "1800", "Exhaustif 1h": "3600"}
    reserves = {"Rapide": "30", "Complet": "60", "Maximum": "90", "Exhaustif 1h": "120"}
    environment = {
        **os.environ,
        "PYTHONUTF8": "1",
        "NO_COLOR": "1",
        "SEARCH_QUERY_BUDGET": str(queries),
        "FIXED_SITE_LIMIT": str(sites),
        "SEARCH_WORKERS": str(search_workers),
        "SCRAPE_WORKERS": str(scrape_workers),
        "SCAN_TIME_BUDGET_SECONDS": budgets.get(mode, "600"),
        "SCAN_DEADLINE_RESERVE_SECONDS": reserves.get(mode, "60"),
    }
    if mode == "Exhaustif 1h":
        environment.update({"WEB_DISABLE_CIRCUIT_BREAKER": "1", "WEB_RETRY_EMPTY_RESULTS": "1"})
    command = [sys.executable, str(ROOT / "stage_hunter.py"), "scan", "--profile", str(path)]
    google = (profile.get("integrations") or {}).get("google") or {}
    if google.get("sheets_enabled"):
        command.append("--sheets")
    if google.get("gmail_enabled"):
        command.append("--gmail")
    log_dir = database(identifier).parent / "logs"
    log_dir.mkdir(parents=True, exist_ok=True)
    log = log_dir / f"scan_{datetime.now():%Y%m%d_%H%M%S}.log"
    with SCAN_LOCK:
        SCAN["log_path"] = str(log)
        SCAN["phase"] = "Démarrage du moteur"
    try:
        with subprocess.Popen(command, cwd=ROOT, env=environment, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                              text=True, encoding="utf-8", errors="replace", bufsize=1) as process:
            with SCAN_LOCK:
                SCAN["process"] = process
                SCAN["process_pid"] = process.pid
            with log.open("w", encoding="utf-8") as output:
                for line in process.stdout:
                    clean = re.sub(r"\x1b\[[0-9;]*m", "", line.rstrip())
                    output.write(clean + "\n")
                    output.flush()  # Anti-crash flush on disk
                    low = clean.lower()
                    phase = None
                    progress_pct = None

                    if "scan terminé" in low:
                        phase = "Scan terminé"
                        progress_pct = 100
                    elif "export —" in low or "génération du fichier excel" in low:
                        phase = "Génération des rapports & exports"
                        progress_pct = 95
                    elif "analyse" in low and ("/" in clean or "notation" in low or "score" in low):
                        m_ana = re.search(r"ANALYSE (\d+)/(\d+)", clean)
                        if m_ana:
                            cur, tot = int(m_ana.group(1)), max(1, int(m_ana.group(2)))
                            progress_pct = 68 + int((cur / tot) * 24)
                        else:
                            progress_pct = 70
                        phase = "Analyse & notation des correspondances"
                    elif "http initial" in low or "http détails" in low or "téléchargement" in low or "page(s) téléchargée(s)" in low:
                        m_tb = re.search(r"(\d+)/(\d+) page", clean)
                        if m_tb:
                            cur, tot = int(m_tb.group(1)), max(1, int(m_tb.group(2)))
                            progress_pct = 45 + int((cur / tot) * 23)
                        else:
                            progress_pct = 48
                        phase = "Téléchargement & extraction des offres"
                    elif "web" in low and ("requête" in low or "candidat" in low or "web adaptatif" in low or re.search(r"web \d+/\d+", low)):
                        m_web = re.search(r"WEB (\d+)/(\d+)", clean)
                        if m_web:
                            cur, tot = int(m_web.group(1)), max(1, int(m_web.group(2)))
                            progress_pct = 25 + int((cur / tot) * 20)
                        else:
                            progress_pct = 28
                        phase = "Recherche web multi-moteurs"
                    elif "sources directes" in low or "sites fixes" in low:
                        phase = "Exploration des sites carrières"
                        progress_pct = 18
                    elif "recontrôle" in low:
                        m_rec = re.search(r"RECONTRÔLE (\d+)/(\d+)", clean)
                        if m_rec:
                            cur, tot = int(m_rec.group(1)), max(1, int(m_rec.group(2)))
                            progress_pct = 8 + int((cur / tot) * 9)
                        else:
                            progress_pct = 10
                        phase = "Vérification des offres existantes"
                    elif "config" in low or "démarrage" in low:
                        phase = "Configuration du profil"
                        progress_pct = 5

                    action_info = extract_gemini_action(clean)
                    is_ret = "→ RETENUE" in clean or "→ TOUJOURS ACTIVE" in clean or "match validé" in low or "offre retenue" in low
                    is_rem = "→ RETIRÉE" in clean or "→ DOUBLON" in clean or "hors cible" in low or "score trop bas" in low or "fermé" in low or "expirée" in low or "doublon" in low
                    is_err = (
                        "traceback" in low
                        or "exception" in low
                        or "crash" in low
                        or "[erreur" in low
                        or "erreur critique" in low
                        or ("erreur" in low and not any(k in low for k in ("http_error", "network_error", "à réessayer", "0 erreur", "requête(s)")))
                    )

                    with SCAN_LOCK:
                        SCAN["lines"].append(clean)
                        if is_ret:
                            SCAN.setdefault("retained_lines", deque(maxlen=1000)).append(clean)
                        if is_rem:
                            SCAN.setdefault("removed_lines", deque(maxlen=1000)).append(clean)
                        if is_err:
                            SCAN.setdefault("error_lines", deque(maxlen=1000)).append(clean)
                        if phase:
                            SCAN["phase"] = phase
                        if progress_pct is not None:
                            SCAN["progress_percent"] = max(SCAN.get("progress_percent", 5), min(98, progress_pct))
                        if action_info:
                            action_info["timestamp"] = datetime.now().strftime("%H:%M:%S")
                            SCAN["current_action"] = action_info
                            if not SCAN["recent_steps"] or SCAN["recent_steps"][-1]["text"] != action_info["text"]:
                                SCAN["recent_steps"].append(action_info)
                                if len(SCAN["recent_steps"]) > 8:
                                    SCAN["recent_steps"].pop(0)
            code = process.wait()
    except Exception as exc:
        code = -1
        with SCAN_LOCK:
            err_line = f"[ERREUR PROCESSUS] {exc}"
            SCAN["lines"].append(err_line)
            SCAN.setdefault("error_lines", deque(maxlen=1000)).append(err_line)
            SCAN["phase"] = "Interrompu"
            SCAN["current_action"] = {"text": f"Erreur : {exc}", "type": "error", "timestamp": datetime.now().strftime("%H:%M:%S")}
        try:
            with log.open("a", encoding="utf-8") as output:
                output.write(f"\n[CRASH / EXCEPTION] {exc}\n")
                output.flush()
        except Exception:
            pass
    with SCAN_LOCK:
        SCAN["exit_code"] = code
        SCAN["process"] = None
        SCAN["process_pid"] = None
        if code == 0:
            SCAN["phase"] = "Terminé avec succès"
            SCAN["current_action"] = {"text": "Scan terminé avec succès !", "type": "done", "timestamp": datetime.now().strftime("%H:%M:%S")}


class Handler(BaseHTTPRequestHandler):
    def require_auth(self):
        username = self.server.web_username
        password = self.server.web_password
        if not username and not password:
            return False
        header = self.headers.get("Authorization", "")
        try:
            scheme, encoded = header.split(" ", 1)
            supplied = base64.b64decode(encoded, validate=True).decode("utf-8")
            supplied_user, supplied_password = supplied.split(":", 1)
            valid = scheme.lower() == "basic" and hmac.compare_digest(supplied_user, username) and hmac.compare_digest(supplied_password, password)
        except (ValueError, UnicodeDecodeError, binascii.Error):
            valid = False
        if valid:
            return False
        self.send_response(401)
        self.send_header("WWW-Authenticate", 'Basic realm="Job Hunter"')
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", "0")
        self.end_headers()
        return True

    def send_json(self, value, status=200):
        body = json.dumps(value, ensure_ascii=False, default=str).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.require_auth():
            return
        parsed = urlparse(self.path)
        query = parse_qs(parsed.query)
        try:
            if parsed.path == "/api/profiles":
                PROFILES.mkdir(parents=True, exist_ok=True)
                return self.send_json([{"id": p.stem, "name": (yaml.safe_load(p.read_text(encoding="utf-8")) or {}).get("name", p.stem)} for p in sorted(PROFILES.glob("*.yaml"))])
            if parsed.path == "/api/state":
                return self.send_json(snapshot(query.get("profile", [""])[0]))
            if parsed.path == "/api/export-csv":
                identifier = query.get("profile", [""])[0]
                csv_bytes = generate_csv(identifier)
                self.send_response(200)
                self.send_header("Content-Type", "text/csv; charset=utf-8")
                self.send_header("Content-Disposition", f'attachment; filename="offres_{identifier}_{datetime.now():%Y%m%d}.csv"')
                self.send_header("Content-Length", str(len(csv_bytes)))
                self.end_headers()
                self.wfile.write(csv_bytes)
                return
            if parsed.path == "/api/scan":
                return self.send_json(scan_state_payload())
            if parsed.path == "/api/scan-log":
                identifier = query.get("profile", [""])[0]
                log_dir = database(identifier).parent / "logs"
                log_content = ""
                if log_dir.exists():
                    logs = sorted(log_dir.glob("scan_*.log"), reverse=True)
                    if logs:
                        log_content = logs[0].read_text(encoding="utf-8", errors="replace")
                return self.send_json({"log": log_content, "file": logs[0].name if logs else None})
            target = (DIST / parsed.path.lstrip("/")).resolve() if parsed.path != "/" else DIST / "index.html"
            if not target.is_relative_to(DIST.resolve()) or not target.is_file():
                target = DIST / "index.html"
            if not target.is_file():
                return self.send_json({"error": "Interface React non compilée. Lancez npm install puis npm run build dans web/."}, 503)
            body = target.read_bytes()
            self.send_response(200)
            mime = {".js": "text/javascript", ".css": "text/css", ".html": "text/html"}.get(target.suffix) or mimetypes.guess_type(target.name)[0] or "application/octet-stream"
            self.send_header("Content-Type", mime)
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        except (ValueError, sqlite3.Error) as exc:
            self.send_json({"error": str(exc)}, 400)

    def do_POST(self):
        if self.require_auth():
            return
        origin = self.headers.get("Origin")
        if origin and urlparse(origin).netloc != self.headers.get("Host"):
            return self.send_json({"error": "Origine de requête invalide"}, 403)
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if length > 2_000_000:
                raise ValueError("Requête trop volumineuse")
            data = json.loads(self.rfile.read(length) or b"{}")
            identifier = data.get("profile", "")
            profile_path(identifier)
            if self.path == "/api/review":
                review(identifier, int(data["offer_id"]), data["decision"])
                return self.send_json({"ok": True})
            if self.path == "/api/undo":
                return self.send_json({"message": undo(identifier)})
            if self.path == "/api/requeue":
                count = requeue_offers(identifier, data.get("offer_ids"), data.get("all_unsure", False))
                return self.send_json({"ok": True, "count": count, "message": f"{count} offre(s) remise(s) dans la file Tinder."})
            if self.path == "/api/delete-offer":
                success = delete_offer(identifier, int(data["offer_id"]))
                return self.send_json({"ok": success, "message": "Offre supprimée de la base."})
            if self.path == "/api/profile":
                current = read_profile(identifier)
                update = data.get("data") or {}
                for key in ("name", "student", "target", "location", "skills", "interests", "search", "sources", "integrations"):
                    if key in update:
                        current[key] = update[key]
                write_profile(identifier, current)
                return self.send_json({"ok": True})
            if self.path == "/api/sources-packs":
                update_packs = data.get("packs")
                if not isinstance(update_packs, dict):
                    raise ValueError("Format de packs invalide")
                sources_file = ROOT / "config" / "sources.yaml"
                current_sources = yaml.safe_load(sources_file.read_text(encoding="utf-8")) or {}
                current_sources["packs"] = update_packs
                sources_file.write_text(yaml.safe_dump(current_sources, allow_unicode=True, sort_keys=False, width=120), encoding="utf-8")
                return self.send_json({"ok": True, "message": "Packs de sources enregistrés avec succès.", "packs": update_packs})
            if self.path == "/api/reset-profile":
                mode = data.get("mode", "all")
                msg = reset_profile_data(identifier, mode=mode)
                return self.send_json({"ok": True, "message": msg})
            if self.path == "/api/scan":
                mode = data.get("mode", "Complet")
                if mode not in MODES:
                    raise ValueError("Mode inconnu")
                with SCAN_LOCK:
                    if SCAN["process"] is not None and (hasattr(SCAN["process"], "poll") and SCAN["process"].poll() is None):
                        raise ValueError("Un scan est déjà en cours")
                    p_name = identifier
                    try:
                        p_obj = read_profile(identifier)
                        if p_obj and p_obj.get("name"):
                            p_name = p_obj["name"]
                    except Exception:
                        pass
                    SCAN.update({
                        "profile": identifier,
                        "profile_name": p_name,
                        "mode": mode,
                        "started": datetime.now().isoformat(),
                        "started_perf": time.perf_counter(),
                        "exit_code": None,
                        "phase": "Initialisation",
                        "progress_percent": 0,
                        "lines": deque(maxlen=1000),
                        "retained_lines": deque(maxlen=1000),
                        "removed_lines": deque(maxlen=1000),
                        "error_lines": deque(maxlen=1000),
                        "current_action": {"text": f"Démarrage du scan ({mode})...", "type": "start", "timestamp": datetime.now().strftime("%H:%M:%S")},
                        "recent_steps": [],
                    })
                    # Reserve the slot before the worker creates its process.
                    SCAN["process"] = _StartingProcess()
                threading.Thread(target=scan_worker, args=(identifier, mode), daemon=True).start()
                return self.send_json({"ok": True})
            if self.path == "/api/command":
                command = data.get("command")
                allowed = {"review-sync", "google-check", "google-auth", "google-create-sheet", "google-setup-sheet", "actions"}
                if command not in allowed:
                    raise ValueError("Commande inconnue")
                result = subprocess.run([sys.executable, str(ROOT / "stage_hunter.py"), command, "--profile", str(profile_path(identifier))],
                    cwd=ROOT, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=120)
                return self.send_json({"ok": result.returncode == 0, "message": (result.stdout + "\n" + result.stderr).strip()})
            if self.path == "/api/schedule":
                action = data.get("action")
                if action not in {"install", "remove", "status"}:
                    raise ValueError("Action inconnue")
                args = [sys.executable, str(ROOT / "stage_hunter_scheduler.py"), action, "--profile", str(profile_path(identifier))]
                if action == "install":
                    at, frequency = data.get("at", "07:00"), data.get("frequency", "daily")
                    if not re.fullmatch(r"(?:[01]\d|2[0-3]):[0-5]\d", at) or frequency not in {"daily", "weekdays", "weekly"}:
                        raise ValueError("Planification invalide")
                    args += ["--at", at, "--frequency", frequency]
                result = subprocess.run(args, cwd=ROOT, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=30)
                return self.send_json({"ok": result.returncode == 0, "message": (result.stdout + "\n" + result.stderr).strip()})
            raise ValueError("Route inconnue")
        except (ValueError, KeyError, sqlite3.Error, subprocess.TimeoutExpired) as exc:
            self.send_json({"error": str(exc)}, 400)


class _StartingProcess:
    def poll(self):
        return None


def main():
    host, preferred, username, password = server_settings()
    try:
        server = ThreadingHTTPServer((host, preferred), Handler)
    except OSError:
        if host != "127.0.0.1" or preferred != 8501:
            raise
        server = ThreadingHTTPServer(("127.0.0.1", 8502), Handler)
    server.web_username = username
    server.web_password = password
    url = f"http://localhost:{server.server_port}"
    print(f"Stage Hunter React : {url}", flush=True)
    if is_loopback_host(host) and os.getenv("STAGE_HUNTER_NO_BROWSER") != "1":
        threading.Timer(0.7, lambda: webbrowser.open(url)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
