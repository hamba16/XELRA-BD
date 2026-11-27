begin;
insert into rbac.roles values('hr_lead','HR Lead') on conflict do nothing;
insert into rbac.role_perms values
 ('hr_lead','people.read','all'),('hr_lead','people.manage','all'),('hr_lead','hr.read','all'),('hr_lead','hr.manage','all'),
 ('hr_lead','leave.approve','all'),('hr_lead','checklists.manage','all'),
 ('central_director','hr.read','all'),('central_director','hr.manage','all'),
 ('central_director','registers.manage','all'),('finance_manager','suppliers.manage','all'),
 ('staff','hr.read','own'),('staff','checklists.read','own') on conflict do nothing;

-- Contracts are effective dated factual records, without invented pay/benefits rules.
create table hr.contracts(
 id uuid primary key default gen_random_uuid(),person_id uuid not null references org.people,division text not null references org.divisions,
 title text not null check(length(btrim(title)) between 1 and 200),starts date not null,ends date check(ends>=starts),
 document_id uuid references docs.files,created_by uuid not null references org.people,created_at timestamptz not null default now(),deleted_at timestamptz,
 exclude using gist(person_id with =,daterange(starts,ends,'[]') with &&) where(deleted_at is null));
create index contracts_scope on hr.contracts(division,person_id);
alter table hr.contracts enable row level security;
alter table hr.contracts force row level security;
create policy contracts_read on hr.contracts for select to authenticated using(deleted_at is null and
 (division=any(((select rbac.divisions_for('hr.read'))::text[])) or (person_id=(select auth.uid()) and (select rbac.has_own('hr.read')))));
create function hr.add_contract(p_person uuid,p_division text,p_title text,p_starts date,p_ends date default null,p_document uuid default null) returns uuid
language plpgsql security definer set search_path='' as $$
declare rid uuid;
begin
 if not rbac.can('hr.manage',p_division) then raise exception 'You cannot manage employee contracts.'; end if;
 if not exists(select 1 from org.people where id=p_person and principal='staff') then raise exception 'Choose a staff profile.'; end if;
 if p_document is not null then perform work.document_detail(p_document); end if;
 insert into hr.contracts(person_id,division,title,starts,ends,document_id,created_by)
 values(p_person,p_division,btrim(p_title),p_starts,p_ends,p_document,auth.uid()) returning id into rid;
 perform audit.log('employee.contract','person',p_person::text,jsonb_build_object('contract',rid,'starts',p_starts,'ends',p_ends)); return rid;
end $$;
create function hr.change_person_status(p_person uuid,p_status text,p_reason text) returns text
language plpgsql security definer set search_path='' as $$
declare prior text;
begin
 if not rbac.can('people.manage') or p_person=auth.uid() then raise exception 'You cannot change this profile.'; end if;
 if p_status is null or p_status not in ('active','suspended','offboarded') or length(btrim(coalesce(p_reason,''))) not between 1 and 2000 then raise exception 'A valid status and reason are required.'; end if;
 select status into prior from org.people where id=p_person and principal='staff' for update;
 if prior is null or prior='offboarded' then raise exception 'This staff profile is not available for status changes.'; end if;
 update org.people set status=p_status where id=p_person;
 perform audit.log('employee.status','person',p_person::text,jsonb_build_object('from',prior,'to',p_status,'reason',p_reason)); return p_status;
end $$;

-- Balance adjustments are explicit signed units. No accrual, carry-over or holiday
-- policy is inferred. A request debit references its approved request exactly once.
create table hr.leave_entries(
 id uuid primary key default gen_random_uuid(),person_id uuid not null references org.people,division text not null references org.divisions,
 kind text not null check(length(kind) between 1 and 80),units numeric(9,2) not null check(units<>0),
 reason text not null check(length(btrim(reason)) between 1 and 2000),request_id uuid unique references approvals.requests,
 created_by uuid not null references org.people,created_at timestamptz not null default now());
create index leave_entries_scope on hr.leave_entries(person_id,division,kind);
alter table hr.leave_entries enable row level security;
alter table hr.leave_entries force row level security;
create policy leave_entries_read on hr.leave_entries for select to authenticated using
 (division=any(((select rbac.divisions_for('hr.read'))::text[])) or (person_id=(select auth.uid()) and (select rbac.has_own('hr.read'))));
create function hr.adjust_leave(p_person uuid,p_division text,p_kind text,p_units numeric,p_reason text,p_request uuid default null) returns uuid
language plpgsql security definer set search_path='' as $$
declare rid uuid;
begin
 if not rbac.can('hr.manage',p_division) then raise exception 'You cannot adjust leave balances.'; end if;
 if not exists(select 1 from org.people where id=p_person and principal='staff') then raise exception 'Choose a staff profile.'; end if;
 if p_units is null or p_units=0 or p_units<>round(p_units,2) then raise exception 'Use a nonzero adjustment with at most two decimal places.'; end if;
 if p_request is not null and (p_units>=0 or not exists(select 1 from approvals.requests where id=p_request and kind='leave' and requester=p_person and division=p_division and status='approved')) then raise exception 'A debit requires this employee''s approved leave request.'; end if;
 insert into hr.leave_entries(person_id,division,kind,units,reason,request_id,created_by) values(p_person,p_division,btrim(p_kind),p_units,btrim(p_reason),p_request,auth.uid()) returning id into rid;
 perform audit.log('leave.adjusted','person',p_person::text,jsonb_build_object('entry',rid,'units',p_units,'request',p_request)); return rid;
end $$;

alter table hr.attendance_events add column client_id uuid unique;
create function hr.capture_attendance(p_client uuid,p_event text) returns bigint language plpgsql security definer set search_path='' as $$
declare rid bigint; previous hr.attendance_events;
begin
 if not rbac.active(auth.uid()) or not exists(select 1 from org.people where id=auth.uid() and principal='staff') then raise exception 'An active staff profile is required.'; end if;
 if p_client is null or p_event is null or p_event not in ('login','logout') then raise exception 'Choose a login or logout event.'; end if;
 insert into hr.attendance_events(person_id,kind,at,client_id) values(auth.uid(),p_event,now(),p_client) on conflict(client_id) do nothing returning id into rid;
 if rid is null then
 select * into previous from hr.attendance_events where client_id=p_client;
 if previous.person_id<>auth.uid() or previous.kind<>p_event then raise exception 'This event identifier already has different content.'; end if;
 return previous.id;
 end if;
 return rid;
end $$;
create function hr.people_workspace(p_person uuid default null) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare target uuid:=coalesce(p_person,auth.uid());
begin
 if not rbac.active(auth.uid()) or (target<>auth.uid() and not rbac.can('hr.read')) then raise exception 'This employee record is not available.'; end if;
 return jsonb_build_object('person',(select jsonb_build_object('id',id,'full_name',full_name,'principal',principal,'status',status) from org.people where id=target),
 'contracts',coalesce((select jsonb_agg(to_jsonb(c) order by starts desc) from hr.contracts c where person_id=target and deleted_at is null),'[]'),
 'balances',coalesce((select jsonb_agg(to_jsonb(b)) from (select kind,sum(units) as units from hr.leave_entries where person_id=target group by kind)b),'[]'),
 'leave_history',coalesce((select jsonb_agg(to_jsonb(e) order by created_at desc) from hr.leave_entries e where person_id=target),'[]'),
 'leave_calendar',coalesce((select jsonb_agg(jsonb_build_object('id',id,'starts',payload->>'starts','ends',payload->>'ends','status',status,'title',payload->>'title') order by created_at desc)
 from approvals.requests where kind='leave' and requester=target and status in ('pending','approved')),'[]'),
 'attendance',coalesce((select jsonb_agg(to_jsonb(a)) from (select id,kind,at from hr.attendance_events where person_id=target order by at desc limit 100)a),'[]'));
end $$;

-- Extend the existing register instead of introducing a competing record system.
alter table work.records add column owner_id uuid references org.people;
alter table work.records add column project text references work.projects;
alter table work.records add column version int not null default 1;
alter table work.records add column related_id uuid references work.records;
create index records_owner on work.records(owner_id,module);
create index records_project on work.records(project);
create index records_related on work.records(related_id);
create function work.register_permission(p_module text) returns text language sql immutable set search_path='' as $$
 select case when p_module in ('benefits','recruitment','appraisals','contracts') then 'hr.manage'
 when p_module='suppliers' then 'suppliers.manage' else 'registers.manage' end;
$$;
-- New sensitive modules are never exposed through the old broad records.read bundle.
drop policy records_read on work.records;
create policy records_read on work.records for select to authenticated using(deleted_at is null and (select rbac.active(auth.uid())) and
 ((module in ('benefits','recruitment','appraisals','contracts') and division=any(((select rbac.divisions_for('hr.manage'))::text[])))
 or (module='suppliers' and (division=any(((select rbac.divisions_for('suppliers.manage'))::text[])) or division=any(((select rbac.divisions_for('registers.manage'))::text[]))))
 or (module not in ('benefits','recruitment','appraisals','contracts','suppliers') and (created_by=(select auth.uid()) or division=any(((select rbac.divisions_for('records.read'))::text[]))))));
create or replace function work.create_record(p_module text,p_division text,p_title text,p_data jsonb,p_expires date default null) returns uuid
language plpgsql security definer set search_path='' as $$
declare rid uuid;
begin
 if not rbac.active(auth.uid()) then raise exception 'Sign in with an active profile.'; end if;
 if p_module is null or p_module not in ('helpdesk','certifications','assets','suppliers','benefits','recruitment','checklists','portfolio','contracts','appraisals') then raise exception 'Unknown register.'; end if;
 if p_module='helpdesk' then
 return work.create_ticket(p_title,coalesce(nullif(p_data->>'description',''),p_title),coalesce(nullif(p_data->>'category',''),'General'),'{}');
 end if;
 if not rbac.can(work.register_permission(p_module),p_division) then raise exception 'You cannot add to this register.'; end if;
 if p_data is null or jsonb_typeof(p_data)<>'object' or octet_length(p_data::text)>16384 then raise exception 'Invalid details.'; end if;
 insert into work.records(module,division,title,data,expires_on,created_by,owner_id)
 values(p_module,p_division,btrim(p_title),p_data,p_expires,auth.uid(),auth.uid()) returning id into rid;
 perform audit.log('record.created',p_module,rid::text); return rid;
end $$;
create function work.record_allowed(p_id uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from work.records r where id=p_id and deleted_at is null and rbac.active(auth.uid()) and
 (rbac.can(work.register_permission(r.module),r.division) or (r.module not in ('benefits','recruitment','appraisals','contracts','suppliers') and r.created_by=auth.uid())));
$$;
create function work.register_page(p_module text,p_search text default '',p_offset int default 0) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if p_offset is null or p_offset not between 0 and 100000 or length(coalesce(p_search,''))>200 then raise exception 'Invalid register search.'; end if;
 return coalesce((select jsonb_agg(to_jsonb(r)) from (select id,module,division,title,status,expires_on,owner_id,version,data from work.records
 where module=p_module and deleted_at is null and division=any(rbac.divisions_for(work.register_permission(p_module)))
 and (coalesce(p_search,'')='' or strpos(lower(title),lower(p_search))>0) order by created_at desc,id limit 50 offset p_offset)r),'[]');
end $$;
create function work.update_record(p_id uuid,p_version int,p_title text,p_data jsonb,p_status text,p_expires date default null,p_owner uuid default null,p_delete boolean default false) returns int
language plpgsql security definer set search_path='' as $$
declare r work.records;
begin
 select * into r from work.records where id=p_id for update;
 if r.id is null or r.deleted_at is not null or not rbac.can(work.register_permission(r.module),r.division) then raise exception 'You cannot manage this register.'; end if;
 if r.version is distinct from p_version then raise exception 'This record changed. Refresh before saving.'; end if;
 if p_data is null or jsonb_typeof(p_data)<>'object' or octet_length(p_data::text)>16384 then raise exception 'Invalid details.'; end if;
 if p_owner is not null and not rbac.active(p_owner) then raise exception 'Choose an active owner.'; end if;
 update work.records set title=btrim(p_title),data=p_data,status=p_status,expires_on=p_expires,owner_id=p_owner,version=version+1,
 deleted_at=case when p_delete then now() end where id=p_id;
 perform audit.log(case when p_delete then 'record.tombstoned' else 'record.updated' end,r.module,r.id::text,
 jsonb_build_object('from_status',r.status,'to_status',p_status,'expires_on',p_expires,'owner',p_owner,'version',r.version+1)); return r.version+1;
end $$;
create function work.record_detail(p_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not work.record_allowed(p_id) then raise exception 'This record is not available to you.'; end if;
 return jsonb_build_object('record',(select to_jsonb(r) from work.records r where id=p_id),'timeline',
 coalesce((select jsonb_agg(jsonb_build_object('at',at,'action',action,'detail',detail) order by seq) from audit.events where entity_id=p_id::text and action like 'record.%'),'[]'));
end $$;

create table work.asset_custody(
 id uuid primary key default gen_random_uuid(),asset_id uuid not null references work.records,person_id uuid not null references org.people,
 division text not null references org.divisions,assigned_at timestamptz not null default now(),returned_at timestamptz,
 return_note text check(length(return_note)<=2000),created_by uuid not null references org.people,created_at timestamptz not null default now());
create unique index asset_current_custody on work.asset_custody(asset_id) where returned_at is null;
create index asset_custody_scope on work.asset_custody(division,person_id);
alter table work.asset_custody enable row level security;
alter table work.asset_custody force row level security;
create policy asset_custody_read on work.asset_custody for select to authenticated using
 (division=any(((select rbac.divisions_for('registers.manage'))::text[])) or ((select rbac.active(auth.uid())) and person_id=(select auth.uid())));
create function work.assign_asset(p_asset uuid,p_person uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare a work.records; rid uuid;
begin
 select * into a from work.records where id=p_asset and module='assets' and status='active' and deleted_at is null for update;
 if a.id is null or not rbac.can('registers.manage',a.division) or not rbac.active(p_person) then raise exception 'Choose an available asset and active custodian.'; end if;
 insert into work.asset_custody(asset_id,person_id,division,created_by) values(p_asset,p_person,a.division,auth.uid()) returning id into rid;
 perform audit.log('asset.assigned','assets',p_asset::text,jsonb_build_object('custody',rid,'person',p_person)); return rid;
end $$;
create function work.return_asset(p_id uuid,p_note text) returns text language plpgsql security definer set search_path='' as $$
declare c work.asset_custody;
begin
 select * into c from work.asset_custody where id=p_id for update;
 if c.id is null or c.returned_at is not null or not rbac.can('registers.manage',c.division) then raise exception 'You cannot return this assignment.'; end if;
 update work.asset_custody set returned_at=now(),return_note=p_note where id=p_id;
 perform audit.log('asset.returned','assets',c.asset_id::text,jsonb_build_object('custody',c.id,'note',p_note)); return 'returned';
end $$;

-- Templates contain user-authored tasks. No institutional checklist is invented.
create table work.checklist_templates(
 id uuid primary key default gen_random_uuid(),division text not null references org.divisions,title text not null check(length(btrim(title)) between 1 and 200),
 kind text not null check(kind in ('onboarding','offboarding','staff-audit','site-incident','quality','appraisal','project','asset')),
 items jsonb not null,created_by uuid not null references org.people,created_at timestamptz not null default now(),deleted_at timestamptz);
create index checklist_templates_scope on work.checklist_templates(division,kind);
alter table work.checklist_templates enable row level security;
alter table work.checklist_templates force row level security;
create policy checklist_template_read on work.checklist_templates for select to authenticated using(deleted_at is null and division=any(((select rbac.divisions_for('checklists.manage'))::text[])));
create table work.checklist_runs(
 id uuid primary key default gen_random_uuid(),template_id uuid not null references work.checklist_templates,division text not null references org.divisions,
 title text not null,items jsonb not null,owner_id uuid not null references org.people,subject text not null check(length(subject) between 1 and 200),
 due_on date,status text not null default 'open' check(status in ('open','completed','cancelled')),version int not null default 1,
 created_by uuid not null references org.people,created_at timestamptz not null default now(),deleted_at timestamptz);
create index checklist_runs_scope on work.checklist_runs(division,owner_id,status);
alter table work.checklist_runs enable row level security;
alter table work.checklist_runs force row level security;
create policy checklist_run_read on work.checklist_runs for select to authenticated using(deleted_at is null and (select rbac.active(auth.uid())) and
 (owner_id=(select auth.uid()) or division=any(((select rbac.divisions_for('checklists.manage'))::text[]))));
create function work.create_checklist_template(p_division text,p_title text,p_kind text,p_items jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare rid uuid; item jsonb;
begin
 if not rbac.can('checklists.manage',p_division) then raise exception 'You cannot manage checklist templates.'; end if;
 if p_items is null or jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items) not between 1 and 100 or octet_length(p_items::text)>32768 then raise exception 'Provide between 1 and 100 checklist tasks.'; end if;
 for item in select * from jsonb_array_elements(p_items) loop
 if jsonb_typeof(item)<>'string' or length(btrim(item#>>'{}')) not between 1 and 300 then raise exception 'Each task needs 1 to 300 characters.'; end if;
 end loop;
 insert into work.checklist_templates(division,title,kind,items,created_by) values(p_division,btrim(p_title),p_kind,p_items,auth.uid()) returning id into rid;
 perform audit.log('checklist.template','checklist',rid::text); return rid;
end $$;
create function work.start_checklist(p_template uuid,p_owner uuid,p_subject text,p_due date default null) returns uuid
language plpgsql security definer set search_path='' as $$
declare t work.checklist_templates; rid uuid;
begin
 select * into t from work.checklist_templates where id=p_template and deleted_at is null;
 if t.id is null or not rbac.can('checklists.manage',t.division) or not rbac.active(p_owner) then raise exception 'Choose an available template and active owner.'; end if;
 insert into work.checklist_runs(template_id,division,title,items,owner_id,subject,due_on,created_by)
 values(t.id,t.division,t.title,(select jsonb_agg(jsonb_build_object('title',value#>>'{}','done',false)) from jsonb_array_elements(t.items)),p_owner,btrim(p_subject),p_due,auth.uid()) returning id into rid;
 perform audit.log('checklist.started','checklist',rid::text,jsonb_build_object('template',t.id,'owner',p_owner)); return rid;
end $$;
create function work.check_checklist_item(p_id uuid,p_version int,p_index int,p_done boolean,p_evidence uuid default null) returns int
language plpgsql security definer set search_path='' as $$
declare r work.checklist_runs; item jsonb;
begin
 select * into r from work.checklist_runs where id=p_id for update;
 if not rbac.active(auth.uid()) or r.id is null or (r.owner_id<>auth.uid() and not rbac.can('checklists.manage',r.division)) then raise exception 'This checklist is not available to you.'; end if;
 if p_version is distinct from r.version or r.status<>'open' then raise exception 'This checklist changed or is complete. Refresh before saving.'; end if;
 if p_index is null or p_index<0 or p_index>=jsonb_array_length(r.items) or p_done is null then raise exception 'Choose a checklist task.'; end if;
 if p_evidence is not null then perform work.document_detail(p_evidence); end if;
 item:=(r.items->p_index)||jsonb_build_object('done',p_done,'at',now(),'by',auth.uid(),'evidence',p_evidence);
 update work.checklist_runs set items=jsonb_set(items,array[p_index::text],item),version=version+1 where id=p_id;
 perform audit.log('checklist.item','checklist',p_id::text,jsonb_build_object('index',p_index,'done',p_done,'evidence',p_evidence)); return r.version+1;
end $$;
create function work.complete_checklist(p_id uuid,p_version int) returns text language plpgsql security definer set search_path='' as $$
declare r work.checklist_runs;
begin
 select * into r from work.checklist_runs where id=p_id for update;
 if not rbac.active(auth.uid()) or r.id is null or (r.owner_id<>auth.uid() and not rbac.can('checklists.manage',r.division)) then raise exception 'This checklist is not available to you.'; end if;
 if r.status<>'open' or r.version is distinct from p_version or exists(select 1 from jsonb_array_elements(r.items) i where not (i->>'done')::boolean) then raise exception 'Finish every task and refresh before completing this checklist.'; end if;
 update work.checklist_runs set status='completed',version=version+1 where id=p_id;
 perform audit.log('checklist.completed','checklist',p_id::text); return 'completed';
end $$;
create function work.checklist_workspace() returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not rbac.active(auth.uid()) then raise exception 'Your profile is not active.'; end if;
 return jsonb_build_object('templates',coalesce((select jsonb_agg(to_jsonb(t)) from work.checklist_templates t where deleted_at is null and division=any(rbac.divisions_for('checklists.manage'))),'[]'),
 'runs',coalesce((select jsonb_agg(to_jsonb(r)) from (select * from work.checklist_runs where deleted_at is null and (owner_id=auth.uid() or division=any(rbac.divisions_for('checklists.manage'))) order by created_at desc limit 100)r),'[]'));
end $$;

create function api.add_contract(p_person uuid,p_division text,p_title text,p_starts date,p_ends date default null,p_document uuid default null) returns uuid language sql security invoker set search_path='' as $$ select hr.add_contract(p_person,p_division,p_title,p_starts,p_ends,p_document) $$;
create function api.change_person_status(p_person uuid,p_status text,p_reason text) returns text language sql security invoker set search_path='' as $$ select hr.change_person_status(p_person,p_status,p_reason) $$;
create function api.adjust_leave(p_person uuid,p_division text,p_kind text,p_units numeric,p_reason text,p_request uuid default null) returns uuid language sql security invoker set search_path='' as $$ select hr.adjust_leave(p_person,p_division,p_kind,p_units,p_reason,p_request) $$;
create function api.capture_attendance(p_client uuid,p_event text) returns bigint language sql security invoker set search_path='' as $$ select hr.capture_attendance(p_client,p_event) $$;
create function api.people_workspace(p_person uuid default null) returns jsonb language sql stable security invoker set search_path='' as $$ select hr.people_workspace(p_person) $$;
create function api.register_page(p_module text,p_search text default '',p_offset int default 0) returns jsonb language sql stable security invoker set search_path='' as $$ select work.register_page(p_module,p_search,p_offset) $$;
create function api.update_record(p_id uuid,p_version int,p_title text,p_data jsonb,p_status text,p_expires date default null,p_owner uuid default null,p_delete boolean default false) returns int language sql security invoker set search_path='' as $$ select work.update_record(p_id,p_version,p_title,p_data,p_status,p_expires,p_owner,p_delete) $$;
create function api.record_detail(p_id uuid) returns jsonb language sql stable security invoker set search_path='' as $$ select work.record_detail(p_id) $$;
create function api.assign_asset(p_asset uuid,p_person uuid) returns uuid language sql security invoker set search_path='' as $$ select work.assign_asset(p_asset,p_person) $$;
create function api.return_asset(p_id uuid,p_note text) returns text language sql security invoker set search_path='' as $$ select work.return_asset(p_id,p_note) $$;
create function api.create_checklist_template(p_division text,p_title text,p_kind text,p_items jsonb) returns uuid language sql security invoker set search_path='' as $$ select work.create_checklist_template(p_division,p_title,p_kind,p_items) $$;
create function api.start_checklist(p_template uuid,p_owner uuid,p_subject text,p_due date default null) returns uuid language sql security invoker set search_path='' as $$ select work.start_checklist(p_template,p_owner,p_subject,p_due) $$;
create function api.check_checklist_item(p_id uuid,p_version int,p_index int,p_done boolean,p_evidence uuid default null) returns int language sql security invoker set search_path='' as $$ select work.check_checklist_item(p_id,p_version,p_index,p_done,p_evidence) $$;
create function api.complete_checklist(p_id uuid,p_version int) returns text language sql security invoker set search_path='' as $$ select work.complete_checklist(p_id,p_version) $$;
create function api.checklist_workspace() returns jsonb language sql stable security invoker set search_path='' as $$ select work.checklist_workspace() $$;
do $$ declare sig text; begin
 foreach sig in array array['add_contract(uuid,text,text,date,date,uuid)','change_person_status(uuid,text,text)','adjust_leave(uuid,text,text,numeric,text,uuid)','capture_attendance(uuid,text)','people_workspace(uuid)'] loop
 execute 'revoke all on function hr.'||sig||',api.'||sig||' from public,anon,service_role';
 execute 'grant execute on function hr.'||sig||',api.'||sig||' to authenticated'; end loop;
 foreach sig in array array['register_page(text,text,integer)','update_record(uuid,integer,text,jsonb,text,date,uuid,boolean)','record_detail(uuid)','assign_asset(uuid,uuid)','return_asset(uuid,text)',
 'create_checklist_template(text,text,text,jsonb)','start_checklist(uuid,uuid,text,date)','check_checklist_item(uuid,integer,integer,boolean,uuid)','complete_checklist(uuid,integer)','checklist_workspace()'] loop
 execute 'revoke all on function work.'||sig||',api.'||sig||' from public,anon,service_role';
 execute 'grant execute on function work.'||sig||',api.'||sig||' to authenticated'; end loop;
end $$;
grant select on hr.contracts,hr.leave_entries,work.asset_custody,work.checklist_templates,work.checklist_runs to authenticated;
commit;
