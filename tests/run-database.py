"""Run migration invariants only on a disposable loopback database."""
import os
from pathlib import Path
import subprocess
import sys
from urllib.parse import urlparse

root = Path(__file__).resolve().parents[1]
url = os.environ['TEST_DATABASE_URL']
parsed = urlparse(url)
assert parsed.hostname in ('127.0.0.1', 'localhost') and not parsed.query, 'Loopback database only'
def run(file):
    subprocess.run(['psql', url, '-X', '-v', 'ON_ERROR_STOP=1', '-f', str(file)], check=True)
if '--bootstrap' in sys.argv:
    run(root / 'tests/bootstrap-postgres.sql')
if '--migrate' in sys.argv:
    for file in sorted((root / 'supabase/migrations').glob('*.sql')):
        run(file)
for file in sorted((root / 'supabase/tests').glob('*.sql')):
    run(file)
print('Actual foundation migration tests passed')
