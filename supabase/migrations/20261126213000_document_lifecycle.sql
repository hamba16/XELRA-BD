begin;

insert into rbac.role_perms(role_code,perm,scope) values
 ('central_director','documents.create','all'),
 ('central_director','documents.manage','all'),
 ('central_director','documents.release','all'),
 ('director_eng','documents.create','division'),
 ('director_eng','documents.manage','division'),
 ('director_eng','documents.release','division'),
 ('staff','documents.create','own')
 on conflict (role_code,perm) do update set scope=excluded.scope;

create or replace function work.create_document(p_division text,p_project text,p_type text,p_title text,p_excerpt text default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare rid uuid; dno text;
begin
 if not rbac.active(auth.uid()) then raise exception 'Sign in with an active profile.'; end if;
 if not rbac.can('documents.create',p_division,auth.uid()) then raise exception 'You cannot create documents in this division.'; end if;
 if p_project is not null and not exists(select 1 from work.projects p where p.code=p_project and p.division=p_division) then
  raise exception 'Choose a valid project in this division.';
 end if;
 if p_title is null or length(btrim(p_title)) not between 1 and 200 then raise exception 'Document titles must contain 1 to 200 characters.'; end if;
 if p_excerpt is not null and octet_length(p_excerpt)>4096 then raise exception 'The document excerpt is limited to 4 KB.'; end if;
 dno:=docs.next_no(p_division,coalesce(p_project,'CORP'),p_type,0);
 insert into docs.files(division,project,doc_no,title,revision,status,excerpt,created_by)
 values(p_division,p_project,dno,btrim(p_title),0,'draft',nullif(btrim(p_excerpt),''),auth.uid())
 returning id into rid;
 perform audit.log('document.created','document',rid::text,jsonb_build_object('doc_no',dno,'division',p_division,'project',p_project));
 return rid;
end $$;

create or replace function work.attach_document(p_id uuid,p_object_key text,p_sha256 text)
returns text language plpgsql security definer set search_path='' as $$
declare f docs.files;
begin
 select * into f from docs.files where id=p_id for update;
 if f.id is null or f.deleted_at is not null then raise exception 'This document is not available.'; end if;
 if f.created_by<>auth.uid() and not rbac.can('documents.manage',f.division) then raise exception 'You cannot attach a file to this document.'; end if;
 if f.status not in ('draft','in_review') then raise exception 'This document is not open for attachment.'; end if;
 if p_object_key is null or length(btrim(p_object_key))<1 or length(p_object_key)>500 then raise exception 'A valid private object key is required.'; end if;
 if p_sha256 is null or p_sha256 !~ '^[0-9a-f]{64}$' then raise exception 'A lowercase SHA-256 checksum is required.'; end if;
 update docs.files set object_key=btrim(p_object_key),sha256=lower(p_sha256) where id=p_id;
 perform audit.log('document.attached','document',p_id::text,jsonb_build_object('sha256',lower(p_sha256)));
 return 'attached';
end $$;

create or replace function work.submit_document(p_id uuid)
returns text language plpgsql security definer set search_path='' as $$
declare f docs.files;
begin
 select * into f from docs.files where id=p_id for update;
 if f.id is null or f.deleted_at is not null then raise exception 'This document is not available.'; end if;
 if f.created_by<>auth.uid() and not rbac.can('documents.manage',f.division) then raise exception 'You cannot submit this document.'; end if;
 if f.status<> 'draft' then raise exception 'Only draft documents can be submitted.'; end if;
 if f.object_key is null or f.sha256 is null then raise exception 'Attach the file before submitting it.'; end if;
 update docs.files set status='in_review' where id=p_id;
 perform audit.log('document.submit','document',p_id::text,jsonb_build_object('doc_no',f.doc_no,'result','in_review'));
 return 'in_review';
end $$;

create or replace function work.release_document(p_id uuid)
returns text language plpgsql security definer set search_path='' as $$
declare f docs.files;
begin
 select * into f from docs.files where id=p_id for update;
 if f.id is null or f.deleted_at is not null then raise exception 'This document is not available.'; end if;
 if not rbac.can('documents.release',f.division) then raise exception 'You cannot release this document.'; end if;
 if f.status<> 'in_review' then raise exception 'Only documents in review can be released.'; end if;
 if f.object_key is null or f.sha256 is null then raise exception 'A reviewed file and checksum are required.'; end if;
 update docs.files set status='released' where id=p_id;
 perform audit.log('document.release','document',p_id::text,jsonb_build_object('doc_no',f.doc_no,'result','released'));
 return 'released';
end $$;

create or replace function work.create_document_revision(p_id uuid,p_title text default null,p_excerpt text default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare f docs.files; rid uuid; dno text; typ text;
begin
 select * into f from docs.files where id=p_id for update;
 if f.id is null or f.deleted_at is not null then raise exception 'This document is not available.'; end if;
 if not rbac.can('documents.manage',f.division) then raise exception 'You cannot create revisions for this document.'; end if;
 if f.status<> 'released' then raise exception 'Only released documents can receive revisions.'; end if;
 if p_title is not null and length(btrim(p_title)) not between 1 and 200 then raise exception 'Document titles must contain 1 to 200 characters.'; end if;
 if p_excerpt is not null and octet_length(p_excerpt)>4096 then raise exception 'The document excerpt is limited to 4 KB.'; end if;
 typ:=split_part(f.doc_no,'-',4);
 dno:=docs.next_no(f.division,coalesce(f.project,'CORP'),typ,f.revision+1);
 insert into docs.files(division,project,doc_no,title,revision,status,excerpt,created_by)
 values(f.division,f.project,dno,coalesce(nullif(btrim(p_title),''),f.title),f.revision+1,'draft',
        coalesce(nullif(btrim(p_excerpt),''),f.excerpt),auth.uid()) returning id into rid;
 update docs.files set status='superseded' where id=p_id;
 perform audit.log('document.revision','document',rid::text,jsonb_build_object('source',p_id,'doc_no',dno,'revision',f.revision+1));
 return rid;
end $$;

create or replace function work.withdraw_document(p_id uuid)
returns text language plpgsql security definer set search_path='' as $$
declare f docs.files;
begin
 select * into f from docs.files where id=p_id for update;
 if f.id is null or f.deleted_at is not null then raise exception 'This document is not available.'; end if;
 if f.created_by<>auth.uid() and not rbac.can('documents.manage',f.division) then raise exception 'You cannot withdraw this document.'; end if;
 if f.status not in ('draft','in_review') then raise exception 'Only draft or in-review documents can be withdrawn.'; end if;
 update docs.files set status='withdrawn' where id=p_id;
 perform audit.log('document.withdraw','document',p_id::text,jsonb_build_object('doc_no',f.doc_no,'result','withdrawn'));
 return 'withdrawn';
end $$;

create or replace function work.document_detail(p_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare f docs.files; result jsonb;
begin
 select * into f from docs.files where id=p_id;
 if f.id is null or f.deleted_at is not null or not (
  f.division=any(rbac.divisions_for('documents.read')) or
  (f.status='released' and f.project=any(rbac.projects_for()))
 ) then raise exception 'This document is not available to you.'; end if;
 select jsonb_build_object(
  'document',jsonb_build_object('id',f.id,'doc_no',f.doc_no,'title',f.title,'division',f.division,'project',f.project,
   'revision',f.revision,'status',f.status,'excerpt',f.excerpt,'has_file',(f.object_key is not null and f.sha256 is not null),
   'can_manage',(f.created_by=auth.uid() or rbac.can('documents.manage',f.division)),
   'can_release',rbac.can('documents.release',f.division)),
  'timeline',coalesce((select jsonb_agg(jsonb_build_object('seq',e.seq,'at',e.at,'actor',coalesce(p.full_name,'System'),'action',e.action,'detail',e.detail)
   order by e.seq) from audit.events e left join org.people p on p.id=e.actor
   where e.entity='document' and e.entity_id=f.id::text),'[]')) into result;
 return result;
end $$;

create function api.create_document(p_division text,p_project text,p_type text,p_title text,p_excerpt text default null)
returns uuid language sql security invoker set search_path='' as $$ select work.create_document(p_division,p_project,p_type,p_title,p_excerpt) $$;
create function api.attach_document(p_id uuid,p_object_key text,p_sha256 text)
returns text language sql security invoker set search_path='' as $$ select work.attach_document(p_id,p_object_key,p_sha256) $$;
create function api.submit_document(p_id uuid) returns text
language sql security invoker set search_path='' as $$ select work.submit_document(p_id) $$;
create function api.release_document(p_id uuid) returns text
language sql security invoker set search_path='' as $$ select work.release_document(p_id) $$;
create function api.create_document_revision(p_id uuid,p_title text default null,p_excerpt text default null) returns uuid
language sql security invoker set search_path='' as $$ select work.create_document_revision(p_id,p_title,p_excerpt) $$;
create function api.withdraw_document(p_id uuid) returns text
language sql security invoker set search_path='' as $$ select work.withdraw_document(p_id) $$;
create function api.document_detail(p_id uuid) returns jsonb
language sql stable security invoker set search_path='' as $$ select work.document_detail(p_id) $$;

revoke all on function
 work.create_document(text,text,text,text,text),work.attach_document(uuid,text,text),work.submit_document(uuid),
 work.release_document(uuid),work.create_document_revision(uuid,text,text),work.withdraw_document(uuid),work.document_detail(uuid),
 api.create_document(text,text,text,text,text),api.attach_document(uuid,text,text),api.submit_document(uuid),
 api.release_document(uuid),api.create_document_revision(uuid,text,text),api.withdraw_document(uuid),api.document_detail(uuid)
 from public,anon,service_role;
grant execute on function
 work.create_document(text,text,text,text,text),work.attach_document(uuid,text,text),work.submit_document(uuid),
 work.release_document(uuid),work.create_document_revision(uuid,text,text),work.withdraw_document(uuid),work.document_detail(uuid)
 to authenticated;
grant execute on function
 api.create_document(text,text,text,text,text),api.attach_document(uuid,text,text),api.submit_document(uuid),
 api.release_document(uuid),api.create_document_revision(uuid,text,text),api.withdraw_document(uuid),api.document_detail(uuid)
 to authenticated;
commit;
