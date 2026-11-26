import importlib.util
from pathlib import Path
import subprocess
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('migration_history', Path(__file__).resolve().parents[1] / 'infrastructure/scripts/migration-history.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class MigrationHistory(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='xelra-history-')
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.directory = self.root / 'supabase/migrations'
        self.directory.mkdir(parents=True)
        self.original = self.directory / '20261126000000_foundation.sql'
        self.original.write_text('select 1;\n')
        self.git('init', '-q')
        self.git('config', 'user.email', 'fixture@invalid.test')
        self.git('config', 'user.name', 'Test fixture')
        self.git('config', 'core.autocrlf', 'false')
        self.git('add', '.')
        self.git('-c', 'commit.gpgsign=false', 'commit', '-qm', 'fixture')
        self.base = self.git('rev-parse', 'HEAD').strip()

    def git(self, *args):
        return subprocess.check_output(['git', '-C', str(self.root), *args], text=True, stderr=subprocess.PIPE)

    def test_accepts_only_append_with_line_ending_normalisation(self):
        self.original.write_bytes(b'select 1;\r\n')
        (self.directory / '20261127000000_next.sql').write_text('select 2;')
        self.assertEqual(module.check(self.root, self.base), {'existing': 1, 'added': 1})

    def test_rejects_mutation_and_rename(self):
        self.original.write_text('select 2;')
        with self.assertRaises(ValueError): module.check(self.root, self.base)
        self.original.rename(self.directory / '20261127000000_renamed.sql')
        with self.assertRaises(ValueError): module.check(self.root, self.base)

    def test_rejects_deleted_history(self):
        self.original.unlink()
        with self.assertRaises(ValueError): module.check(self.root, self.base)

    def test_rejects_backdated_duplicate_and_invalid_date(self):
        for name in ['20261125000000_old.sql', '20261126000000_duplicate.sql', '20261327000000_invalid.sql']:
            with self.subTest(name=name):
                path = self.directory / name
                path.write_text('select 2;')
                with self.assertRaises(ValueError): module.check(self.root, self.base)
                path.unlink()

    def test_missing_or_invalid_baseline_fails_closed(self):
        with self.assertRaises(subprocess.CalledProcessError): module.check(self.root, 'a' * 40)
        with self.assertRaises(ValueError): module.check(self.root, '--help')
        self.assertEqual(module.check(self.root, '0' * 40)['added'], 1)
