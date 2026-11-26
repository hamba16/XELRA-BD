begin;
-- System scope is explicit; these are not staff or business records.
create table private.ops_heartbeats (
  kind text primary key check (kind in ('backup', 'keepalive', 'restore_drill')),
  scope text not null default 'system' check (scope = 'system'),
  succeeded_at timestamptz not null default now()
);
alter table private.ops_heartbeats enable row level security;
alter table private.ops_heartbeats force row level security;
create table private.ops_meters (
  kind text primary key check (kind in ('database_bytes', 'r2_bytes', 'hosting_credits')),
  scope text not null default 'system' check (scope = 'system'),
  value numeric not null check (value >= 0),
  capacity numeric not null check (capacity > 0),
  measured_at timestamptz not null default now()
);
alter table private.ops_meters enable row level security;
alter table private.ops_meters force row level security;
-- SECURITY INVOKER: only the service role can call these RPCs.
grant usage on schema private to service_role;
grant select, insert, update on private.ops_heartbeats, private.ops_meters to service_role;
create function public.record_heartbeat(p_kind text) returns void
language sql security invoker set search_path = '' as $$
  insert into private.ops_heartbeats(kind) values (p_kind)
  on conflict (kind) do update set succeeded_at = now();
$$;
revoke all on function public.record_heartbeat(text) from public, anon, authenticated;
grant execute on function public.record_heartbeat(text) to service_role;
create function public.record_meter(p_kind text, p_value numeric, p_capacity numeric)
returns void language sql security invoker set search_path = '' as $$
  insert into private.ops_meters(kind, value, capacity) values (p_kind, p_value, p_capacity)
  on conflict (kind) do update set value = excluded.value,
    capacity = excluded.capacity, measured_at = now();
$$;
revoke all on function public.record_meter(text, numeric, numeric) from public, anon, authenticated;
grant execute on function public.record_meter(text, numeric, numeric) to service_role;
create function public.infrastructure_health() returns jsonb
language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'backup_ok', coalesce((select succeeded_at > now() - interval '30 hours'
      from private.ops_heartbeats where kind = 'backup'), false),
    'keepalive_ok', coalesce((select succeeded_at > now() - interval '3 days'
      from private.ops_heartbeats where kind = 'keepalive'), false),
    'restore_drill_ok', coalesce((select succeeded_at > now() - interval '35 days'
      from private.ops_heartbeats where kind = 'restore_drill'), false),
    'meters', coalesce((select jsonb_agg(jsonb_build_object(
      'kind', kind, 'ratio', value / capacity,
      'warning', value / capacity >= 0.70,
      'critical', value / capacity >= 0.85,
      'stale', measured_at < now() - interval '30 hours')) from private.ops_meters), '[]'::jsonb)
  );
$$;
revoke all on function public.infrastructure_health() from public, anon, authenticated;
grant execute on function public.infrastructure_health() to service_role;
commit;
