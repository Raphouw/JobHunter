"""Focused state-machine checks for concurrent discovery and immediate analysis."""

import threading
import unittest
from unittest.mock import patch

from cloud import scan_worker as worker
import stage_hunter


class Engine:
    SCAN_METRICS = {}
    barrier = threading.Barrier(2)

    @staticmethod
    def targeted_fixed_urls(profile): return ['https://jobs.example/one', 'https://jobs.example/two']
    @staticmethod
    def build_search_queries(profile, emit_log=False): return ['intern robot', 'stage robot']
    @classmethod
    def fixed_site_candidates(cls, profile):
        cls.barrier.wait(timeout=3)
        cls.SCAN_METRICS['fixed_sites_visited'] = 2
        return [{'url': 'https://jobs.example/offer/1'}]
    @classmethod
    def search_web(cls, queries, limit):
        cls.barrier.wait(timeout=3)
        cls.SCAN_METRICS['web'] = {'executed': len(queries), 'backends': {}}
        return [{'url': 'https://other.example/offer/2'}]
    @staticmethod
    def safe_int(value, default=0): return int(value or default)


class Store:
    def __init__(self): self.events = []; self.phase_counts = {}; self.released = None
    def event(self, job, message): self.events.append(message)
    def rows(self, table, query): return []


class DiscoveryPipelineTests(unittest.TestCase):
    def test_independent_search_apis_normalize_results(self):
        class Response:
            def raise_for_status(self): pass
            def json(self): return {'web': {'results': [{'url': 'https://jobs.example/1',
                                                         'title': 'Intern', 'description': 'Robotics'}]},
                                    'results': [{'url': 'https://jobs.example/2',
                                                 'title': 'Trainee', 'content': 'Sensors'}]}
        with patch.dict('os.environ', {'BRAVE_SEARCH_API_KEY': 'test',
                                      'SEARXNG_BASE_URL': 'https://search.example'}), \
             patch.object(stage_hunter.requests, 'get', return_value=Response()) as get:
            brave, brave_trace = stage_hunter.search_backend_once('robotics', 'brave_api', 5, 'fr-fr', 3)
            searx, searx_trace = stage_hunter.search_backend_once('robotics', 'searxng', 5, 'fr-fr', 3)
        self.assertEqual(brave[0]['href'], 'https://jobs.example/1')
        self.assertEqual(searx[0]['href'], 'https://jobs.example/2')
        self.assertEqual((brave_trace['status'], searx_trace['status']), ('results', 'results'))
        self.assertEqual(get.call_count, 2)

    def test_site_and_web_pools_run_together_before_analysis(self):
        Engine.barrier = threading.Barrier(2)
        Engine.SCAN_METRICS = {}
        job = {'id': 'job', 'user_id': 'user', 'profile_id': 'profile',
               'mode': 'Rapide', 'batch_size': 2, 'checkpoint': {}, 'progress_percent': 0}
        store = Store()
        def release(_, __, phase, checkpoint, progress):
            store.released = (phase, checkpoint, progress)
        with patch.object(worker, 'stop_at_scan_limit', return_value=False), \
             patch.object(worker, 'candidate_rows', side_effect=lambda s, j, rows, profile=None: len(rows)), \
             patch.object(worker, 'still_owned', return_value=True), \
             patch.object(worker, 'release', side_effect=release):
            worker.discover(store, job, Engine, {})
        self.assertEqual(store.released[0], 'analyze')
        self.assertTrue(store.released[1]['discovery_complete'])
        self.assertEqual(store.phase_counts['sites'], 2)
        self.assertEqual(store.phase_counts['queries'], 2)

    def test_empty_analysis_returns_to_discovery(self):
        job = {'id': 'job', 'user_id': 'user', 'profile_id': 'profile',
               'mode': 'Rapide', 'checkpoint': {'discovery_complete': False},
               'progress_percent': 12}
        store = Store()
        with patch.object(worker, 'scan_limit_reached', return_value=None), \
             patch.object(worker, 'apply_decisions'), \
             patch.object(worker, 'release', side_effect=lambda s, j, phase, c, p:
                          setattr(store, 'released', phase)):
            worker.analyze(store, job, None, None)
        self.assertEqual(store.released, 'discover')

    def test_final_score_removes_low_pending_but_preserves_reviewed_offer(self):
        class FinalStore:
            def __init__(self): self.patches = []; self.deletes = []
            def rows(self, table, query):
                if 'id=gt.0' not in query: return []
                return [
                    {'id': 1, 'url': 'https://jobs.example/1', 'canonical_url': 'https://jobs.example/1',
                     'title': 'Low', 'company': 'Acme', 'location': 'Geneva', 'body': 'short',
                     'review_decision': 'pending'},
                    {'id': 2, 'url': 'https://jobs.example/2', 'canonical_url': 'https://jobs.example/2',
                     'title': 'Reviewed', 'company': 'Acme', 'location': 'Geneva', 'body': 'short',
                     'review_decision': 'keep'},
                ]
            def patch(self, table, query, body): self.patches.append((table, query, body))
            def request(self, path, method, body, prefer): self.deletes.append((path, method))
        class Scorer:
            @staticmethod
            def safe_float(value, default): return float(value or default)
            @staticmethod
            def detect_meta(title, text, profile, location): return location
            @staticmethod
            def score(title, text, meta, kind, profile, url, company):
                return 15, 50, ['Score final']
        store = FinalStore()
        finalized, rejected = worker.finalize_scored_offers(store,
            {'id': 'job', 'profile_id': 'profile', 'user_id': 'user', 'created_at': '2026-09-29'},
            Scorer, {'search': {}})
        self.assertEqual((finalized, rejected), (1, 1))
        self.assertEqual(len(store.deletes), 1)
        self.assertTrue(any(table == 'hunter_offer_history' for table, _, _ in store.patches))

    def test_final_score_includes_enriched_older_offer(self):
        class FinalStore:
            def __init__(self): self.patches = []
            def rows(self, table, query):
                if 'id=in.(42)' not in query: return []
                return [{'id': 42, 'url': 'https://jobs.example/42',
                         'canonical_url': 'https://jobs.example/42', 'title': 'Robotics',
                         'company': 'Acme', 'location': 'Geneva', 'body': 'A merged description',
                         'review_decision': 'keep'}]
            def patch(self, table, query, body): self.patches.append((table, body))
        class Scorer:
            @staticmethod
            def safe_float(value, default): return default
            @staticmethod
            def detect_meta(title, body, profile, location): return location
            @staticmethod
            def score(title, body, meta, kind, profile, url, company):
                return 72, 80, ['Merged facts']
        store = FinalStore()
        result = worker.finalize_scored_offers(store,
            {'id': 'job', 'profile_id': 'profile', 'user_id': 'user',
             'created_at': '2026-09-29', 'checkpoint': {'enriched_offer_ids': [42]}},
            Scorer, {'search': {}})
        self.assertEqual(result, (1, 0))
        self.assertEqual(store.patches[0][1]['score'], 72)


if __name__ == '__main__': unittest.main()
