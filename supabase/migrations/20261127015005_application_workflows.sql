begin;

-- Internal workflow permissions; no identities, policies or statutory rates are seeded.
insert into rbac.role_perms values
 ('central_director','projects.manage','all'),('director_eng','projects.manage','division'),
 ('it_admin','helpdesk.manage','all'),('central_director','helpdesk.manage','all'),
 ('central_director','records.manage','all'),('finance_manager','records.manage','all'),
 ('central_director','people.manage','all'),('central_director','checklists.manage','all')
on conflict do nothing;

-- A document revision belongs to the same numbered series. The released version
-- remains available until its replacement is actually released.
alter table docs.files add column supersedes uuid references docs.files;
alter table docs.files add column release_request uuid references approvals.requests;
create unique index document_open_revision on docs.files(supersedes)
 where supersedes is not null and status in ('draft','in_review','released');
create index document_parent on docs.files(supersedes);
drop policy files_read on docs.files;
create policy files_read on docs.files for select to authenticated using (
 deleted_at is null and (select rbac.active(auth.uid())) and (
 division=any(((select rbac.divisions_for('documents.read'))::text[]))
 or created_by=(select auth.uid())
 or (status='released' and project=any(((select rbac.projects_for())::text[])))));

create or replace function work.create_document(p_division text,p_project text,p_type text,p_title text,p_excerpt text default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare rid uuid; dno text;
begin
 if not rbac.active(auth.uid()) or not rbac.can('documents.create',p_division,auth.uid())
 or (not rbac.member(p_division) and not p_division=any(rbac.divisions_for('documents.create'))) then
  raise exception 'You cannot create documents in this division.'; end if;
 if p_project is not null and not exists(select 1 from work.projects p where p.code=p_project and p.division=p_division and p.deleted_at is null) then
  raise exception 'Choose a valid project in this division.'; end if;
 if p_title is null or length(btrim(p_title)) not between 1 and 200 then raise exception 'Document titles must contain 1 to 200 characters.'; end if;
 if p_excerpt is not null and octet_length(p_excerpt)>4096 then raise exception 'The document excerpt is limited to 4 KB.'; end if;
 dno:=docs.next_no(p_division,coalesce(p_project,'CORP'),p_type,0);
 insert into docs.files(division,project,doc_no,title,excerpt,created_by)
 values(p_division,p_project,dno,btrim(p_title),nullif(btrim(p_excerpt),''),auth.uid()) returning id into rid;
 perform audit.log('document.created','document',rid::text,jsonb_build_object('doc_no',dno)); return rid;
end $$;

create or replace function work.attach_document(p_id uuid,p_object_key text,p_sha256 text)
returns text language plpgsql security definer set search_path='' as $$
declare f docs.files;
begin
 select * into f from docs.files where id=p_id for update;
 if not rbac.active(auth.uid()) or f.id is null or f.deleted_at is not null or
 (f.created_by<>auth.uid() and not rbac.can('documents.manage',f.division)) then raise exception 'You cannot attach a file to this document.'; end if;
 if f.status<>'draft' then raise exception 'Only draft documents can receive attachments. Request changes before replacing a reviewed file.'; end if;
 if p_object_key is null or length(p_object_key) not between 1 and 500 or p_object_key !~ '^documents/'
 or p_object_key ~ '(^|/)\.\.(/|$)|[\\\x00-\x1f]' then raise exception 'A valid private object key is required.'; end if;
 if p_sha256 is null or p_sha256 !~ '^[0-9a-f]{64}$' then raise exception 'A lowercase SHA-256 checksum is required.'; end if;
 update docs.files set object_key=p_object_key,sha256=p_sha256 where id=p_id;
 perform audit.log('document.attached','document',p_id::text,jsonb_build_object('sha256',p_sha256)); return 'attached';
end $$;

create or replace function work.submit_document(p_id uuid) returns text
language plpgsql security definer set search_path='' as $$
declare f docs.files; rid uuid;
begin
 select * into f from docs.files where id=p_id for update;
 if not rbac.active(auth.uid()) or f.id is null or f.deleted_at is not null or
 (f.created_by<>auth.uid() and not rbac.can('documents.manage',f.division)) then raise exception 'You cannot submit this document.'; end if;
 if f.status<>'draft' or f.object_key is null or f.sha256 is null then raise exception 'Attach a file to a draft document before submitting it.'; end if;
 insert into approvals.requests(kind,division,requester,payload)
 values('document-release',f.division,auth.uid(),jsonb_build_object('title',f.title,'document_id',f.id,'sha256',f.sha256)) returning id into rid;
 insert into approvals.steps(request_id,step_no,step_type,perm) values(rid,1,'perm','documents.release');
 update docs.files set status='in_review',release_request=rid where id=p_id;
 perform audit.log('approval.submit','request',rid::text,jsonb_build_object('kind','document-release','steps',1));
 perform audit.log('document.submit','document',p_id::text,jsonb_build_object('request',rid,'sha256',f.sha256));
 insert into notifications.outbox(person_id,request_id,event) select p.id,rid,'approval.waiting' from org.people p where approvals.eligible(p.id,rid,1);
 return 'in_review';
end $$;

create or replace function work.release_document(p_id uuid) returns text
language plpgsql security definer set search_path='' as $$
declare f docs.files; r approvals.requests;
begin
 select * into f from docs.files where id=p_id for update;
 if not rbac.active(auth.uid()) or f.id is null or not rbac.can('documents.release',f.division) then raise exception 'You cannot release this document.'; end if;
 if f.status<>'in_review' or f.release_request is null then raise exception 'Submit this document for approval first.'; end if;
 select * into r from approvals.requests where id=f.release_request for update;
 if r.status='pending' then perform work.decide(r.id,true,null); select * into r from approvals.requests where id=r.id; end if;
 if r.status<>'approved' or r.payload->>'sha256' is distinct from f.sha256 then raise exception 'A matching approved file is required.'; end if;
 if f.supersedes is not null then
  update docs.files set status='superseded' where id=f.supersedes and status='released';
  if not found then raise exception 'The previous revision is no longer released.'; end if;
  perform audit.log('document.superseded','document',f.supersedes::text,jsonb_build_object('replacement',f.id));
 end if;
 update docs.files set status='released' where id=f.id;
 perform audit.log('document.release','document',p_id::text,jsonb_build_object('request',r.id,'sha256',f.sha256)); return 'released';
end $$;

create or replace function work.create_document_revision(p_id uuid,p_title text default null,p_excerpt text default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare f docs.files; rid uuid; dno text;
begin
 select * into f from docs.files where id=p_id for update;
 if not rbac.active(auth.uid()) or f.id is null or not rbac.can('documents.manage',f.division) then raise exception 'You cannot create revisions for this document.'; end if;
 if f.status<>'released' then raise exception 'Only released documents can receive revisions.'; end if;
 if p_title is not null and length(btrim(p_title)) not between 1 and 200 then raise exception 'Document titles must contain 1 to 200 characters.'; end if;
 if p_excerpt is not null and octet_length(p_excerpt)>4096 then raise exception 'The document excerpt is limited to 4 KB.'; end if;
 dno:=regexp_replace(f.doc_no,'-R[0-9]+$','-R'||lpad((f.revision+1)::text,2,'0'));
 insert into docs.files(division,project,doc_no,title,revision,excerpt,created_by,supersedes)
 values(f.division,f.project,dno,coalesce(p_title,f.title),f.revision+1,coalesce(p_excerpt,f.excerpt),auth.uid(),f.id) returning id into rid;
 perform audit.log('document.revision','document',rid::text,jsonb_build_object('source',f.id,'doc_no',dno)); return rid;
end $$;

create function work.return_document(p_id uuid,p_reason text) returns text
language plpgsql security definer set search_path='' as $$
declare f docs.files;
begin
 select * into f from docs.files where id=p_id for update;
 if not rbac.active(auth.uid()) or f.id is null or not rbac.can('documents.release',f.division) then raise exception 'You cannot review this document.'; end if;
 if f.status<>'in_review' or length(btrim(coalesce(p_reason,''))) not between 1 and 2000 then raise exception 'Choose a document in review and explain the changes needed.'; end if;
 if exists(select 1 from approvals.requests where id=f.release_request and status='pending') then perform work.decide(f.release_request,false,p_reason); end if;
 if exists(select 1 from approvals.requests where id=f.release_request and status='approved') then raise exception 'This release is already approved.'; end if;
 update docs.files set status='draft',release_request=null where id=p_id;
 perform audit.log('document.changes_requested','document',p_id::text,jsonb_build_object('reason',p_reason)); return 'draft';
end $$;

create or replace function work.withdraw_document(p_id uuid) returns text
language plpgsql security definer set search_path='' as $$
declare f docs.files;
begin
 select * into f from docs.files where id=p_id for update;
 if not rbac.active(auth.uid()) or f.id is null or (f.created_by<>auth.uid() and not rbac.can('documents.manage',f.division)) then raise exception 'You cannot withdraw this document.'; end if;
 if f.status not in ('draft','in_review') then raise exception 'Only draft or in-review documents can be withdrawn.'; end if;
 if f.release_request is not null then
  if exists(select 1 from approvals.requests where id=f.release_request and status='approved') then raise exception 'An approved release cannot be withdrawn as a draft.'; end if;
  update approvals.requests set status='cancelled' where id=f.release_request and status='pending';
  update approvals.steps set status='skipped' where request_id=f.release_request and status='waiting';
  update notifications.outbox set cancelled_at=now(),lease=null,lease_until=null where request_id=f.release_request and sent_at is null;
 end if;
 update docs.files set status='withdrawn' where id=p_id;
 perform audit.log('document.withdraw','document',p_id::text); return 'withdrawn';
end $$;

-- Scoped document detail and access acknowledgements. No private object key is returned.
create or replace function work.document_detail(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare f docs.files;
begin
 select * into f from docs.files where id=p_id;
 if not rbac.active(auth.uid()) or f.id is null or f.deleted_at is not null or not (
 f.created_by=auth.uid() or f.division=any(rbac.divisions_for('documents.read')) or
 (f.status='released' and f.project=any(rbac.projects_for()))) then raise exception 'This document is not available to you.'; end if;
 return jsonb_build_object('document',jsonb_build_object('id',f.id,'doc_no',f.doc_no,'title',f.title,'division',f.division,'project',f.project,
 'revision',f.revision,'status',f.status,'excerpt',f.excerpt,'has_file',f.object_key is not null,'release_request',f.release_request,
 'can_manage',f.created_by=auth.uid() or rbac.can('documents.manage',f.division),'can_release',rbac.can('documents.release',f.division)),
 'timeline',coalesce((select jsonb_agg(jsonb_build_object('seq',e.seq,'at',e.at,'actor',coalesce(p.full_name,'System'),'action',e.action,'detail',e.detail) order by e.seq)
 from audit.events e left join org.people p on p.id=e.actor where e.entity='document' and e.entity_id=f.id::text),'[]'));
end $$;
create function work.acknowledge_document(p_id uuid,p_name text) returns text
language plpgsql security definer set search_path='' as $$
begin
 perform work.document_detail(p_id);
 if not exists(select 1 from docs.files where id=p_id and status='released') or length(btrim(coalesce(p_name,''))) not between 1 and 200 then raise exception 'A released document and your typed name are required.'; end if;
 perform audit.log('document.acknowledged','document',p_id::text,jsonb_build_object('typed_name',btrim(p_name))); return 'acknowledged';
end $$;

-- Delivery state remains internal. No real provider is enabled by this migration.
alter table notifications.outbox add column read_at timestamptz;
alter table notifications.outbox add column expires_at timestamptz not null default (now()+interval '30 days');
alter table notifications.outbox add column failed_at timestamptz;
create policy notification_own on notifications.outbox for select to authenticated using
 ((select rbac.active(auth.uid())) and person_id=(select auth.uid()));
create or replace function notifications.claim() returns table(id bigint,lease uuid,email text,time_zone text,request_id uuid)
language sql security definer set search_path='' as $$
 with candidates as (select o.id from notifications.outbox o join org.people p on p.id=o.person_id
 where o.sent_at is null and o.cancelled_at is null and o.failed_at is null and o.expires_at>now()
 and o.attempts<8 and o.available_at<=now() and (o.lease_until is null or o.lease_until<now())
 and p.status='active' and (p.expires_at is null or p.expires_at>now())
 and not ((now() at time zone p.time_zone)::time >= time '12:30' and (now() at time zone p.time_zone)::time < time '13:00')
 order by o.id limit 20 for update of o skip locked),
 claimed as (update notifications.outbox o set lease=gen_random_uuid(),lease_until=now()+interval '5 minutes',attempts=attempts+1
 from candidates c where o.id=c.id returning o.*)
 select c.id,c.lease,p.email,p.time_zone,c.request_id from claimed c join org.people p on p.id=c.person_id;
$$;
create or replace function notifications.finish(p_id bigint,p_lease uuid,p_sent boolean,p_next timestamptz) returns void
language sql security definer set search_path='' as $$
 update notifications.outbox set sent_at=case when p_sent then now() else null end,
 failed_at=case when not p_sent and attempts>=8 then now() else null end,
 available_at=greatest(now()+interval '1 minute',coalesce(p_next,now()+least(3600,power(2,attempts)::int*60)*interval '1 second')),
 lease=null,lease_until=null where id=p_id and lease=p_lease and lease_until>now() and cancelled_at is null and expires_at>now();
$$;
create function work.notification_page(p_offset int default 0) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if not rbac.active(auth.uid()) or p_offset is null or p_offset not between 0 and 100000 then raise exception 'Invalid notification page.'; end if;
 return coalesce((select jsonb_agg(to_jsonb(t)) from (select id,event,request_id,read_at,sent_at,cancelled_at,failed_at,expires_at,attempts,
 case when request_id is null then '/inbox' else '/inbox?request='||request_id::text end as link
 from notifications.outbox where person_id=auth.uid() order by id desc limit 50 offset p_offset) t),'[]');
end $$;
create function work.read_notification(p_id bigint) returns boolean
language plpgsql security definer set search_path='' as $$
begin
 if not rbac.active(auth.uid()) then raise exception 'Your profile is not active.'; end if;
 update notifications.outbox set read_at=coalesce(read_at,now()) where id=p_id and person_id=auth.uid(); return found;
end $$;

-- Helpdesk is private to the reporter and support staff, including external reporters.
create table work.tickets(
 id uuid primary key default gen_random_uuid(),division text not null references org.divisions,
 created_by uuid not null references org.people,created_at timestamptz not null default now(),deleted_at timestamptz,
 title text not null check(length(title) between 1 and 200),description text not null check(length(description) between 1 and 8000),
 category text not null check(length(category) between 1 and 80),priority int not null default 3 check(priority between 1 and 4),
 status text not null default 'open' check(status in ('open','acknowledged','in_progress','resolved','closed')),
 assigned_to uuid references org.people,acknowledged_at timestamptz,resolved_at timestamptz,
 context jsonb not null default '{}' check(jsonb_typeof(context)='object' and octet_length(context::text)<=4096),
 version int not null default 1);
create index tickets_owner on work.tickets(created_by,created_at desc);
create index tickets_scope on work.tickets(division,status,assigned_to);
alter table work.tickets enable row level security;
alter table work.tickets force row level security;
create policy tickets_read on work.tickets for select to authenticated using(deleted_at is null and
 (select rbac.active(auth.uid())) and (created_by=(select auth.uid()) or division=any(((select rbac.divisions_for('helpdesk.manage'))::text[]))));
create function work.ticket_ids() returns uuid[] language sql stable security definer set search_path='' as $$
 select coalesce(array_agg(id),'{}') from work.tickets where deleted_at is null and rbac.active(auth.uid()) and
 (created_by=auth.uid() or division=any(rbac.divisions_for('helpdesk.manage')));
$$;
create table work.ticket_messages(
 id uuid primary key default gen_random_uuid(),ticket_id uuid not null references work.tickets,
 created_by uuid not null references org.people,created_at timestamptz not null default now(),
 body text not null check(length(btrim(body)) between 1 and 4000));
create index ticket_messages_parent on work.ticket_messages(ticket_id,created_at);
alter table work.ticket_messages enable row level security;
alter table work.ticket_messages force row level security;
create policy ticket_messages_read on work.ticket_messages for select to authenticated using(ticket_id=any(((select work.ticket_ids())::uuid[])));
create function work.create_ticket(p_title text,p_description text,p_category text,p_context jsonb default '{}') returns uuid
language plpgsql security definer set search_path='' as $$
declare rid uuid; div text;
begin
 if not rbac.active(auth.uid()) then raise exception 'Your profile is not active.'; end if;
 -- COR is a support routing scope for accounts without an organisational assignment.
 select division into div from rbac.assignments where person_id=auth.uid() and valid_from<=current_date and (valid_to is null or valid_to>=current_date) order by division limit 1;
 if p_context is null or jsonb_typeof(p_context)<>'object' or exists(select 1 from jsonb_object_keys(p_context) k where k not in ('page','browser','version','error_reference')) then raise exception 'Unsupported ticket context.'; end if;
 insert into work.tickets(division,created_by,title,description,category,context)
 values(coalesce(div,'COR'),auth.uid(),btrim(p_title),btrim(p_description),btrim(p_category),p_context) returning id into rid;
 perform audit.log('ticket.created','ticket',rid::text); return rid;
end $$;
create function work.ticket_page(p_offset int default 0,p_status text default 'all') returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if p_offset is null or p_offset not between 0 and 100000 then raise exception 'Invalid page.'; end if;
 return coalesce((select jsonb_agg(to_jsonb(t)) from (select id,title,division,status,priority,created_at,assigned_to,version
 from work.tickets where id=any(work.ticket_ids()) and (p_status='all' or status=p_status) order by created_at desc,id limit 50 offset p_offset)t),'[]');
end $$;
create function work.ticket_detail(p_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not p_id=any(work.ticket_ids()) then raise exception 'This ticket is not available to you.'; end if;
 return jsonb_build_object('ticket',(select to_jsonb(t) from work.tickets t where id=p_id),
 'messages',coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'body',m.body,'at',m.created_at,'actor',p.full_name) order by m.created_at,m.id) from work.ticket_messages m join org.people p on p.id=m.created_by where ticket_id=p_id),'[]'),
 'timeline',coalesce((select jsonb_agg(jsonb_build_object('at',at,'action',action,'detail',detail) order by seq) from audit.events where entity='ticket' and entity_id=p_id::text),'[]'));
end $$;
create function work.reply_ticket(p_id uuid,p_body text) returns uuid language plpgsql security definer set search_path='' as $$
declare rid uuid;
begin
 perform 1 from work.tickets where id=p_id for update;
 if not p_id=any(work.ticket_ids()) then raise exception 'This ticket is not available to you.'; end if;
 if exists(select 1 from work.tickets where id=p_id and status='closed') then raise exception 'This ticket is closed.'; end if;
 insert into work.ticket_messages(ticket_id,created_by,body) values(p_id,auth.uid(),btrim(p_body)) returning id into rid;
 perform audit.log('ticket.reply','ticket',p_id::text,jsonb_build_object('message',rid)); return rid;
end $$;
create function work.update_ticket(p_id uuid,p_version int,p_status text,p_priority int,p_assigned uuid default null) returns int
language plpgsql security definer set search_path='' as $$
declare t work.tickets;
begin
 select * into t from work.tickets where id=p_id for update;
 if t.id is null or not rbac.can('helpdesk.manage',t.division) then raise exception 'You cannot manage this ticket.'; end if;
 if p_version is distinct from t.version then raise exception 'This ticket changed. Refresh before saving.'; end if;
 if p_status is null or not (p_status=t.status or (t.status='open' and p_status='acknowledged') or
 (t.status='acknowledged' and p_status='in_progress') or (t.status='in_progress' and p_status='resolved') or
 (t.status='resolved' and p_status in ('closed','in_progress'))) then raise exception 'Invalid ticket transition.'; end if;
 if p_assigned is not null and not rbac.person_can(p_assigned,'helpdesk.manage',t.division) then raise exception 'Assign an active support person.'; end if;
 update work.tickets set status=p_status,priority=p_priority,assigned_to=p_assigned,version=version+1,
 acknowledged_at=case when p_status='acknowledged' then coalesce(acknowledged_at,now()) else acknowledged_at end,
 resolved_at=case when p_status='resolved' then now() when p_status='in_progress' then null else resolved_at end where id=p_id;
 perform audit.log('ticket.updated','ticket',p_id::text,jsonb_build_object('from',t.status,'to',p_status,'assigned_to',p_assigned,'priority',p_priority)); return t.version+1;
end $$;

-- Project lifecycle and published milestone projection use the existing project gate.
alter table work.projects add column status text not null default 'active' check(status in ('planned','active','completed','closed'));
alter table work.projects add column owner_id uuid references org.people;
alter table work.projects add column version int not null default 1;
alter table work.project_members add column expires_at timestamptz;
create or replace function rbac.projects_for() returns text[] language sql stable security definer set search_path='' as $$
 select coalesce(array_agg(p.code),'{}') from work.projects p where rbac.active(auth.uid()) and p.deleted_at is null and (
 p.division=any(rbac.divisions_for('projects.read')) or (exists(select 1 from work.project_members m where m.project=p.code and m.person_id=auth.uid() and (m.expires_at is null or m.expires_at>now()))
 and (not exists(select 1 from org.people where id=auth.uid() and principal='client') or (p.published and p.payment_recorded_at is not null))));
$$;
create table work.milestones(
 id uuid primary key default gen_random_uuid(),project text not null references work.projects,division text not null references org.divisions,
 title text not null check(length(btrim(title)) between 1 and 200),due_on date,completed_at timestamptz,published boolean not null default false,
 created_by uuid not null references org.people,created_at timestamptz not null default now(),deleted_at timestamptz);
create index milestones_project on work.milestones(project,due_on);
create index milestones_division on work.milestones(division);
alter table work.milestones enable row level security;
alter table work.milestones force row level security;
create policy milestones_read on work.milestones for select to authenticated using(deleted_at is null and project=any(((select rbac.projects_for())::text[])) and
 (published or division=any(((select rbac.divisions_for('projects.read'))::text[]))));
create function work.save_project(p_code text,p_division text,p_title text,p_budget bigint,p_actual bigint,p_progress int,p_status text,p_version int default 0) returns int
language plpgsql security definer set search_path='' as $$
declare p work.projects;
begin
 if not rbac.can('projects.manage',p_division) then raise exception 'You cannot manage this project.'; end if;
 if length(btrim(coalesce(p_title,''))) not between 1 and 200 then raise exception 'Enter a project title.'; end if;
 select * into p from work.projects where code=p_code for update;
 if p.code is null then
  if p_version<>0 or p_status<>'planned' then raise exception 'New projects start as planned.'; end if;
  insert into work.projects(code,division,title,budget_ugx,actual_ugx,progress,status,created_by,owner_id)
  values(p_code,p_division,btrim(p_title),p_budget,p_actual,p_progress,p_status,auth.uid(),auth.uid());
 else
  if p.division<>p_division or p.version is distinct from p_version or p.deleted_at is not null then raise exception 'This project changed. Refresh before saving.'; end if;
  if p.status='closed' or p_status is null or not (p_status=p.status or (p.status='planned' and p_status='active') or (p.status='active' and p_status='completed') or (p.status='completed' and p_status='closed')) then raise exception 'Invalid project transition.'; end if;
  if p_status in ('completed','closed') and (p_progress<>100 or exists(select 1 from work.milestones where project=p_code and deleted_at is null and completed_at is null)) then raise exception 'Complete the milestones and progress before completing this project.'; end if;
  update work.projects set title=btrim(p_title),budget_ugx=p_budget,actual_ugx=p_actual,progress=p_progress,status=p_status,version=version+1 where code=p_code;
 end if;
 perform audit.log('project.saved','project',p_code,jsonb_build_object('status',p_status,'budget',p_budget,'actual',p_actual,'progress',p_progress)); return coalesce(p.version,0)+1;
end $$;
create function work.save_milestone(p_project text,p_title text,p_due date,p_id uuid default null,p_completed boolean default false,p_published boolean default false) returns uuid
language plpgsql security definer set search_path='' as $$
declare p work.projects; rid uuid;
begin
 select * into p from work.projects where code=p_project for update;
 if p.code is null or p.status='closed' or not rbac.can('projects.manage',p.division) then raise exception 'You cannot manage this project.'; end if;
 if p_id is null then
 insert into work.milestones(project,division,title,due_on,completed_at,published,created_by) values(p_project,p.division,btrim(p_title),p_due,case when p_completed then now() end,p_published,auth.uid()) returning id into rid;
 else
 update work.milestones set title=btrim(p_title),due_on=p_due,completed_at=case when p_completed then coalesce(completed_at,now()) end,published=p_published where id=p_id and project=p_project returning id into rid;
 if rid is null then raise exception 'This milestone is not available.'; end if;
 end if;
 perform audit.log('project.milestone','project',p_project,jsonb_build_object('milestone',rid,'completed',p_completed,'published',p_published)); return rid;
end $$;
create function work.project_detail(p_code text) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare p work.projects; internal boolean;
begin
 if not p_code=any(rbac.projects_for()) then raise exception 'This project is not available to you.'; end if;
 select * into p from work.projects where code=p_code;
 internal:=p.division=any(rbac.divisions_for('projects.read'));
 return jsonb_build_object('project',jsonb_build_object('code',p.code,'title',p.title,'division',p.division,'progress',p.progress,'status',p.status,'version',p.version)
 ||case when internal then jsonb_build_object('budget_ugx',p.budget_ugx,'actual_ugx',p.actual_ugx,'variance_ugx',p.budget_ugx-p.actual_ugx,
 'health',case when p.budget_ugx=0 then 'unavailable' when p.actual_ugx::numeric/p.budget_ugx*100<=p.progress+5 then 'green' when p.actual_ugx::numeric/p.budget_ugx*100<=p.progress+15 then 'amber' else 'red' end) else '{}'::jsonb end,
 'milestones',coalesce((select jsonb_agg(jsonb_build_object('id',id,'title',title,'due_on',due_on,'completed_at',completed_at,'published',published) order by due_on nulls last,id) from work.milestones where project=p_code and deleted_at is null and (internal or published)),'[]'),
 'timeline',case when internal then coalesce((select jsonb_agg(jsonb_build_object('at',at,'action',action,'detail',detail) order by seq) from audit.events where entity='project' and entity_id=p_code),'[]') else '[]'::jsonb end);
end $$;

-- Audit verification exposes integrity counts to IT, content only to audit readers.
create function work.verify_audit() returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not rbac.can('audit.read') and not rbac.can('ops.read') then raise exception 'You cannot verify the audit chain.'; end if;
 return (select to_jsonb(v) from audit.verify() v);
end $$;
create function work.audit_page(p_after bigint default 0) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not rbac.can('audit.read') then raise exception 'You cannot inspect the audit log.'; end if;
 return coalesce((select jsonb_agg(to_jsonb(t)) from (select * from audit.events where seq>p_after order by seq limit 50)t),'[]');
end $$;

-- Exact API signatures and dependencies. No broad function execution grants.
create function api.return_document(p_id uuid,p_reason text) returns text language sql security invoker set search_path='' as $$ select work.return_document(p_id,p_reason) $$;
create function api.acknowledge_document(p_id uuid,p_name text) returns text language sql security invoker set search_path='' as $$ select work.acknowledge_document(p_id,p_name) $$;
create function api.notification_page(p_offset int default 0) returns jsonb language sql stable security invoker set search_path='' as $$ select work.notification_page(p_offset) $$;
create function api.read_notification(p_id bigint) returns boolean language sql security invoker set search_path='' as $$ select work.read_notification(p_id) $$;
create function api.create_ticket(p_title text,p_description text,p_category text,p_context jsonb default '{}') returns uuid language sql security invoker set search_path='' as $$ select work.create_ticket(p_title,p_description,p_category,p_context) $$;
create function api.ticket_page(p_offset int default 0,p_status text default 'all') returns jsonb language sql stable security invoker set search_path='' as $$ select work.ticket_page(p_offset,p_status) $$;
create function api.ticket_detail(p_id uuid) returns jsonb language sql stable security invoker set search_path='' as $$ select work.ticket_detail(p_id) $$;
create function api.reply_ticket(p_id uuid,p_body text) returns uuid language sql security invoker set search_path='' as $$ select work.reply_ticket(p_id,p_body) $$;
create function api.update_ticket(p_id uuid,p_version int,p_status text,p_priority int,p_assigned uuid default null) returns int language sql security invoker set search_path='' as $$ select work.update_ticket(p_id,p_version,p_status,p_priority,p_assigned) $$;
create function api.save_project(p_code text,p_division text,p_title text,p_budget bigint,p_actual bigint,p_progress int,p_status text,p_version int default 0) returns int language sql security invoker set search_path='' as $$ select work.save_project(p_code,p_division,p_title,p_budget,p_actual,p_progress,p_status,p_version) $$;
create function api.save_milestone(p_project text,p_title text,p_due date,p_id uuid default null,p_completed boolean default false,p_published boolean default false) returns uuid language sql security invoker set search_path='' as $$ select work.save_milestone(p_project,p_title,p_due,p_id,p_completed,p_published) $$;
create function api.project_detail(p_code text) returns jsonb language sql stable security invoker set search_path='' as $$ select work.project_detail(p_code) $$;
create function api.verify_audit() returns jsonb language sql stable security invoker set search_path='' as $$ select work.verify_audit() $$;
create function api.audit_page(p_after bigint default 0) returns jsonb language sql stable security invoker set search_path='' as $$ select work.audit_page(p_after) $$;
do $$ declare sig text; begin
 foreach sig in array array['return_document(uuid,text)','acknowledge_document(uuid,text)','notification_page(integer)','read_notification(bigint)',
 'create_ticket(text,text,text,jsonb)','ticket_page(integer,text)','ticket_detail(uuid)','reply_ticket(uuid,text)','update_ticket(uuid,integer,text,integer,uuid)',
 'save_project(text,text,text,bigint,bigint,integer,text,integer)','save_milestone(text,text,date,uuid,boolean,boolean)','project_detail(text)','verify_audit()','audit_page(bigint)'] loop
 execute 'revoke all on function work.'||sig||',api.'||sig||' from public,anon,service_role';
 execute 'grant execute on function work.'||sig||',api.'||sig||' to authenticated';
 end loop;
end $$;
grant execute on function work.ticket_ids() to authenticated;
grant select on work.tickets,work.ticket_messages,work.milestones to authenticated;
commit;
