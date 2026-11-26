import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { generate } from '../infrastructure/scripts/static-headers.mjs';
import { manifest } from '../infrastructure/scripts/release-manifest.mjs';
import { verifyHost } from '../infrastructure/scripts/verify-host.mjs';
const revision = 'b'.repeat(40), origin = 'https://xelra.test';
function fixture(t, fault) {
  const root = mkdtempSync(join(tmpdir(), 'xelra-host-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, '_next/static'), { recursive: true });
  writeFileSync(join(root, 'index.html'), '<h1>XELRA</h1>');
  writeFileSync(join(root, '404.html'), '<h1>Not found</h1>');
  writeFileSync(join(root, '_next/static/app.js'), 'self.ready=true;');
  writeFileSync(join(root, 'release.txt'), revision + '\n');
  generate(root, { NEXT_PUBLIC_SUPABASE_URL: 'https://test.supabase.co', NEXT_PUBLIC_FILES_ORIGIN: 'https://abc.r2.cloudflarestorage.com' });
  const expected = manifest(root, revision);
  const fetcher = async (url, options) => {
    assert.equal(options.redirect, 'manual');
    assert.equal(new URL(url).origin, origin);
    const path = new URL(url).pathname;
    let status = path.startsWith('/__xelra_missing_') ? 404 : 200;
    const file = status === 404 ? '404.html' : path === '/' ? 'index.html' : path.slice(1);
    const headers = {};
    // Simulate only the common security block; asset cache is a separate host rule.
    for (const line of readFileSync(join(root, '_headers'), 'utf8').split('\n').slice(1)) {
      if (line && !line.startsWith(' ')) break;
      const match = line.match(/^\s+([^:]+):\s*(.+)$/);
      if (match) headers[match[1]] = match[2];
    }
    if (path.includes('_next/static')) headers['Cache-Control'] = 'public, max-age=31536000, immutable';
    let body = readFileSync(join(root, file));
    if (fault === 'csp') delete headers['Content-Security-Policy'];
    if (fault === 'redirect') { status = 302; headers.Location = 'https://other.test'; }
    if (fault === 'spa' && status === 404) status = 200;
    if (fault === 'stale' && path === '/release.txt') body = Buffer.from('c'.repeat(40) + '\n');
    if (fault === 'cache' && path.includes('_next/static')) headers['Cache-Control'] += ', no-cache';
    if (fault === 'asset' && path.includes('_next/static')) body = Buffer.from('self.ready=evil;');
    if (fault === 'oversized') body = Buffer.concat([body, Buffer.from('extra')]);
    return new Response(body, { status, headers });
  };
  return { root, expected, fetcher };
}
test('accepts matching host content, security headers, immutable asset and real 404', async t => {
  const { root, expected, fetcher } = fixture(t);
  assert.equal((await verifyHost(origin, root, expected, revision, fetcher)).probes, 4);
});
test('rejects stale releases, header loss, redirects, soft 404, bad caching and content changes', async t => {
  for (const fault of ['csp', 'redirect', 'spa', 'stale', 'cache', 'asset', 'oversized']) {
    const { root, expected, fetcher } = fixture(t, fault);
    await assert.rejects(verifyHost(origin, root, expected, revision, fetcher), undefined, fault);
  }
});
test('rejects insecure target without making a request', async t => {
  const { root, expected } = fixture(t);
  await assert.rejects(verifyHost('http://xelra.test', root, expected, revision, () => assert.fail('network used')));
});
