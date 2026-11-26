import { PGlite } from '@electric-sql/pglite';
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist';
import { readFileSync } from 'node:fs';

const db = new PGlite({ extensions: { btree_gist } });
const results = [];
const check = (name, ok, extra = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  [' + extra + ']' : ''}`); };

await db.exec(readFileSync(new URL('../sql/core.sql', import.meta.url), 'utf8'));
await db.exec(`
  grant usage on schema org, rbac, hr, fin, approvals, audit, docs, payroll, auth to authenticated;
  grant select on all tables in schema org, rbac, hr, fin, approvals, audit, docs, payroll to authenticated;
  grant insert on hr.leave_requests to authenticated;
`);

const U = {
  darren: '00000000-0000-0000-0000-000000000001', derrick: '00000000-0000-0000-0000-000000000002',
  jude: '00000000-0000-0000-0000-000000000003', fm: '00000000-0000-0000-0000-000000000004',
  fo: '00000000-0000-0000-0000-000000000005', engineer: '00000000-0000-0000-0000-000000000006',
  amgAnalyst: '00000000-0000-0000-0000-000000000007', itAdmin: '00000000-0000-0000-0000-000000000008',
  engineer2: '00000000-0000-0000-0000-000000000009',
};
// seed as superuser
await db.exec(`
  insert into org.people (id, full_name, email, manager_id) values
   ('${U.darren}','Central Director','darren@x.test',null),
   ('${U.derrick}','Director Engineering','derrick@x.test','${U.darren}'),
   ('${U.jude}','Pro-Consultant','jude@x.test','${U.derrick}'),
   ('${U.fm}','Finance Manager','fm@x.test','${U.darren}'),
   ('${U.fo}','Finance Officer','fo@x.test','${U.fm}'),
   ('${U.engineer}','Engineer One','e1@x.test','${U.jude}'),
   ('${U.amgAnalyst}','AMG Analyst','a1@x.test','${U.darren}'),
   ('${U.itAdmin}','IT Administrator','it@x.test',null),
   ('${U.engineer2}','Engineer Two','e2@x.test','${U.jude}');
  insert into rbac.roles values ('central_director','Central Director'),('director_eng','Director (Engineering)'),
    ('pro_consultant','Pro-Consultant'),('finance_manager','Finance Manager'),('finance_officer','Finance Officer'),
    ('engineer','Engineer'),('amg_analyst','AMG Analyst'),('it_admin','IT Administrator');
  insert into rbac.role_perms values
   ('central_director','leave.read','all'),('central_director','leave.approve','all'),('central_director','pay.read','all'),
   ('central_director','audit.read','all'),('central_director','rbac.grant','all'),('central_director','expense.approve.central','all'),
   ('central_director','expense.approve.fm','all'),('central_director','expense.depthead','all'),('central_director','view.combined','all'),
   ('director_eng','leave.read','division'),('director_eng','leave.approve','division'),('director_eng','expense.depthead','division'),
   ('pro_consultant','leave.read','own'),
   ('finance_manager','pay.read','all'),('finance_manager','expense.approve.fm','all'),('finance_manager','leave.read','all'),
   ('finance_officer','expense.review','all'),
   ('engineer','leave.read','own'),('amg_analyst','leave.read','own'),
   ('it_admin','rbac.grant','all'),('it_admin','audit.read','all');
  insert into rbac.sensitive_perms values ('view.combined'),('pay.read');
  insert into rbac.assignments (person_id, role_code, division) values
   ('${U.darren}','central_director','COR'),('${U.derrick}','director_eng','ENG'),('${U.jude}','pro_consultant','ENG'),
   ('${U.fm}','finance_manager','COR'),('${U.fo}','finance_officer','COR'),('${U.engineer}','engineer','ENG'),
   ('${U.engineer2}','engineer','ENG'),('${U.amgAnalyst}','amg_analyst','AMG'),('${U.itAdmin}','it_admin','COR');
  insert into hr.pay values ('${U.engineer}','ENG',3500000,'ACC-1'),('${U.amgAnalyst}','AMG',4200000,'ACC-2'),('${U.derrick}','ENG',9000000,'ACC-3');
  insert into hr.leave_requests (person_id, division, starts, ends) values
   ('${U.engineer}','ENG','2026-12-01','2026-12-05'),('${U.amgAnalyst}','AMG','2026-12-08','2026-12-12');
`);

async function as(user, fn) {
  await db.exec(`set role authenticated; select set_config('request.jwt.claims', '{"sub":"${user}","role":"authenticated"}', false);`);
  try { return await fn(); } finally { await db.exec(`reset role; select set_config('request.jwt.claims','',false);`); }
}
const q = async (sql, params) => (await db.query(sql, params)).rows;
const fails = async (fn) => { try { await fn(); return null; } catch (e) { return e.message; } };

// ---- T1 isolation ----
await as(U.derrick, async () => {
  const rows = await q('select person_id from hr.leave_requests');
  check('T1a Engineering Director sees ENG leave only', rows.length === 1 && rows[0].person_id === U.engineer);
});
await as(U.amgAnalyst, async () => {
  const rows = await q('select person_id from hr.leave_requests');
  check('T1b AMG analyst sees only own leave', rows.length === 1 && rows[0].person_id === U.amgAnalyst);
});
await as(U.darren, async () => {
  check('T1c Central Director sees both divisions', (await q('select 1 from hr.leave_requests')).length === 2);
});

// ---- T2 IT admin wall ----
await as(U.itAdmin, async () => {
  check('T2a IT Administrator reads zero salary rows', (await q('select 1 from hr.pay')).length === 0);
  check('T2b IT Administrator reads zero leave rows', (await q('select 1 from hr.leave_requests')).length === 0);
});
await as(U.fm, async () => { check('T2c Finance Manager reads all salary rows', (await q('select 1 from hr.pay')).length === 3); });
await as(U.engineer, async () => { check('T2d An engineer reads no salary rows (not even their own via this table)', (await q('select 1 from hr.pay')).length === 0); });

// ---- T3 approvals ----
let reqSmall, reqMid, reqBig;
await as(U.engineer, async () => {
  reqSmall = (await q(`select approvals.submit('expense','ENG',80000) id`))[0].id;
  reqMid = (await q(`select approvals.submit('expense','ENG',700000) id`))[0].id;
  reqBig = (await q(`select approvals.submit('expense','ENG',6500000) id`))[0].id;
  const msg = await fails(() => q(`select approvals.decide('${reqSmall}', true)`));
  check('T3a requester cannot approve own item', !!msg, msg);
});
await as(U.engineer2, async () => {
  const msg = await fails(() => q(`select approvals.decide('${reqSmall}', true)`));
  check('T3b a peer who is not the manager cannot approve', !!msg, msg);
});
await as(U.jude, async () => {
  const r = (await q(`select approvals.decide('${reqSmall}', true) s`))[0].s;
  check('T3c line manager approves petty-cash item in one step', r === 'approved', r);
  const m1 = (await q(`select approvals.decide('${reqMid}', true) s`))[0].s;
  check('T3d mid item moves to Finance review after manager', m1 === 'pending', m1);
});
await as(U.fo, async () => {
  const r = (await q(`select approvals.decide('${reqMid}', true) s`))[0].s;
  check('T3e Finance Officer completes review', r === 'approved', r);
});
await as(U.fm, async () => {
  const r1 = (await q(`select approvals.decide('${reqBig}', true) s`))[0].s;
  check('T3f >5M: Finance Manager is step one, still pending', r1 === 'pending', r1);
  const msg = await fails(() => q(`select approvals.decide('${reqBig}', true)`));
  check('T3g four-eyes: same person cannot take the next step', !!msg, msg);
});
await as(U.darren, async () => {
  const r = (await q(`select approvals.decide('${reqBig}', true) s`))[0].s;
  check('T3h >5M: Central Director completes', r === 'approved', r);
});

// delegation: Jude is covering for the Engineering Director; expense.depthead step needs ENG director or delegate
let reqDept;
await as(U.engineer, async () => { reqDept = (await q(`select approvals.submit('expense','ENG',3000000) id`))[0].id; });
await as(U.engineer2, async () => {
  check('T3i non-delegate cannot take dept-head step', !!(await fails(() => q(`select approvals.decide('${reqDept}', true)`))));
});
await db.exec(`insert into approvals.delegations (from_person,to_person,division,starts_at,expires_at)
  values ('${U.derrick}','${U.jude}','ENG', now() - interval '1 hour', now() + interval '4 days')`);
await as(U.jude, async () => {
  const r = (await q(`select approvals.decide('${reqDept}', true) s`))[0].s;
  check('T3j delegate (Pro-Consultant) covers the Engineering dept-head step', r === 'pending', r);
});
const dl = await fails(() => db.exec(`insert into approvals.delegations (from_person,to_person,division,starts_at,expires_at)
  values ('${U.derrick}','${U.engineer2}','ENG', now(), now() + interval '6 days')`));
check('T3k a cover period longer than 5 days is rejected by the database', !!dl, dl);
await db.exec(`update approvals.delegations set expires_at = now() - interval '1 minute', starts_at = now() - interval '2 days'`);
let reqDept2;
await as(U.engineer, async () => { reqDept2 = (await q(`select approvals.submit('expense','ENG',2000000) id`))[0].id; });
await as(U.jude, async () => {
  check('T3l after cover expires the delegate can no longer approve', !!(await fails(() => q(`select approvals.decide('${reqDept2}', true)`))));
});

// ---- T4 audit chain ----
let v = (await q('select * from audit.verify()'))[0];
check('T4a audit chain verifies after normal use', v.ok === true, `${v.checked} events`);
await as(U.engineer, async () => {
  check('T4b an engineer reads no audit events', (await q('select 1 from audit.events')).length === 0);
  const msg = await fails(() => q(`update audit.events set action='x'`));
  check('T4c authenticated users cannot update audit rows', !!msg, msg);
});
const msg4 = await fails(() => q(`delete from audit.events`));
check('T4d even a superuser delete is blocked by trigger', !!msg4, msg4);
await db.exec(`alter table audit.events disable trigger audit_immutable;
  update audit.events set detail = '{"approve":false}'::jsonb where seq = 3;
  alter table audit.events enable trigger audit_immutable;`);
v = (await q('select * from audit.verify()'))[0];
check('T4e a silent edit by a privileged operator is detected', v.ok === false && Number(v.first_bad_seq) === 3, `first bad seq ${v.first_bad_seq}`);

// ---- T5 consent on sensitive grants ----
await as(U.itAdmin, async () => {
  const m = await fails(() => q(`select rbac.grant_perm('${U.fo}','view.combined','all',null,null,null)`));
  check('T5a IT Admin cannot grant Combined view without Director consent', !!m, m);
  const ok = await fails(() => q(`select rbac.grant_perm('${U.fo}','view.combined','all',null,'${U.darren}',now() + interval '30 days')`));
  check('T5b with a consent record the grant succeeds', ok === null);
});
await as(U.fo, async () => { check('T5c the grantee now has the permission', (await q(`select rbac.can('view.combined') c`))[0].c === true); });
await db.exec(`update rbac.grants set expires_at = now() - interval '1 second'`);
await as(U.fo, async () => { check('T5d an expired grant stops working without any job running', (await q(`select rbac.can('view.combined') c`))[0].c === false); });

// ---- T6 numbering ----
const nums = [];
for (let i = 0; i < 5; i++) nums.push((await q(`select docs.next_no('ENG','P014','RPT') n`))[0].n);
check('T6a numbering is sequential and well formed', nums[0] === 'DRN-ENG-P014-RPT-0001-R00' && nums[4] === 'DRN-ENG-P014-RPT-0005-R00', nums[4]);
check('T6b a new type restarts at 0001', (await q(`select docs.next_no('ENG','P014','DWG',2) n`))[0].n === 'DRN-ENG-P014-DWG-0001-R02');
check('T6c a malformed project code is refused', !!(await fails(() => q(`select docs.next_no('ENG','14','RPT')`))));

// ---- T7 rate tables ----
await db.exec(`
 insert into payroll.rate_tables (kind, effective, bands, source_note) values
 ('paye_resident_monthly','[2025-07-01,2026-07-01)','[{"from":0,"to":235000,"rate":0},{"from":235000,"to":335000,"rate":0.10},{"from":335000,"to":410000,"rate":0.20},{"from":410000,"to":10000000,"rate":0.30},{"from":10000000,"to":null,"rate":0.40}]','FY2025/26 bands'),
 ('paye_resident_monthly','[2026-07-01,)','[{"from":0,"to":335000,"rate":0},{"from":335000,"to":410000,"rate":0.20},{"from":410000,"to":485000,"rate":0.25},{"from":485000,"to":10000000,"rate":0.30},{"from":10000000,"to":null,"rate":0.40}]','FY2026/27 bands, effective 1 Jul 2026 (Income Tax (Amendment) Act 2026)');`);
check('T7a an unverified table cannot be used for payroll', !!(await fails(() => q(`select payroll.paye(1000000,'2026-08-31')`))));
await db.exec(`update payroll.rate_tables set verified_at = now(), verified_by = '${U.fm}'`);
const p = async (g, d) => Number((await q(`select payroll.paye(${g}, '${d}') t`))[0].t);
check('T7b FY25/26 vector: 1,000,000 gross = 202,000 (matches URA formula)', (await p(1000000, '2026-06-30')) === 202000, String(await p(1000000, '2026-06-30')));
check('T7c FY26/27 vector: 1,000,000 gross = 188,250', (await p(1000000, '2026-07-01')) === 188250, String(await p(1000000, '2026-07-01')));
check('T7d FY26/27 vector: 400,000 gross = 13,000', (await p(400000, '2026-09-30')) === 13000);
check('T7e FY26/27 vector: 450,000 gross = 25,000', (await p(450000, '2026-09-30')) === 25000);
check('T7f FY26/27 vector: 12,000,000 gross = 3,688,250 (40% marginal above 10M)', (await p(12000000, '2026-09-30')) === 3688250, String(await p(12000000, '2026-09-30')));
check('T7g 335,000 and below pay nothing', (await p(335000, '2026-09-30')) === 0);
const ov = await fails(() => db.exec(`insert into payroll.rate_tables (kind, effective, bands) values ('paye_resident_monthly','[2026-09-01,2026-12-31)','[]')`));
check('T7h overlapping effective periods are refused', !!ov, ov);


// ---- T8 identity lifecycle and write policies ----
await as(U.engineer, async () => {
  const m = await fails(() => q(`insert into hr.leave_requests (person_id, division, starts, ends) values ('${U.engineer2}','ENG','2026-12-20','2026-12-22')`));
  check('T8a you cannot file leave on someone else\'s behalf', !!m, m);
  const ok = await fails(() => q(`insert into hr.leave_requests (person_id, division, starts, ends) values ('${U.engineer}','ENG','2026-12-20','2026-12-22')`));
  check('T8b you can file your own leave', ok === null);
});
await db.exec(`update org.people set status='suspended' where id='${U.derrick}'`);
await as(U.derrick, async () => {
  check('T8c a suspended Director loses all access immediately', (await q('select 1 from hr.leave_requests')).length === 0);
});
await db.exec(`update org.people set status='active' where id='${U.derrick}'`);

// ---- T9 stuck-work detector ----
let reqStuck;
await as(U.engineer2, async () => { reqStuck = (await q(`select approvals.submit('expense','ENG',700000) id`))[0].id; });
check('T9a a request with a live approver is not orphaned', (await q(`select 1 from approvals.orphaned() where request_id='${reqStuck}'`)).length === 0);
await db.exec(`update org.people set status='offboarded' where id='${U.jude}'`);
check('T9b when the only approver leaves, the request is flagged as orphaned', (await q(`select 1 from approvals.orphaned() where request_id='${reqStuck}'`)).length === 1);
await db.exec(`update org.people set manager_id='${U.derrick}' where id='${U.engineer2}'`);
check('T9c re-pointing the manager un-sticks it', (await q(`select 1 from approvals.orphaned() where request_id='${reqStuck}'`)).length === 0);

// ---- T10 attendance retention + T11 offline idempotency ----
await db.exec(`
  insert into rbac.role_perms values ('it_admin','attendance.export','all');
  select rbac.rebuild('${U.itAdmin}');
  grant select on hr.attendance_events, hr.attendance_exports, hr.field_reports to authenticated;
  insert into hr.attendance_events (person_id, kind, at) values
   ('${U.engineer}','login','2025-10-01 07:58+00'),('${U.engineer}','logout','2025-10-01 17:03+00'),
   ('${U.engineer}','login','2026-11-20 08:01+00');`);
import { createHash } from 'node:crypto';
let exp;
await as(U.itAdmin, async () => {
  exp = (await q(`select * from hr.export_attendance('2025-12-01+00')`))[0];
  const local = createHash('sha256').update(exp.csv).digest('hex');
  check('T10a server checksum equals the checksum of the file the admin downloads', local === exp.sha256, exp.sha256.slice(0,12));
  check('T10b the export covers only rows older than the cutoff', Number(exp.row_count) === 2);
  const m = await fails(() => q(`select hr.purge_attendance('${exp.export_id}')`));
  check('T10c purge is refused until the download is confirmed', !!m, m);
  check('T10d a wrong checksum does not confirm', (await q(`select hr.confirm_export('${exp.export_id}', 'deadbeef') c`))[0].c === false);
  check('T10e the matching checksum confirms', (await q(`select hr.confirm_export('${exp.export_id}', '${local}') c`))[0].c === true);
  const n = Number((await q(`select hr.purge_attendance('${exp.export_id}') n`))[0].n);
  check('T10f purge deletes exactly the exported rows', n === 2);
  check('T10g purge twice is refused', !!(await fails(() => q(`select hr.purge_attendance('${exp.export_id}')`))));
});
const left = (await q(`select count(*)::int c from hr.attendance_events`))[0].c;
check('T10h newer rows survive the purge', left === 1);
const last = (await q(`select detail::text d from audit.events where action='attendance.purge' order by seq desc limit 1`))[0].d;
check('T10i the audit record of the deletion carries a count and no personal data', last.includes('rows_deleted') && !last.includes(U.engineer), last);
await as(U.engineer, async () => { check('T10j staff cannot read the attendance table', (await q('select 1 from hr.attendance_events')).length === 0); });
await as(U.engineer, async () => {
  const id = '77777777-7777-7777-7777-777777777777';
  const r = [];
  for (let i = 0; i < 4; i++) r.push((await q(`select hr.sync_field_report('${id}','P014','{"note":"slab poured"}','2026-11-24 09:00+00') s`))[0].s);
  check('T11a replaying the same offline report four times stores it once', r.join() === 'created,duplicate,duplicate,duplicate', r.join());
});
check('T11b exactly one row exists', (await q(`select count(*)::int c from hr.field_reports`))[0].c === 1);

// ---- T12 build gate: no table without row-level security ----
check('T12a every table in the application schemas has RLS enabled', (await q('select * from audit.tables_without_rls()')).length === 0);
await db.exec('create table hr.oops_forgot_rls (id int)');
check('T12b the gate catches a table that forgot RLS (negative control)', (await q('select * from audit.tables_without_rls()')).some(r => r.table_name === 'oops_forgot_rls'));
await db.exec('drop table hr.oops_forgot_rls');
await as(U.engineer, async () => {
  check('T12c a plain user reading role definitions sees nothing', (await q('select 1 from rbac.role_perms')).length === 0);
  check('T12d a plain user reading statutory rate tables sees nothing', (await q('select 1 from payroll.rate_tables')).length === 0);
});

const failed = results.filter(r => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
