export async function serveFile(req, env, fetcher=fetch) {
 const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Vary':'Origin'};
 const origin=req.headers.get('origin');
 if(origin&&origin!==env.APP_ORIGIN)return new Response('Origin not allowed',{status:403,headers});
 if(origin)headers['Access-Control-Allow-Origin']=origin;
 if(req.method==='OPTIONS')return new Response(null,{status:204,headers:{...headers,'Access-Control-Allow-Methods':'GET, HEAD','Access-Control-Allow-Headers':'Authorization'}});
 if(!['GET','HEAD'].includes(req.method))return new Response('Method not allowed',{status:405,headers});
 const m=new URL(req.url).pathname.match(/^\/files\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i);
 if(!m)return new Response('Not found',{status:404,headers});
 const jwt=req.headers.get('authorization');
 if(!jwt?.startsWith('Bearer '))return new Response('Sign in first',{status:401,headers});
 try{
  const response=await fetcher(`${env.SUPABASE_URL}/rest/v1/rpc/file_key`,{method:'POST',headers:{apikey:env.SUPABASE_PUBLISHABLE_KEY,authorization:jwt,'Content-Type':'application/json','Content-Profile':'api','Accept-Profile':'api'},body:JSON.stringify({p_file:m[1]}),signal:AbortSignal.timeout(15000)});
  if(!response.ok)return new Response('Not allowed',{status:403,headers});
  const key=await response.json();
  if(typeof key!=='string'||!key.startsWith('documents/')||key.split('/').includes('..'))return new Response('Not allowed',{status:403,headers});
  const object=await env.DOCS.get(key);
  if(!object)return new Response('File unavailable',{status:404,headers});
  return new Response(req.method==='HEAD'?null:object.body,{headers:{...headers,'Content-Type':object.httpMetadata?.contentType||'application/octet-stream','Content-Disposition':'attachment','Content-Security-Policy':"default-src 'none'; sandbox"}});
 }catch{return new Response('File service unavailable. Try again.',{status:503,headers});}
}
