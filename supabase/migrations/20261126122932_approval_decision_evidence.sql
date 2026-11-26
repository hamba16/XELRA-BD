begin;

-- Keep the reason inside the hash-chained event for new decisions. Historical
-- events are never rewritten; their existing step comments remain a fallback.
create or replace function approvals.decide_unchecked(p_req uuid,p_approve boolean,p_comment text default null) returns text
language plpgsql security definer set search_path='' as $$
declare r approvals.requests; total int; res text; reason text:=nullif(btrim(p_comment),'');
begin
 if length(coalesce(reason,''))>2000 then raise exception 'Keep the decision reason within 2,000 characters.'; end if;
 select * into r from approvals.requests where id=p_req for update;
 if r.id is null or r.status<>'pending' then raise exception 'This request is no longer open.'; end if;
 if not approvals.eligible(auth.uid(),p_req,r.current_step) then raise exception 'You cannot decide this step.'; end if;
 update approvals.steps set status=case when p_approve then 'approved' else 'rejected' end,
  decided_by=auth.uid(),decided_at=now(),comment=reason where request_id=p_req and step_no=r.current_step;
 select count(*) into total from approvals.steps where request_id=p_req;
 if not p_approve then res:='rejected'; elsif r.current_step>=total then res:='approved'; else res:='pending'; end if;
 update approvals.requests set status=res,current_step=case when res='pending' then current_step+1 else current_step end where id=p_req;
 perform audit.log('approval.decide','request',p_req::text,jsonb_build_object('approve',p_approve,'step',r.current_step,'result',res,'reason',reason));
 return res;
end $$;

create or replace function work.request_detail(p_id uuid) returns jsonb
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
    'decided_by',p.full_name,'decided_at',s.decided_at,
    'comment',case when evidence.detail ? 'reason' then evidence.detail->>'reason' else s.comment end) order by s.step_no)
    from approvals.steps s left join org.people p on p.id=s.decided_by
    left join lateral (select e.detail from audit.events e where e.entity='request' and e.entity_id=r.id::text
     and e.action='approval.decide' and (e.detail->>'step')::int=s.step_no order by e.seq desc limit 1) evidence on true
    where s.request_id=r.id),'[]'),
  'timeline',coalesce((select jsonb_agg(jsonb_build_object('seq',e.seq,'at',e.at,'actor',coalesce(p.full_name,'System'),
    'action',e.action,'step',e.detail->'step','result',e.detail->>'result',
    'reason',case when e.detail ? 'reason' then e.detail->>'reason' when e.action='approval.decide' then s.comment else null end) order by e.seq)
    from audit.events e left join org.people p on p.id=e.actor
    left join approvals.steps s on s.request_id=r.id and s.step_no=(e.detail->>'step')::int
    where e.entity='request' and e.entity_id=r.id::text and e.action in ('approval.submit','approval.decide','approval.cancel')),'[]')) into result;
 return result;
end $$;
commit;
