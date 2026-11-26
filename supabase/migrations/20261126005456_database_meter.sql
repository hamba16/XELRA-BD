begin;
create function public.record_database_meter(p_capacity numeric) returns void
language sql security invoker set search_path = '' as $$
  select public.record_meter('database_bytes',
    pg_catalog.pg_database_size(pg_catalog.current_database()), p_capacity);
$$;
revoke all on function public.record_database_meter(numeric) from public, anon, authenticated;
grant execute on function public.record_database_meter(numeric) to service_role;
commit;
