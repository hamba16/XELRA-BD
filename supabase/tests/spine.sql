-- Read-only invariants also run after a disposable restore.
do $$ declare result record; begin
 if exists(select 1 from audit.tables_without_rls()) then raise exception 'Application table missing RLS'; end if;
 select * into result from audit.verify();
 if not result.ok then raise exception 'Audit chain fails at event %',result.first_bad_seq; end if;
 if has_function_privilege('anon','api.profile()','execute') or has_function_privilege('authenticated','api.claim_notifications()','execute')
 or has_function_privilege('authenticated','rbac.grant_perm(uuid,text,text,text,uuid,timestamptz)','execute')
 or has_function_privilege('authenticated','audit.log(text,text,text,jsonb)','execute') then raise exception 'Privileged function exposed'; end if;
end $$;
