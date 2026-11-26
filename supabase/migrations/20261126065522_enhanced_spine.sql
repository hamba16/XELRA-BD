-- Adapted from Files lab; no auth shims or synthetic people.
begin;
-- XELRA core spine prototype. Runs on Supabase Postgres and on PGlite (for CI).
create extension if not exists btree_gist;

-- ---------- Schemas ----------
create schema org; create schema rbac; create schema hr; create schema fin;
create schema approvals; create schema audit; create schema docs; create schema payroll;

-- ---------- Organisation ----------
create table org.divisions (code text primary key check (code in ('ENG','AMG','COR')), name text not null);
insert into org.divisions values ('ENG','Engineering'),('AMG','Asset Management'),('COR','Corporate');

create table org.people (
  id uuid primary key, full_name text not null, email text not null unique,
  status text not null default 'active' check (status in ('active','suspended','offboarded')),
  manager_id uuid references org.people(id), created_at timestamptz not null default now());

-- ---------- RBAC: roles, permissions and grants live in data, not code ----------
create table rbac.roles (code text primary key, name text not null);
create table rbac.role_perms (
  role_code text references rbac.roles(code) on delete cascade, perm text not null,
  scope text not null check (scope in ('own','division','all')), primary key (role_code, perm));
create table rbac.sensitive_perms (perm text primary key);
create table rbac.assignments (
  id uuid primary key default gen_random_uuid(), person_id uuid not null references org.people(id),
  role_code text not null references rbac.roles(code), division text not null references org.divisions(code),
  valid_from date not null default current_date, valid_to date, consent_doc_id uuid);
create table rbac.grants (
  id uuid primary key default gen_random_uuid(), person_id uuid not null references org.people(id),
  perm text not null, scope text not null check (scope in ('own','division','all')), division text references org.divisions(code),
  granted_by uuid, consent_doc_id uuid, expires_at timestamptz);
-- Flattened, indexed copy of what each person may do. This is what RLS reads.
create table rbac.effective (
  person_id uuid not null, perm text not null, scope text not null, division text, expires_at timestamptz);
create index effective_lookup on rbac.effective (person_id, perm);

create function rbac.rebuild(p uuid) returns void language plpgsql security definer set search_path = '' as $$
begin
  delete from rbac.effective where person_id = p;
  insert into rbac.effective (person_id, perm, scope, division, expires_at)
    select a.person_id, rp.perm, rp.scope, a.division, (a.valid_to + 1)::timestamptz
    from rbac.assignments a join rbac.role_perms rp on rp.role_code = a.role_code
    where a.person_id = p and a.valid_from <= current_date
  union all
    select g.person_id, g.perm, g.scope, g.division, g.expires_at from rbac.grants g where g.person_id = p;
end $$;

create function rbac.trg_rebuild() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform rbac.rebuild(coalesce(new.person_id, old.person_id));
  return null;
end $$;
create trigger assignments_rebuild after insert or update or delete on rbac.assignments for each row execute function rbac.trg_rebuild();
create trigger grants_rebuild after insert or update or delete on rbac.grants for each row execute function rbac.trg_rebuild();

create function rbac.person_can(p uuid, p_perm text, p_division text default null, p_owner uuid default null)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from rbac.effective e join org.people pe on pe.id = e.person_id and pe.status = 'active'
    where e.person_id = p and e.perm = p_perm and (e.expires_at is null or e.expires_at > now())
      and (e.scope = 'all'
        or (e.scope = 'division' and p_division is not null and e.division = p_division)
        or (e.scope = 'own' and p_owner is not null and p_owner = p)));
$$;
create function rbac.can(p_perm text, p_division text default null, p_owner uuid default null)
returns boolean language sql stable security definer set search_path = '' as $$
  select rbac.person_can(auth.uid(), p_perm, p_division, p_owner);
$$;

-- ---------- Audit: append-only, hash-chained ----------
create table audit.events (
  seq bigint generated always as identity primary key, at timestamptz not null, actor uuid,
  action text not null, entity text, entity_id text, detail jsonb not null default '{}'::jsonb,
  prev_hash text not null, hash text not null);
create function audit.stamp(prev text, at timestamptz, actor uuid, action text, entity text, entity_id text, detail jsonb)
returns text language sql stable set search_path='' as $$
  select encode(sha256(convert_to(jsonb_build_array(prev,
    to_char(at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.US'), coalesce(actor::text,''), action,
    coalesce(entity,''), coalesce(entity_id,''), detail)::text, 'utf8')), 'hex');
$$;
create function audit.log(p_action text, p_entity text default null, p_entity_id text default null, p_detail jsonb default '{}')
returns bigint language plpgsql security definer set search_path = '' as $$
declare prev text; t timestamptz := clock_timestamp(); h text; s bigint;
begin
  perform pg_advisory_xact_lock(7001);
  select e.hash into prev from audit.events e order by e.seq desc limit 1;
  prev := coalesce(prev, 'genesis');
  h := audit.stamp(prev, t, auth.uid(), p_action, p_entity, p_entity_id, p_detail);
  insert into audit.events (at, actor, action, entity, entity_id, detail, prev_hash, hash)
    values (t, auth.uid(), p_action, p_entity, p_entity_id, p_detail, prev, h) returning seq into s;
  return s;
end $$;
create function audit.no_change() returns trigger language plpgsql as $$
begin raise exception 'audit.events is append-only'; end $$;
create trigger audit_immutable before update or delete on audit.events for each row execute function audit.no_change();
create trigger audit_no_truncate before truncate on audit.events for each statement execute function audit.no_change();
create function audit.verify() returns table (ok boolean, first_bad_seq bigint, checked bigint)
language plpgsql security definer set search_path = '' as $$
declare r record; prev text := 'genesis'; n bigint := 0;
begin
  for r in select * from audit.events order by seq loop
    n := n + 1;
    if r.prev_hash <> prev or r.hash <> audit.stamp(prev, r.at, r.actor, r.action, r.entity, r.entity_id, r.detail) then
      return query select false, r.seq, n; return;
    end if;
    prev := r.hash;
  end loop;
  return query select true, null::bigint, n;
end $$;

-- ---------- Controlled granting (consent on sensitive access) ----------
create function rbac.grant_perm(p_person uuid, p_perm text, p_scope text, p_division text, p_consent uuid, p_expires timestamptz)
returns uuid language plpgsql security definer set search_path = '' as $$
declare sens boolean; is_dir boolean; gid uuid;
begin
  if not rbac.can('rbac.grant') then raise exception 'You are not allowed to grant access.'; end if;
  sens := exists (select 1 from rbac.sensitive_perms sp where sp.perm = p_perm);
  is_dir := exists (select 1 from rbac.assignments a where a.person_id = auth.uid() and a.role_code = 'central_director');
  if sens and not is_dir and p_consent is null then
    raise exception 'A Director''s uploaded consent is required for this access.';
  end if;
  insert into rbac.grants (person_id, perm, scope, division, granted_by, consent_doc_id, expires_at)
    values (p_person, p_perm, p_scope, p_division, auth.uid(), p_consent, p_expires) returning id into gid;
  perform audit.log('rbac.grant', 'person', p_person::text, jsonb_build_object('perm', p_perm, 'scope', p_scope, 'division', p_division, 'consent', p_consent));
  return gid;
end $$;

-- ---------- HR data under RLS ----------
create table hr.leave_requests (
  id uuid primary key default gen_random_uuid(), person_id uuid not null references org.people(id),
  division text not null references org.divisions(code), kind text not null default 'annual',
  starts date not null, ends date not null check (ends >= starts), status text not null default 'draft',
  created_at timestamptz not null default now());
create table hr.pay (
  person_id uuid primary key references org.people(id), division text not null references org.divisions(code),
  base_salary_ugx bigint not null, bank_ref text);
alter table hr.leave_requests enable row level security;
alter table hr.pay enable row level security;
create policy leave_read on hr.leave_requests for select to authenticated
  using ((select rbac.can('leave.read', division, person_id)));
create policy leave_insert on hr.leave_requests for insert to authenticated
  with check (person_id = (select auth.uid()));
create policy pay_read on hr.pay for select to authenticated
  using ((select rbac.can('pay.read', division, person_id)));
alter table audit.events enable row level security;
create policy audit_read on audit.events for select to authenticated using ((select rbac.can('audit.read')));

-- ---------- Approval engine ----------
create table fin.settings (id boolean primary key default true check (id), spend_scale numeric not null default 1);
insert into fin.settings default values;
create table approvals.delegations (
  id uuid primary key default gen_random_uuid(), from_person uuid not null references org.people(id),
  to_person uuid not null references org.people(id), division text not null references org.divisions(code),
  starts_at timestamptz not null default now(), expires_at timestamptz not null,
  check (expires_at <= starts_at + interval '5 days'), check (from_person <> to_person));
create table approvals.requests (
  id uuid primary key default gen_random_uuid(), kind text not null, division text not null references org.divisions(code),
  requester uuid not null references org.people(id), amount_ugx bigint, payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending' check (status in ('pending','approved','rejected','cancelled')),
  current_step int not null default 1, created_at timestamptz not null default now());
create table approvals.steps (
  request_id uuid references approvals.requests(id) on delete cascade, step_no int not null,
  step_type text not null check (step_type in ('manager','perm')), perm text,
  status text not null default 'waiting' check (status in ('waiting','approved','rejected','skipped')),
  decided_by uuid, decided_at timestamptz, comment text, primary key (request_id, step_no));

create function fin.expense_ladder(p_amount bigint) returns jsonb language plpgsql stable set search_path = '' as $$
declare k numeric := (select spend_scale from fin.settings);
begin
  if p_amount <= 100000 * k then
    return '[{"type":"manager"}]'::jsonb;                      -- petty cash: manager notified/ack
  elsif p_amount <= 1000000 * k then
    return '[{"type":"manager"},{"type":"perm","perm":"expense.review"}]'::jsonb;
  elsif p_amount <= 5000000 * k then
    return '[{"type":"perm","perm":"expense.depthead"},{"type":"perm","perm":"expense.approve.fm"}]'::jsonb;
  else
    return '[{"type":"perm","perm":"expense.approve.fm"},{"type":"perm","perm":"expense.approve.central"}]'::jsonb;
  end if;
end $$;

create function approvals.submit(p_kind text, p_division text, p_amount bigint, p_payload jsonb default '{}')
returns uuid language plpgsql security definer set search_path = '' as $$
declare rid uuid; steps jsonb; s jsonb; i int := 0;
begin
  if auth.uid() is null then raise exception 'Sign in first.'; end if;
  steps := case p_kind
    when 'expense' then fin.expense_ladder(coalesce(p_amount, 0))
    when 'leave' then '[{"type":"manager"},{"type":"perm","perm":"leave.approve"}]'::jsonb
    else '[{"type":"perm","perm":"generic.approve"}]'::jsonb end;
  insert into approvals.requests (kind, division, requester, amount_ugx, payload)
    values (p_kind, p_division, auth.uid(), p_amount, p_payload) returning id into rid;
  for s in select * from jsonb_array_elements(steps) loop
    i := i + 1;
    insert into approvals.steps (request_id, step_no, step_type, perm) values (rid, i, s ->> 'type', s ->> 'perm');
  end loop;
  perform audit.log('approval.submit', 'request', rid::text, jsonb_build_object('kind', p_kind, 'amount', p_amount, 'steps', jsonb_array_length(steps)));
  return rid;
end $$;

create function approvals.eligible(p_person uuid, p_req uuid, p_step int) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare r approvals.requests; st approvals.steps; mgr uuid;
begin
  select * into r from approvals.requests where id = p_req;
  select * into st from approvals.steps where request_id = p_req and step_no = p_step;
  if r.id is null or st.request_id is null then return false; end if;
  if p_person = r.requester then return false; end if;                                    -- never your own item
  if exists (select 1 from approvals.steps x where x.request_id = p_req and x.decided_by = p_person) then return false; end if; -- four eyes
  if st.step_type = 'manager' then
    select manager_id into mgr from org.people where id = r.requester;
    return mgr is not null and (mgr = p_person or exists (
      select 1 from approvals.delegations d where d.from_person = mgr and d.to_person = p_person
        and d.division = r.division and now() >= d.starts_at and now() < d.expires_at));
  end if;
  return rbac.person_can(p_person, st.perm, r.division) or exists (
    select 1 from approvals.delegations d
    where d.to_person = p_person and d.division = r.division and now() >= d.starts_at and now() < d.expires_at
      and rbac.person_can(d.from_person, st.perm, r.division));
end $$;

create function approvals.decide(p_req uuid, p_approve boolean, p_comment text default null)
returns text language plpgsql security definer set search_path = '' as $$
declare r approvals.requests; total int; res text;
begin
  select * into r from approvals.requests where id = p_req for update;
  if r.id is null or r.status <> 'pending' then raise exception 'This request is no longer open.'; end if;
  if not approvals.eligible(auth.uid(), p_req, r.current_step) then
    raise exception 'You cannot decide this step.';
  end if;
  update approvals.steps set status = case when p_approve then 'approved' else 'rejected' end,
    decided_by = auth.uid(), decided_at = now(), comment = p_comment
    where request_id = p_req and step_no = r.current_step;
  select count(*) into total from approvals.steps where request_id = p_req;
  if not p_approve then res := 'rejected';
  elsif r.current_step >= total then res := 'approved';
  else res := 'pending'; end if;
  update approvals.requests set status = res, current_step = case when res = 'pending' then current_step + 1 else current_step end where id = p_req;
  perform audit.log('approval.decide', 'request', p_req::text, jsonb_build_object('approve', p_approve, 'step', r.current_step, 'result', res));
  return res;
end $$;

-- ---------- Document numbering ----------
create table docs.counters (div text, proj text, doc_type text, seq int not null default 0, primary key (div, proj, doc_type));
create function docs.next_no(p_div text, p_proj text, p_type text, p_rev int default 0) returns text
language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  if p_div not in ('ENG','AMG','COR') then raise exception 'Unknown division %', p_div; end if;
  if p_proj !~ '^(P[0-9]{3}|CORP)$' then raise exception 'Project code must look like P014 or CORP'; end if;
  if p_type not in ('RPT','DWG','LTR','CTR','VAR','QTN','PO','INV','MIN','POL','FRM','CRT','PHO','OTH') then raise exception 'Unknown document type %', p_type; end if;
  insert into docs.counters (div, proj, doc_type, seq) values (p_div, p_proj, p_type, 1)
    on conflict (div, proj, doc_type) do update set seq = docs.counters.seq + 1 returning seq into n;
  return format('DRN-%s-%s-%s-%s-R%s', p_div, p_proj, p_type, lpad(n::text, 4, '0'), lpad(p_rev::text, 2, '0'));
end $$;

-- ---------- Effective-dated statutory rates (never hard-coded) ----------
create table payroll.rate_tables (
  id uuid primary key default gen_random_uuid(), kind text not null, effective daterange not null,
  bands jsonb not null, source_note text, verified_by uuid, verified_at timestamptz,
  exclude using gist (kind with =, effective with &&));
create function payroll.paye(p_gross numeric, p_on date) returns numeric language plpgsql stable set search_path = '' as $$
declare t payroll.rate_tables; b jsonb; tax numeric := 0; lo numeric; hi numeric; rate numeric;
begin
  select * into t from payroll.rate_tables where kind = 'paye_resident_monthly' and effective @> p_on;
  if t.id is null then raise exception 'No PAYE table covers %', p_on; end if;
  if t.verified_at is null then raise exception 'The PAYE table for % has not been verified by the Finance Manager.', p_on; end if;
  for b in select * from jsonb_array_elements(t.bands) loop
    lo := (b ->> 'from')::numeric; hi := coalesce((b ->> 'to')::numeric, 1e15); rate := (b ->> 'rate')::numeric;
    if p_gross > lo then tax := tax + rate * (least(p_gross, hi) - lo); end if;
  end loop;
  return round(tax);
end $$;

-- ---------- Stuck-work detector: a request nobody can currently decide ----------
create function approvals.orphaned() returns table (request_id uuid, kind text, step_no int)
language sql stable security definer set search_path = '' as $$
  select r.id, r.kind, r.current_step from approvals.requests r
  where r.status = 'pending'
    and not exists (select 1 from org.people p where p.status = 'active' and approvals.eligible(p.id, r.id, r.current_step));
$$;

-- ---------- Attendance retention: export, verify checksum, then purge ----------
create table hr.attendance_events (
  id bigint generated always as identity primary key, person_id uuid not null references org.people(id),
  kind text not null check (kind in ('login','logout','timeout')), at timestamptz not null default now());
create table hr.attendance_exports (
  id uuid primary key default gen_random_uuid(), cutoff timestamptz not null, row_count bigint not null, sha256 text not null,
  created_by uuid, created_at timestamptz not null default now(), confirmed_by uuid, confirmed_at timestamptz, purged_at timestamptz);
alter table hr.attendance_events enable row level security;
alter table hr.attendance_exports enable row level security;
create policy att_read on hr.attendance_events for select to authenticated using ((select rbac.can('attendance.read')));

create function hr.export_attendance(p_cutoff timestamptz) returns table (export_id uuid, csv text, sha256 text, row_count bigint)
language plpgsql security definer set search_path = '' as $$
declare body text; h text; n bigint; eid uuid;
begin
  if not rbac.can('attendance.export') then raise exception 'You cannot export attendance.'; end if;
  select coalesce(string_agg(format('%s,%s,%s,%s', a.id, a.person_id, a.kind, to_char(a.at at time zone 'utc','YYYY-MM-DD"T"HH24:MI:SS"Z"')), E'\n' order by a.id), ''), count(*)
    into body, n from hr.attendance_events a where a.at < p_cutoff;
  body := 'id,person_id,kind,at_utc' || E'\n' || body;
  h := encode(sha256(convert_to(body, 'utf8')), 'hex');
  insert into hr.attendance_exports (cutoff, row_count, sha256, created_by) values (p_cutoff, n, h, auth.uid()) returning id into eid;
  perform audit.log('attendance.export', 'export', eid::text, jsonb_build_object('rows', n, 'sha256', h));
  return query select eid, body, h, n;
end $$;
create function hr.confirm_export(p_export uuid, p_sha256_of_downloaded_file text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare ok boolean;
begin
  if not rbac.can('attendance.export') then raise exception 'You cannot confirm exports.'; end if;
  update hr.attendance_exports set confirmed_by = auth.uid(), confirmed_at = now()
    where id = p_export and sha256 = lower(p_sha256_of_downloaded_file) and purged_at is null returning true into ok;
  perform audit.log('attendance.confirm', 'export', p_export::text, jsonb_build_object('matched', coalesce(ok, false)));
  return coalesce(ok, false);
end $$;
create function hr.purge_attendance(p_export uuid) returns bigint
language plpgsql security definer set search_path = '' as $$
declare e hr.attendance_exports; n bigint;
begin
  if not rbac.can('attendance.export') then raise exception 'You cannot purge attendance.'; end if;
  select * into e from hr.attendance_exports where id = p_export for update;
  if e.id is null or e.confirmed_at is null then raise exception 'Confirm the downloaded file first. Nothing was deleted.'; end if;
  if e.purged_at is not null then raise exception 'This export was already purged.'; end if;
  delete from hr.attendance_events where at < e.cutoff;
  get diagnostics n = row_count;
  update hr.attendance_exports set purged_at = now() where id = p_export;
  perform audit.log('attendance.purge', 'export', p_export::text, jsonb_build_object('rows_deleted', n));   -- counts only, never the data
  return n;
end $$;

-- ---------- Offline field reports: idempotent by client-generated id ----------
create table hr.field_reports (
  client_id uuid primary key, person_id uuid not null references org.people(id), project text not null,
  body jsonb not null, captured_at timestamptz not null, synced_at timestamptz not null default now());
create function hr.sync_field_report(p_client uuid, p_project text, p_body jsonb, p_captured timestamptz) returns text
language plpgsql security definer set search_path = '' as $$
begin
  insert into hr.field_reports (client_id, person_id, project, body, captured_at) values (p_client, auth.uid(), p_project, p_body, p_captured)
    on conflict (client_id) do nothing;
  return case when found then 'created' else 'duplicate' end;
end $$;

-- ---------- Second wall: RLS on every table, deny by default ----------
alter table org.divisions enable row level security;
alter table org.people enable row level security;
alter table rbac.roles enable row level security;
alter table rbac.role_perms enable row level security;
alter table rbac.sensitive_perms enable row level security;
alter table rbac.assignments enable row level security;
alter table rbac.grants enable row level security;
alter table rbac.effective enable row level security;
alter table approvals.delegations enable row level security;
alter table approvals.requests enable row level security;
alter table approvals.steps enable row level security;
alter table fin.settings enable row level security;
alter table docs.counters enable row level security;
alter table payroll.rate_tables enable row level security;
alter table hr.field_reports enable row level security;
-- Reference data anyone signed in may read; people visible to themselves and to people managers.
create policy divisions_read on org.divisions for select to authenticated using (true);
create policy people_read on org.people for select to authenticated
  using (id = (select auth.uid()) or (select rbac.can('people.read')));
create policy requests_read on approvals.requests for select to authenticated
  using (requester = (select auth.uid()) or (select rbac.can('approvals.read.all')));
create policy rates_read on payroll.rate_tables for select to authenticated using ((select rbac.can('payroll.read')));
create policy field_reports_read on hr.field_reports for select to authenticated
  using (person_id = (select auth.uid()) or (select rbac.can('fieldreports.read.all')));
-- Everything else (rbac.*, approvals.steps, docs.counters, fin.settings) has no policy: only SECURITY DEFINER functions touch it.

-- Build gate: list any table in our schemas that has RLS switched off.
create function audit.tables_without_rls() returns table (schema_name text, table_name text)
language sql stable as $$
  select schemaname::text, tablename::text from pg_tables
  where schemaname in ('org','rbac','hr','fin','approvals','audit','docs','payroll','work','notifications','api','public') and not rowsecurity;
$$;

-- Integration boundary. Original prototype helpers are private, not public APIs.
create schema api;
create schema work;
create schema notifications;
alter table org.people add column principal text not null default 'staff'
  check (principal in ('staff','client','contractor','auditor','it_admin'));
alter table org.people add column expires_at timestamptz;
alter table approvals.delegations add constraint positive_cover check (expires_at > starts_at);
alter table fin.settings add constraint positive_scale check (spend_scale > 0);
alter table approvals.requests add constraint positive_amount check (amount_ugx is null or amount_ugx >= 0);
create index assignments_person on rbac.assignments(person_id, division);
create index grants_person on rbac.grants(person_id, perm);
create index leave_scope on hr.leave_requests(division, person_id);
create index pay_scope on hr.pay(division, person_id);
create index requests_scope on approvals.requests(division, requester, created_at desc);
create index field_owner on hr.field_reports(person_id);
create index attendance_person_time on hr.attendance_events(person_id, at);

create function rbac.active(p uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from org.people where id=p and status='active' and (expires_at is null or expires_at>now()));
$$;
-- Read current assignments rather than relying on a stale materialised permission copy.
-- Role changes, future start dates, moves and expiry therefore take effect immediately.
create function rbac.permissions(p uuid) returns table(perm text, scope text, division text)
language sql stable security definer set search_path='' as $$
 select rp.perm,rp.scope,a.division from rbac.assignments a join rbac.role_perms rp on rp.role_code=a.role_code
 where a.person_id=p and rbac.active(p) and a.valid_from<=current_date and (a.valid_to is null or a.valid_to>=current_date)
 union select g.perm,g.scope,g.division from rbac.grants g where g.person_id=p and rbac.active(p) and (g.expires_at is null or g.expires_at>now());
$$;
create or replace function rbac.person_can(p uuid,p_perm text,p_division text default null,p_owner uuid default null)
returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from rbac.permissions(p) e where e.perm=p_perm and
 (e.scope='all' or (e.scope='division' and e.division=p_division) or (e.scope='own' and p_owner=p)));
$$;
create function rbac.divisions_for(p_perm text) returns text[] language sql stable security definer set search_path='' as $$
 select coalesce(array_agg(distinct d.code),'{}') from org.divisions d join rbac.permissions(auth.uid()) e
 on e.perm=p_perm and (e.scope='all' or (e.scope='division' and e.division=d.code));
$$;
create function rbac.has_own(p_perm text) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from rbac.permissions(auth.uid()) where perm=p_perm and scope='own');
$$;
create function rbac.member(p_div text) returns boolean language sql stable security definer set search_path='' as $$
 select rbac.active(auth.uid()) and exists(select 1 from rbac.assignments a where a.person_id=auth.uid()
 and a.division=p_div and a.valid_from<=current_date and (a.valid_to is null or a.valid_to>=current_date));
$$;
drop policy leave_read on hr.leave_requests;
create policy leave_read on hr.leave_requests for select to authenticated using
 (division=any(((select rbac.divisions_for('leave.read'))::text[])) or (person_id=(select auth.uid()) and (select rbac.has_own('leave.read'))));
drop policy pay_read on hr.pay;
create policy pay_read on hr.pay for select to authenticated using
 (division=any(((select rbac.divisions_for('pay.read'))::text[])) or (person_id=(select auth.uid()) and (select rbac.has_own('pay.read'))));
drop policy leave_insert on hr.leave_requests;
-- Requests are created only through the validated, audited RPC below.
drop policy people_read on org.people;
create policy people_read on org.people for select to authenticated using
 ((select rbac.active(auth.uid())) and (id=(select auth.uid()) or (select rbac.can('people.read'))));

-- Close the prototype's inactive-manager and delegated-inactive-user gaps.
alter function approvals.eligible(uuid,uuid,int) rename to eligible_unchecked;
create function approvals.eligible(p_person uuid,p_req uuid,p_step int) returns boolean
language sql stable security definer set search_path='' as $$
 select rbac.active(p_person) and approvals.eligible_unchecked(p_person,p_req,p_step);
$$;
alter function approvals.decide(uuid,boolean,text) rename to decide_unchecked;
create function approvals.decide(p_req uuid,p_approve boolean,p_comment text default null) returns text
language plpgsql security definer set search_path='' as $$
begin
 if p_approve is null or (not p_approve and nullif(btrim(p_comment),'') is null) then raise exception 'Tell the requester what to change.'; end if;
 if not rbac.active(auth.uid()) then raise exception 'Your profile is not active.'; end if;
 return approvals.decide_unchecked(p_req,p_approve,p_comment);
end $$;

create table work.projects (
 code text primary key check(code ~ '^P[0-9]{3}$'), division text not null references org.divisions,
 title text not null, budget_ugx bigint not null default 0 check(budget_ugx>=0), actual_ugx bigint not null default 0 check(actual_ugx>=0),
 progress int not null default 0 check(progress between 0 and 100), published boolean not null default false,
 payment_recorded_at timestamptz, created_by uuid not null references org.people, created_at timestamptz not null default now(), deleted_at timestamptz);
create table work.project_members(project text references work.projects, person_id uuid references org.people, primary key(project,person_id));
create index project_member_person on work.project_members(person_id,project);
create index project_division on work.projects(division);
create function rbac.projects_for() returns text[] language sql stable security definer set search_path='' as $$
 select coalesce(array_agg(p.code),'{}') from work.projects p where rbac.active(auth.uid()) and p.deleted_at is null and (
 p.division=any(rbac.divisions_for('projects.read')) or (exists(select 1 from work.project_members m where m.project=p.code and m.person_id=auth.uid())
 and (not exists(select 1 from org.people where id=auth.uid() and principal='client') or (p.published and p.payment_recorded_at is not null))));
$$;
alter table work.projects enable row level security;
alter table work.project_members enable row level security;
create policy project_read on work.projects for select to authenticated using(code=any(((select rbac.projects_for())::text[])));

create table docs.files (
 id uuid primary key default gen_random_uuid(), division text not null references org.divisions, project text references work.projects,
 doc_no text not null unique, title text not null, object_key text unique, sha256 text check(sha256 ~ '^[0-9a-f]{64}$'),
 revision int not null default 0 check(revision>=0), status text not null default 'draft' check(status in ('draft','in_review','released','superseded','withdrawn')),
 excerpt text check(octet_length(excerpt)<=4096), created_by uuid not null references org.people, created_at timestamptz not null default now(), deleted_at timestamptz);
create index files_scope on docs.files(division,project);
alter table docs.files enable row level security;
create policy files_read on docs.files for select to authenticated using(deleted_at is null and
 (division=any(((select rbac.divisions_for('documents.read'))::text[])) or (status='released' and project=any(((select rbac.projects_for())::text[])))));
create table rbac.consents (
 id uuid primary key default gen_random_uuid(), document_id uuid not null references docs.files,
 person_id uuid not null references org.people, perm text not null, scope text not null, division text,
 approved_by uuid not null references org.people, expires_at timestamptz not null, used_at timestamptz);
alter table rbac.consents enable row level security;
create or replace function rbac.grant_perm(p_person uuid,p_perm text,p_scope text,p_division text,p_consent uuid,p_expires timestamptz)
returns uuid language plpgsql security definer set search_path='' as $$
declare gid uuid;
begin
 if not rbac.can('rbac.grant') then raise exception 'You are not allowed to grant access.'; end if;
 if p_expires is null or p_expires<=now() then raise exception 'Access needs a future expiry.'; end if;
 if not exists(select 1 from rbac.role_perms where perm=p_perm) then raise exception 'Unknown permission.'; end if;
 -- All grants, not just a mutable sensitive-permission list, need a bound Director consent.
 update rbac.consents c set used_at=now() where c.id=p_consent and c.person_id=p_person and c.perm=p_perm
 and c.scope=p_scope and c.division is not distinct from p_division and c.expires_at>=p_expires and c.used_at is null
 and rbac.person_can(c.approved_by,'consent.approve')
 and exists(select 1 from docs.files f where f.id=c.document_id and f.status='released' and f.object_key is not null and f.sha256 is not null);
 if not found then raise exception 'A matching, unused Director consent document is required.'; end if;
 insert into rbac.grants(person_id,perm,scope,division,granted_by,consent_doc_id,expires_at)
 values(p_person,p_perm,p_scope,p_division,auth.uid(),p_consent,p_expires) returning id into gid;
 perform audit.log('rbac.grant','person',p_person::text,jsonb_build_object('permission',p_perm,'consent',p_consent)); return gid;
end $$;

create table work.records (
 id uuid primary key default gen_random_uuid(), module text not null, division text not null references org.divisions,
 title text not null check(length(title) between 1 and 200), data jsonb not null default '{}',
 status text not null default 'active' check(status in ('active','inactive')), expires_on date,
 created_by uuid not null references org.people, created_at timestamptz not null default now(), deleted_at timestamptz);
create index records_scope on work.records(module,division,created_by,created_at desc);
alter table work.records enable row level security;
create policy records_read on work.records for select to authenticated using(deleted_at is null and (select rbac.active(auth.uid())) and
 (created_by=(select auth.uid()) or division=any(((select rbac.divisions_for('records.read'))::text[]))));
create table notifications.outbox (
 id bigint generated always as identity primary key, person_id uuid not null references org.people, request_id uuid references approvals.requests,
 event text not null, available_at timestamptz not null default now(), sent_at timestamptz, attempts int not null default 0);
create index outbox_due on notifications.outbox(available_at) where sent_at is null;
alter table notifications.outbox enable row level security;

create function work.submit(p_kind text,p_division text,p_amount bigint,p_payload jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare rid uuid;
begin
 if not rbac.member(p_division) or not exists(select 1 from org.people where id=auth.uid() and principal='staff') then raise exception 'Choose your assigned division.'; end if;
 if p_kind not in ('leave','expense','requisition','booking','site-visit') or p_kind is null then raise exception 'Unknown request type.'; end if;
 if p_payload is null or jsonb_typeof(p_payload)<>'object' or octet_length(p_payload::text)>16384 or nullif(btrim(p_payload->>'title'),'') is null then raise exception 'A title and valid request details are required.'; end if;
 if p_kind in ('expense','requisition') and (p_amount is null or p_amount<=0) then raise exception 'Enter an amount above zero.'; end if;
 if p_kind='leave' and ((p_payload->>'starts') is null or (p_payload->>'ends') is null or (p_payload->>'ends')::date < (p_payload->>'starts')::date) then raise exception 'Choose valid leave dates.'; end if;
 rid:=approvals.submit(p_kind,p_division,p_amount,p_payload);
 insert into notifications.outbox(person_id,request_id,event) select p.id,rid,'approval.waiting' from org.people p where approvals.eligible(p.id,rid,1);
 return rid;
end $$;
create function work.decide(p_id uuid,p_approve boolean,p_comment text) returns text
language plpgsql security definer set search_path='' as $$
declare result text; r approvals.requests;
begin
 result:=approvals.decide(p_id,p_approve,p_comment);
 select * into r from approvals.requests where id=p_id;
 insert into notifications.outbox(person_id,request_id,event) values(r.requester,p_id,'approval.'||result);
 if result='pending' then insert into notifications.outbox(person_id,request_id,event) select p.id,p_id,'approval.waiting' from org.people p where approvals.eligible(p.id,p_id,r.current_step); end if;
 return result;
end $$;
create or replace function hr.sync_field_report(p_client uuid,p_project text,p_body jsonb,p_captured timestamptz) returns text
language plpgsql security definer set search_path='' as $$
declare previous hr.field_reports;
begin
 if not rbac.active(auth.uid()) or not p_project=any(rbac.projects_for()) or not exists(select 1 from org.people where id=auth.uid() and principal in ('staff','contractor')) then raise exception 'You cannot submit reports to this project.'; end if;
 if p_body is null or jsonb_typeof(p_body)<>'object' or octet_length(p_body::text)>65536 or p_captured is null then raise exception 'Invalid report.'; end if;
 insert into hr.field_reports(client_id,person_id,project,body,captured_at) values(p_client,auth.uid(),p_project,p_body,p_captured) on conflict(client_id) do nothing;
 if found then perform audit.log('field.created','report',p_client::text); return 'created'; end if;
 select * into previous from hr.field_reports where client_id=p_client;
 if previous.person_id<>auth.uid() or previous.project<>p_project or previous.body<>p_body or previous.captured_at<>p_captured then raise exception 'This report identifier already has different content. Your local copy was kept.'; end if;
 return 'duplicate';
end $$;

-- Attendance purge snapshots exact row IDs: later backdated arrivals must survive.
alter table hr.attendance_exports add column row_ids bigint[];
alter function hr.export_attendance(timestamptz) rename to export_attendance_unchecked;
create function hr.export_attendance(p_cutoff timestamptz) returns table(export_id uuid,csv text,sha256 text,row_count bigint)
language plpgsql security definer set search_path='' as $$
declare e record;
begin
 if p_cutoff>now()-interval '12 months' then raise exception 'Keep at least twelve months of attendance.'; end if;
 lock table hr.attendance_events in share mode;
 select * into e from hr.export_attendance_unchecked(p_cutoff);
 update hr.attendance_exports set row_ids=(select coalesce(array_agg(id),'{}') from hr.attendance_events where at<p_cutoff) where id=e.export_id;
 return query select e.export_id,e.csv,e.sha256,e.row_count;
end $$;
create or replace function hr.purge_attendance(p_export uuid) returns bigint language plpgsql security definer set search_path='' as $$
declare e hr.attendance_exports; n bigint;
begin
 if not rbac.can('attendance.export') then raise exception 'You cannot purge attendance.'; end if;
 select * into e from hr.attendance_exports where id=p_export for update;
 if e.id is null or e.confirmed_at is null or e.row_ids is null then raise exception 'Confirm the downloaded file first. Nothing was deleted.'; end if;
 if e.purged_at is not null then raise exception 'This export was already purged.'; end if;
 delete from hr.attendance_events where id=any(e.row_ids);
 get diagnostics n=row_count;
 update hr.attendance_exports set purged_at=now() where id=p_export;
 perform audit.log('attendance.purge','export',p_export::text,jsonb_build_object('rows_deleted',n)); return n;
end $$;

-- Narrow invoker API wrappers. All privileged logic stays in unexposed schemas.
create function api.submit_request(p_kind text,p_division text,p_amount bigint,p_payload jsonb) returns uuid
language sql security invoker set search_path='' as $$ select work.submit(p_kind,p_division,p_amount,p_payload) $$;
create function api.decide_request(p_id uuid,p_approve boolean,p_comment text default null) returns text
language sql security invoker set search_path='' as $$ select work.decide(p_id,p_approve,p_comment) $$;
create function api.sync_field_report(p_client uuid,p_project text,p_body jsonb,p_captured timestamptz) returns text
language sql security invoker set search_path='' as $$ select hr.sync_field_report(p_client,p_project,p_body,p_captured) $$;
create view api.projects with(security_invoker=true) as select code,division,title,budget_ugx,actual_ugx,progress from work.projects;
create view api.documents with(security_invoker=true) as select id,division,project,doc_no,title,revision,status,created_at from docs.files;
create view api.people with(security_invoker=true) as select id,full_name,status,principal from org.people;
create view api.records with(security_invoker=true) as select id,module,division,title,data,status,expires_on,created_by,created_at from work.records;
create function work.profile() returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('id',p.id,'name',p.full_name,'principal',p.principal,
 'permissions',(select coalesce(jsonb_agg(distinct perm),'[]') from rbac.permissions(p.id)),
 'divisions',(select coalesce(jsonb_agg(distinct a.division),'[]') from rbac.assignments a where a.person_id=p.id and a.valid_from<=current_date and (a.valid_to is null or a.valid_to>=current_date)))
 from org.people p where p.id=auth.uid() and rbac.active(p.id);
$$;
create function api.profile() returns jsonb language sql stable security invoker set search_path='' as $$ select work.profile() $$;
create function work.inbox(p_offset int default 0) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not rbac.active(auth.uid()) then raise exception 'Your profile is not active.'; end if;
 return (select coalesce(jsonb_agg(to_jsonb(t)),'[]') from (
 select r.id,r.kind,r.division,r.requester,p.full_name as requester_name,r.amount_ugx,r.payload,r.status,r.current_step,r.created_at,
 (select count(*) from approvals.steps s where s.request_id=r.id) as steps,
 approvals.eligible(auth.uid(),r.id,r.current_step) and r.status='pending' as can_decide,
 (select coalesce(string_agg(n.full_name,', '),'Nobody currently available') from org.people n where approvals.eligible(n.id,r.id,r.current_step)) as waiting_on
 from approvals.requests r join org.people p on p.id=r.requester
 where r.requester=auth.uid() or approvals.eligible(auth.uid(),r.id,r.current_step) or r.division=any(rbac.divisions_for('approvals.read'))
 order by r.created_at desc limit 50 offset greatest(0,least(p_offset,100000))) t);
end $$;
create function api.inbox(p_offset int default 0) returns jsonb language sql stable security invoker set search_path='' as $$ select work.inbox(p_offset) $$;
create function work.create_record(p_module text,p_division text,p_title text,p_data jsonb,p_expires date default null) returns uuid
language plpgsql security definer set search_path='' as $$
declare rid uuid;
begin
 if not rbac.active(auth.uid()) then raise exception 'Sign in with an active profile.'; end if;
 if p_module not in ('helpdesk','certifications','assets','suppliers','benefits','recruitment','checklists','portfolio') then raise exception 'Unknown register.'; end if;
 if p_module<>'helpdesk' and not rbac.can('records.create',p_division) then raise exception 'You cannot add to this register.'; end if;
 if p_module='helpdesk' and not rbac.member(p_division) then raise exception 'Choose your assigned division.'; end if;
 if p_data is null or jsonb_typeof(p_data)<>'object' or octet_length(p_data::text)>16384 then raise exception 'Invalid details.'; end if;
 insert into work.records(module,division,title,data,expires_on,created_by) values(p_module,p_division,btrim(p_title),p_data,p_expires,auth.uid()) returning id into rid;
 perform audit.log('record.created',p_module,rid::text); return rid;
end $$;
create function api.create_record(p_module text,p_division text,p_title text,p_data jsonb,p_expires date default null) returns uuid
language sql security invoker set search_path='' as $$ select work.create_record(p_module,p_division,p_title,p_data,p_expires) $$;
create function work.file_key(p_file uuid) returns text language sql stable security invoker set search_path='' as $$
 select object_key from docs.files where id=p_file;
$$;
create function api.file_key(p_file uuid) returns text language sql stable security invoker set search_path='' as $$ select work.file_key(p_file) $$;

-- Preserve operations RPCs without exposing public as an API schema.
create function api.record_heartbeat(p_kind text) returns void language sql security invoker set search_path='' as $$ select public.record_heartbeat(p_kind) $$;
create function api.record_meter(p_kind text,p_value numeric,p_capacity numeric) returns void language sql security invoker set search_path='' as $$ select public.record_meter(p_kind,p_value,p_capacity) $$;
create function api.record_database_meter(p_capacity numeric) returns void language sql security invoker set search_path='' as $$ select public.record_database_meter(p_capacity) $$;
create function api.infrastructure_health() returns jsonb language sql stable security invoker set search_path='' as $$ select public.infrastructure_health() $$;

-- Reference permission bundles only. Production contains no example users or rate tables.
insert into rbac.roles values ('central_director','Central Director'),('director_eng','Engineering Director'),('staff','Staff'),('finance_manager','Finance Manager'),('finance_officer','Finance Officer'),('it_admin','IT Administrator'),('client','Client'),('contractor','Contractor'),('auditor','Auditor');
insert into rbac.role_perms values
 ('central_director','projects.read','all'),('central_director','documents.read','all'),('central_director','people.read','all'),('central_director','approvals.read','all'),('central_director','view.combined','all'),
 ('central_director','leave.read','all'),('central_director','leave.approve','all'),('central_director','expense.approve.central','all'),('central_director','expense.depthead','all'),('central_director','generic.approve','all'),
 ('central_director','records.read','all'),('central_director','records.create','all'),('central_director','audit.read','all'),('central_director','consent.approve','all'),('central_director','rbac.grant','all'),
 ('director_eng','projects.read','division'),('director_eng','documents.read','division'),('director_eng','approvals.read','division'),('director_eng','leave.read','division'),('director_eng','leave.approve','division'),('director_eng','expense.depthead','division'),
 ('staff','leave.read','own'),('finance_manager','pay.read','all'),('finance_manager','payroll.read','all'),('finance_manager','expense.approve.fm','all'),('finance_manager','records.read','all'),('finance_manager','records.create','all'),
 ('finance_officer','expense.review','all'),('it_admin','rbac.grant','all'),('it_admin','attendance.export','all'),('it_admin','ops.read','all');

-- Default deny; expose only the wrappers and the exact dependencies they need.
do $$ declare s text; t record; begin
 foreach s in array array['org','rbac','hr','fin','approvals','audit','docs','payroll','work','notifications','api'] loop
  execute format('revoke all on schema %I from public,anon,authenticated',s);
  execute format('revoke all on all functions in schema %I from public,anon,authenticated',s);
  execute format('revoke all on all tables in schema %I from public,anon,authenticated',s);
  execute format('alter default privileges in schema %I revoke execute on functions from public,anon,authenticated',s);
  for t in select tablename from pg_tables where schemaname=s loop execute format('alter table %I.%I force row level security',s,t.tablename); end loop;
 end loop;
end $$;
grant usage on schema api,work,org,rbac,docs,hr to authenticated;
grant select on work.projects,work.records,org.people,docs.files to authenticated;
grant select on api.projects,api.documents,api.people,api.records to authenticated;
grant execute on function rbac.active(uuid),rbac.can(text,text,uuid),rbac.divisions_for(text),rbac.has_own(text),rbac.projects_for() to authenticated;
grant execute on function work.profile(),work.inbox(int),work.submit(text,text,bigint,jsonb),work.decide(uuid,boolean,text),work.create_record(text,text,text,jsonb,date),work.file_key(uuid),hr.sync_field_report(uuid,text,jsonb,timestamptz) to authenticated;
grant execute on function api.profile(),api.inbox(int),api.submit_request(text,text,bigint,jsonb),api.decide_request(uuid,boolean,text),api.create_record(text,text,text,jsonb,date),api.file_key(uuid),api.sync_field_report(uuid,text,jsonb,timestamptz) to authenticated;
grant usage on schema api to service_role;
grant execute on function api.record_heartbeat(text),api.record_meter(text,numeric,numeric),api.record_database_meter(numeric),api.infrastructure_health() to service_role;
alter table org.people add column time_zone text not null default 'Africa/Kampala';
alter table notifications.outbox add column lease uuid;
alter table notifications.outbox add column lease_until timestamptz;
create function notifications.claim() returns table(id bigint,lease uuid,email text,time_zone text,request_id uuid)
language sql security definer set search_path='' as $$
 with candidates as (select o.id from notifications.outbox o join org.people p on p.id=o.person_id
 where o.sent_at is null and o.available_at<=now() and (o.lease_until is null or o.lease_until<now()) and p.status='active'
 and (p.expires_at is null or p.expires_at>now()) order by o.id limit 20 for update of o skip locked),
 claimed as (update notifications.outbox o set lease=gen_random_uuid(),lease_until=now()+interval '5 minutes',attempts=attempts+1
 from candidates c where o.id=c.id returning o.*)
 select c.id,c.lease,p.email,p.time_zone,c.request_id from claimed c join org.people p on p.id=c.person_id;
$$;
create function notifications.finish(p_id bigint,p_lease uuid,p_sent boolean,p_next timestamptz) returns void
language sql security definer set search_path='' as $$
 update notifications.outbox set sent_at=case when p_sent then now() else null end,available_at=greatest(now()+interval '1 minute',coalesce(p_next,now()+interval '15 minutes')),lease=null,lease_until=null
 where id=p_id and lease=p_lease and lease_until>now();
$$;
create function api.claim_notifications() returns table(id bigint,lease uuid,email text,time_zone text,request_id uuid)
language sql security invoker set search_path='' as $$ select * from notifications.claim() $$;
create function api.finish_notification(p_id bigint,p_lease uuid,p_sent boolean,p_next timestamptz default null) returns void
language sql security invoker set search_path='' as $$ select notifications.finish(p_id,p_lease,p_sent,p_next) $$;
revoke all on function notifications.claim(),notifications.finish(bigint,uuid,boolean,timestamptz),api.claim_notifications(),api.finish_notification(bigint,uuid,boolean,timestamptz) from public,anon,authenticated;
grant usage on schema notifications to service_role;
grant execute on function notifications.claim(),notifications.finish(bigint,uuid,boolean,timestamptz),api.claim_notifications(),api.finish_notification(bigint,uuid,boolean,timestamptz) to service_role;
create function work.health() returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not rbac.can('ops.read') then raise exception 'You cannot read operations health.'; end if;
 return public.infrastructure_health();
end $$;
create function api.health() returns jsonb language sql stable security invoker set search_path='' as $$ select work.health() $$;
revoke all on function work.health(),api.health() from public,anon;
grant execute on function work.health(),api.health() to authenticated;
commit;
