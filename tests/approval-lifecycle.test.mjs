import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {btree_gist} from '@electric-sql/pglite/contrib/btree_gist';

test('approval lifecycle: ownership, terminal states, scoped history, orphan health and notification leases',async t=>{
 const db=new PGlite({extensions:{btree_gist}});
 const id=n=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
 const U={director:id(1),requester:id(2),peer:id(3),engDirector:id(4),amg:id(5),it:id(6),client:id(7),contractor:id(8),auditor:id(9)};
 const rows=async(sql,args)=>(await db.query(sql,args)).rows;
 const value=async(sql,args)=>Object.values((await rows(sql,args))[0])[0];
 const as=async(user,fn)=>{await db.exec(`set role authenticated;select set_config('request.jwt.claim.sub','${user}',false)`);try{return await fn();}finally{await db.exec('reset role');}};
 const submit=(who=U.requester,div='ENG',amount=80000)=>as(who,()=>value("select api.submit_request('expense',$1,$2,'{\"title\":\"Materials\",\"description\":\"A scoped request\"}')",[div,amount]));
 try{
  await db.exec(readFileSync('tests/bootstrap-postgres.sql','utf8'));
  await db.exec(`create schema auth;create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;`);
  for(const f of readdirSync('supabase/migrations').sort())await db.exec(readFileSync(`supabase/migrations/${f}`,'utf8'));
  for(const [name,uuid] of Object.entries(U))await db.query('insert into org.people(id,full_name,email,principal) values($1,$2,$3,$4)',[uuid,name,`${name}@xelra.test`,['client','contractor','auditor'].includes(name)?name:name==='it'?'it_admin':'staff']);
  await db.exec(`update org.people set manager_id='${U.director}' where id in ('${U.requester}','${U.amg}');
   insert into rbac.assignments(person_id,role_code,division) values
   ('${U.director}','central_director','COR'),('${U.requester}','staff','ENG'),('${U.peer}','staff','ENG'),('${U.engDirector}','director_eng','ENG'),('${U.amg}','staff','AMG'),('${U.it}','it_admin','COR');`);
  let withdrawn,approved,rejected,stuck,amgRequest;
  await t.test('owner withdrawal is audited once and invalidates pending reminders/leases',async()=>{
   withdrawn=await submit();
   for(const u of [U.peer,U.engDirector,U.director,U.it,U.client,U.contractor,U.auditor])await as(u,()=>assert.rejects(()=>value('select api.withdraw_request($1)',[withdrawn]),/cannot withdraw/));
   await db.exec('set role service_role');const claims=await rows('select * from api.claim_notifications()');await db.exec('reset role');
   const claim=claims.find(c=>c.request_id===withdrawn);assert.ok(claim);
   await as(U.requester,()=>assert.rejects(()=>value('select api.withdraw_request($1,$2)',[withdrawn,'x'.repeat(2001)]),/2,000/));
   assert.equal(await as(U.requester,()=>value("select api.withdraw_request($1,'Order no longer needed')",[withdrawn])),'cancelled');
   assert.equal(await value("select count(*)::int from approvals.steps where request_id=$1 and status='waiting'",[withdrawn]),0);
   await db.exec('set role service_role');await rows('select api.finish_notification($1,$2,true)',[claim.id,claim.lease]);
   const after=await rows('select * from api.claim_notifications()');await db.exec('reset role');
   assert.ok(!after.some(c=>c.id===claim.id));
   const old=(await rows('select cancelled_at,sent_at from notifications.outbox where id=$1',[claim.id]))[0];assert.ok(old.cancelled_at);assert.equal(old.sent_at,null);
   assert.equal(await value("select count(*)::int from notifications.outbox where request_id=$1 and event='approval.cancelled'",[withdrawn]),2);
   await as(U.requester,()=>assert.rejects(()=>value('select api.withdraw_request($1)',[withdrawn]),/no longer open/));
   await as(U.director,()=>assert.rejects(()=>value('select api.decide_request($1,true)',[withdrawn]),/no longer open/));
   const detail=await as(U.requester,()=>value('select api.request_detail($1)',[withdrawn]));
   assert.equal(detail.request.can_withdraw,false);assert.equal(detail.request.can_decide,false);
   assert.equal(detail.timeline.filter(e=>e.action==='approval.cancel').length,1);
   assert.equal(detail.timeline.at(-1).reason,'Order no longer needed');
  });
  await t.test('final approval and rejection cannot be withdrawn; reasons are retained',async()=>{
   approved=await submit();await as(U.director,()=>value('select api.decide_request($1,true)',[approved]));
   await as(U.requester,()=>assert.rejects(()=>value('select api.withdraw_request($1)',[approved]),/no longer open/));
   rejected=await submit();await as(U.director,()=>value("select api.decide_request($1,false,'Attach the supplier quote.')",[rejected]));
   await as(U.requester,()=>assert.rejects(()=>value('select api.withdraw_request($1)',[rejected]),/no longer open/));
   const d=await as(U.requester,()=>value('select api.request_detail($1)',[rejected]));
   assert.equal(d.steps[0].comment,'Attach the supplier quote.');assert.equal(d.timeline.at(-1).reason,'Attach the supplier quote.');
   await as(U.peer,()=>assert.rejects(()=>value('select api.request_detail($1)',[rejected]),/not available/));
  });
  await t.test('withdrawal after an intermediate approval keeps completed history',async()=>{
   const request=await submit(U.requester,'ENG',700000);
   assert.equal(await as(U.director,()=>value('select api.decide_request($1,true)',[request])),'pending');
   await as(U.requester,()=>value('select api.withdraw_request($1)',[request]));
   const d=await as(U.requester,()=>value('select api.request_detail($1)',[request]));
   assert.deepEqual(d.steps.map(s=>s.status),['approved','skipped']);assert.equal(d.timeline.length,3);
  });
  await t.test('division reviewers and owners see only authorised detail/history',async()=>{
   amgRequest=await submit(U.amg,'AMG');
   const permitted=await as(U.engDirector,()=>value("select api.request_page(0,null,'all','all')"));
   assert.ok(permitted.items.length>0&&permitted.items.every(r=>r.division==='ENG'));
   await as(U.engDirector,()=>assert.rejects(()=>value('select api.request_detail($1)',[amgRequest]),/not available/));
   for(const u of [U.it,U.client,U.contractor,U.auditor,U.peer])await as(u,async()=>{
    assert.deepEqual((await value('select api.request_page()')).items,[]);
    await assert.rejects(()=>value('select api.request_detail($1)',[withdrawn]),/not available/);
   });
   await db.exec(`update org.people set status='suspended' where id='${U.requester}'`);
   await as(U.requester,()=>assert.rejects(()=>value('select api.request_detail($1)',[withdrawn]),/not active/));
   await as(U.requester,()=>assert.rejects(()=>value('select api.withdraw_request($1)',[approved]),/not active/));
   await db.exec(`update org.people set status='active' where id='${U.requester}'`);
  });
  await t.test('orphan detection is scoped and IT receives only aggregate health',async()=>{
   stuck=await submit();
   await db.exec(`update org.people set status='offboarded' where id='${U.director}'`);
   const d=await as(U.engDirector,()=>value("select api.request_page(0,'ENG','pending','stuck')"));
   assert.ok(d.items.some(r=>r.id===stuck));assert.ok(!d.items.some(r=>r.id===amgRequest));
   const health=await as(U.it,()=>value('select api.approval_attention()'));
   assert.deepEqual(Object.keys(health).sort(),['orphaned_count','technical_only']);assert.equal(health.technical_only,true);assert.ok(health.orphaned_count>=2);
   const mine=await as(U.requester,()=>value('select api.approval_attention()'));assert.equal(mine.orphaned_count,1);
   await db.exec(`update org.people set manager_id='${U.engDirector}' where id='${U.requester}'`);
   assert.equal((await as(U.requester,()=>value('select api.approval_attention()'))).orphaned_count,0);
   await db.exec(`update org.people set status='active' where id='${U.director}'`);
  });
  await t.test('51-row fetch yields distinct stable pages with filters and denied invalid input',async()=>{
   for(let n=0;n<51;n++)await submit();
   const first=await as(U.requester,()=>value("select api.request_page(0,'ENG','pending','mine')"));
   const second=await as(U.requester,()=>value("select api.request_page(50,'ENG','pending','mine')"));
   assert.equal(first.items.length,50);assert.equal(first.has_more,true);assert.equal(second.has_more,false);assert.ok(second.items.length>0);
   assert.equal(new Set([...first.items,...second.items].map(r=>r.id)).size,first.items.length+second.items.length);
   const closed=await as(U.requester,()=>value("select api.request_page(0,'ENG','cancelled','mine')"));assert.ok(closed.items.every(r=>r.status==='cancelled'));
   await as(U.requester,()=>assert.rejects(()=>value("select api.request_page(-1)"),/Invalid request page/));
   await as(U.requester,()=>assert.rejects(()=>value("select api.request_page(0,'UNKNOWN')"),/Unknown division/));
   await as(U.requester,()=>assert.rejects(()=>value("select api.request_page(0,null,'bad')"),/Unknown request status/));
  });
  await t.test('anonymous API access and direct table writes remain denied; chain verifies',async()=>{
   await db.exec('set role anon');await assert.rejects(()=>rows('select api.request_page()'),/permission denied/);await assert.rejects(()=>rows('select api.withdraw_request($1)',[stuck]),/permission denied/);await db.exec('reset role');
   await as(U.requester,()=>assert.rejects(()=>rows("update approvals.requests set status='cancelled' where id=$1",[stuck]),/permission denied/));
   assert.equal((await rows('select * from audit.verify()'))[0].ok,true);
  });
 }finally{await db.close();}
});
