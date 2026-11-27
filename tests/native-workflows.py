"""Apply and verify actual migrations in a new, disposable loopback PostgreSQL cluster.

No existing database, Docker service, provider, account or secret is used.
"""
from pathlib import Path
import os
import shutil
import socket
import subprocess
import sys
import uuid

ROOT = Path(__file__).resolve().parents[1]
BASE = (ROOT / '.validation').resolve()
BASE.mkdir(exist_ok=True)
FOLDER = (BASE / ('workflows-native-' + uuid.uuid4().hex)).resolve()
assert FOLDER.parent == BASE
FOLDER.mkdir()
HIDDEN = subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0
BIN = {name: shutil.which(name) for name in ('initdb', 'pg_ctl', 'psql')}
if not all(BIN.values()):
    raise SystemExit('initdb, pg_ctl and psql must be on PATH.')
with socket.socket() as sock:
    sock.bind(('127.0.0.1', 0))
    PORT = sock.getsockname()[1]

def run(args, timeout=120, env=None):
    with (FOLDER / 'validation.log').open('a', encoding='utf-8') as log:
        result = subprocess.run(args, stdout=log, stderr=log, timeout=timeout,
                                creationflags=HIDDEN, env=env)
    if result.returncode:
        raise RuntimeError(f'{Path(args[0]).name} failed; see {FOLDER / "validation.log"}')

PSQL = [BIN['psql'], '-X', '-v', 'ON_ERROR_STOP=1', '-h', '127.0.0.1', '-p', str(PORT), '-U', 'postgres', '-d', 'postgres']
started = False
try:
    run([BIN['initdb'], '-D', str(FOLDER / 'data'), '-U', 'postgres', '--auth=trust', '--encoding=UTF8', '--no-locale'])
    run([BIN['pg_ctl'], '-D', str(FOLDER / 'data'), '-l', str(FOLDER / 'server.log'), '-o', f'-h 127.0.0.1 -p {PORT} -F', '-w', 'start'])
    started = True
    run(PSQL + ['-f', str(ROOT / 'tests/bootstrap-postgres.sql')])
    run(PSQL + ['-c', "create schema auth; create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$; grant usage on schema auth to authenticated; grant execute on function auth.uid() to authenticated;"])
    environment = dict(os.environ, TEST_DATABASE_URL=f'postgresql://postgres@127.0.0.1:{PORT}/postgres')
    run([sys.executable, str(ROOT / 'tests/run-database.py'), '--migrate'], env=environment)
    print('PASS: all actual migrations and supabase/tests on disposable native PostgreSQL.', flush=True)
    print(f'Diagnostic log: {FOLDER / "validation.log"}', flush=True)
finally:
    if started:
        run([BIN['pg_ctl'], '-D', str(FOLDER / 'data'), '-m', 'immediate', '-w', 'stop'], timeout=30)
