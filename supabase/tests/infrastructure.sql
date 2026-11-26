-- Actual migrations, with all fixtures rolled back.
begin;
do $$ declare r text; begin
  foreach r in array array['anon','authenticated'] loop
    if has_schema_privilege(r, 'private', 'USAGE')
      or has_function_privilege(r, 'public.record_heartbeat(text)', 'EXECUTE')
      or has_function_privilege(r, 'public.infrastructure_health()', 'EXECUTE')
      or has_function_privilege(r, 'public.record_meter(text,numeric,numeric)', 'EXECUTE')
    then raise exception 'operations exposed to %', r; end if;
  end loop;
  if exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname in ('public','private') and c.relkind='r'
      and (not c.relrowsecurity or not c.relforcerowsecurity))
  then raise exception 'foundation table missing RLS'; end if;
end $$;
set local role authenticated;
do $$ begin
  perform public.record_heartbeat('backup');
  raise exception 'authenticated heartbeat unexpectedly permitted';
exception when insufficient_privilege then null; end $$;
reset role;
set local role anon;
do $$ begin
  perform public.infrastructure_health();
  raise exception 'anonymous health unexpectedly permitted';
exception when insufficient_privilege then null; end $$;
reset role;
set local role service_role;
select public.record_heartbeat('backup');
select public.record_heartbeat('keepalive');
select public.record_heartbeat('restore_drill');
select public.record_meter('hosting_credits', 85, 100);
do $$ declare h jsonb; begin
  h := public.infrastructure_health();
  if not (h->>'backup_ok')::boolean or not (h->>'keepalive_ok')::boolean
    or not (h->>'restore_drill_ok')::boolean
    or not (h->'meters'->0->>'critical')::boolean
  then raise exception 'health positive control failed'; end if;
  begin
    perform public.record_heartbeat('unknown');
    raise exception 'invalid heartbeat accepted';
  exception when check_violation then null; end;
  begin
    perform public.record_meter('hosting_credits', -1, 100);
    raise exception 'negative meter accepted';
  exception when check_violation then null; end;
end $$;
reset role;
update private.ops_heartbeats set succeeded_at = now() - interval '40 days';
do $$ begin
  if (public.infrastructure_health()->>'backup_ok')::boolean
    or (public.infrastructure_health()->>'restore_drill_ok')::boolean
  then raise exception 'stale success treated as healthy'; end if;
end $$;
create table public.future_probe(id uuid);
create function public.future_probe() returns int language sql as $$ select 1 $$;
do $$ begin
  if has_table_privilege('authenticated','public.future_probe','SELECT')
    or has_function_privilege('anon','public.future_probe()','EXECUTE')
    or has_function_privilege('service_role','public.future_probe()','EXECUTE')
  then raise exception 'default privilege regression'; end if;
end $$;
rollback;
