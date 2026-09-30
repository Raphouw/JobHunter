import tempfile
import unittest
from pathlib import Path
from cv_store import cv_request


class CvStoreTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name) / 'profile' / 'database.sqlite3'

    def test_roundtrip_multiple_cvs_and_revision_conflict(self):
        one = cv_request(self.path, 'create', {'title': 'CV France', 'content': {'version': 17, 'name': 'Émilie'}})
        two = cv_request(self.path, 'create', {'title': 'CV Suisse'})
        self.assertEqual(len(cv_request(self.path, 'list')), 2)
        saved = cv_request(self.path, 'save', {**one, 'title': 'CV France React', 'content': {'name': 'Émilie', 'mainCol': '<b>React</b>'}})
        self.assertEqual(saved['revision'], 1)
        self.assertEqual(cv_request(self.path, 'get', {'id': one['id']})['content']['mainCol'], '<b>React</b>')
        with self.assertRaises(ValueError):
            cv_request(self.path, 'save', one)
        self.assertIsNone(cv_request(self.path, 'get', {'id': two['id']})['content'])
        cv_request(self.path, 'delete', {'id': one['id']})
        self.assertEqual(len(cv_request(self.path, 'list')), 1)

    def test_profile_isolation_and_input_validation(self):
        one = cv_request(self.path, 'create', {'title': 'Mon CV'})
        other = Path(self.temp.name) / 'other' / 'database.sqlite3'
        self.assertEqual(cv_request(other, 'list'), [])
        with self.assertRaises(ValueError):
            cv_request(other, 'get', {'id': one['id']})
        for values in ({'title': ''}, {'title': 'a' * 121}, {'title': 'CV', 'content': []}, {'title': 'CV', 'content': {'photo': 'a' * 1800001}}):
            with self.assertRaises(ValueError):
                cv_request(self.path, 'create', values)


if __name__ == '__main__':
    unittest.main()
