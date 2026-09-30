"""PostgreSQL text/jsonb Unicode regressions without a database."""
import unittest
from unittest.mock import patch


class PersistenceTests(unittest.TestCase):
    def test_persistence_repairs_postgres_unsupported_unicode(self):
        from cloud.scan_worker import postgres_json
        source = {'text': 'hello\x00world', 'nested': [{'snippet': 'bad\ud800end'}],
                  'emoji': '\U0001f600', 'pair': '\ud83d\ude00', 'accent': 'caf\u00e9'}
        cleaned = postgres_json(source)
        self.assertEqual(cleaned['text'], 'helloworld')
        self.assertEqual(cleaned['nested'][0]['snippet'], 'bad\ufffdend')
        self.assertEqual(cleaned['emoji'], source['emoji'])
        self.assertEqual(cleaned['pair'], source['emoji'])
        self.assertEqual(cleaned['accent'], source['accent'])
        self.assertIn('\x00', source['text'])

    def test_store_sanitizes_the_actual_supabase_request_body(self):
        import json
        from cloud.scan_worker import Store
        class Response:
            def __enter__(self): return self
            def __exit__(self, *args): pass
            def read(self): return b'[]'
        with patch.dict('os.environ', {'SUPABASE_URL': 'https://example.org', 'SUPABASE_SERVICE_ROLE_KEY': 'fixture'}), \
                patch('cloud.scan_worker.urllib.request.urlopen', return_value=Response()) as send:
            Store().request('hunter_scan_events', 'POST', {'message': 'hello\x00world', 'payload': {'title': 'bad\ud800'}})
        payload = json.loads(send.call_args.args[0].data)
        self.assertEqual(payload['message'], 'helloworld')
        self.assertEqual(payload['payload']['title'], 'bad\ufffd')


if __name__ == "__main__":
    unittest.main()
