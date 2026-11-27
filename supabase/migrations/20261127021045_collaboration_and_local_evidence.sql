begin;
-- API list flags come from the same current database permissions as detail actions.
create or replace view api.documents with(security_invoker=true) as
 select id,division,project,doc_no,title,revision,status,created_at,
 (rbac.active(auth.uid()) and (created_by=auth.uid() or rbac.can('documents.manage',division))) as can_manage,
 rbac.can('documents.release',division) as can_release,(object_key is not null and sha256 is not null) as has_file from docs.files;
create or replace view api.projects with(security_invoker=true) as
 select code,division,title,
 case when division=any(rbac.divisions_for('projects.read')) then budget_ugx end as budget_ugx,
 case when division=any(rbac.divisions_for('projects.read')) then actual_ugx end as actual_ugx,progress from work.projects;

-- Project assignments are expiring internal access records, not provider invitations.
create function work.assign_project_member(p_project text,p_person uuid,p_expires timestamptz) returns text
language plpgsql security definer set search_path='' as $$
declare p work.projects;
begin
 select * into p from work.projects where code=p_project for update;
 if p.code is null or p.deleted_at is not null or not rbac.can('projects.manage',p.division) then raise exception 'You cannot manage this project.'; end if;
 if not rbac.active(p_person) or p_expires is null or p_expires<=now() then raise exception 'Choose an active person and a future access expiry.'; end if;
 insert into work.project_members(project,person_id,expires_at) values(p_project,p_person,p_expires) on conflict(project,person_id) do update set expires_at=excluded.expires_at;
 perform audit.log('project.member','project',p_project,jsonb_build_object('person',p_person,'expires',p_expires)); return 'assigned';
end $$;

-- Contextual project threads are ordinary project communication. Grievances and
-- payroll/disciplinary contexts are deliberately unsupported here.
create table work.project_messages(
 id uuid primary key default gen_random_uuid(),project text not null references work.projects,division text not null references org.divisions,
 body text not null check(length(btrim(body)) between 1 and 4000),reply_to uuid references work.project_messages,
 document_id uuid references docs.files,created_by uuid not null references org.people,created_at timestamptz not null default now(),deleted_at timestamptz);
create index project_messages_scope on work.project_messages(project,created_at,id);
create index project_messages_reply on work.project_messages(reply_to);
alter table work.project_messages enable row level security;
alter table work.project_messages force row level security;
create policy project_messages_read on work.project_messages for select to authenticated using(deleted_at is null and project=any(((select rbac.projects_for())::text[])));
create function work.post_project_message(p_project text,p_body text,p_reply uuid default null,p_document uuid default null) returns uuid
language plpgsql security definer set search_path='' as $$
declare p work.projects; rid uuid;
begin
 if not p_project=any(rbac.projects_for()) or not exists(select 1 from org.people where id=auth.uid() and principal in ('staff','client','contractor')) then raise exception 'You cannot post to this project.'; end if;
 select * into p from work.projects where code=p_project for update;
 if p.status='closed' then raise exception 'This project is closed.'; end if;
 if p_reply is not null and not exists(select 1 from work.project_messages where id=p_reply and project=p_project and deleted_at is null) then raise exception 'Reply within this project thread.'; end if;
 if p_document is not null and not exists(select 1 from docs.files where id=p_document and project=p_project and status='released' and deleted_at is null) then raise exception 'Only released project documents may be linked in this thread.'; end if;
 insert into work.project_messages(project,division,body,reply_to,document_id,created_by) values(p_project,p.division,btrim(p_body),p_reply,p_document,auth.uid()) returning id into rid;
 perform audit.log('project.message','project',p_project,jsonb_build_object('message',rid)); return rid;
end $$;
create function work.project_thread(p_project text,p_offset int default 0) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not p_project=any(rbac.projects_for()) then raise exception 'This project is not available to you.'; end if;
 if p_offset is null or p_offset not between 0 and 100000 then raise exception 'Invalid message page.'; end if;
 return coalesce((select jsonb_agg(to_jsonb(m)) from (select m.id,m.body,m.reply_to,m.document_id,m.created_at,p.full_name as author
 from work.project_messages m join org.people p on p.id=m.created_by where project=p_project and deleted_at is null order by m.created_at desc,m.id limit 50 offset p_offset)m),'[]');
end $$;

create table hr.timesheets(
 id uuid primary key default gen_random_uuid(),person_id uuid not null references org.people,division text not null references org.divisions,
 starts date not null,ends date not null check(ends>=starts),lines jsonb not null,status text not null default 'draft' check(status in ('draft','submitted')),
 request_id uuid unique references approvals.requests,version int not null default 1,
 created_by uuid not null references org.people,created_at timestamptz not null default now(),deleted_at timestamptz);
create index timesheets_scope on hr.timesheets(division,person_id,starts);
alter table hr.timesheets enable row level security;
alter table hr.timesheets force row level security;
create policy timesheets_read on hr.timesheets for select to authenticated using(deleted_at is null and (select rbac.active(auth.uid())) and
 (person_id=(select auth.uid()) or division=any(((select rbac.divisions_for('hr.read'))::text[]))));
create function hr.save_timesheet(p_division text,p_starts date,p_ends date,p_lines jsonb,p_id uuid default null,p_version int default 0) returns uuid
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
 if exists(select 1 from jsonb_array_elements(p_lines) item group by (item->>'date')::date having sum((item->>'hours')::numeric)>24) then raise exception 'A day cannot contain more than 24 recorded hours.'; end if;
 if p_id is null then
 insert into hr.timesheets(person_id,division,starts,ends,lines,created_by) values(auth.uid(),p_division,p_starts,p_ends,p_lines,auth.uid()) returning id into rid;
 else
 select * into t from hr.timesheets where id=p_id for update;
 if t.id is null or t.person_id<>auth.uid() or t.status<>'draft' or t.version is distinct from p_version then raise exception 'This timesheet changed or is not editable.'; end if;
 update hr.timesheets set starts=p_starts,ends=p_ends,lines=p_lines,version=version+1 where id=p_id; rid:=p_id;
 end if;
 perform audit.log('timesheet.saved','timesheet',rid::text); return rid;
end $$;
create function hr.submit_timesheet(p_id uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare t hr.timesheets; rid uuid;
begin
 select * into t from hr.timesheets where id=p_id for update;
 if not rbac.active(auth.uid()) or t.id is null or t.person_id<>auth.uid() or t.status<>'draft' then raise exception 'You cannot submit this timesheet.'; end if;
 insert into approvals.requests(kind,division,requester,payload) values('timesheet',t.division,auth.uid(),jsonb_build_object('title','Timesheet '||t.starts||' to '||t.ends,'timesheet_id',t.id)) returning id into rid;
 insert into approvals.steps(request_id,step_no,step_type) values(rid,1,'manager');
 update hr.timesheets set status='submitted',request_id=rid,version=version+1 where id=p_id;
 perform audit.log('timesheet.submitted','timesheet',p_id::text,jsonb_build_object('request',rid));
 insert into notifications.outbox(person_id,request_id,event) select p.id,rid,'approval.waiting' from org.people p where approvals.eligible(p.id,rid,1); return rid;
end $$;
create function hr.timesheet_page() returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not rbac.active(auth.uid()) then raise exception 'Your profile is not active.'; end if;
 return coalesce((select jsonb_agg(to_jsonb(t)) from (select t.*,r.status as approval_status from hr.timesheets t left join approvals.requests r on r.id=t.request_id
 where t.deleted_at is null and (t.person_id=auth.uid() or t.division=any(rbac.divisions_for('hr.read'))) order by t.created_at desc limit 100)t),'[]');
end $$;

-- Archive manifests retain copies locally. Hot events are never deleted or altered.
create table audit.archives(
 id uuid primary key default gen_random_uuid(),first_seq bigint not null,last_seq bigint not null,previous_hash text not null,
 events jsonb not null,sha256 text not null,created_by uuid not null references org.people,created_at timestamptz not null default now());
alter table audit.archives enable row level security;
alter table audit.archives force row level security;
create policy archive_read on audit.archives for select to authenticated using((select rbac.can('audit.read')));
create trigger archive_immutable before update or delete on audit.archives for each row execute function audit.no_change();
create trigger archive_no_truncate before truncate on audit.archives for each statement execute function audit.no_change();
create function work.export_audit_archive(p_after bigint default 0) returns jsonb language plpgsql security definer set search_path='' as $$
declare payload jsonb; h text; rid uuid; first_n bigint; last_n bigint; prev text;
begin
 if not rbac.can('audit.read') then raise exception 'You cannot archive the audit log.'; end if;
 if p_after is null or p_after<0 then raise exception 'Invalid archive range.'; end if;
 select jsonb_agg(to_jsonb(e) order by seq) into payload from (select * from audit.events where seq>p_after and at<now()-interval '12 months' order by seq limit 5000)e;
 if payload is null then raise exception 'No events older than twelve months are available in this range.'; end if;
 first_n:=(payload->0->>'seq')::bigint; last_n:=(payload->-1->>'seq')::bigint; prev:=payload->0->>'prev_hash';
 h:=encode(sha256(convert_to(payload::text,'utf8')),'hex');
 insert into audit.archives(first_seq,last_seq,previous_hash,events,sha256,created_by) values(first_n,last_n,prev,payload,h,auth.uid()) returning id into rid;
 perform audit.log('audit.archived','archive',rid::text,jsonb_build_object('first',first_n,'last',last_n,'sha256',h));
 return jsonb_build_object('id',rid,'first_seq',first_n,'last_seq',last_n,'previous_hash',prev,'events',payload,'sha256',h);
end $$;
create function work.verify_audit_archive(p_id uuid,p_events jsonb) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare a audit.archives; e jsonb; prev text; n int:=0; prior_seq bigint:=0;
begin
 if not rbac.can('audit.read') then raise exception 'You cannot verify audit archives.'; end if;
 select * into a from audit.archives where id=p_id;
 if a.id is null or p_events is null or jsonb_typeof(p_events)<>'array' then raise exception 'Choose a recorded archive and its event array.'; end if;
 if encode(sha256(convert_to(p_events::text,'utf8')),'hex')<>a.sha256 then return jsonb_build_object('ok',false,'reason','Archive checksum mismatch'); end if;
 prev:=a.previous_hash;
 for e in select * from jsonb_array_elements(p_events) loop
 n:=n+1;
 if (e->>'seq')::bigint<=prior_seq or e->>'prev_hash'<>prev or e->>'hash'<>audit.stamp(prev,(e->>'at')::timestamptz,(e->>'actor')::uuid,e->>'action',e->>'entity',e->>'entity_id',e->'detail') then return jsonb_build_object('ok',false,'first_bad_seq',e->'seq','checked',n); end if;
 prev:=e->>'hash'; prior_seq:=(e->>'seq')::bigint;
 end loop;
 return jsonb_build_object('ok',true,'checked',n,'last_hash',prev);
end $$;

create function api.assign_project_member(p_project text,p_person uuid,p_expires timestamptz) returns text language sql security invoker set search_path='' as $$ select work.assign_project_member(p_project,p_person,p_expires) $$;
create function api.post_project_message(p_project text,p_body text,p_reply uuid default null,p_document uuid default null) returns uuid language sql security invoker set search_path='' as $$ select work.post_project_message(p_project,p_body,p_reply,p_document) $$;
create function api.project_thread(p_project text,p_offset int default 0) returns jsonb language sql stable security invoker set search_path='' as $$ select work.project_thread(p_project,p_offset) $$;
create function api.save_timesheet(p_division text,p_starts date,p_ends date,p_lines jsonb,p_id uuid default null,p_version int default 0) returns uuid language sql security invoker set search_path='' as $$ select hr.save_timesheet(p_division,p_starts,p_ends,p_lines,p_id,p_version) $$;
create function api.submit_timesheet(p_id uuid) returns uuid language sql security invoker set search_path='' as $$ select hr.submit_timesheet(p_id) $$;
create function api.timesheet_page() returns jsonb language sql stable security invoker set search_path='' as $$ select hr.timesheet_page() $$;
create function api.export_audit_archive(p_after bigint default 0) returns jsonb language sql security invoker set search_path='' as $$ select work.export_audit_archive(p_after) $$;
create function api.verify_audit_archive(p_id uuid,p_events jsonb) returns jsonb language sql stable security invoker set search_path='' as $$ select work.verify_audit_archive(p_id,p_events) $$;
grant select on work.project_messages,hr.timesheets,audit.archives to authenticated;
grant execute on function work.assign_project_member(text,uuid,timestamptz),work.post_project_message(text,text,uuid,uuid),work.project_thread(text,integer),
 hr.save_timesheet(text,date,date,jsonb,uuid,integer),hr.submit_timesheet(uuid),hr.timesheet_page(),work.export_audit_archive(bigint),work.verify_audit_archive(uuid,jsonb),
 api.assign_project_member(text,uuid,timestamptz),api.post_project_message(text,text,uuid,uuid),api.project_thread(text,integer),
 api.save_timesheet(text,date,date,jsonb,uuid,integer),api.submit_timesheet(uuid),api.timesheet_page(),api.export_audit_archive(bigint),api.verify_audit_archive(uuid,jsonb) to authenticated;
commit;
