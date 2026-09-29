"""Authenticated preview and profile-backed listing configuration endpoint."""
import hashlib
import hmac
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request
import uuid
from http.server import BaseHTTPRequestHandler
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from cloud.scan_worker import Store
from site_configs import crawl_site, inspection_html, profile_listing_url, validate_site
from site_network import fetch_preview


def signature(site, profile_id, user_id, timestamp):
    payload = {**site, 'enabled': False}
    message = json.dumps([payload, profile_id, user_id, timestamp], sort_keys=True, ensure_ascii=False)
    return hmac.new(os.environ['SUPABASE_SERVICE_ROLE_KEY'].encode(), message.encode(), hashlib.sha256).hexdigest()


def merge_site(current_config, site):
    """Preserve all profile fields and unrelated source settings when saving."""
    sources = current_config.get('sources') or {}
    existing = sources.get('sites') or []
    if not isinstance(existing, list) or len(existing) > 30:
        raise ValueError('Liste de sites invalide')
    others = [row for row in existing if isinstance(row, dict) and row.get('id') != site['id']]
    if len(others) >= 30:
        raise ValueError('Maximum de 30 sites par profil')
    return {**current_config, 'sources': {**sources, 'sites': [*others, site]}}


def valid_preview_token(token, site, profile_id, user_id):
    match = re.fullmatch(r'(\d{10})\.([a-f0-9]{64})', str(token or ''))
    return bool(match and abs(time.time() - int(match[1])) <= 1800 and
                hmac.compare_digest(match[2], signature(site, profile_id, user_id, int(match[1]))))


class handler(BaseHTTPRequestHandler):
    def respond(self, status, payload):
        data = json.dumps(payload, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_POST(self):
        if not os.getenv('SUPABASE_SERVICE_ROLE_KEY') or not os.getenv('SUPABASE_URL'):
            return self.respond(503, {'error': 'Service indisponible'})
        authorization = self.headers.get('Authorization', '')
        if not authorization.startswith('Bearer '):
            return self.respond(401, {'error': 'Authentification requise'})
        length = self.headers.get('Content-Length', '')
        if not length.isdigit() or int(length) > 30_000:
            return self.respond(400, {'error': 'Requête trop volumineuse'})
        try:
            body = json.loads(self.rfile.read(int(length)))
            action = body.get('action')
            profile_id = str(uuid.UUID(str(body.get('profile_id'))))
            if action not in ('inspect', 'preview', 'save', 'catalog', 'publish', 'unpublish'):
                raise ValueError('Action invalide')
            publishable = os.getenv('SUPABASE_PUBLISHABLE_KEY') or os.getenv('SUPABASE_ANON_KEY') or 'sb_publishable_wQCX6LA7JVPRaL5cE-Lfsw_oUxISayf'
            request = urllib.request.Request(os.environ['SUPABASE_URL'].rstrip('/') + '/auth/v1/user',
                                             headers={'apikey': publishable, 'Authorization': authorization})
            try:
                with urllib.request.urlopen(request, timeout=10) as response:
                    user_id = json.load(response)['id']
            except (OSError, KeyError, ValueError):
                return self.respond(401, {'error': 'Session invalide'})
            store = Store()
            rows = store.rows('hunter_profiles', f'id=eq.{profile_id}&user_id=eq.{user_id}&select=id,config')
            if not rows:
                return self.respond(404, {'error': 'Profil introuvable'})
            current_config = rows[0]['config'] or {}
            admin = bool(store.rows('hunter_site_recipe_admins',
                                    f'user_id=eq.{user_id}&select=user_id&limit=1'))
            if action == 'catalog':
                query = ('select=id,name,listing_url,config,status&order=updated_at.desc&limit=100'
                         if admin else 'status=eq.published&select=id,name,listing_url,config,status&order=updated_at.desc&limit=100')
                return self.respond(200, {'is_admin': admin,
                                          'recipes': store.rows('hunter_site_recipes', query)})
            if action == 'inspect':
                from site_network import public_http_url
                url = (profile_listing_url(body['site'], current_config)
                       if isinstance(body.get('site'), dict) else str(body.get('url') or ''))
                if not public_http_url(url):
                    raise ValueError('Adresse publique HTTP(S) requise')
                html, final_url = fetch_preview(url)
                return self.respond(200, {'url': final_url,
                                          'html': inspection_html(html, final_url)})
            if action == 'unpublish':
                if not admin:
                    return self.respond(403, {'error': 'Publication réservée à l’administrateur'})
                listing_url = urllib.parse.quote(str(body.get('listing_url') or ''), safe='')
                store.patch('hunter_site_recipes', f'listing_url=eq.{listing_url}',
                            {'status': 'disabled', 'updated_at': __import__('datetime').datetime.now(
                                __import__('datetime').timezone.utc).isoformat()})
                return self.respond(200, {'disabled': True})
            site = validate_site(body.get('site'))
            site['id'] = str(uuid.UUID(site['id'])) if site['id'] else str(uuid.uuid4())
            if action == 'preview':
                preview_site = {**site, 'limits': {**site['limits'],
                                                 'max_pages': 1,
                                                 'max_offers': min(20, site['limits']['max_offers']),
                                                 'max_detail_pages': min(3, site['limits']['max_detail_pages'])}}
                result = crawl_site(preview_site, current_config, fetch_preview, with_details=True)
                if not result['offers']:
                    return self.respond(422, {'error': 'Aucune offre avec lien de détail trouvée', 'preview': result})
                stamp = int(time.time())
                return self.respond(200, {'preview': result, 'site': site,
                                          'preview_token': f'{stamp}.{signature(site, profile_id, user_id, stamp)}'})
            if action == 'publish':
                if not admin:
                    return self.respond(403, {'error': 'Publication réservée à l’administrateur'})
                site['enabled'] = True
            if site['enabled']:
                if not valid_preview_token(body.get('preview_token'), site, profile_id, user_id):
                    raise ValueError('Tester cette configuration avant activation')
            if action == 'publish':
                store.request('hunter_site_recipes?on_conflict=listing_url', 'POST',
                              {'name': site['name'], 'listing_url': site['listing_url'],
                               'config': site, 'status': 'published', 'created_by': user_id,
                               'updated_at': __import__('datetime').datetime.now(
                                   __import__('datetime').timezone.utc).isoformat()},
                              'resolution=merge-duplicates,return=minimal')
                return self.respond(200, {'site': site, 'published': True})
            new_config = merge_site(current_config, site)
            store.patch('hunter_profiles', f'id=eq.{profile_id}&user_id=eq.{user_id}', {'config': new_config})
            return self.respond(200, {'site': site})
        except ValueError as exc:
            return self.respond(400, {'error': str(exc)})
        except Exception as exc:
            print(f'Site configuration error: {type(exc).__name__}: {str(exc)[:180]}')
            return self.respond(502, {'error': 'Configuration ou test indisponible'})
