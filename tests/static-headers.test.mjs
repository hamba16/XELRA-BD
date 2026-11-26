import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { generate, origin } from '../infrastructure/scripts/static-headers.mjs';
const env = { NEXT_PUBLIC_SUPABASE_URL: 'https://testref.supabase.co', NEXT_PUBLIC_FILES_ORIGIN: 'https://abc.r2.cloudflarestorage.com' };
function fixture(t, html) {
  const dir = mkdtempSync(join(tmpdir(), 'xelra-csp-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, 'index.html'), html);
  writeFileSync(join(dir, '404.html'), '<h1>Not found</h1>');
  return dir;
}
test('hashes exact script bytes, ignores comments, handles quoted greater-than', t => {
  const code = '\nself.x = "<&>";\n';
  const dir = fixture(t, `<!-- <script>fake()</script> --><script data-x=">">${code}</script>`);
  assert.deepEqual(generate(dir, env), { pages: 2, hashes: 1 });
  const headers = readFileSync(join(dir, '_headers'), 'utf8');
  assert.ok(headers.includes(createHash('sha256').update(code).digest('base64')));
  assert.ok(headers.includes("frame-ancestors 'none'"));
  assert.ok(!headers.includes('unsafe-eval'));
  assert.ok(!headers.split('\n/*.html')[0].includes('Cache-Control'));
  assert.ok(headers.includes('/release.txt\n  Cache-Control: no-store'));
  assert.ok(headers.includes('/\n  Cache-Control: no-cache'));
});
test('rejects inline handlers and remote scripts', t => {
  for (const html of ['<img onerror="alert(1)">', '<script src="//evil.test/a.js"></script>', '<a href="javascript:alert(1)">x</a>'])
    assert.throws(() => generate(fixture(t, html), env));
});
test('rejects missing config, placeholders, development and secret markers', t => {
  for (const value of [undefined, 'https://example.supabase.co', 'https://ok.test/path', 'http://ok.test'])
    assert.throws(() => origin(value));
  for (const marker of ['DEV_ROLE_SWITCHER_MARKER', 'sb_secret_test'])
    assert.throws(() => generate(fixture(t, `<script>${marker}</script>`), env));
});
test('rejects header overflow instead of silently losing CSP on standby', t => {
  const html = Array.from({length: 50}, (_, i) => `<script>self.n=${i}</script>`).join('');
  assert.throws(() => generate(fixture(t, html), env), /header limit/);
});
test('detects embedded legacy service JWTs without rejecting library role labels', t => {
  const payload = Buffer.from(JSON.stringify({role: 'service_role'})).toString('base64url');
  const token = `eyJhbGciOiJIUzI1NiJ9.${payload}.c2lnbmF0dXJl`;
  assert.throws(() => generate(fixture(t, `<script>self.key='${token}'</script>`), env));
  assert.doesNotThrow(() => generate(fixture(t, '<script>self.roleLabel="service_role"</script>'), env));
});
