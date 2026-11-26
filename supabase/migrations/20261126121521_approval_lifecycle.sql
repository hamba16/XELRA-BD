begin;

-- A terminal request or completed/skipped step cannot confer approval authority.
create or replace function approvals.eligible(p_person uuid,p_req uuid,p_step int) returns boolean
language sql stable security definer set search_path='' as $$
 select rbac.active(p_person) and exists(
   select 1 from approvals.requests r join approvals.steps s on s.request_id=r.id and s.step_no=p_step
   where r.id=p_req and r.status='pending' and r.current_step=p_step and s.status='waiting'
 ) and approvals.eligible_unchecked(p_person,p_req,p_step);
$$;

alter table notifications.outbox add column cancelled_at timestamptz;
create index requests_order on approvals.requests(created_at desc,id desc);
create index request_audit_lookup on audit.events(entity_id,seq) where entity='request';

create function work.withdraw_request(p_id uuid,p_reason text default null) returns text
language plpgsql security definer set search_path='' as $$
declare r approvals.requests; recipients uuid[];
begin
 if not rbac.active(auth.uid()) then raise exception 'Your profile is not active.'; end if;
 if length(coalesce(p_reason,''))>2000 then raise exception 'Keep the withdrawal reason within 2,000 characters.'; end if;
 -- Same lock and terminal-state guard as approvals.decide; no lost update.
 select * into r from approvals.requests where id=p_id for update;
 if r.id is null or r.requester<>auth.uid() then raise exception 'You cannot withdraw this request.'; end if;
 if r.status<>'pending' then raise exception 'This request is no longer open.'; end if;
 select coalesce(array_agg(p.id),'{}') into recipients from org.people p
 where p.id<>r.requester and rbac.active(p.id) and
 (approvals.eligible(p.id,r.id,r.current_step) or exists(select 1 from approvals.steps s where s.request_id=r.id and s.decided_by=p.id));
 update approvals.requests set status='cancelled' where id=p_id;
 update approvals.steps set status='skipped' where request_id=p_id and status='waiting';
 -- Preserve delivery history; invalidate unsent reminders and any outstanding leases.
 update notifications.outbox set cancelled_at=now(),lease=null,lease_until=null
 where request_id=p_id and sent_at is null and cancelled_at is null;
 perform audit.log('approval.cancel','request',p_id::text,
   jsonb_build_object('step',r.current_step,'result','cancelled','reason',nullif(btrim(p_reason),'')));
 insert into notifications.outbox(person_id,request_id,event)
 select person_id,p_id,'approval.cancelled' from unnest(recipients||array[r.requester]) person_id;
 return 'cancelled';
end $$;

-- Server-side filters/pagination avoid silently hiding requests after the first 50.
create function work.request_page(p_offset int default 0,p_division text default null,p_status text default 'all',p_view text default 'all') returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if not rbac.active(auth.uid()) then raise exception 'Your profile is not active.'; end if;
 if p_offset is null or p_offset<0 or p_offset>100000 then raise exception 'Invalid request page.'; end if;
 if p_division is not null and p_division not in ('ENG','AMG','COR') then raise exception 'Unknown division.'; end if;
 if p_status is null or p_status not in ('all','pending','approved','rejected','cancelled') then raise exception 'Unknown request status.'; end if;
 if p_view is null or p_view not in ('all','mine','waiting','stuck') then raise exception 'Unknown request view.'; end if;
 with allowed as materialized (
  select r.*,p.full_name as requester_name,
   (r.status='pending' and approvals.eligible(auth.uid(),r.id,r.current_step)) as can_decide
  from approvals.requests r join org.people p on p.id=r.requester
  where (p_division is null or r.division=p_division)
   and (p_status='all' or r.status=p_status)
   and (r.requester=auth.uid() or approvals.eligible(auth.uid(),r.id,r.current_step)
        or r.division=any(rbac.divisions_for('approvals.read')))
 ), filtered as materialized (
  select a.* from allowed a where p_view='all' or (p_view='mine' and a.requester=auth.uid())
   or (p_view='waiting' and a.can_decide)
   or (p_view='stuck' and a.status='pending' and not exists(select 1 from org.people p where approvals.eligible(p.id,a.id,a.current_step)))
 ), page as materialized (
  select f.* from filtered f order by created_at desc,id desc limit 51 offset p_offset
 ), enriched as (
  select p.*, (select count(*) from approvals.steps s where s.request_id=p.id) as steps,
   case when p.status='pending' then coalesce((select string_agg(n.full_name,', ' order by n.full_name)
       from org.people n where approvals.eligible(n.id,p.id,p.current_step)),'Nobody currently available') else 'Complete' end as waiting_on,
   (p.status='pending' and not exists(select 1 from org.people n where approvals.eligible(n.id,p.id,p.current_step))) as orphaned
  from page p order by p.created_at desc,p.id desc limit 50
 ) select jsonb_build_object('items',coalesce((select jsonb_agg(to_jsonb(e) order by e.created_at desc,e.id desc) from enriched e),'[]'),
   'has_more',(select count(*)>50 from page),'offset',p_offset) into result;
 return result;
end $$;

create function work.request_detail(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare r approvals.requests; result jsonb;
begin
 if not rbac.active(auth.uid()) then raise exception 'Your profile is not active.'; end if;
 select * into r from approvals.requests where id=p_id;
 if r.id is null or not (r.requester=auth.uid() or approvals.eligible(auth.uid(),r.id,r.current_step)
  or r.division=any(rbac.divisions_for('approvals.read'))) then raise exception 'This request is not available to you.'; end if;
 select jsonb_build_object('request',to_jsonb(r)||jsonb_build_object(
   'requester_name',(select full_name from org.people where id=r.requester),
   'steps',(select count(*) from approvals.steps where request_id=r.id),
   'can_decide',(r.status='pending' and approvals.eligible(auth.uid(),r.id,r.current_step)),
   'can_withdraw',(r.status='pending' and r.requester=auth.uid()),
   'waiting_on',case when r.status='pending' then coalesce((select string_agg(p.full_name,', ' order by p.full_name) from org.people p where approvals.eligible(p.id,r.id,r.current_step)),'Nobody currently available') else 'Complete' end),
  'steps',coalesce((select jsonb_agg(jsonb_build_object('number',s.step_no,'type',s.step_type,'permission',s.perm,'status',s.status,
    'decided_by',p.full_name,'decided_at',s.decided_at,'comment',s.comment) order by s.step_no)
    from approvals.steps s left join org.people p on p.id=s.decided_by where s.request_id=r.id),'[]'),
  -- Narrow projection: never expose the audit table or unrelated event detail.
  'timeline',coalesce((select jsonb_agg(jsonb_build_object('seq',e.seq,'at',e.at,'actor',coalesce(p.full_name,'System'),
    'action',e.action,'step',e.detail->'step','result',e.detail->>'result',
    'reason',case when e.action='approval.cancel' then e.detail->>'reason' when e.action='approval.decide' then s.comment else null end) order by e.seq)
    from audit.events e left join org.people p on p.id=e.actor
    left join approvals.steps s on s.request_id=r.id and s.step_no=(e.detail->>'step')::int
    where e.entity='request' and e.entity_id=r.id::text and e.action in ('approval.submit','approval.decide','approval.cancel')),'[]')) into result;
 return result;
end $$;

create function work.approval_attention(p_division text default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare n bigint;
begin
 if not rbac.active(auth.uid()) then raise exception 'Your profile is not active.'; end if;
 if p_division is not null and p_division not in ('ENG','AMG','COR') then raise exception 'Unknown division.'; end if;
 if rbac.can('ops.read') then
   -- Technical health only. No requester, title, payload, division or business identifier.
   select count(*) into n from approvals.orphaned();
   return jsonb_build_object('orphaned_count',n,'technical_only',true);
 end if;
 select count(*) into n from approvals.requests r
 where r.status='pending' and (p_division is null or r.division=p_division)
  and (r.requester=auth.uid() or r.division=any(rbac.divisions_for('approvals.read')))
  and not exists(select 1 from org.people p where approvals.eligible(p.id,r.id,r.current_step));
 return jsonb_build_object('orphaned_count',n,'technical_only',false);
end $$;

create or replace function notifications.claim() returns table(id bigint,lease uuid,email text,time_zone text,request_id uuid)
language sql security definer set search_path='' as $$
 with candidates as (select o.id from notifications.outbox o join org.people p on p.id=o.person_id
 where o.sent_at is null and o.cancelled_at is null and o.available_at<=now()
 and (o.lease_until is null or o.lease_until<now()) and p.status='active' and (p.expires_at is null or p.expires_at>now())
 order by o.id limit 20 for update of o skip locked),
 claimed as (update notifications.outbox o set lease=gen_random_uuid(),lease_until=now()+interval '5 minutes',attempts=attempts+1
 from candidates c where o.id=c.id returning o.*)
 select c.id,c.lease,p.email,p.time_zone,c.request_id from claimed c join org.people p on p.id=c.person_id;
$$;

create function api.withdraw_request(p_id uuid,p_reason text default null) returns text
language sql security invoker set search_path='' as $$ select work.withdraw_request(p_id,p_reason) $$;
create function api.request_page(p_offset int default 0,p_division text default null,p_status text default 'all',p_view text default 'all') returns jsonb
language sql stable security invoker set search_path='' as $$ select work.request_page(p_offset,p_division,p_status,p_view) $$;
create function api.request_detail(p_id uuid) returns jsonb
language sql stable security invoker set search_path='' as $$ select work.request_detail(p_id) $$;
create function api.approval_attention(p_division text default null) returns jsonb
language sql stable security invoker set search_path='' as $$ select work.approval_attention(p_division) $$;

revoke all on function work.withdraw_request(uuid,text),work.request_page(int,text,text,text),work.request_detail(uuid),work.approval_attention(text),
 api.withdraw_request(uuid,text),api.request_page(int,text,text,text),api.request_detail(uuid),api.approval_attention(text) from public,anon,service_role;
grant execute on function work.withdraw_request(uuid,text),work.request_page(int,text,text,text),work.request_detail(uuid),work.approval_attention(text),
 api.withdraw_request(uuid,text),api.request_page(int,text,text,text),api.request_detail(uuid),api.approval_attention(text) to authenticated;
commit;
