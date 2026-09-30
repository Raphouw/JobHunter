"""Vercel transport: one bounded operation, never a scan loop."""
import json
import os
import sys
import time
import urllib.request
from http.server import BaseHTTPRequestHandler
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from cloud.browser_bridge import BridgeError, MAX_BODY, execute
from cloud.scan_worker import Store


class handler(BaseHTTPRequestHandler):
    def respond(self, status, payload):
        data = json.dumps(payload, ensure_ascii=False).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Cache-Control', 'private, no-store')
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_POST(self):
        started = time.process_time()
        if os.getenv('BROWSER_SCAN_ENABLED', '0') != '1':
            return self.respond(503, {'error': 'Scan navigateur non activé'})
        if not os.getenv('SUPABASE_URL') or not os.getenv('SUPABASE_SERVICE_ROLE_KEY'):
            return self.respond(503, {'error': 'Persistance non configurée'})
        authorization = self.headers.get('Authorization', '')
        if not authorization.startswith('Bearer '):
            return self.respond(401, {'error': 'Authentification requise'})
        length = self.headers.get('Content-Length', '')
        if not length.isdigit() or not 0 < int(length) <= MAX_BODY:
            return self.respond(413, {'error': 'Requête trop volumineuse'})
        key = os.environ['SUPABASE_SERVICE_ROLE_KEY']
        request = urllib.request.Request(os.environ['SUPABASE_URL'].rstrip('/') + '/auth/v1/user',
            headers={'apikey': key, 'Authorization': authorization})
        try:
            with urllib.request.urlopen(request, timeout=10) as response:
                user_id = json.load(response)['id']
        except Exception:
            return self.respond(401, {'error': 'Session invalide'})
        try:
            body = json.loads(self.rfile.read(int(length)))
            if not isinstance(body, dict):
                raise ValueError('Objet requis')
            result = execute(Store(), user_id, body)
            self.respond(200, {'data': result, 'metrics': {'server_cpu_ms': round((time.process_time() - started) * 1000, 2)}})
        except BridgeError as error:
            self.respond(error.status, {'error': str(error)})
        except (ValueError, TypeError, KeyError):
            self.respond(400, {'error': 'Paramètres invalides'})
        except Exception as error:
            print('Browser scan transport failed:', type(error).__name__)
            self.respond(502, {'error': 'Opération temporairement indisponible'})
