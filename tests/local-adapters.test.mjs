import test from 'node:test';
import assert from 'node:assert/strict';
import { importTypeScript } from './helpers/typescript.mjs';

const finance = await importTypeScript('packages/lab/src/lib/finance.ts');
const files = await importTypeScript('apps/web/src/local-files.ts');
const field = await importTypeScript('apps/web/src/field-attachments.ts');
const calendar = await importTypeScript('packages/lab/src/lib/working-calendar.ts');

test('CSV imports validate quoting, exact amounts, dates, duplicate references and safe exports', () => {
  assert.deepEqual(finance.parseCsv('a,b\r\n"one, two","three\nlines"\r\n'), [['a','b'], ['one, two','three\nlines']]);
  for (const bad of ['a,b\n1', 'a,b\n"unterminated,1', 'a,b\n"x"trailing,1']) assert.throws(()=>finance.parseCsv(bad));
  const mapping={reference:'reference',date:'date',amount:'amount',description:'description'};
  const header='reference,date,amount,description\n';
  const row='A,2026-11-01,-200,Payment';
  const parsed=finance.statementCsv(header+row+'\n'+row,mapping);
  assert.equal(parsed.duplicates,1); assert.equal(parsed.lines.length,1);
  assert.throws(()=>finance.statementCsv(header+row+'\nA,2026-11-01,-201,Payment',mapping),/conflicting/);
  assert.throws(()=>finance.statementCsv(header+'A,2026-02-30,200,Payment',mapping),/valid/);
  assert.throws(()=>finance.statementCsv(header+'A,2026-11-01,2.01,Payment',mapping),/whole/);
  assert.match(finance.csvExport(['text','amount'],[['=SUM(A1)',-20]]),/"'=SUM\(A1\)","-20"/);
});
test('group reconciliation is bounded, exact, date-limited and only suggests splits',()=>{
 const target={id:'B',date:'2026-11-10',amount:300,text:'Settlement'};
 const lines=[{id:'L1',date:'2026-11-09',amount:100,text:'Part'},{id:'L2',date:'2026-11-10',amount:200,text:'Part'}];
 assert.deepEqual(finance.groupMatches(target,lines),[['L1','L2']]);
 assert.deepEqual(finance.groupMatches({...target,amount:301},lines),[]);
 assert.deepEqual(finance.groupMatches({...target,date:'2026-11-30'},lines),[]);
 assert.throws(()=>finance.groupMatches(target,Array.from({length:7},(_,i)=>({...lines[0],id:String(i)}))),/six/);
 assert.equal(finance.forecast13Weeks(null,'2026-11-01',[]),null);
 const forecast=finance.forecast13Weeks(1000,'2026-11-01',[{due:'2026-11-02',amount:-200,source:'bill-1'}]);
 assert.equal(forecast.length,13); assert.equal(forecast[0].closing,800); assert.equal(forecast[12].closing,800);
});
test('SLA working calendar pauses weekends, holidays and outside configured hours',()=>{
 const config={timeZone:'Africa/Kampala',weekdays:{1:[[540,1020]],2:[[540,1020]],3:[[540,1020]],4:[[540,1020]],5:[[540,1020]]},holidays:[],workingDayMinutes:480};
 assert.equal(calendar.workingMinutes(new Date('2026-11-27T13:30Z'),new Date('2026-11-30T06:30Z'),config),60);
 assert.equal(calendar.workingMinutes(new Date('2026-11-27T13:30Z'),new Date('2026-11-30T06:30Z'),{...config,holidays:['2026-11-30']}),30);
 assert.equal(calendar.acknowledgementSla(1,new Date(),new Date(),null).state,'unconfigured');
 assert.throws(()=>calendar.workingMinutes(new Date(),new Date(),{...config,weekdays:{1:[[500,600],[550,700]]}}),/non-overlapping/);
});
test('local files reject misleading types and verify SHA-256; field transport cannot discard unconfirmed photos',async()=>{
 const pdf=new File(['%PDF-1.4\nsynthetic fixture'],'test.pdf',{type:'application/pdf'});
 await files.validateFile(pdf);
 await assert.rejects(()=>files.validateFile(new File(['executable'],'test.pdf',{type:'application/pdf'})),/signature/);
 await assert.rejects(()=>files.validateFile(new File(['<svg>'],'test.svg',{type:'image/svg+xml'})),/supported/);
 const photo={id:'photo',name:'photo.jpg',type:'image/jpeg',size:3,sha256:await files.fileDigest(new Blob(['abc'])),blob:new Blob(['abc']),createdAt:0};
 const job={id:'report',kind:'field_report',attempts:0,createdAt:0,payload:{p_client:'report',p_project:'P014',p_body:{note:'Site note'},p_captured:'2026-11-01T00:00:00Z',local_photos:[photo]}};
 let rpcCalls=0;
 await assert.rejects(()=>field.sendFieldJob(job,null,async()=>{rpcCalls++;return 'created';}),/still saved/);
 assert.equal(rpcCalls,0);
 await assert.rejects(()=>field.sendFieldJob(job,{upload:async()=>({key:'photos/test',sha256:'wrong'})},async()=>{rpcCalls++;return 'created';}),/not verified/);
 assert.equal(rpcCalls,0);
 assert.equal(await field.sendFieldJob(job,{upload:async()=>({key:'photos/test',sha256:photo.sha256})},async args=>{rpcCalls++;assert.equal('local_photos' in args,false);assert.equal(args.p_body.attachments[0].sha256,photo.sha256);return 'duplicate';}),'duplicate');
 assert.equal(rpcCalls,1); assert.equal(job.payload.local_photos.length,1);
});
