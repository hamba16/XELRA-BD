import { PGlite } from '@electric-sql/pglite';
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist';
import { readFileSync } from 'node:fs';

const db = new PGlite({ extensions: { btree_gist } });
await db.exec(readFileSync(new URL('../sql/core.sql', import.meta.url), 'utf8'));
await db.exec(`
  grant usage on schema org, rbac, hr, fin, approvals, audit, docs, payroll, auth to authenticated;
  grant select on all tables in schema org, rbac, hr to authenticated;
  create function rbac.divisions_for(p_perm text) returns text[] language sql stable security definer set search_path = '' as $$
    select coalesce(array_agg(distinct d.code), '{}') from org.divisions d
    where exists (select 1 from rbac.effective e join org.people pe on pe.id = e.person_id and pe.status='active'
      where e.person_id = auth.uid() and e.perm = p_perm and (e.expires_at is null or e.expires_at > now())
        and (e.scope = 'all' or (e.scope = 'division' and e.division = d.code)));
  $$;
  create function rbac.has_own(p_perm text) returns boolean language sql stable security definer set search_path = '' as $$
    select exists (select 1 from rbac.effective e where e.person_id = auth.uid() and e.perm = p_perm and e.scope = 'own' and (e.expires_at is null or e.expires_at > now()));
  $$;
`);
const D = '00000000-0000-0000-0000-0000000000d1';
await db.exec(`
  insert into org.people (id, full_name, email) values ('${D}','Dir','d@x.test');
  insert into rbac.roles values ('director_eng','D'),('staff','S');
  insert into rbac.role_perms values ('director_eng','leave.read','division'),('staff','leave.read','own');
  insert into rbac.assignments (person_id, role_code, division) values ('${D}','director_eng','ENG');
`);
// 400 staff, 200k leave rows spread across divisions
await db.exec(`
  insert into org.people (id, full_name, email)
    select ('10000000-0000-0000-0000-' || lpad(g::text,12,'0'))::uuid, 'P'||g, 'p'||g||'@x.test' from generate_series(1,400) g;
  insert into hr.leave_requests (person_id, division, starts, ends, status)
    select ('10000000-0000-0000-0000-' || lpad(((g % 400)+1)::text,12,'0'))::uuid,
           (array['ENG','AMG','COR'])[1 + (g % 3)], date '2025-01-01' + (g % 700), date '2025-01-01' + (g % 700) + 2, 'approved'
    from generate_series(1,200000) g;
  analyze;
`);
await db.exec(`grant select on all tables in schema hr to authenticated;`);
async function time(label, policySql) {
  await db.exec(`drop policy if exists leave_read on hr.leave_requests; create policy leave_read on hr.leave_requests for select to authenticated using (${policySql});`);
  await db.exec(`set role authenticated; select set_config('request.jwt.claims','{"sub":"${D}"}', false);`);
  const runs = [];
  let n;
  for (let i = 0; i < 3; i++) {
    const t = performance.now();
    n = (await db.query('select count(*)::int c from hr.leave_requests')).rows[0].c;
    runs.push(performance.now() - t);
  }
  await db.exec(`reset role;`);
  const best = Math.min(...runs);
  console.log(`${label.padEnd(46)} rows visible ${String(n).padStart(6)}   best of 3: ${best.toFixed(0)} ms`);
  return best;
}
const a = await time('A  per-row rbac.can(perm, division, owner)', `rbac.can('leave.read', division, person_id)`);
const b = await time('B  (select rbac.can(...)) correlated wrapper', `(select rbac.can('leave.read', division, person_id))`);
const c = await time('C  set-based: division = any(initPlan array)', `division = any(((select rbac.divisions_for('leave.read')))::text[]) or (person_id = (select auth.uid()) and (select rbac.has_own('leave.read')))`);
console.log(`\nC is ${(a / c).toFixed(1)}x faster than A, ${(b / c).toFixed(1)}x faster than B`);
