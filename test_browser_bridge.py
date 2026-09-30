"""Ownership/fencing regressions. No network or real credentials."""
import unittest
import hashlib
from datetime import datetime, timedelta, timezone
from unittest.mock import patch
from urllib.parse import parse_qs, urlsplit
from cloud.browser_bridge import execute, scoped_path, scoped_body, active_lease, BridgeError

JOB = {'id': '11111111-1111-4111-8111-111111111111',
       'profile_id': '22222222-2222-4222-8222-222222222222',
       'user_id': '33333333-3333-4333-8333-333333333333',
       'checkpoint': {'executor': 'browser'}, 'status': 'running',
       'lease_token': 'lease', 'lease_until': (datetime.now(timezone.utc) + timedelta(minutes=2)).isoformat()}


class FakeStore:
    def __init__(self, jobs=None): self.jobs = [dict(JOB)] if jobs is None else jobs; self.calls = []
    def rows(self, table, query): self.calls.append((table, query)); return self.jobs
    def request(self, *args): self.calls.append(args); return []
    def rpc(self, name, args): self.calls.append((name, args)); return True
    def patch(self, *args): self.calls.append(args)


class BridgeTests(unittest.TestCase):
    def test_owner_filters_cannot_be_overridden(self):
        for table, field, value in [('hunter_offers', 'profile_id', JOB['profile_id']),
                                    ('hunter_scan_candidates', 'job_id', JOB['id']),
                                    ('hunter_offer_history', 'profile_id', JOB['profile_id'])]:
            _, path = scoped_path(table + '?user_id=eq.other&' + field + '=eq.other&or=(id.eq.1,id.eq.2)&limit=99999', 'GET', JOB)
            query = parse_qs(urlsplit(path).query)
            self.assertEqual(query['user_id'], ['eq.' + JOB['user_id']])
            self.assertEqual(query[field], ['eq.' + value])
            self.assertEqual(query['limit'], ['1000'])

    def test_no_embedded_joins_or_arbitrary_rpc(self):
        for path in ('rpc/evil', 'auth/users', 'hunter_offers?select=*,hunter_profiles(*)'):
            with self.assertRaises(BridgeError): scoped_path(path, 'GET', JOB)
        with self.assertRaises(BridgeError): execute(FakeStore(), JOB['user_id'], {'action': 'rpc', 'job_id': JOB['id'], 'name': 'evil'})

    def test_upsert_cannot_move_another_users_row(self):
        with self.assertRaises(BridgeError): scoped_path('hunter_offers?on_conflict=id', 'POST', JOB)
        for field in ('id', 'offer_id', 'lease_token'):
            with self.assertRaises(BridgeError): scoped_body('hunter_offers', {field: 'other'}, JOB)
        row = scoped_body('hunter_offers', {'user_id': 'other', 'profile_id': 'other', 'url': 'https://example.org/job'}, JOB)
        self.assertEqual(row['user_id'], JOB['user_id'])
        self.assertEqual(row['profile_id'], JOB['profile_id'])

    def test_lease_expiration_cancel_and_wrong_token_block_writes(self):
        active_lease(JOB, 'lease')
        for job, token in [(JOB, 'other'), ({**JOB, 'cancel_requested': True}, 'lease'),
                            ({**JOB, 'status': 'queued'}, 'lease'),
                            ({**JOB, 'lease_until': '2000-01-01T00:00:00Z'}, 'lease')]:
            with self.assertRaises(BridgeError): active_lease(job, token)

    def test_foreign_job_and_nonbrowser_job_are_hidden(self):
        for jobs in ([], [{**JOB, 'checkpoint': {}}]):
            with self.assertRaises(BridgeError) as failure:
                execute(FakeStore(jobs), JOB['user_id'], {'action': 'state', 'job_id': JOB['id']})
            self.assertEqual(failure.exception.status, 404)

    def test_pause_invalidates_lease_and_suspends_dispatch(self):
        store = FakeStore()
        result = execute(store, JOB['user_id'], {'action': 'pause', 'job_id': JOB['id']})
        self.assertIsNone(result['lease_token'])
        self.assertTrue(result['checkpoint']['paused'])
        self.assertEqual(result['next_run_at'], '2099-01-01T00:00:00Z')

    def test_scoped_claim_and_decisions_ignore_caller_job_id(self):
        store = FakeStore()
        execute(store, JOB['user_id'], {'action': 'rpc', 'job_id': JOB['id'], 'name': 'hunter_apply_scan_decisions',
                'args': {'p_job_id': 'other', 'p_lease_token': 'lease', 'p_rows': []}})
        self.assertEqual(store.calls[-1][1]['p_job_id'], JOB['id'])

    def test_proxy_invokes_checked_network_path(self):
        with patch('site_network.fetch_preview', return_value=('<p>OK</p>', 'https://example.org/job')) as fetch:
            result = execute(FakeStore(), JOB['user_id'], {'action': 'fetch', 'job_id': JOB['id'],
                             'lease_token': 'lease', 'url': 'https://example.org/job'})
        fetch.assert_called_once()
        self.assertEqual(result['meta']['status'], 'ok')

    def test_write_batches_and_job_fields_are_bounded(self):
        with self.assertRaises(BridgeError): scoped_body('hunter_offers', [{}] * 101, JOB)
        with self.assertRaises(BridgeError): scoped_body('hunter_scan_jobs', {'status': 'completed'}, JOB)

    def test_mirror_never_transfers_full_descriptions(self):
        body = 'x' * 60000
        class MirrorStore(FakeStore):
            def rows(self, table, query):
                if table == 'hunter_scan_jobs': return [JOB]
                self.calls.append((table, query))
                return [{'id': 1, 'body': body, 'snippet': 'excerpt', 'title': 'Example'}]
        store = MirrorStore()
        rows = execute(store, JOB['user_id'], {'action': 'mirror', 'job_id': JOB['id'], 'offset': 0})
        self.assertEqual(len(rows[0]['body']), 250)
        self.assertEqual(rows[0]['_text_hashes']['body'], hashlib.sha256(body.encode()).hexdigest())
        self.assertIn('limit=25', store.calls[-1][1])
        self.assertIn('user_id=eq.' + JOB['user_id'], store.calls[-1][1])

    def test_delete_only_targets_owned_offers_and_requires_an_id(self):
        for table in ('hunter_scan_jobs', 'hunter_profiles', 'hunter_scan_candidates'):
            with self.assertRaises(BridgeError): scoped_path(table + '?id=eq.1', 'DELETE', JOB)
        with self.assertRaises(BridgeError): scoped_path('hunter_offers', 'DELETE', JOB)
        _, path = scoped_path('hunter_offers?id=eq.1&user_id=eq.other', 'DELETE', JOB)
        self.assertIn('eq.' + JOB['user_id'], urllib_parse(path)['user_id'])


def urllib_parse(path):
    return parse_qs(urlsplit(path).query)


class FinalizationTests(unittest.TestCase):
    def test_final_scoring_resumes_in_bounded_pages(self):
        from cloud.scan_worker import finalize_scored_offers
        class Engine:
            safe_float = staticmethod(lambda value, default=0: float(value if value is not None else default))
            detect_meta = staticmethod(lambda *args: ())
            score = staticmethod(lambda *args: (10, 20, ['reason']))
        class Store:
            finalize_batch_limit = 2
            body_page_size = 2
            def __init__(self):
                self.offers = [{'id': i, 'url': f'https://example.org/{i}', 'canonical_url': f'https://example.org/{i}', 'body': 'body', 'review_decision': 'pending'} for i in range(1, 4)]
                self.updated = []
                self.deleted = []
            def rows(self, table, query):
                params = parse_qs(query)
                cursor = int(params['id'][0].split('.')[1])
                return [row for row in self.offers if row['id'] > cursor][:int(params['limit'][0])]
            def patch(self, table, query, body):
                if table == 'hunter_offers': self.updated.append(int(parse_qs(query)['id'][0].split('.')[1]))
            def request(self, path, method, body, prefer):
                self.deleted.append(path)
        checkpoint = {}
        store = Store()
        job = {**JOB, 'created_at': '2026-09-30T00:00:00Z', 'checkpoint': checkpoint}
        self.assertEqual(finalize_scored_offers(store, job, Engine(), {'search': {'minimum_score': 0}}, checkpoint), (2, 0))
        self.assertTrue(store.finalization_pending)
        self.assertEqual(checkpoint['final_score_cursor'], 2)
        self.assertEqual(finalize_scored_offers(store, job, Engine(), {'search': {'minimum_score': 0}}, checkpoint), (1, 0))
        self.assertFalse(store.finalization_pending)
        self.assertEqual(store.updated, [1, 2, 3])
        # Low final scores retain the existing business decision: reject history
        # and remove the pending offer, without applying it to a user's keep.
        store = Store()
        result = finalize_scored_offers(store, job, Engine(), {'search': {'minimum_score': 50}}, {})
        self.assertEqual(result, (0, 2))
        self.assertEqual(len(store.deleted), 2)


if __name__ == '__main__': unittest.main()
