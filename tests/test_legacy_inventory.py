import importlib.util
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('legacy_inventory', Path(__file__).resolve().parents[1] / 'scripts/legacy-inventory.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

class LegacyInventory(unittest.TestCase):
    def test_deduplicates_without_modifying_sources_and_requires_review(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'one.pdf').write_bytes(b'%PDF-synthetic')
            (root / 'two.pdf').write_bytes(b'%PDF-synthetic')
            original = {p.name: p.read_bytes() for p in root.iterdir()}
            plan = module.inventory(root, {'one.pdf': {'reviewed': True, 'division': 'ENG', 'project': 'P014', 'type': 'RPT'}})
            self.assertEqual(plan['unique_content'], 1)
            self.assertEqual(sum(bool(row['duplicate_of']) for row in plan['files']), 1)
            self.assertFalse(next(row for row in plan['files'] if row['original_name'] == 'one.pdf')['review_required'])
            self.assertTrue(next(row for row in plan['files'] if row['original_name'] == 'two.pdf')['review_required'])
            self.assertEqual(original, {p.name: p.read_bytes() for p in root.iterdir()})
            with self.assertRaises(ValueError):
                module.inventory(root, {'one.pdf': {'reviewed': True, 'division': 'UNKNOWN', 'project': 'P014', 'type': 'RPT'}})
