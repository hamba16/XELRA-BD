begin;
-- Reviewers must be able to inspect exactly the period currently awaiting them.
-- This grants no general payroll visibility and never grants it to IT.
create function payroll.visible_periods() returns uuid[] language sql stable security definer set search_path='' as $$
 select coalesce(array_agg(p.id),'{}') from payroll.periods p where rbac.active(auth.uid()) and
 (p.division=any(rbac.divisions_for('payroll.read')) or exists(select 1 from approvals.requests r where r.id=p.request_id and approvals.eligible(auth.uid(),r.id,r.current_step)));
$$;
drop policy payroll_period_read on payroll.periods;
create policy payroll_period_read on payroll.periods for select to authenticated using(id=any(((select payroll.visible_periods())::uuid[])));
drop policy payroll_lines_read on payroll.lines;
create policy payroll_lines_read on payroll.lines for select to authenticated using(period_id=any(((select payroll.visible_periods())::uuid[])));
create or replace function payroll.workspace() returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not rbac.active(auth.uid()) then raise exception 'Your profile is not active.'; end if;
 return jsonb_build_object('periods',coalesce((select jsonb_agg(to_jsonb(p) order by starts desc) from payroll.periods p where id=any(payroll.visible_periods())),'[]'),
 'lines',coalesce((select jsonb_agg(to_jsonb(l)||jsonb_build_object('variance_ugx',net_ugx-expected_net_ugx)) from payroll.lines l where period_id=any(payroll.visible_periods())),'[]'),
 'payslips',coalesce((select jsonb_agg(jsonb_build_object('id',l.id,'period',p.title,'gross_ugx',l.gross_ugx,'paye_ugx',l.paye_ugx,'other_deductions_ugx',l.other_deductions_ugx,'net_ugx',l.net_ugx,'shadow',true)) from payroll.lines l join payroll.periods p on p.id=l.period_id where p.status='locked' and l.person_id=auth.uid()),'[]'));
end $$;
grant execute on function payroll.visible_periods() to authenticated;

-- A requester cannot change a financial draft's project by guessing another code.
alter function fin.save_record(text,text,text,jsonb,text,uuid,uuid,date,uuid,integer) rename to save_record_core;
revoke all on function fin.save_record_core(text,text,text,jsonb,text,uuid,uuid,date,uuid,integer) from public,anon,authenticated,service_role;
create function fin.save_record(p_kind text,p_division text,p_title text,p_lines jsonb,p_project text default null,p_supplier uuid default null,p_document uuid default null,p_due date default null,p_id uuid default null,p_version int default 0) returns uuid
language plpgsql security definer set search_path='' as $$
begin
 if p_project is not null and not p_project=any(rbac.projects_for()) and not rbac.can('finance.manage',p_division) then raise exception 'Choose a project you can access.'; end if;
 return fin.save_record_core(p_kind,p_division,p_title,p_lines,p_project,p_supplier,p_document,p_due,p_id,p_version);
end $$;
-- SQL-language wrappers bind at call time in this repository, but recreate this
-- dependency explicitly so the newly guarded entry point is unambiguous.
create or replace function api.save_financial_record(p_kind text,p_division text,p_title text,p_lines jsonb,p_project text default null,p_supplier uuid default null,p_document uuid default null,p_due date default null,p_id uuid default null,p_version int default 0) returns uuid language sql security invoker set search_path='' as $$ select fin.save_record(p_kind,p_division,p_title,p_lines,p_project,p_supplier,p_document,p_due,p_id,p_version) $$;
grant execute on function fin.save_record(text,text,text,jsonb,text,uuid,uuid,date,uuid,integer) to authenticated;

-- Custody and record history use the same authorisation boundary as the record.
create or replace function work.record_detail(p_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not work.record_allowed(p_id) then raise exception 'This record is not available to you.'; end if;
 return jsonb_build_object('record',(select to_jsonb(r) from work.records r where id=p_id),
 'custody',coalesce((select jsonb_agg(to_jsonb(c) order by assigned_at desc) from work.asset_custody c where asset_id=p_id),'[]'),
 'timeline',coalesce((select jsonb_agg(jsonb_build_object('at',at,'action',action,'detail',detail) order by seq) from audit.events where entity_id=p_id::text and (action like 'record.%' or action like 'asset.%')),'[]'));
end $$;

-- Support calendars contain no assumed working week or institutional holidays.
create table work.support_calendars(
 division text primary key references org.divisions,calendar jsonb not null check(jsonb_typeof(calendar)='object' and octet_length(calendar::text)<=16384),
 created_by uuid not null references org.people,created_at timestamptz not null default now());
alter table work.support_calendars enable row level security;
alter table work.support_calendars force row level security;
create policy support_calendar_read on work.support_calendars for select to authenticated using((select rbac.active(auth.uid())));
create function work.set_support_calendar(p_division text,p_calendar jsonb) returns text language plpgsql security definer set search_path='' as $$
declare day_entry record; slot jsonb; prev_end int; start_min int; end_min int; holiday text;
begin
 if not rbac.can('helpdesk.manage',p_division) then raise exception 'You cannot configure support calendars.'; end if;
 if p_calendar is null or jsonb_typeof(p_calendar->'weekdays') is distinct from 'object' or jsonb_typeof(p_calendar->'holidays') is distinct from 'array'
 or (p_calendar->>'workingDayMinutes') is null or (p_calendar->>'workingDayMinutes')::int not between 1 and 1440
 or not exists(select 1 from pg_timezone_names where name=p_calendar->>'timeZone') then raise exception 'Provide a timezone, working windows, holidays and working-day minutes.'; end if;
 for day_entry in select * from jsonb_each(p_calendar->'weekdays') loop
 if day_entry.key !~ '^[0-6]$' or jsonb_typeof(day_entry.value)<>'array' then raise exception 'Invalid working weekday.'; end if;
 prev_end:=-1;
 for slot in select * from jsonb_array_elements(day_entry.value) loop
 if jsonb_typeof(slot)<>'array' or jsonb_array_length(slot)<>2 then raise exception 'Each working window needs start and end minutes.'; end if;
 start_min:=(slot->>0)::int; end_min:=(slot->>1)::int;
 if start_min is null or end_min is null or start_min<0 or end_min>1440 or start_min>=end_min or start_min<prev_end then raise exception 'Working windows must be ordered and non-overlapping.'; end if;
 prev_end:=end_min;
 end loop; end loop;
 for holiday in select jsonb_array_elements_text(p_calendar->'holidays') loop
 if holiday !~ '^\d{4}-\d{2}-\d{2}$' or holiday::date is null then raise exception 'Use YYYY-MM-DD holiday dates.'; end if;
 end loop;
 insert into work.support_calendars(division,calendar,created_by) values(p_division,p_calendar,auth.uid()) on conflict(division) do update set calendar=excluded.calendar,created_by=excluded.created_by,created_at=now();
 perform audit.log('support.calendar','division',p_division); return 'saved';
end $$;
alter function work.ticket_detail(uuid) rename to ticket_detail_core;
revoke all on function work.ticket_detail_core(uuid) from public,anon,authenticated,service_role;
create function work.ticket_detail(p_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare detail jsonb;
begin
 detail:=work.ticket_detail_core(p_id);
 return detail||jsonb_build_object('calendar',(select calendar from work.support_calendars where division=detail->'ticket'->>'division'));
end $$;
create or replace function api.ticket_detail(p_id uuid) returns jsonb language sql stable security invoker set search_path='' as $$ select work.ticket_detail(p_id) $$;
create function api.set_support_calendar(p_division text,p_calendar jsonb) returns text language sql security invoker set search_path='' as $$ select work.set_support_calendar(p_division,p_calendar) $$;
grant execute on function work.ticket_detail(uuid),work.set_support_calendar(text,jsonb),api.set_support_calendar(text,jsonb) to authenticated;

-- Exact read models: no cash estimate appears without a statement balance.
create function work.dashboard() returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not rbac.active(auth.uid()) then raise exception 'Your profile is not active.'; end if;
 return jsonb_build_object('cash_position',null,'cash_state','No opening statement balance is configured',
 'projects',coalesce((select jsonb_agg(jsonb_build_object('code',code,'progress',progress,'budget_ugx',budget_ugx,'actual_ugx',actual_ugx,
 'health',case when budget_ugx=0 then 'unavailable' when actual_ugx::numeric/budget_ugx*100<=progress+5 then 'green' when actual_ugx::numeric/budget_ugx*100<=progress+15 then 'amber' else 'red' end)) from work.projects where deleted_at is null and division=any(rbac.divisions_for('projects.read'))),'[]'),
 'headcount',case when rbac.can('people.read') then coalesce((select jsonb_agg(to_jsonb(h)) from (select a.division,a.role_code,count(distinct a.person_id) as people from rbac.assignments a join org.people p on p.id=a.person_id
 where p.principal='staff' and rbac.active(p.id) and a.valid_from<=current_date and (a.valid_to is null or a.valid_to>=current_date) group by a.division,a.role_code)h),'[]') else '[]'::jsonb end,
 'pending_on_me',(select count(*) from approvals.requests r where approvals.eligible(auth.uid(),r.id,r.current_step)),
 'my_open_checklists',(select count(*) from work.checklist_runs where owner_id=auth.uid() and status='open' and deleted_at is null));
end $$;
create function api.dashboard() returns jsonb language sql stable security invoker set search_path='' as $$ select work.dashboard() $$;
grant execute on function work.dashboard(),api.dashboard() to authenticated;

-- Qualify aggregate entries separately from the PL/pgSQL loop variable.
create or replace function hr.save_timesheet(p_division text,p_starts date,p_ends date,p_lines jsonb,p_id uuid default null,p_version int default 0) returns uuid
language plpgsql security definer set search_path='' as $$
declare item jsonb; rid uuid; t hr.timesheets;
begin
 if not rbac.member(p_division) or not exists(select 1 from org.people where id=auth.uid() and principal='staff') then raise exception 'Choose your assigned division.'; end if;
 if p_lines is null or jsonb_typeof(p_lines)<>'array' or jsonb_array_length(p_lines) not between 1 and 100 then raise exception 'Provide between 1 and 100 dated work lines.'; end if;
 for item in select * from jsonb_array_elements(p_lines) loop
 if (item->>'date') is null or (item->>'date')::date not between p_starts and p_ends or jsonb_typeof(item->'hours') is distinct from 'number' or (item->>'hours')::numeric<=0 or (item->>'hours')::numeric>24
 or length(btrim(coalesce(item->>'description',''))) not between 1 and 500 then raise exception 'Work lines need a date in this period, 0 to 24 hours and a description.'; end if;
 if item->>'project' is not null and not (item->>'project')=any(rbac.projects_for()) then raise exception 'Choose a project you can access.'; end if;
 end loop;
 if exists(select 1 from jsonb_array_elements(p_lines) entry group by (entry->>'date')::date having sum((entry->>'hours')::numeric)>24) then raise exception 'A day cannot contain more than 24 recorded hours.'; end if;
 if p_id is null then
 insert into hr.timesheets(person_id,division,starts,ends,lines,created_by) values(auth.uid(),p_division,p_starts,p_ends,p_lines,auth.uid()) returning id into rid;
 else
 select * into t from hr.timesheets where id=p_id for update;
 if t.id is null or t.person_id<>auth.uid() or t.status<>'draft' or t.version is distinct from p_version then raise exception 'This timesheet changed or is not editable.'; end if;
 update hr.timesheets set starts=p_starts,ends=p_ends,lines=p_lines,version=version+1 where id=p_id; rid:=p_id;
 end if;
 perform audit.log('timesheet.saved','timesheet',rid::text); return rid;
end $$;
-- Local revocation is checked on every protected API call. It does not pretend
-- to delete provider sessions: old or undated JWTs fail until a fresh token exists.
create table rbac.session_revocations(person_id uuid primary key references org.people,revoked_before timestamptz not null,
 created_by uuid not null references org.people,created_at timestamptz not null default now());
alter table rbac.session_revocations enable row level security;
alter table rbac.session_revocations force row level security;
create policy session_revocations_read on rbac.session_revocations for select to authenticated using((select rbac.can('ops.read')));
create or replace function rbac.active(p uuid) returns boolean language plpgsql stable security definer set search_path='' as $$
declare cutoff timestamptz; claims jsonb; issued numeric;
begin
 if not exists(select 1 from org.people where id=p and status='active' and (expires_at is null or expires_at>now())) then return false; end if;
 if p=auth.uid() then
 select revoked_before into cutoff from rbac.session_revocations where person_id=p;
 if cutoff is not null then
 begin
 claims:=nullif(current_setting('request.jwt.claims',true),'')::jsonb; issued:=(claims->>'iat')::numeric;
 if issued is null or issued<extract(epoch from cutoff) then return false; end if;
 exception when others then return false;
 end;
 end if;
 end if;
 return true;
end $$;
create function work.revoke_profile_sessions(p_person uuid,p_reason text) returns text language plpgsql security definer set search_path='' as $$
begin
 if not rbac.can('ops.read') or p_person=auth.uid() then raise exception 'You cannot revoke this profile''s sessions.'; end if;
 if length(btrim(coalesce(p_reason,''))) not between 1 and 2000 then raise exception 'Record a reason for revoking sessions.'; end if;
 insert into rbac.session_revocations(person_id,revoked_before,created_by) values(p_person,clock_timestamp(),auth.uid())
 on conflict(person_id) do update set revoked_before=excluded.revoked_before,created_by=excluded.created_by,created_at=now();
 perform audit.log('security.sessions_revoked','person',p_person::text,jsonb_build_object('reason',p_reason)); return 'revoked';
end $$;
create function api.revoke_profile_sessions(p_person uuid,p_reason text) returns text language sql security invoker set search_path='' as $$ select work.revoke_profile_sessions(p_person,p_reason) $$;
grant execute on function work.revoke_profile_sessions(uuid,text),api.revoke_profile_sessions(uuid,text) to authenticated;

insert into rbac.role_perms values ('central_director','audit.finding.approve','all'),('director_eng','audit.finding.approve','division') on conflict do nothing;
create table work.audit_findings(
 id uuid primary key default gen_random_uuid(),project text not null references work.projects,division text not null references org.divisions,
 title text not null check(length(btrim(title)) between 1 and 200),body text not null check(length(btrim(body)) between 1 and 8000),
 request_id uuid not null unique references approvals.requests,created_by uuid not null references org.people,created_at timestamptz not null default now(),deleted_at timestamptz);
create index audit_findings_scope on work.audit_findings(project,division,created_by);
alter table work.audit_findings enable row level security;
alter table work.audit_findings force row level security;
create policy audit_findings_read on work.audit_findings for select to authenticated using(deleted_at is null and (select rbac.active(auth.uid())) and
 (division=any(((select rbac.divisions_for('audit.finding.approve'))::text[])) or
 (project=any(((select rbac.projects_for())::text[])) and (select exists(select 1 from org.people where id=auth.uid() and principal='auditor')))));
create function work.submit_audit_finding(p_project text,p_title text,p_body text) returns uuid language plpgsql security definer set search_path='' as $$
declare p work.projects; rid uuid; finding uuid:=gen_random_uuid();
begin
 if not rbac.active(auth.uid()) or not exists(select 1 from org.people where id=auth.uid() and principal='auditor') or not p_project=any(rbac.projects_for()) then raise exception 'An active auditor seat assigned to this project is required.'; end if;
 select * into p from work.projects where code=p_project;
 insert into approvals.requests(kind,division,requester,payload) values('audit-finding',p.division,auth.uid(),jsonb_build_object('title',p_title,'finding_id',finding,'project',p_project)) returning id into rid;
 insert into approvals.steps(request_id,step_no,step_type,perm) values(rid,1,'perm','audit.finding.approve');
 insert into work.audit_findings(id,project,division,title,body,request_id,created_by) values(finding,p_project,p.division,btrim(p_title),btrim(p_body),rid,auth.uid());
 perform audit.log('audit.finding_submitted','finding',finding::text,jsonb_build_object('request',rid,'seat',auth.uid()));
 insert into notifications.outbox(person_id,request_id,event) select pe.id,rid,'approval.waiting' from org.people pe where approvals.eligible(pe.id,rid,1);
 return finding;
end $$;
create function work.audit_finding_page(p_project text) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare p work.projects;
begin
 select * into p from work.projects where code=p_project;
 if p.code is null or not rbac.active(auth.uid()) or not (rbac.can('audit.finding.approve',p.division) or
 (p_project=any(rbac.projects_for()) and exists(select 1 from org.people where id=auth.uid() and principal='auditor'))) then raise exception 'These findings are not available to you.'; end if;
 return coalesce((select jsonb_agg(to_jsonb(f)) from (select f.id,f.title,f.body,f.created_at,pe.full_name as seat_holder,
 upper(left(pe.full_name,1)||left(split_part(pe.full_name,' ',2),1)) as initials,r.status as approval_status
 from work.audit_findings f join org.people pe on pe.id=f.created_by join approvals.requests r on r.id=f.request_id
 where f.project=p_project and f.deleted_at is null order by f.created_at desc limit 100)f),'[]');
end $$;
create function api.submit_audit_finding(p_project text,p_title text,p_body text) returns uuid language sql security invoker set search_path='' as $$ select work.submit_audit_finding(p_project,p_title,p_body) $$;
create function api.audit_finding_page(p_project text) returns jsonb language sql stable security invoker set search_path='' as $$ select work.audit_finding_page(p_project) $$;
grant select on work.audit_findings to authenticated;
grant execute on function work.submit_audit_finding(text,text,text),work.audit_finding_page(text),api.submit_audit_finding(text,text,text),api.audit_finding_page(text) to authenticated;

-- Withdrawn revision numbers are never reused.
create or replace function work.create_document_revision(p_id uuid,p_title text default null,p_excerpt text default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare f docs.files; rid uuid; dno text; next_revision int;
begin
 select * into f from docs.files where id=p_id for update;
 if not rbac.active(auth.uid()) or f.id is null or not rbac.can('documents.manage',f.division) then raise exception 'You cannot create revisions for this document.'; end if;
 if f.status<>'released' then raise exception 'Only released documents can receive revisions.'; end if;
 if p_title is not null and length(btrim(p_title)) not between 1 and 200 then raise exception 'Document titles must contain 1 to 200 characters.'; end if;
 if p_excerpt is not null and octet_length(p_excerpt)>4096 then raise exception 'The document excerpt is limited to 4 KB.'; end if;
 select coalesce(max(revision),f.revision)+1 into next_revision from docs.files where regexp_replace(doc_no,'-R[0-9]+$','')=regexp_replace(f.doc_no,'-R[0-9]+$','');
 dno:=regexp_replace(f.doc_no,'-R[0-9]+$','-R'||lpad(next_revision::text,2,'0'));
 insert into docs.files(division,project,doc_no,title,revision,excerpt,created_by,supersedes)
 values(f.division,f.project,dno,coalesce(p_title,f.title),next_revision,coalesce(p_excerpt,f.excerpt),auth.uid(),f.id) returning id into rid;
 perform audit.log('document.revision','document',rid::text,jsonb_build_object('source',f.id,'doc_no',dno)); return rid;
end $$;

commit;
