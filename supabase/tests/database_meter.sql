begin;
do $$ begin
  if has_function_privilege('anon','public.record_database_meter(numeric)','EXECUTE')
    or has_function_privilege('authenticated','public.record_database_meter(numeric)','EXECUTE')
  then raise exception 'database meter exposed'; end if;
end $$;
set local role service_role;
select public.record_database_meter(500000000);
do $$ begin
  if not exists(select 1 from private.ops_meters
    where kind = 'database_bytes' and value > 0 and capacity = 500000000)
  then raise exception 'database size was not measured'; end if;
end $$;
rollback;
