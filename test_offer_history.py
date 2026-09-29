"""Offline checks for the durable URL cache used before page download."""

import unittest
from cloud.offer_history import examined_history_rows, known_identities, save_examined


class Engine:
    @staticmethod
    def safe_public_url(url): return url.startswith('https://')
    @staticmethod
    def candidate_identity(url): return url.split('?')[0]
    @staticmethod
    def canon(url): return url.split('?')[0]


class Store:
    def __init__(self, rows=None):
        self.existing = rows or []
        self.queries = []
        self.writes = []

    def rows(self, table, query):
        self.queries.append((table, query))
        return self.existing

    def request(self, path, method, body, prefer):
        self.writes.append((path, method, body, prefer))


JOB = {'user_id': 'user', 'profile_id': 'profile'}


class OfferHistoryTests(unittest.TestCase):
    def test_only_previously_fetched_terminal_pages_are_known(self):
        store = Store([
            {'identity': 'https://jobs.example/1', 'status': 'rejected', 'fetched_at': '2026-09-29'},
            {'identity': 'https://jobs.example/2', 'status': 'accepted', 'fetched_at': None},
            {'identity': 'https://jobs.example/3', 'status': 'retry', 'fetched_at': '2026-09-29'},
        ])
        known = known_identities(store, JOB, ['https://jobs.example/1',
                                               'https://jobs.example/2', 'https://jobs.example/3'])
        self.assertEqual(list(known), ['https://jobs.example/1'])
        self.assertIn('identity=in.(', store.queries[0][1])

    def test_only_examined_offer_pages_are_cached(self):
        audits = [
            {'original_url': 'https://jobs.example/1?utm=x', 'decision': 'rejected_low_score',
             'fetch': {'status': 'ok'}, 'title': 'Stage robotique'},
            {'original_url': 'https://jobs.example/list', 'decision': 'listing',
             'fetch': {'status': 'ok'}},
            {'original_url': 'https://jobs.example/2', 'decision': 'retry',
             'fetch': {'status': 'timeout'}},
            {'original_url': 'https://jobs.example/3', 'decision': 'time_deferred',
             'fetch': {'status': 'ok'}},
            {'original_url': 'https://jobs.example/4', 'decision': 'filtered',
             'fetch': {'status': 'ok'}},
        ]
        rows = examined_history_rows(JOB, audits, Engine)
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]['status'], 'rejected')
        self.assertEqual(rows[0]['identity'], 'https://jobs.example/1')
        store = Store()
        self.assertEqual(save_examined(store, JOB, audits, Engine), 1)
        self.assertEqual(store.writes[0][2], rows)


if __name__ == '__main__': unittest.main()
