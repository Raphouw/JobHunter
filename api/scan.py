"""Authenticated Vercel entrypoint for one resumable Python scan slice."""

import json
import os
import sys
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


class handler(BaseHTTPRequestHandler):
    def respond(self, status, payload):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        # Configuration is intentionally coarse: no keys or project metadata.
        ready = bool(os.getenv("SUPABASE_SERVICE_ROLE_KEY") and os.getenv("CRON_SECRET")
                     and os.getenv("SUPABASE_URL") and os.getenv("SCAN_DISPATCHER_ENABLED", "1") == "1")
        self.respond(200, {"ready": ready})

    def do_POST(self):
        if not (os.getenv("SUPABASE_SERVICE_ROLE_KEY") and os.getenv("SUPABASE_URL")):
            self.respond(503, {"error": "Worker Python non configuré"})
            return
        authorization = self.headers.get("Authorization", "")
        cron_secret = os.getenv("CRON_SECRET", "")
        is_cron = bool(cron_secret and authorization == f"Bearer {cron_secret}")
        raw_len = (self.headers.get("Content-Length") or "").strip()
        read_len = min(int(raw_len), 2048) if raw_len.isdigit() else 2048
        body = json.loads(self.rfile.read(read_len) or b"{}")
        job_id = body.get("job_id")
        if job_id and not __import__("re").fullmatch(r"[0-9a-fA-F-]{36}", str(job_id)):
            self.respond(400, {"error": "Identifiant de scan invalide"})
            return
        if not is_cron:
            if not authorization.startswith("Bearer ") or not job_id:
                self.respond(401, {"error": "Authentification requise"})
                return
            url = os.getenv("SUPABASE_URL").rstrip("/")
            publishable = os.getenv("SUPABASE_PUBLISHABLE_KEY", "sb_publishable_wQCX6LA7JVPRaL5cE-Lfsw_oUxISayf")
            user_request = urllib.request.Request(f"{url}/auth/v1/user", headers={
                "apikey": publishable, "Authorization": authorization})
            try:
                with urllib.request.urlopen(user_request, timeout=10) as response:
                    user = json.load(response)
            except Exception:
                self.respond(401, {"error": "Session invalide"})
                return
            from cloud.scan_worker import Store
            store = Store()
            jobs = store.rows("hunter_scan_jobs", f"id=eq.{urllib.parse.quote(job_id)}&user_id=eq.{user['id']}&select=id")
            if not jobs:
                self.respond(404, {"error": "Scan introuvable"})
                return
        try:
            from cloud.scan_worker import run_slice
            result = run_slice(job_id)
            self.respond(200, result)
        except Exception as error:
            import traceback
            traceback.print_exc()
            print(f"Scan slice failed: {type(error).__name__}: {str(error)[:220]}")
            self.respond(502, {"error": f"Étape du scan interrompue: {type(error).__name__}: {str(error)}"})
