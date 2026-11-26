import {serveFile} from './files.mjs';
import {dispatch} from './notifications.mjs';
export async function rpc(env,name,args={},fetcher=fetch){
 const r=await fetcher(`${env.SUPABASE_URL}/rest/v1/rpc/${name}`,{method:'POST',headers:{apikey:env.SUPABASE_SECRET_KEY,'Content-Type':'application/json','Content-Profile':'api','Accept-Profile':'api'},body:JSON.stringify(args),signal:AbortSignal.timeout(20000)});
 if(!r.ok)throw Error(`Operations ${name} failed (${r.status})`);
 const text=await r.text();return text?JSON.parse(text):null;
}
export async function newestBackup(bucket){
 let cursor,newest=null;
 do{const page=await bucket.list({prefix:'db/',cursor});for(const o of page.objects)if(o.key.endsWith('.dump.age'))newest=Math.max(newest||0,new Date(o.uploaded).getTime());cursor=page.truncated?page.cursor:undefined;}while(cursor);
 return newest;
}
export async function monitor(env,fetcher=fetch,now=Date.now()){
 const alerts=[];let health;
 try{await rpc(env,'record_heartbeat',{p_kind:'keepalive'},fetcher);await rpc(env,'record_database_meter',{p_capacity:500*1024*1024},fetcher);health=await rpc(env,'infrastructure_health',{},fetcher);}catch{alerts.push('Database probe failed.');}
 if(health){
  if(!health.backup_ok)alerts.push('No recent verified backup receipt.');
  if(!health.restore_drill_ok)alerts.push('Restore drill is missing, stale or failed.');
  for(const kind of ['database_bytes','r2_bytes','hosting_credits'])if(!(health.meters||[]).some(m=>m.kind===kind))alerts.push(`${kind}: missing measurement`);
  for(const m of health.meters||[])if(m.warning||m.critical||m.stale)alerts.push(`${m.kind}: ${m.stale?'measurement stale':m.critical?'critical':'warning'}`);
 }
 try{const newest=await newestBackup(env.BACKUPS);if(!newest||now-newest>36*3600000)alerts.push('No verified recent backup object within 36 hours.');}catch{alerts.push('Backup storage could not be checked.');}
 if(alerts.length){
  if(!env.ALERT_WEBHOOK)throw Error('Alerts require a configured delivery endpoint.');
  const r=await fetcher(env.ALERT_WEBHOOK,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${env.ALERT_SECRET}`},body:JSON.stringify({source:'xelra-ops',alerts}),signal:AbortSignal.timeout(15000)});
  if(!r.ok)throw Error(`Alert delivery failed (${r.status})`);
 }
 return alerts;
}
export default {fetch:serveFile,scheduled(event,env,ctx){ctx.waitUntil(event.cron==='*/5 * * * *'?dispatch(env,rpc):monitor(env));}};
