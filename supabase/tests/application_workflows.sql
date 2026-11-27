-- Runs against actual migrations in both PGlite and disposable native Postgres.
do $$ declare t record; p record; begin
 for t in select n.nspname,c.relname,c.oid,c.relrowsecurity,c.relforcerowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace
 where (n.nspname,c.relname) in (('rbac','session_revocations'),('work','audit_findings'),('work','support_calendars'),('work','tickets'),('work','ticket_messages'),('work','milestones'),('work','asset_custody'),('work','checklist_templates'),('work','checklist_runs'),('work','project_messages'),
 ('hr','contracts'),('hr','leave_entries'),('hr','timesheets'),('fin','records'),('fin','accounts'),('fin','journals'),('payroll','periods'),('payroll','lines'),('audit','archives')) loop
 if not t.relrowsecurity or not t.relforcerowsecurity then raise exception 'Workflow table %.% is missing forced RLS',t.nspname,t.relname; end if;
 if not exists(select 1 from pg_policy where polrelid=t.oid and polcmd='r') then raise exception 'Workflow table %.% has no read policy',t.nspname,t.relname; end if;
 if has_table_privilege('authenticated',t.oid,'INSERT,UPDATE,DELETE,TRUNCATE') or has_table_privilege('anon',t.oid,'SELECT') then raise exception 'Unmediated workflow table access: %.%',t.nspname,t.relname; end if;
 end loop;
 for p in select proc.oid,proc.proname,proc.prosecdef from pg_proc proc join pg_namespace n on n.oid=proc.pronamespace where n.nspname='api' loop
 if p.prosecdef then raise exception 'API wrapper % must be security invoker',p.proname; end if;
 if has_function_privilege('anon',p.oid,'EXECUTE') then raise exception 'Anonymous API execution: %',p.proname; end if;
 end loop;
end $$;
