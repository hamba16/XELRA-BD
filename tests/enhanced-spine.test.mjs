import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {btree_gist} from '@electric-sql/pglite/contrib/btree_gist';

test('actual migrations: scope, API privileges, inactive approvers and idempotency',async()=>{
 const db=new PGlite({extensions:{btree_gist}});
 try{
 await db.exec(readFileSync('tests/bootstrap-postgres.sql','utf8'));
 // Only this disposable test harness defines Supabase auth helpers.
 await db.exec(`create schema auth; create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$; grant usage on schema auth to authenticated; grant execute on function auth.uid() to authenticated;`);
 for(const f of readdirSync('supabase/migrations').sort())await db.exec(readFileSync(`supabase/migrations/${f}`,'utf8'));
 const ids={director:'00000000-0000-0000-0000-000000000001',engineer:'00000000-0000-0000-0000-000000000002',client:'00000000-0000-0000-0000-000000000003',other:'00000000-0000-0000-0000-000000000004',admin:'00000000-0000-0000-0000-000000000005'};
 await db.exec(`insert into org.people(id,full_name,email,principal) values
 ('${ids.director}','Director','director@xelra.test','staff'),('${ids.engineer}','Engineer','engineer@xelra.test','staff'),('${ids.client}','Client','client@xelra.test','client'),('${ids.other}','Other','other@xelra.test','staff'),('${ids.admin}','IT','it@xelra.test','it_admin');
 update org.people set manager_id='${ids.director}' where id='${ids.engineer}';
 insert into rbac.assignments(person_id,role_code,division) values ('${ids.director}','central_director','COR'),('${ids.engineer}','staff','ENG'),('${ids.other}','staff','AMG'),('${ids.admin}','it_admin','COR');
 insert into work.projects(code,division,title,created_by) values ('P014','ENG','Test project','${ids.director}'),('P022','AMG','Private project','${ids.director}');
 insert into work.project_members values ('P014','${ids.engineer}'),('P014','${ids.client}');
 insert into hr.pay values ('${ids.engineer}','ENG',1000000,'encrypted-placeholder');`);
 const as=async(id,fn)=>{await db.exec(`set role authenticated;select set_config('request.jwt.claim.sub','${id}',false)`);try{return await fn();}finally{await db.exec('reset role');}};
 const rows=async(sql,args)=>(await db.query(sql,args)).rows;
 await as(ids.engineer,async()=>{
   assert.equal((await rows('select * from api.projects')).length,1);
   await assert.rejects(()=>rows("select api.submit_request('expense','AMG',80000,'{\"title\":\"Bad\"}')"),/assigned division/);
   await assert.rejects(()=>rows("select api.submit_request('expense','ENG',-1,'{\"title\":\"Bad\"}')"),/above zero/);
   await assert.rejects(()=>rows("select audit.log('forged')"),/permission denied/);
   await assert.rejects(()=>rows('select * from hr.pay'),/permission denied/);
   await assert.rejects(()=>rows("select rbac.grant_perm($1,'pay.read','all',null,$1,now()+interval '1 day')",[ids.engineer]),/permission denied/);
 });
 await as(ids.client,async()=>assert.equal((await rows('select * from api.projects')).length,0));
 await db.exec("update work.projects set published=true where code='P014'");
 await as(ids.client,async()=>assert.equal((await rows('select * from api.projects')).length,0));
 await db.exec("update work.projects set payment_recorded_at=now() where code='P014'");
 await as(ids.client,async()=>{assert.equal((await rows('select * from api.projects')).length,1);await assert.rejects(()=>rows("select api.sync_field_report('77777777-7777-7777-7777-777777777777','P014','{}',now())"),/cannot submit/);});
 const req=await as(ids.engineer,async()=>(await rows("select api.submit_request('expense','ENG',80000,'{\"title\":\"Materials\"}') id"))[0].id);
 await as(ids.engineer,async()=>await assert.rejects(()=>rows('select api.decide_request($1,true)',[req]),/cannot decide/));
 await db.exec(`update org.people set status='suspended' where id='${ids.director}'`);
 await as(ids.director,async()=>{await assert.rejects(()=>rows('select api.decide_request($1,true)',[req]),/not active/);assert.equal((await rows('select * from api.projects')).length,0);});
 await db.exec(`update org.people set status='active' where id='${ids.director}'`);
 await as(ids.director,async()=>{await assert.rejects(()=>rows("select api.decide_request($1,false,'  ')",[req]),/what to change/);assert.equal((await rows('select api.decide_request($1,true) result',[req]))[0].result,'approved');});
 await as(ids.engineer,async()=>{
  const sql="select api.sync_field_report('77777777-7777-7777-7777-777777777777','P014',$1,'2026-11-26T08:00:00Z') result";
  assert.equal((await rows(sql,['{"note":"Site checked"}']))[0].result,'created');
  assert.equal((await rows(sql,['{"note":"Site checked"}']))[0].result,'duplicate');
  await assert.rejects(()=>rows(sql,['{"note":"Changed"}']),/different content/);
 });
 await as(ids.other,async()=>await assert.rejects(()=>rows("select api.sync_field_report('77777777-7777-7777-7777-777777777777','P014','{}',now())"),/cannot submit/));
 await as(ids.admin,async()=>{assert.equal((await rows('select * from api.projects')).length,0);await assert.rejects(()=>rows('select * from hr.pay'),/permission denied/);});
 assert.equal((await rows('select * from audit.verify()'))[0].ok,true);
 assert.equal((await rows("select count(*)::int n from pg_tables where schemaname in ('org','rbac','hr','fin','approvals','audit','docs','payroll','work','notifications') and not rowsecurity"))[0].n,0);
 await db.exec('set role anon');await assert.rejects(()=>rows('select api.profile()'),/permission denied/);await db.exec('reset role');
 for(const f of readdirSync('supabase/tests').sort())await db.exec(readFileSync(`supabase/tests/${f}`,'utf8'));
 }finally{await db.close();}
});
