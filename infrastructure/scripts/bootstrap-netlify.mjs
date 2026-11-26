// Declarative bootstrap gap: Netlify's official Terraform provider only manages existing sites.
// Dry-run by default. No DNS changes, deployment, Git connection or paid plan selection.
const { NETLIFY_TOKEN: token, NETLIFY_ACCOUNT_SLUG: account, NETLIFY_SITE_NAME: name } = process.env;
if (!token || !/^[a-z0-9-]+$/.test(account ?? '') || !/^[a-z0-9-]+$/.test(name ?? ''))
  throw new Error('Set NETLIFY_TOKEN, NETLIFY_ACCOUNT_SLUG and NETLIFY_SITE_NAME');
async function api(path, options = {}) {
  const res = await fetch(`https://api.netlify.com/api/v1/${path}`, {
    ...options, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`Netlify API failed: ${res.status}`);
  return res.json();
}
let existing;
for (let page = 1; ; page++) {
  const sites = await api(`${account}/sites?per_page=100&page=${page}`);
  existing = sites.find(s => s.name === name);
  if (existing || sites.length < 100) break;
}
if (existing) console.log(JSON.stringify({ site_id: existing.id, name, created: false }));
else if (!process.argv.includes('--apply')) console.log(JSON.stringify({ would_create: name, account }));
else {
  const site = await api(`${account}/sites`, { method: 'POST', body: JSON.stringify({ name }) });
  console.log(JSON.stringify({ site_id: site.id, name, created: true }));
}
