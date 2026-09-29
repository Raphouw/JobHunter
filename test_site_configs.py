import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from api.sites import merge_site, signature, valid_preview_token
from site_configs import (crawl_site, extract_detail, inspection_html, missing_fields,
                          profile_listing_url, validate_site)
from site_network import _resolved_ip, public_http_url


def sample_site():
    return {'id': 'b363b84c-c8c0-4822-8433-b7d5892b7d7f', 'name': 'Exemple',
            'listing_url': 'https://example.org/jobs', 'enabled': False,
            'query': {'keyword_param': 'q', 'location_param': 'place'},
            'selectors': {'card': 'article.job', 'detail_link': 'a.title', 'title': 'a.title',
                          'company': '.company', 'location': '.place', 'contract': '.contract',
                          'date': '.date', 'description': '.summary', 'application_link': 'a.apply'},
            'detail_selectors': {'title': 'h1', 'company': '.company', 'location': '.place',
                                 'contract': '.contract', 'date': 'time',
                                 'description': '.description', 'application_link': 'a.apply'},
            'pagination': {'next_selector': 'a.next', 'start': 1, 'step': 1},
            'limits': {'max_pages': 2, 'max_offers': 3, 'max_detail_pages': 1}}


class SiteConfigTests(unittest.TestCase):
    def test_extraction_pagination_details_and_missing(self):
        site = validate_site(sample_site())
        profile = {'target': {'job_titles': ['Ingénieur capteurs']},
                   'location': {'countries': ['Suisse']}}
        listing = profile_listing_url(site, profile)
        self.assertIn('q=Ing%C3%A9nieur+capteurs', listing)
        templated = validate_site({**sample_site(), 'listing_url': 'https://example.org/jobs/{keywords}/{location}'})
        self.assertIn('/jobs/Ing%C3%A9nieur%20capteurs/Suisse', profile_listing_url(templated, profile))
        first = '''<article class="job"><a class="title" href="/jobs/1">Ingénieur capteurs</a>
          <span class="company">Acme</span></article><a class="next" href="/jobs?page=2">Suivant</a>'''
        second = '''<article class="job"><a class="title" href="/jobs/2">Roboticien</a>
          <span class="place">Genève</span></article>'''
        detail = '''<h1>Ingénieur capteurs senior</h1><p class="description">Développer des capteurs.</p>
          <a class="apply" href="/apply/1">Postuler</a>'''
        seen = []
        def fetch(url):
            seen.append(url)
            if '/jobs/1' in url: return detail, url
            if 'page=2' in url: return second, url
            return first, url
        report = crawl_site(site, profile, fetch, with_details=True)
        self.assertEqual(report['pages'], 2)
        self.assertEqual(len(report['offers']), 2)
        self.assertEqual(report['offers'][0]['application_link'], 'https://example.org/apply/1')
        self.assertEqual(report['offers'][0]['description'], 'Développer des capteurs.')
        self.assertIn('company', report['missing'][1])
        self.assertEqual(len(seen), 3)

    def test_validation_and_network_policy(self):
        site = sample_site()
        site['selectors']['card'] = 'div['
        with self.assertRaises(ValueError): validate_site(site)
        self.assertFalse(public_http_url('http://127.0.0.1/jobs'))
        self.assertFalse(public_http_url('http://localhost/jobs'))
        self.assertFalse(public_http_url('file:///tmp/jobs'))
        with patch('site_network.socket.getaddrinfo', return_value=[
                (None, None, None, None, ('93.184.215.14', 0)),
                (None, None, None, None, ('127.0.0.1', 0))]):
            with self.assertRaises(ValueError): _resolved_ip('https://example.org/jobs')

    def test_visual_snapshot_is_inert_and_retains_selectable_cards(self):
        raw = '''<html><head><script>alert(1)</script></head><body>
          <article class="job"><a class="title" href="/jobs/1" onclick="alert(2)">Stage</a>
          <img src="https://tracker.example/pixel" alt="Logo"></article>
          <form action="https://evil.example"><button>Send</button></form></body></html>'''
        result = inspection_html(raw, 'https://example.org/jobs')
        self.assertIn('class="job"', result)
        self.assertIn('href="https://example.org/jobs/1"', result)
        self.assertNotIn('<script', result)
        self.assertNotIn('onclick', result)
        self.assertNotIn('tracker.example', result)
        self.assertNotIn('<form', result)

    def test_recording_preserves_profile_and_replaces_same_site(self):
        site = validate_site(sample_site())
        config = {'target': {'job_titles': ['Engineer']},
                  'sources': {'packs': ['switzerland'], 'sites': [{**site, 'name': 'Ancien'}]}}
        saved = merge_site(config, site)
        self.assertEqual(saved['target'], config['target'])
        self.assertEqual(saved['sources']['packs'], ['switzerland'])
        self.assertEqual(saved['sources']['sites'], [site])
        with patch.dict(os.environ, {'SUPABASE_SERVICE_ROLE_KEY': 'test-only-secret'}):
            stamp = 1_800_000_000
            self.assertEqual(signature(site, 'profile', 'user', stamp),
                             signature({**site, 'enabled': True}, 'profile', 'user', stamp))
            self.assertNotEqual(signature(site, 'profile', 'user', stamp),
                                signature({**site, 'name': 'Altéré'}, 'profile', 'user', stamp))
            with patch('api.sites.time.time', return_value=stamp):
                token = f"{stamp}.{signature(site, 'profile', 'user', stamp)}"
                self.assertTrue(valid_preview_token(token, site, 'profile', 'user'))
                self.assertFalse(valid_preview_token(token, {**site, 'name': 'Changed'}, 'profile', 'user'))

    def test_scanner_uses_configured_detail_and_keeps_generic_storage(self):
        import stage_hunter as hunter
        site = validate_site({**sample_site(), 'enabled': True})
        profile = {'target': {'job_titles': ['Engineer']}, 'location': {'countries': ['Suisse']}}
        listing = '<article class="job"><a class="title" href="/jobs/1">Engineer</a></article>'
        with patch.object(hunter, 'fetch_preview', return_value=(listing, 'https://example.org/jobs')):
            rows = hunter.configured_site_candidates(profile, site)
        self.assertEqual(len(rows), 1)
        detail = '<h1>Engineer</h1><span class="contract">Internship</span><time>2026-09-29</time><a class="apply" href="/apply/1">Apply</a>'
        structured = hunter.configured_detail_data(rows[0], detail, rows[0]['url'], {})
        self.assertEqual(structured['application_url'], 'https://example.org/apply/1')
        self.assertEqual(structured['employment_type'], 'Internship')
        self.assertEqual(structured['date_posted'], '2026-09-29')
        with tempfile.TemporaryDirectory() as directory, patch.object(hunter, 'DB', Path(directory) / 'offers.sqlite3'):
            connection = hunter.init_db()
            columns = {item[1] for item in connection.execute('PRAGMA table_info(offers)')}
            self.assertTrue({'application_url', 'contract_type', 'posting_date'} <= columns)
            connection.close()


if __name__ == '__main__': unittest.main()
