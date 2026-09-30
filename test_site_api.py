"""Authenticated shared-recipe API checks without external requests."""

import io
import json
import os
import time
import unittest
from unittest.mock import patch

from api.sites import handler, signature
from site_configs import validate_site
from test_site_configs import sample_site


PROFILE = '4fb77d84-373e-45a7-a205-0937d55981ac'
USER = 'd64d69c3-79b0-4eac-b9f9-d41d05906e1c'


class AuthResponse:
    def __enter__(self): return self
    def __exit__(self, *args): pass
    def read(self, *args): return json.dumps({'id': USER}).encode()


class FakeStore:
    admin = False
    writes = []

    def rows(self, table, query):
        if table == 'hunter_profiles': return [{'config': {}}]
        if table == 'hunter_site_recipe_admins': return [{'user_id': USER}] if self.admin else []
        if table == 'hunter_site_recipes': return [{'id': 'recipe', 'name': 'Example',
                                                    'status': 'published', 'config': sample_site()}]
        return []

    def request(self, path, method, body, prefer): self.writes.append((path, method, body))
    def patch(self, table, query, body): self.writes.append((table, 'PATCH', body))


def post(body, admin=False):
    encoded = json.dumps({'profile_id': PROFILE, **body}).encode()
    request = handler.__new__(handler)
    request.headers = {'Authorization': 'Bearer test', 'Content-Length': str(len(encoded))}
    request.rfile = io.BytesIO(encoded)
    request.wfile = io.BytesIO()
    request.send_response = lambda status: setattr(request, 'status', status)
    request.send_header = lambda *args: None
    request.end_headers = lambda: None
    FakeStore.admin = admin
    with patch.dict(os.environ, {'SUPABASE_SERVICE_ROLE_KEY': 'test-key',
                                  'SUPABASE_URL': 'https://db.example.org'}), \
         patch('api.sites.Store', FakeStore), \
         patch('api.sites.urllib.request.urlopen', return_value=AuthResponse()):
        request.do_POST()
    return request.status, json.loads(request.wfile.getvalue())


class SharedSiteApiTests(unittest.TestCase):
    def setUp(self): FakeStore.writes = []

    def test_personal_toggle_writes_only_owned_profile(self):
        status, payload = post({'action': 'toggle', 'listing_url': 'https://example.org/jobs', 'enabled': False})
        self.assertEqual(status, 200)
        self.assertFalse(payload['enabled'])
        self.assertEqual(FakeStore.writes[0][0], 'hunter_profiles')
        self.assertEqual(FakeStore.writes[0][2]['config']['sources']['disabled_sites'], ['https://example.org/jobs'])
        status, _ = post({'action': 'toggle', 'listing_url': 'http://localhost', 'enabled': False})
        self.assertEqual(status, 400)

    def test_catalog_is_readable_to_non_admin_but_publish_is_denied(self):
        status, payload = post({'action': 'catalog'})
        self.assertEqual(status, 200)
        self.assertFalse(payload['is_admin'])
        self.assertEqual(len(payload['recipes']), 1)
        status, _ = post({'action': 'publish', 'site': sample_site()})
        self.assertEqual(status, 403)
        self.assertEqual(FakeStore.writes, [])

    def test_admin_publication_requires_matching_preview_token(self):
        site = validate_site(sample_site())
        status, _ = post({'action': 'publish', 'site': site}, admin=True)
        self.assertEqual(status, 400)
        stamp = int(time.time())
        with patch.dict(os.environ, {'SUPABASE_SERVICE_ROLE_KEY': 'test-key'}):
            token = f'{stamp}.{signature(site, PROFILE, USER, stamp)}'
        status, payload = post({'action': 'publish', 'site': site,
                                'preview_token': token}, admin=True)
        self.assertEqual(status, 200)
        self.assertTrue(payload['published'])
        self.assertEqual(FakeStore.writes[0][2]['status'], 'published')

    def test_inspection_returns_inert_snapshot(self):
        with patch('api.sites.fetch_preview', return_value=(
                '<article class="job"><a href="/1" onclick="alert(1)">Stage</a></article>',
                'https://example.org/jobs')):
            status, payload = post({'action': 'inspect', 'url': 'https://example.org/jobs'})
        self.assertEqual(status, 200)
        self.assertIn('class="job"', payload['html'])
        self.assertNotIn('onclick', payload['html'])


if __name__ == '__main__': unittest.main()
