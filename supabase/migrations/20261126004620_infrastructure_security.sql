-- Foundation only. No application roles, employees, payroll or development users.
begin;
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
revoke create on schema public from public, anon, authenticated;
-- PUBLIC EXECUTE must be revoked globally, not only per schema.
alter default privileges for role postgres revoke execute on functions from public;
alter default privileges for role postgres in schema public
  revoke all on tables from anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  revoke all on sequences from anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  revoke execute on functions from anon, authenticated, service_role;
alter default privileges for role postgres in schema private
  revoke all on tables from public, anon, authenticated, service_role;
alter default privileges for role postgres in schema private
  revoke execute on functions from public, anon, authenticated, service_role;
commit;
