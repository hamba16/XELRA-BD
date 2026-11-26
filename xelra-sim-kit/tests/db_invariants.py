"""XELRA database invariant harness.
Each test counts violations. A foundation is certified only when every violations is 0.
Runs on real Postgres through pgserver. Usage: python db_invariants.py
"""
import json, tempfile, threading, time, hashlib, random, uuid
import pgserver, psycopg

SCHEMA = r"""
create schema auth; create schema private;
create function auth.uid() returns uuid language sql stable as
$$ select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid $$;
create role authenticated nologin;

create table divisions(id text primary key);
create table profiles(id uuid primary key, full_name text not null, status text not null default 'active');
create table role_templates(key text primary key);
create table role_permissions(role_key text references role_templates, perm text, primary key(role_key, perm));
create table user_roles(user_id uuid references profiles, role_key text references role_templates,
  division_id text references divisions, expires_at timestamptz, consent_doc uuid);
create unique index on user_roles(user_id, role_key, coalesce(division_id,'*'));
create table approval_limits(role_key text primary key references role_templates, max_amount bigint not null);
create table delegations(id bigserial primary key, from_user uuid, to_user uuid, role_key text, division_id text,
  starts timestamptz, ends timestamptz, cap bigint);

create function private.my_divisions(p text) returns setof text language sql stable security definer
set search_path=public as $$
 select distinct d.id from user_roles ur
 join role_permissions rp on rp.role_key=ur.role_key and rp.perm=p
 join divisions d on (ur.division_id is null or ur.division_id=d.id)
 where ur.user_id=auth.uid() and (ur.expires_at is null or ur.expires_at>now()) $$;
create function private.has_perm(p text) returns boolean language sql stable security definer
set search_path=public as $$
 select exists(select 1 from user_roles ur join role_permissions rp on rp.role_key=ur.role_key and rp.perm=p
 where ur.user_id=auth.uid() and (ur.expires_at is null or ur.expires_at>now())) $$;
create function private.has_perm_row(p text, d text) returns boolean language sql stable security definer
set search_path=public as $$
 select exists(select 1 from user_roles ur join role_permissions rp on rp.role_key=ur.role_key and rp.perm=p
 where ur.user_id=auth.uid() and (ur.division_id is null or ur.division_id=d)) $$;

create table projects(id serial primary key, division_id text references divisions, name text);
alter table projects enable row level security;
create policy p_read on projects for select to authenticated
 using (division_id in (select private.my_divisions('project.read')));

create table payroll_runs(id serial primary key, status text not null default 'draft');
create table payslips(id serial primary key, run_id int references payroll_runs, user_id uuid, gross bigint, net bigint);
alter table payslips enable row level security;
create policy s_read on payslips for select to authenticated
 using (user_id=(select auth.uid()) or (select private.has_perm('payroll.read')));
create function private.lock_payslips() returns trigger language plpgsql as $$
begin if (select status from payroll_runs where id=coalesce(new.run_id,old.run_id))='approved'
 then raise exception 'payroll period locked'; end if; return coalesce(new,old); end $$;
create trigger payslip_lock before insert or update or delete on payslips for each row execute function private.lock_payslips();

create table audit_log(id bigserial primary key, at timestamptz default now(), actor uuid, action text, entity text, entity_id text, data jsonb);
create function private.audit_immutable() returns trigger language plpgsql as $$
begin raise exception 'audit_log is append-only'; end $$;
create trigger audit_no_row before update or delete on audit_log for each row execute function private.audit_immutable();
create trigger audit_no_trunc before truncate on audit_log for each statement execute function private.audit_immutable();

create table approvals(id serial primary key, requester uuid not null, amount bigint not null, division_id text, status text default 'pending',
  created_at timestamptz default now());
create table approval_steps(id serial primary key, approval_id int references approvals, approver uuid not null, decision text, decided_at timestamptz default now());
create function private.approver_limit(u uuid, d text) returns bigint language sql stable security definer set search_path=public as $$
 select coalesce(max(x),0) from (
  select al.max_amount x from user_roles ur join approval_limits al using(role_key)
   where ur.user_id=u and (ur.division_id is null or ur.division_id=d) and (ur.expires_at is null or ur.expires_at>now())
  union all
  select least(al.max_amount, dg.cap) from delegations dg join approval_limits al on al.role_key=dg.role_key
   where dg.to_user=u and now() between dg.starts and dg.ends and (dg.division_id is null or dg.division_id=d)) q $$;
create function private.check_step() returns trigger language plpgsql as $$
declare a approvals;
begin select * into a from approvals where id=new.approval_id;
 if new.approver=a.requester then raise exception 'segregation of duties: requester cannot approve'; end if;
 if private.approver_limit(new.approver,a.division_id) < a.amount then raise exception 'above approver authority'; end if;
 if (select status from profiles where id=new.approver)<>'active' then raise exception 'approver inactive'; end if;
 return new; end $$;
create trigger step_check before insert on approval_steps for each row execute function private.check_step();

create table doc_counters(project text, doc_type text, last int not null default 0, primary key(project,doc_type));
create function private.next_doc_no(p text, t text) returns int language sql as $$
 insert into doc_counters(project,doc_type,last) values(p,t,1)
 on conflict(project,doc_type) do update set last=doc_counters.last+1 returning last $$;

create table login_events(id bigserial primary key, user_id uuid, event text, at timestamptz);
create table login_exports(id serial primary key, from_ts timestamptz, to_ts timestamptz, row_count int, sha256 text, confirmed_at timestamptz);
create function private.purge_login_events(export_id int) returns int language plpgsql as $$
declare e login_exports; n int; c int; begin
 select * into e from login_exports where id=export_id;
 if e.id is null or e.confirmed_at is null or e.sha256 is null then raise exception 'purge refused: export not confirmed'; end if;
 select count(*) into c from login_events where at>=e.from_ts and at<e.to_ts;
 if c<>e.row_count then raise exception 'purge refused: row count differs from export'; end if;
 delete from login_events where at>=e.from_ts and at<e.to_ts; get diagnostics n=row_count;
 insert into audit_log(action,entity,entity_id,data) values('purge','login_events',export_id::text,jsonb_build_object('rows',n,'sha256',e.sha256));
 return n; end $$;

create table expenses_a(id serial primary key, division_id text, amount bigint);
create table expenses_b(like expenses_a including all);
alter table expenses_a enable row level security; alter table expenses_b enable row level security;
create policy a_read on expenses_a for select to authenticated using (private.has_perm_row('expense.read', division_id));
create policy b_read on expenses_b for select to authenticated using (division_id in (select private.my_divisions('expense.read')));
grant usage on schema auth, private to authenticated;
grant select on all tables in schema public to authenticated;
grant execute on all functions in schema auth, private to authenticated;
"""

U = {k: str(uuid.uuid4()) for k in
     "cd dir_eng eng amg_head fin it intern pro outsider employee".split()}

def uri_db():
    d = tempfile.mkdtemp(); srv = pgserver.get_server(d); return srv, srv.get_uri()

def as_user(cur, who):
    cur.execute("select set_config('request.jwt.claim.sub', %s, false)", (U[who],)); cur.execute("set role authenticated")

def reset(cur):
    cur.execute("reset role")

def expect_error(cur, sql, args=(), contains=""):
    cur.execute("savepoint s")
    try:
        cur.execute(sql, args); cur.execute("release savepoint s"); return False
    except Exception as e:
        cur.execute("rollback to savepoint s"); return contains in str(e)

def main():
    srv, uri = uri_db(); results = {}
    with psycopg.connect(uri, autocommit=False) as cx:
        cur = cx.cursor(); cur.execute(SCHEMA)
        cur.execute("insert into divisions values('ENG'),('AMG')")
        for k, v in U.items():
            cur.execute("insert into profiles values(%s,%s,'active')", (v, k))
        cur.execute("update profiles set status='inactive' where id=%s", (U['outsider'],))
        for r in ['central_director','director_eng','dept_head','project_lead','finance_manager','intern','it_admin','pro_consultant','employee']:
            cur.execute("insert into role_templates values(%s)", (r,))
        perms = {'central_director':['project.read','expense.read','payroll.read'],
                 'director_eng':['project.read','expense.read','payroll.read'],
                 'dept_head':['project.read','expense.read'], 'project_lead':['project.read'],
                 'finance_manager':['project.read','expense.read','payroll.read'],
                 'intern':['project.read'], 'it_admin':['system.admin'], 'pro_consultant':['project.read'], 'employee':[]}
        for r, ps in perms.items():
            for p in ps: cur.execute("insert into role_permissions values(%s,%s)", (r, p))
        for r, m in [('project_lead',1_000_000),('dept_head',5_000_000),('pro_consultant',0),('director_eng',50_000_000),('central_director',10**12),('finance_manager',5_000_000)]:
            cur.execute("insert into approval_limits values(%s,%s)", (r, m))
        roles = [('cd','central_director',None),('dir_eng','director_eng','ENG'),('eng','project_lead','ENG'),
                 ('amg_head','dept_head','AMG'),('fin','finance_manager',None),('it','it_admin',None),
                 ('intern','intern','ENG'),('pro','pro_consultant','ENG'),('employee','employee','ENG'),('outsider','dept_head','ENG')]
        for u, r, d in roles:
            cur.execute("insert into user_roles(user_id,role_key,division_id) values(%s,%s,%s)", (U[u], r, d))
        for i in range(3):
            cur.execute("insert into projects(division_id,name) values('ENG',%s),('AMG',%s)", (f'e{i}', f'a{i}'))
        cur.execute("insert into payroll_runs(status) values('draft'),('approved')")
        for u in ['eng','amg_head','fin','employee']:
            cur.execute("insert into payslips(run_id,user_id,gross,net) values(1,%s,1000,800)", (U[u],))
        cx.commit()

        # T1 isolation
        om = 0
        as_user(cur, 'eng'); cur.execute("select count(*) from projects where division_id='AMG'"); om += cur.fetchone()[0]
        cur.execute("select count(*) from projects"); eng_seen = cur.fetchone()[0]; reset(cur)
        as_user(cur, 'it'); cur.execute("select count(*) from projects"); om += cur.fetchone()[0]; reset(cur)
        as_user(cur, 'cd'); cur.execute("select count(*) from projects"); cd_seen = cur.fetchone()[0]; reset(cur)
        results['T1_division_isolation'] = dict(violations=om, positive_controls=dict(eng_sees=eng_seen, central_director_sees=cd_seen))

        # T2 salary isolation
        om = 0
        as_user(cur, 'it'); cur.execute("select count(*) from payslips"); om += cur.fetchone()[0]; reset(cur)
        as_user(cur, 'employee'); cur.execute("select count(*) from payslips where user_id<>%s", (U['employee'],)); om += cur.fetchone()[0]
        cur.execute("select count(*) from payslips"); own = cur.fetchone()[0]; reset(cur)
        as_user(cur, 'fin'); cur.execute("select count(*) from payslips"); fin_seen = cur.fetchone()[0]; reset(cur)
        results['T2_salary_isolation'] = dict(violations=om, positive_controls=dict(employee_sees_own=own, finance_manager_sees=fin_seen))

        # T3 segregation of duties and authority ladder
        om = 0
        cur.execute("insert into approvals(requester,amount,division_id) values(%s,800000,'ENG') returning id", (U['eng'],)); a1 = cur.fetchone()[0]
        cur.execute("insert into approvals(requester,amount,division_id) values(%s,4000000,'ENG') returning id", (U['eng'],)); a2 = cur.fetchone()[0]
        cur.execute("insert into approvals(requester,amount,division_id) values(%s,70000000,'ENG') returning id", (U['eng'],)); a3 = cur.fetchone()[0]
        ins = "insert into approval_steps(approval_id,approver,decision) values(%s,%s,'approved')"
        om += 0 if expect_error(cur, ins, (a1, U['eng']), 'segregation') else 1
        om += 0 if expect_error(cur, ins, (a2, U['eng']), 'segregation') else 1
        om += 0 if expect_error(cur, ins, (a2, U['intern']), 'above approver authority') else 1
        om += 0 if expect_error(cur, ins, (a3, U['dir_eng']), 'above approver authority') else 1
        om += 0 if expect_error(cur, ins, (a1, U['outsider']), 'approver inactive') else 1
        ok1 = not expect_error(cur, ins, (a1, U['dir_eng']))  # positive control
        cur.execute("insert into delegations(from_user,to_user,role_key,division_id,starts,ends,cap) values(%s,%s,'director_eng','ENG',now()-interval '1 day',now()+interval '5 days',5000000)", (U['dir_eng'], U['pro']))
        ok2 = not expect_error(cur, ins, (a2, U['pro']))   # delegate within cap
        om += 0 if expect_error(cur, ins, (a3, U['pro']), 'above approver authority') else 1  # delegate above cap
        cur.execute("update delegations set ends=now()-interval '1 hour'")
        om += 0 if expect_error(cur, ins, (a1, U['pro']), 'above approver authority') else 1  # expired delegation
        cx.commit()
        results['T3_segregation_and_ladder'] = dict(violations=om, positive_controls=dict(director_approves_in_limit=ok1, delegate_approves_within_cap=ok2))

        # T4 audit immutability
        cur.execute("insert into audit_log(actor,action,entity) values(%s,'seed','x')", (U['cd'],))
        om = 0
        for sql in ["update audit_log set action='x'", "delete from audit_log", "truncate audit_log"]:
            om += 0 if expect_error(cur, sql, (), 'append-only') else 1
        results['T4_audit_append_only'] = dict(violations=om)

        # T7 payroll lock
        approved = expect_error(cur, "insert into payslips(run_id,user_id,gross,net) values(2,%s,1,1)", (U['eng'],), 'locked')
        draft_ok = not expect_error(cur, "update payslips set net=801 where run_id=1")
        results['T7_payroll_lock'] = dict(violations=0 if approved else 1, positive_controls=dict(draft_editable=draft_ok))
        cx.commit()

        # T6 purge safeguard
        t0 = "2026-01-01"; t1 = "2026-02-01"
        for i in range(200):
            cur.execute("insert into login_events(user_id,event,at) values(%s,'login','2026-01-15'::timestamptz+(%s||' minutes')::interval)", (U['eng'], i))
        cur.execute("insert into login_events(user_id,event,at) values(%s,'login','2026-03-01')", (U['eng'],))
        cur.execute("insert into login_exports(from_ts,to_ts,row_count,sha256) values(%s,%s,200,%s) returning id", (t0, t1, hashlib.sha256(b'csv').hexdigest())); eid = cur.fetchone()[0]
        om = 0
        om += 0 if expect_error(cur, "select private.purge_login_events(%s)", (eid,), 'not confirmed') else 1
        cur.execute("update login_exports set confirmed_at=now() where id=%s", (eid,))
        cur.execute("insert into login_events(user_id,event,at) values(%s,'login','2026-01-20')", (U['eng'],))  # row count drift
        om += 0 if expect_error(cur, "select private.purge_login_events(%s)", (eid,), 'row count differs') else 1
        cur.execute("delete from login_events where at='2026-01-20'")
        cur.execute("select private.purge_login_events(%s)", (eid,)); purged = cur.fetchone()[0]
        cur.execute("select count(*) from login_events"); left = cur.fetchone()[0]
        om += 0 if (purged == 200 and left == 1) else 1
        results['T6_purge_requires_verified_export'] = dict(violations=om, positive_controls=dict(purged=purged, rows_kept_outside_range=left))
        cx.commit()

        # T8 RLS performance on 300k rows
        cur.execute("insert into expenses_a(division_id,amount) select case when g%2=0 then 'ENG' else 'AMG' end, g from generate_series(1,300000) g")
        cur.execute("insert into expenses_b select * from expenses_a"); cur.execute("create index on expenses_a(division_id)"); cur.execute("create index on expenses_b(division_id)")
        cur.execute("analyze"); cx.commit()
        perf = {}
        for tbl in ['expenses_a','expenses_b']:
            times = []
            for _ in range(3):
                as_user(cur, 'dir_eng' if False else 'cd'); s = time.perf_counter()
                cur.execute(f"select count(*) from {tbl}"); cur.fetchone(); times.append((time.perf_counter()-s)*1000); reset(cur)
            perf[tbl] = round(min(times), 1)
        as_user(cur, 'it'); cur.execute("select count(*) from expenses_b"); it_rows = cur.fetchone()[0]; reset(cur)
        results['T8_rls_performance_300k_rows'] = dict(violations=it_rows, per_row_function_ms=perf['expenses_a'], set_based_policy_ms=perf['expenses_b'],
                                                      speedup=round(perf['expenses_a']/max(perf['expenses_b'],0.1), 1))
        cx.commit()

    # T5 numbering under real concurrency, with injected rollbacks
    N_THREADS, PER = 8, 150; committed = []; lock = threading.Lock(); errors = []
    def worker(seed):
        rnd = random.Random(seed)
        try:
            with psycopg.connect(uri, autocommit=False) as c:
                cu = c.cursor()
                for _ in range(PER):
                    cu.execute("select private.next_doc_no('P014','RPT')"); n = cu.fetchone()[0]
                    if rnd.random() < 0.1: c.rollback()
                    else:
                        c.commit()
                        with lock: committed.append(n)
        except Exception as e: errors.append(str(e))
    ths = [threading.Thread(target=worker, args=(i,)) for i in range(N_THREADS)]
    s = time.perf_counter(); [t.start() for t in ths]; [t.join() for t in ths]; dur = time.perf_counter()-s
    dup = len(committed) - len(set(committed)); gaps = (max(committed) - len(committed)) if committed else 0
    results['T5_numbering_concurrency'] = dict(violations=dup + gaps + len(errors), allocations_committed=len(committed),
        duplicates=dup, gaps=gaps, errors=len(errors), seconds=round(dur, 2), threads=N_THREADS)
    total = sum(v['violations'] for v in results.values())
    results['RESULT'] = dict(total_violations=total, certified=(total == 0))
    print(json.dumps(results, indent=2))

if __name__ == '__main__':
    main()
