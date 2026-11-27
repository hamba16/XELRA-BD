import test from 'node:test';
import assert from 'node:assert/strict';
import { database, id } from './helpers/database.mjs';

test('helpdesk: external reporters, private threads, transitions, stale writes and audit', async () => {
  const {db,as,value,rows}=await database();
  try {
    const ticket=await as(id(5),()=>value("select api.create_ticket('Cannot open report','The link is unavailable','Access','{\"page\":\"/documents\"}')"));
    assert.equal((await as(id(5),()=>value('select api.ticket_page()'))).length,1);
    for(const user of [id(2),id(3),id(9),id(10)]) {
      await as(user,()=>assert.rejects(()=>value('select api.ticket_detail($1)',[ticket]),/not available/));
      assert.equal((await as(user,()=>rows('select * from work.tickets'))).length,0);
      await as(user,()=>assert.rejects(()=>value("select api.reply_ticket($1,'Intrusion')",[ticket]),/not available/));
    }
    await as(id(5),()=>value("select api.reply_ticket($1,'Additional context')",[ticket]));
    await as(id(4),()=>assert.rejects(()=>value("select api.update_ticket($1,1,'closed',1)",[ticket]),/transition/));
    assert.equal(await as(id(4),()=>value("select api.update_ticket($1,1,'acknowledged',2,$2)",[ticket,id(4)])),2);
    await as(id(4),()=>assert.rejects(()=>value("select api.update_ticket($1,1,'in_progress',2,$2)",[ticket,id(4)]),/changed/));
    await as(id(4),()=>value("select api.update_ticket($1,2,'in_progress',2,$2)",[ticket,id(4)]));
    await as(id(4),()=>value("select api.update_ticket($1,3,'resolved',2,$2)",[ticket,id(4)]));
    await as(id(4),()=>value("select api.update_ticket($1,4,'closed',2,$2)",[ticket,id(4)]));
    await as(id(5),()=>assert.rejects(()=>value("select api.reply_ticket($1,'Late reply')",[ticket]),/closed/));
    const detail=await as(id(5),()=>value('select api.ticket_detail($1)',[ticket]));
    assert.equal(detail.messages.length,1); assert.equal(detail.timeline.length,6);
    await db.query("update org.people set status='suspended' where id=$1",[id(5)]);
    assert.equal((await as(id(5),()=>rows('select * from work.ticket_messages'))).length,0);
    assert.equal(await value('select ok from audit.verify()'),true);
  } finally {await db.close();}
});

test('projects: health, completion gate, external published projection and membership expiry',async()=>{
 const {db,as,value}=await database();
 try {
  await as(id(2),()=>assert.rejects(()=>value("select api.save_project('P099','ENG','Project',100,20,20,'planned')"),/cannot manage/));
  await as(id(1),()=>value("select api.save_project('P099','ENG','Project',100,70,50,'planned')"));
  let detail=await as(id(1),()=>value("select api.project_detail('P099')"));
  assert.equal(detail.project.health,'red'); assert.equal(detail.project.variance_ugx,30);
  const milestone=await as(id(1),()=>value("select api.save_milestone('P099','Survey',current_date)"));
  await as(id(1),()=>value("select api.save_project('P099','ENG','Project',100,70,100,'active',1)"));
  await as(id(1),()=>assert.rejects(()=>value("select api.save_project('P099','ENG','Project',100,70,100,'completed',2)"),/milestones/));
  await as(id(1),()=>value("select api.save_milestone('P099','Survey',current_date,$1,true,true)",[milestone]));
  await as(id(1),()=>value("select api.save_project('P099','ENG','Project',100,70,100,'completed',2)"));
  await as(id(1),()=>value("select api.save_project('P099','ENG','Project',100,70,100,'closed',3)"));
  await as(id(1),()=>assert.rejects(()=>value("select api.save_project('P099','ENG','Changed',100,70,100,'closed',4)"),/transition/));
  await as(id(5),()=>assert.rejects(()=>value("select api.project_detail('P014')"),/not available/));
  await db.exec("update work.projects set published=true,payment_recorded_at=now() where code='P014'");
  detail=await as(id(5),()=>value("select api.project_detail('P014')"));
  assert.equal('budget_ugx' in detail.project,false); assert.deepEqual(detail.timeline,[]);
  await db.query("update work.project_members set expires_at=now()-interval '1 second' where person_id=$1",[id(5)]);
  await as(id(5),()=>assert.rejects(()=>value("select api.project_detail('P014')"),/not available/));
 } finally {await db.close();}
});

test('people: effective contracts, explicit balances, attendance idempotency and IT wall',async()=>{
 const {db,as,value,rows}=await database();
 try {
  await as(id(7),()=>value("select api.add_contract($1,'ENG','Engineer','2026-01-01','2026-06-30')",[id(2)]));
  await as(id(7),()=>assert.rejects(()=>value("select api.add_contract($1,'ENG','Overlap','2026-06-30','2026-12-31')",[id(2)]),/exclusion/));
  await as(id(7),()=>value("select api.add_contract($1,'ENG','Renewal','2026-07-01',null)",[id(2)]));
  await as(id(7),()=>value("select api.adjust_leave($1,'ENG','annual',12,'Authorised opening balance')",[id(2)]));
  const person=await as(id(2),()=>value('select api.people_workspace()'));
  assert.equal(person.contracts.length,2); assert.equal(person.balances[0].units,12);
  for(const denied of [id(3),id(4),id(5),id(9),id(10)]) {
   await as(denied,()=>assert.rejects(()=>value('select api.people_workspace($1)',[id(2)]),/not available/));
   assert.equal((await as(denied,()=>rows('select * from hr.contracts'))).length,0);
  }
  const event=await as(id(2),()=>value("select api.capture_attendance($1,'login')",[id(50)]));
  assert.equal(await as(id(2),()=>value("select api.capture_attendance($1,'login')",[id(50)])),event);
  await as(id(2),()=>assert.rejects(()=>value("select api.capture_attendance($1,'logout')",[id(50)]),/different content/));
  await as(id(7),()=>value("select api.change_person_status($1,'suspended','Leave of access')",[id(2)]));
  await as(id(2),()=>assert.rejects(()=>value('select api.people_workspace()'),/not available/));
  await as(id(2),()=>assert.rejects(()=>value("select api.capture_attendance($1,'login')",[id(51)]),/active staff/));
  assert.equal(await value('select ok from audit.verify()'),true);
 } finally {await db.close();}
});

test('registers and checklists: sensitive scope, custody exclusivity, immutable run snapshot and evidence',async()=>{
 const {db,as,value,rows}=await database();
 try {
  const asset=await as(id(1),()=>value("select api.create_record('assets','ENG','Survey kit','{\"description\":\"Instrument\"}')"));
  const custody=await as(id(1),()=>value('select api.assign_asset($1,$2)',[asset,id(2)]));
  await as(id(1),()=>assert.rejects(()=>value('select api.assign_asset($1,$2)',[asset,id(3)]),/unique/));
  await as(id(1),()=>value("select api.return_asset($1,'Condition checked')",[custody]));
  await as(id(1),()=>value('select api.assign_asset($1,$2)',[asset,id(3)]));
  const sensitive=await as(id(7),()=>value("select api.create_record('benefits','ENG','Private benefit','{}')"));
  await as(id(6),()=>assert.rejects(()=>value('select api.record_detail($1)',[sensitive]),/not available/));
  assert.equal((await as(id(6),()=>rows("select * from work.records where module='benefits'"))).length,0);
  const template=await as(id(7),()=>value("select api.create_checklist_template('ENG','Induction','onboarding','[\"Confirm contact\",\"Record equipment\"]')"));
  const run=await as(id(7),()=>value("select api.start_checklist($1,$2,'Synthetic staff',current_date)",[template,id(2)]));
  await as(id(2),()=>assert.rejects(()=>value('select api.complete_checklist($1,1)',[run]),/Finish every/));
  await as(id(3),()=>assert.rejects(()=>value('select api.check_checklist_item($1,1,0,true)',[run]),/not available/));
  await as(id(2),()=>value('select api.check_checklist_item($1,1,0,true)',[run]));
  await as(id(2),()=>assert.rejects(()=>value('select api.check_checklist_item($1,1,1,true)',[run]),/changed/));
  await as(id(2),()=>value('select api.check_checklist_item($1,2,1,true)',[run]));
  await as(id(2),()=>value('select api.complete_checklist($1,3)',[run]));
  await as(id(2),()=>assert.rejects(()=>value('select api.check_checklist_item($1,4,0,false)',[run]),/complete/));
  assert.equal((await as(id(2),()=>value('select api.checklist_workspace()'))).runs[0].status,'completed');
  assert.equal(await value('select ok from audit.verify()'),true);
  assert.equal(await value("select count(*)::int from pg_tables where schemaname in ('org','rbac','hr','fin','approvals','audit','docs','payroll','work','notifications') and not rowsecurity"),0);
 } finally {await db.close();}
});

test('finance: exact lines, receipt gate, spending ladder, balanced journals, immutable payroll review',async()=>{
 const {db,as,value,rows}=await database();
 try {
  const claim=await as(id(2),()=>value("select api.save_financial_record('expense','ENG','Travel','[{\"description\":\"Travel\",\"quantity\":1,\"unit_ugx\":80000}]')"));
  await as(id(2),()=>assert.rejects(()=>value('select api.submit_financial_record($1)',[claim]),/receipt/));
  await as(id(3),()=>assert.rejects(()=>value('select api.submit_financial_record($1)',[claim]),/owner/));
  const req=await as(id(2),()=>value("select api.save_financial_record('requisition','ENG','Materials','[{\"description\":\"Materials\",\"quantity\":2,\"unit_ugx\":350000}]')"));
  const approval=await as(id(2),()=>value('select api.submit_financial_record($1)',[req]));
  assert.equal(await value('select count(*)::int from approvals.steps where request_id=$1',[approval]),2);
  assert.equal((await as(id(4),()=>value('select api.financial_page()'))).length,0);
  await as(id(6),()=>value("select api.save_account('TEST-CASH','Synthetic cash')"));
  await as(id(6),()=>value("select api.save_account('TEST-COST','Synthetic cost')"));
  await as(id(6),()=>assert.rejects(()=>value("select api.post_journal('ENG',current_date,'J-1','Manual','[{\"account_code\":\"TEST-CASH\",\"debit\":100,\"credit\":0},{\"account_code\":\"TEST-COST\",\"debit\":0,\"credit\":90}]')"),/balance/));
  await as(id(6),()=>value("select api.post_journal('ENG',current_date,'J-1','Manual','[{\"account_code\":\"TEST-CASH\",\"debit\":100,\"credit\":0},{\"account_code\":\"TEST-COST\",\"debit\":0,\"credit\":100}]')"));
  assert.equal((await as(id(6),()=>value('select api.journal_page()'))).length,1);
  await as(id(4),()=>assert.rejects(()=>value("select api.save_account('BAD','Forbidden')"),/cannot/));
  const period=await as(id(6),()=>value("select api.create_payroll_period('ENG','Synthetic shadow','2026-11-01','2026-11-30')"));
  await as(id(6),()=>assert.rejects(()=>value("select api.save_payroll_line($1,$2,1000000,10000,'Synthetic deduction',890000)",[period,id(2)]),/No PAYE/));
  await db.exec(`insert into payroll.rate_tables(kind,effective,bands,source_note) values('paye_resident_monthly','[2026-01-01,2027-01-01)','[{"from":0,"rate":0.1}]','Synthetic test formula, not statutory')`);
  await as(id(6),()=>assert.rejects(()=>value("select api.save_payroll_line($1,$2,1000000,10000,'Synthetic deduction',890000)",[period,id(2)]),/not been verified/));
  await db.query('update payroll.rate_tables set verified_at=now(),verified_by=$1',[id(6)]);
  await as(id(6),()=>value("select api.save_payroll_line($1,$2,1000000,10000,'Synthetic deduction',890000)",[period,id(2)]));
  const payrollApproval=await as(id(6),()=>value('select api.submit_payroll_period($1)',[period]));
  assert.equal((await as(id(7),()=>value('select api.payroll_workspace()'))).lines.length,1,'current HR reviewer can inspect inputs');
  assert.equal((await as(id(8),()=>value('select api.payroll_workspace()'))).lines.length,0,'future department step cannot inspect yet');
  await as(id(6),()=>assert.rejects(()=>value('select api.lock_payroll_period($1)',[period]),/HR and department/));
  await as(id(6),()=>assert.rejects(()=>value("select api.save_payroll_line($1,$2,2000000,0,'Changed')",[period,id(2)]),/not open/));
  await as(id(7),()=>value('select api.decide_request($1,true)',[payrollApproval]));
  assert.equal((await as(id(8),()=>value('select api.payroll_workspace()'))).lines.length,1,'current department reviewer can inspect inputs');
  await as(id(8),()=>value('select api.decide_request($1,true)',[payrollApproval]));
  await as(id(6),()=>value('select api.lock_payroll_period($1)',[period]));
  const payslips=await as(id(2),()=>value('select api.payroll_workspace()'));
  assert.equal(payslips.payslips[0].net_ugx,890000); assert.equal(payslips.lines.length,0);
  assert.equal((await as(id(4),()=>rows('select * from payroll.lines'))).length,0);
  assert.equal((await as(id(3),()=>value('select api.payroll_workspace()'))).payslips.length,0);
  assert.equal(await value('select ok from audit.verify()'),true);
 } finally {await db.close();}
});
