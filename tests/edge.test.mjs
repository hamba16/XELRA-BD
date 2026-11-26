import test from 'node:test';import assert from 'node:assert/strict';
import {serveFile} from '../workers/edge/files.mjs';import {newestBackup,monitor} from '../workers/edge/index.mjs';
import {dispatch,nextSendTime} from '../workers/edge/notifications.mjs';
const url='https://files.test/files/11111111-1111-1111-1111-111111111111';
test('file boundary forwards user token and rejects untrusted origins, keys and methods',async()=>{
 const env={APP_ORIGIN:'https://app.test',SUPABASE_URL:'https://db.test',SUPABASE_PUBLISHABLE_KEY:'public-key',DOCS:{get:async()=>({body:'document',httpMetadata:{contentType:'text/plain'}})}};
 const req=()=>new Request(url,{headers:{Origin:env.APP_ORIGIN,Authorization:'Bearer user-token'}});
 assert.equal((await serveFile(new Request(url),env)).status,401);
 assert.equal((await serveFile(new Request(url,{method:'POST'}),env)).status,405);
 assert.equal((await serveFile(new Request(url,{headers:{Origin:'https://evil.test'}}),env)).status,403);
 const r=await serveFile(req(),env,async(_url,init)=>{assert.equal(init.headers.authorization,'Bearer user-token');assert.equal(init.headers['Content-Profile'],'api');return Response.json('documents/ENG/test.pdf');});
 assert.equal(await r.text(),'document');assert.equal(r.headers.get('cache-control'),'no-store');
 assert.equal((await serveFile(req(),env,async()=>Response.json(null))).status,403);
 assert.equal((await serveFile(req(),env,async()=>Response.json('../secret'))).status,403);
});
test('backup monitor paginates and ignores checksum objects',async()=>{
 let calls=0;const bucket={list:async({cursor})=>{calls++;return cursor?{objects:[{key:'db/new.dump.age',uploaded:new Date(2000)}],truncated:false}:{objects:[{key:'db/old.dump.age',uploaded:new Date(1000)},{key:'db/check.sha256',uploaded:new Date(9000)}],truncated:true,cursor:'next'};}};
 assert.equal(await newestBackup(bucket),2000);assert.equal(calls,2);
});
test('monitor reports probe failure and checks alert delivery',async()=>{
 const env={SUPABASE_URL:'https://db.test',ALERT_WEBHOOK:'https://alerts.test',BACKUPS:{list:async()=>({objects:[],truncated:false})}};
 await assert.rejects(()=>monitor(env,async url=>url.startsWith('https://alerts')?new Response('',{status:500}):new Response('',{status:503})),/delivery failed/);
});
test('notification quiet time and failed delivery retain work for retry',async()=>{
 const now=new Date('2026-12-01T09:40:00Z');
 assert.equal(nextSendTime(now,'Africa/Kampala').toISOString(),'2026-12-01T10:00:00.000Z');
 const finished=[];const claim=async(_env,name,args)=>name==='claim_notifications'?[{id:1,lease:'lease',email:'sample@xelra.test',time_zone:'Africa/Kampala'}]:finished.push(args);
 await dispatch({MAIL_ENABLED:'true'},claim,()=>{throw Error('Must not send during quiet time');},now);
 assert.equal(finished[0].p_sent,false);assert.equal(finished[0].p_next,'2026-12-01T10:00:00.000Z');
 finished.length=0;await dispatch({MAIL_ENABLED:'true'},claim,async()=>new Response('',{status:503}),new Date('2026-12-01T10:30:00Z'));
 assert.equal(finished[0].p_sent,false);
 assert.deepEqual(await dispatch({MAIL_ENABLED:'false'},()=>{throw Error('Disabled dispatcher cannot claim');}),{sent:0,disabled:true});
});
