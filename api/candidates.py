"""Authenticated, paginated access to a profile's raw scan candidates."""

import json
import os
import urllib.error
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler


def get_json(url, headers):
    request = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(request, timeout=15) as response:
        return json.load(response)


class handler(BaseHTTPRequestHandler):
    def respond(self, status, payload):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "private, no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        base = (os.getenv("SUPABASE_URL") or "https://seacseklrbucmgxaykgc.supabase.co").rstrip("/")
        key = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
        authorization = self.headers.get("Authorization", "")
        if not base or not key:
            return self.respond(503, {"error": "Service de candidats non configuré (SUPABASE_SERVICE_ROLE_KEY manquant)"})
        if not authorization.startswith("Bearer "):
            return self.respond(401, {"error": "Authentification requise"})
        params = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
        profile_id = (params.get("profile_id") or [""])[0]
        job_id = (params.get("job_id") or [""])[0]
        status = (params.get("status") or [""])[0]
        allowed_statuses = {"", "pending", "deferred", "retry", "accepted", "known",
                            "filtered", "rejected", "unavailable", "unexamined"}
        if status not in allowed_statuses:
            return self.respond(400, {"error": "État invalide"})
        try:
            import uuid
            uuid.UUID(profile_id)
            uuid.UUID(job_id)
            offset = int((params.get("offset") or ["0"])[0])
            if offset < 0 or offset > 100000:
                raise ValueError()
        except (ValueError, TypeError):
            return self.respond(400, {"error": "Paramètres invalides"})
        try:
            user = get_json(f"{base}/auth/v1/user", {
                "apikey": key, "Authorization": authorization,
            })
            if not user.get("id"):
                return self.respond(401, {"error": "Session invalide"})
            service_headers = {"apikey": key, "Authorization": f"Bearer {key}"}
            owner_filter = urllib.parse.urlencode({
                "id": f"eq.{profile_id}", "user_id": f"eq.{user['id']}", "select": "id",
            })
            if not get_json(f"{base}/rest/v1/hunter_profiles?{owner_filter}", service_headers):
                return self.respond(404, {"error": "Profil introuvable"})
            job_filter = urllib.parse.urlencode({
                "id": f"eq.{job_id}", "profile_id": f"eq.{profile_id}",
                "user_id": f"eq.{user['id']}", "select": "id",
            })
            if not get_json(f"{base}/rest/v1/hunter_scan_jobs?{job_filter}", service_headers):
                return self.respond(404, {"error": "Scan introuvable"})
            filters = {"user_id": f"eq.{user['id']}", "select":
                       "id,job_id,status,canonical_url,payload,decision,created_at,updated_at",
                       "order": "id.desc", "limit": "51", "offset": str(offset),
                       "job_id": f"eq.{job_id}"}
            if status:
                filters["status"] = f"eq.{status}"
            rows = get_json(f"{base}/rest/v1/hunter_scan_candidates?{urllib.parse.urlencode(filters)}",
                            service_headers)
            return self.respond(200, {"rows": rows[:50], "has_more": len(rows) > 50})
        except urllib.error.HTTPError as error:
            if error.code in (401, 403):
                return self.respond(401, {"error": "Session invalide"})
            return self.respond(502, {"error": "Lecture des candidats indisponible"})
        except Exception:
            return self.respond(502, {"error": "Lecture des candidats indisponible"})
