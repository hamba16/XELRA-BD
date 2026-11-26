"""Run two real concurrent connections against a NEW disposable local cluster.

Requires PostgreSQL initdb/pg_ctl/psql on PATH. Never connects to an existing
database or accepts a database URL. No Docker, account or secret is used.
"""
from pathlib import Path
import json
import os
import shutil
import socket
import subprocess
import time
import uuid

ROOT = Path(__file__).resolve().parents[1]
BASE = (ROOT / '.validation').resolve()
BASE.mkdir(exist_ok=True)
FOLDER = (BASE / ('approval-native-' + uuid.uuid4().hex)).resolve()
assert FOLDER.parent == BASE
FOLDER.mkdir()
HIDDEN = subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0
BIN = {}
for name in ('initdb', 'pg_ctl', 'psql'):
    BIN[name] = shutil.which(name)
    if not BIN[name]:
        raise SystemExit(f'{name} is required on PATH for the isolated concurrency check.')
with socket.socket() as sock:
    sock.bind(('127.0.0.1', 0))
    PORT = sock.getsockname()[1]

def run(args, check=True, timeout=60):
    return subprocess.run(args, text=True, capture_output=True, check=check,
                          timeout=timeout, creationflags=HIDDEN)

def sql(query, check=True):
    return run([BIN['psql'], '-X', '-qAt', '-v', 'ON_ERROR_STOP=1',
                '-h', '127.0.0.1', '-p', str(PORT), '-U', 'postgres',
                '-d', 'postgres', '-c', query], check=check)

def file(path):
    run([BIN['psql'], '-X', '-q', '-v', 'ON_ERROR_STOP=1', '-h', '127.0.0.1',
         '-p', str(PORT), '-U', 'postgres', '-d', 'postgres', '-f', str(path)])

REQUESTER = '00000000-0000-0000-0000-000000000002'
MANAGER = '00000000-0000-0000-0000-000000000001'

def as_user(who, command):
    return f"set role authenticated; select set_config('request.jwt.claim.sub','{who}',false); {command}"

def connection(query):
    return subprocess.Popen([BIN['psql'], '-X', '-qAt', '-v', 'ON_ERROR_STOP=1',
        '-h', '127.0.0.1', '-p', str(PORT), '-U', 'postgres', '-d', 'postgres', '-c', query],
        stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, creationflags=HIDDEN)

started = False
try:
    run([BIN['initdb'], '-D', str(FOLDER / 'data'), '-U', 'postgres', '--auth=trust', '--encoding=UTF8', '--no-locale'])
    run([BIN['pg_ctl'], '-D', str(FOLDER / 'data'), '-l', str(FOLDER / 'server.log'),
         '-o', f'-h 127.0.0.1 -p {PORT} -F', '-w', 'start'])
    started = True
    version = sql('show server_version').stdout.strip()
    file(ROOT / 'tests/bootstrap-postgres.sql')
    sql("create schema auth; create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$; grant usage on schema auth to authenticated; grant execute on function auth.uid() to authenticated;")
    for path in sorted((ROOT / 'supabase/migrations').glob('*.sql')):
        file(path)
    sql(f"""insert into org.people(id,full_name,email) values
      ('{MANAGER}','Sample Manager','manager@xelra.test'),('{REQUESTER}','Sample Staff','staff@xelra.test');
      update org.people set manager_id='{MANAGER}' where id='{REQUESTER}';
      insert into rbac.assignments(person_id,role_code,division) values
      ('{MANAGER}','central_director','COR'),('{REQUESTER}','staff','ENG');""")
    results = []
    for first in ('withdraw', 'approve'):
        request = sql(as_user(REQUESTER, "select api.submit_request('expense','ENG',80000,'{\"title\":\"Concurrent request\"}');")).stdout.strip().splitlines()[-1]
        actions = {
            'withdraw': as_user(REQUESTER, f"select api.withdraw_request('{request}','No longer needed');"),
            'approve': as_user(MANAGER, f"select api.decide_request('{request}',true);")
        }
        second = 'approve' if first == 'withdraw' else 'withdraw'
        winner = connection(f"set application_name='xelra-race-winner';begin;{actions[first]}select pg_sleep(3);commit;")
        deadline = time.monotonic() + 15
        while time.monotonic() < deadline:
            if sql("select count(*) from pg_stat_activity where application_name='xelra-race-winner' and wait_event='PgSleep'").stdout.strip() == '1':
                break
            if winner.poll() is not None:
                raise AssertionError(winner.communicate())
            time.sleep(.05)
        else:
            raise AssertionError('Winning transaction did not reach its held-lock checkpoint')
        loser = connection(f"set application_name='xelra-race-loser';{actions[second]}")
        blocked = False
        for _ in range(15):
            if sql("select count(*) from pg_stat_activity where application_name='xelra-race-loser' and wait_event_type='Lock'").stdout.strip() == '1':
                blocked = True
                break
            time.sleep(.05)
        winner.communicate(timeout=20)
        _, failure = loser.communicate(timeout=20)
        assert blocked, 'Second connection must wait for the shared request-row lock'
        assert winner.returncode == 0
        assert loser.returncode != 0 and 'no longer open' in failure, failure
        state = sql(f"select status from approvals.requests where id='{request}'").stdout.strip()
        assert state == ('cancelled' if first == 'withdraw' else 'approved'), state
        results.append({'first': first, 'second': second, 'second_waited_for_lock': blocked,
                        'second_rejected': True, 'final_status': state})
        print(f'PASS: {first} commits; concurrent {second} waits and is rejected.', flush=True)
    assert sql('select ok from audit.verify()').stdout.strip() == 't'
    report = {'postgres_version': version, 'disposable_loopback_only': True, 'cases': results, 'audit_verified': True}
    (BASE / 'approval-races.json').write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
    print(f'Native PostgreSQL {version}: both race orderings and audit verification passed.', flush=True)
finally:
    if started:
        run([BIN['pg_ctl'], '-D', str(FOLDER / 'data'), '-m', 'immediate', '-w', 'stop'], timeout=30)
    # Leave diagnostic files under the ignored validation directory; no existing cluster is touched.
