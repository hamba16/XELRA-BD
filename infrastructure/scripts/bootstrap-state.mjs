// Create the independent state bucket before Terraform init. Dry-run by default.
const { CLOUDFLARE_API_TOKEN: token, CLOUDFLARE_ACCOUNT_ID: account,
  TF_STATE_BUCKET: name = 'xelra-terraform-state' } = process.env;
if (!token || !/^[a-f0-9]{32}$/.test(account ?? '') || !/^[a-z0-9-]{3,63}$/.test(name))
  throw new Error('Set account token, account ID and a valid state bucket name');
const base = `https://api.cloudflare.com/client/v4/accounts/${account}/r2/buckets`;
async function call(url, method = 'GET', body) {
  const r = await fetch(url, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body && JSON.stringify(body), signal: AbortSignal.timeout(30000) });
  if (r.status === 404 && method === 'GET') return null;
  if (!r.ok) throw new Error(`Cloudflare returned ${r.status}`);
  const data = await r.json();
  if (!data.success) throw new Error('Cloudflare operation failed');
  return data.result;
}
const exists = await call(`${base}/${name}`);
if (!process.argv.includes('--apply')) console.log(JSON.stringify({ bucket: name, would_create: !exists, public_access: 'disabled' }));
else {
  if (!exists) await call(base, 'POST', { name });
  await call(`${base}/${name}/domains/managed`, 'PUT', { enabled: false });
  console.log(JSON.stringify({ bucket: name, created: !exists }));
}
