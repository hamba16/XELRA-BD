-- XELRA core spine prototype. Runs on Supabase Postgres and on PGlite (for CI).
create extension if not exists btree_gist;

-- ---------- Supabase shims (only used in the local/CI harness) ----------
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;
create schema if not exists auth;
create or replace function auth.jwt() returns jsonb language sql stable as
  $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
create or replace function auth.uid() returns uuid language sql stable as
  $$ select nullif(auth.jwt() ->> 'sub', '')::uuid $$;

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
returns text language sql immutable as $$
  select encode(sha256(convert_to(concat_ws('|', prev,
    to_char(at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.US'), coalesce(actor::text,''), action,
    coalesce(entity,''), coalesce(entity_id,''), detail::text), 'utf8')), 'hex');
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
  where schemaname in ('org','rbac','hr','fin','approvals','audit','docs','payroll','public') and not rowsecurity;
$$;
