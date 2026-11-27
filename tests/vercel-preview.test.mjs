import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const config = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));

test('Vercel serves known SPA paths without swallowing unknown paths or assets', () => {
  const rewrite = path => config.rewrites.find(rule => new RegExp(`^${rule.source}$`).test(path))?.destination;
  for (const path of ['/inbox', '/projects', '/people', '/documents', '/finance', '/settings', '/capture', '/help', '/admin', '/auth/callback', '/auth/callback/']) {
    assert.equal(rewrite(path), '/index.html', path);
  }
  for (const path of ['/missing-page', '/projects/not-a-route', '/assets/missing.js', '/api/private']) {
    assert.equal(rewrite(path), undefined, path);
  }
  assert.equal(config.framework, null, 'do not inject a framework-wide SPA fallback');
});

test('Vercel keeps preview pages unindexed and caches only fingerprinted assets immutably', () => {
  const headers = path => Object.fromEntries(config.headers
    .filter(rule => new RegExp(`^${rule.source}$`).test(path))
    .flatMap(rule => rule.headers.map(header => [header.key, header.value])));
  for (const path of ['/', '/settings', '/404.html', '/sw.js']) {
    assert.equal(headers(path)['Cache-Control'], 'no-cache');
    assert.match(headers(path)['X-Robots-Tag'], /noindex/);
    assert.equal(headers(path)['X-Frame-Options'], 'DENY');
    assert.match(headers(path)['Content-Security-Policy'], /frame-ancestors 'none'/);
  }
  assert.equal(headers('/assets/index-123.js')['Cache-Control'], 'public, max-age=31536000, immutable');
  assert.equal(headers('/release.txt')['Cache-Control'], 'no-store');
});

test('hosted profiles retain synthetic identities and restricted external and IT scopes', () => {
  const profiles = JSON.parse(readFileSync(new URL('../infrastructure/preview-profiles.json', import.meta.url), 'utf8'));
  assert.equal(profiles.length, 9);
  assert.equal(new Set(profiles.map(profile => profile.id)).size, profiles.length);
  for (const profile of profiles) {
    assert.match(profile.id, /^preview-/);
    assert.match(profile.name, /^Sample /);
    if (['client', 'contractor', 'auditor'].includes(profile.principal)) assert.deepEqual(profile.permissions, []);
    if (profile.principal === 'it_admin') {
      assert.ok(profile.permissions.includes('ops.read'));
      assert.ok(!profile.permissions.includes('payroll.read'));
      assert.ok(!profile.permissions.includes('records.read'));
    }
  }
});
