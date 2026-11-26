export default {
  async fetch(req, env) {
    const m = new URL(req.url).pathname.match(/^\/files\/([0-9a-f-]{36})$/);
    if (!m) return new Response('Not found', { status: 404 });
    const jwt = req.headers.get('authorization');
    if (!jwt) return new Response('Sign in first', { status: 401 });
    const r = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/file_key`, {
      method: 'POST',
      headers: { apikey: env.SUPABASE_ANON_KEY, authorization: jwt, 'content-type': 'application/json' },
      body: JSON.stringify({ p_file: m[1] }),
    });
    if (!r.ok) return new Response('Not allowed', { status: 403 });
    const key = await r.json();
    if (!key) return new Response('Not allowed', { status: 403 });
    const obj = await env.DOCS.get(key);
    if (!obj) return new Response('Missing', { status: 404 });
    return new Response(obj.body, { headers: {
      'content-type': obj.httpMetadata?.contentType ?? 'application/octet-stream',
      'content-disposition': 'attachment', 'cache-control': 'private, max-age=300', 'x-content-type-options': 'nosniff' } });
  },
};
