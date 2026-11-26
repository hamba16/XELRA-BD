export function nextSendTime(now,tz){
 const parts=new Intl.DateTimeFormat('en-GB',{timeZone:tz,hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(now);
 const minute=Number(parts.find(p=>p.type==='hour').value)*60+Number(parts.find(p=>p.type==='minute').value);
 if(minute<750||minute>=780)return now;
 const next=new Date(now.getTime()+(780-minute)*60000);next.setUTCSeconds(0,0);return next;
}
export async function dispatch(env,rpc,fetcher=fetch,now=new Date()){
 if(env.MAIL_ENABLED!=='true')return {sent:0,disabled:true};
 const rows=await rpc(env,'claim_notifications');let token,sent=0;
 for(const row of rows){
  try{
   const due=nextSendTime(now,row.time_zone);
   if(due>now){await rpc(env,'finish_notification',{p_id:row.id,p_lease:row.lease,p_sent:false,p_next:due.toISOString()});continue;}
   if(!token){const result=await fetcher(`https://login.microsoftonline.com/${encodeURIComponent(env.TENANT_ID)}/oauth2/v2.0/token`,{method:'POST',body:new URLSearchParams({client_id:env.CLIENT_ID,client_secret:env.CLIENT_SECRET,scope:'https://graph.microsoft.com/.default',grant_type:'client_credentials'}),signal:AbortSignal.timeout(15000)});if(!result.ok)throw Error('Mail authentication failed');token=(await result.json()).access_token;if(!token)throw Error('No mail token');}
   const response=await fetcher(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(env.MAILBOX)}/sendMail`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({message:{subject:'Your XELRA inbox has an update',body:{contentType:'Text',content:`Open your workspace to review the update: ${env.APP_ORIGIN}/inbox`},toRecipients:[{emailAddress:{address:row.email}}]},saveToSentItems:false}),signal:AbortSignal.timeout(15000)});
   if(!response.ok)throw Error('Mail delivery failed');
   await rpc(env,'finish_notification',{p_id:row.id,p_lease:row.lease,p_sent:true});sent++;
  }catch{await rpc(env,'finish_notification',{p_id:row.id,p_lease:row.lease,p_sent:false,p_next:new Date(now.getTime()+15*60000).toISOString()});}
 }
 return {sent};
}
