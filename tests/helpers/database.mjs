import { readFileSync, readdirSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist';

export const id = n => `10000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
export async function database() {
  const db = new PGlite({ extensions: { btree_gist } });
  try {
    await db.exec(readFileSync('tests/bootstrap-postgres.sql', 'utf8'));
    await db.exec(`create schema auth; create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$; grant usage on schema auth to authenticated; grant execute on function auth.uid() to authenticated;`);
    for (const file of readdirSync('supabase/migrations').filter(f => f.endsWith('.sql')).sort()) {
      try { await db.exec(readFileSync(`supabase/migrations/${file}`, 'utf8')); }
      catch (error) { throw Error(`${file}: ${error.message}`, { cause: error.code }); }
    }
    const rows = async (sql, args) => (await db.query(sql, args)).rows;
    const value = async (sql, args) => Object.values((await rows(sql, args))[0])[0];
    const as = async (user, fn) => {
      await db.exec('set role authenticated');
      await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user]);
      try { return await fn(); } finally { await db.exec('reset role'); }
    };
    for (const [n, role, division, principal] of [[1,'central_director','COR','staff'],[2,'staff','ENG','staff'],[3,'staff','AMG','staff'],[4,'it_admin','COR','it_admin'],[5,'client','ENG','client'],[6,'finance_manager','COR','staff'],[7,'hr_lead','COR','staff'],[8,'director_eng','ENG','staff'],[9,'auditor','COR','auditor'],[10,'contractor','ENG','contractor']]) {
      await db.query('insert into org.people(id,full_name,email,principal) values($1,$2,$3,$4)', [id(n),`Synthetic ${role}`,`person${n}@xelra.test`,principal]);
      await db.query('insert into rbac.assignments(person_id,role_code,division) values($1,$2,$3)',[id(n),role,division]);
    }
    await db.query('update org.people set manager_id=$1 where id=$2',[id(1),id(2)]);
    await db.query("insert into work.projects(code,division,title,created_by) values('P014','ENG','Synthetic survey',$1),('P022','AMG','Synthetic assessment',$1)",[id(1)]);
    await db.query("insert into work.project_members(project,person_id) values('P014',$1),('P014',$2),('P014',$3)",[id(2),id(5),id(10)]);
    return { db, rows, value, as };
  } catch (error) { await db.close(); throw error; }
}
