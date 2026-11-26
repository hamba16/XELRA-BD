-- Test-only stand-ins for Supabase's database roles. NEVER a production migration.
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
grant usage on schema public to anon, authenticated, service_role;
-- Exercise the stricter migration against legacy permissive defaults too.
alter default privileges for role postgres in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges for role postgres in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges for role postgres in schema public grant execute on functions to anon, authenticated, service_role;
