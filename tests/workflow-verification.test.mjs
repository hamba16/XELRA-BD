import test from 'node:test';
import assert from 'node:assert/strict';
import { database, id } from './helpers/database.mjs';

test('communication, timesheets and support calendars enforce current access and validation',async()=>{
 const {db,as,value,rows}=await database();
 try {
  await as(id(2),()=>value("select api.post_project_message('P014','Site update')"));
  assert.equal((await as(id(10),()=>value("select api.project_thread('P014')"))).length,1);
  await as(id(3),()=>assert.rejects(()=>value("select api.project_thread('P014')"),/not available/));
  await as(id(9),()=>assert.rejects(()=>value("select api.post_project_message('P014','Auditor message')"),/cannot post/));
  await as(id(1),()=>value("select api.assign_project_member('P014',$1,now()+interval '1 day')",[id(3)]));
  assert.equal((await as(id(3),()=>value("select api.project_thread('P014')"))).length,1);
  await db.query("update work.project_members set expires_at=now()-interval '1 second' where person_id=$1",[id(3)]);
  assert.equal((await as(id(3),()=>rows('select * from work.project_messages'))).length,0);
  const sheet=await as(id(2),()=>value("select api.save_timesheet('ENG','2026-11-01','2026-11-07','[{\"date\":\"2026-11-02\",\"hours\":8,\"description\":\"Site survey\",\"project\":\"P014\"}]')"));
  await as(id(2),()=>assert.rejects(()=>value("select api.save_timesheet('ENG','2026-11-01','2026-11-07','[{\"date\":\"2026-11-02\",\"hours\":18,\"description\":\"Work\"},{\"date\":\"2026-11-02\",\"hours\":8,\"description\":\"Work\"}]')"),/24 recorded/));
  const request=await as(id(2),()=>value('select api.submit_timesheet($1)',[sheet]));
  await as(id(3),()=>assert.rejects(()=>value('select api.decide_request($1,true)',[request]),/cannot decide/));
  await as(id(1),()=>value('select api.decide_request($1,true)',[request]));
  assert.equal((await as(id(2),()=>value('select api.timesheet_page()')))[0].approval_status,'approved');
  assert.equal((await as(id(4),()=>rows('select * from hr.timesheets'))).length,0);
  const calendar={timeZone:'Africa/Kampala',weekdays:{1:[[540,1020]]},holidays:['2026-12-25'],workingDayMinutes:480};
  await as(id(2),()=>assert.rejects(()=>value('select api.set_support_calendar($1,$2)',['ENG',calendar]),/cannot configure/));
  await as(id(4),()=>value('select api.set_support_calendar($1,$2)',['ENG',calendar]));
  await as(id(4),()=>assert.rejects(()=>value('select api.set_support_calendar($1,$2)',['ENG',{...calendar,weekdays:{1:[[540,1020],[900,1100]]}}]),/non-overlapping/));
  const ticket=await as(id(2),()=>value("select api.create_ticket('Problem','Description','Access')"));
  assert.deepEqual((await as(id(2),()=>value('select api.ticket_detail($1)',[ticket]))).calendar,calendar);
  const summary=await as(id(1),()=>value('select api.dashboard()'));
  assert.equal(summary.cash_position,null); assert.ok(summary.headcount.length>0);
  assert.equal((await as(id(4),()=>value('select api.dashboard()'))).headcount.length,0);
 } finally {await db.close();}
});

test('local archived event copies retain checksum, chain integrity and append-only storage',async()=>{
 const {db,as,value}=await database();
 try {
  await db.query(`insert into audit.events(at,actor,action,entity,entity_id,detail,prev_hash,hash)
  select t,$1,'synthetic.old','fixture','old','{}','genesis',audit.stamp('genesis',t,$1,'synthetic.old','fixture','old','{}')
  from (select now()-interval '13 months' as t) d`,[id(1)]);
  const archive=await as(id(1),()=>value('select api.export_audit_archive()'));
  assert.equal(archive.events.length,1);
  assert.equal((await as(id(1),()=>value('select api.verify_audit_archive($1,$2)',[archive.id,archive.events]))).ok,true);
  const changed=structuredClone(archive.events); changed[0].action='tampered';
  assert.equal((await as(id(1),()=>value('select api.verify_audit_archive($1,$2)',[archive.id,changed]))).ok,false);
  await as(id(4),()=>assert.rejects(()=>value('select api.export_audit_archive()'),/cannot archive/));
  await assert.rejects(()=>db.query('delete from audit.archives where id=$1',[archive.id]),/append-only/);
  assert.equal(await value('select count(*)::int from audit.events'),2);
  assert.equal(await value('select ok from audit.verify()'),true);
 } finally {await db.close();}
});

test('notification history, read ownership, expired messages and exhausted retries',async()=>{
 const {db,as,value,rows}=await database();
 try {
  await db.query("update org.people set time_zone='UTC' where id=$1",[id(2)]);
  const notification=await value("insert into notifications.outbox(person_id,event,expires_at) values($1,'approval.approved',now()-interval '1 second') returning id",[id(2)]);
  assert.equal((await as(id(2),()=>value('select api.notification_page()'))).length,1);
  assert.equal((await as(id(3),()=>value('select api.notification_page()'))).length,0);
  assert.equal(await as(id(3),()=>value('select api.read_notification($1)',[notification])),false);
  assert.equal(await as(id(2),()=>value('select api.read_notification($1)',[notification])),true);
  await db.exec('set role service_role');
  assert.equal((await rows('select * from api.claim_notifications()')).length,0);
  await db.exec('reset role');
  await db.query("update notifications.outbox set expires_at=now()+interval '1 day',attempts=8 where id=$1",[notification]);
  await db.exec('set role service_role'); assert.equal((await rows('select * from api.claim_notifications()')).length,0); await db.exec('reset role');
  await as(id(2),()=>assert.rejects(()=>value('select api.claim_notifications()'),/permission denied/));
 } finally {await db.close();}
});

test('revocation rejects old tokens and auditor findings expire with their named seat',async()=>{
 const {db,as,value,rows}=await database();
 try {
  await db.exec("select set_config('request.jwt.claims','{\"iat\":1}',false)");
  await as(id(2),()=>assert.rejects(()=>value("select api.revoke_profile_sessions($1,'No authority')",[id(3)]),/cannot revoke/));
  await as(id(4),()=>value("select api.revoke_profile_sessions($1,'Synthetic lost-device exercise')",[id(2)]));
  await as(id(2),()=>assert.rejects(()=>value("select api.create_ticket('Blocked','Old token','Access')"),/not active/));
  assert.equal((await as(id(2),()=>rows('select * from api.projects'))).length,0);
  await db.exec("select set_config('request.jwt.claims',jsonb_build_object('iat',ceil(extract(epoch from clock_timestamp()))+1)::text,false)");
  await as(id(2),()=>value("select api.create_ticket('Fresh token','New token works','Access')"));
  await as(id(1),()=>value("select api.assign_project_member('P014',$1,now()+interval '1 day')",[id(9)]));
  const finding=await as(id(9),()=>value("select api.submit_audit_finding('P014','Evidence review','Synthetic finding detail')"));
  const list=await as(id(9),()=>value("select api.audit_finding_page('P014')"));
  assert.equal(list[0].id,finding); assert.equal(list[0].initials,'SA'); assert.equal(list[0].approval_status,'pending');
  await as(id(5),()=>assert.rejects(()=>value("select api.audit_finding_page('P014')"),/not available/));
  assert.equal((await as(id(4),()=>rows('select * from work.audit_findings'))).length,0);
  const request=await value('select request_id from work.audit_findings where id=$1',[finding]);
  await as(id(1),()=>value('select api.decide_request($1,true)',[request]));
  assert.equal((await as(id(9),()=>value("select api.audit_finding_page('P014')")))[0].approval_status,'approved');
  await db.query("update org.people set expires_at=now()-interval '1 second' where id=$1",[id(9)]);
  await as(id(9),()=>assert.rejects(()=>value("select api.audit_finding_page('P014')"),/not available/));
  assert.equal((await as(id(9),()=>rows('select * from work.audit_findings'))).length,0);
  assert.equal(await value('select ok from audit.verify()'),true);
 } finally {await db.close();}
});
