import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { manifest, verify } from '../infrastructure/scripts/release-manifest.mjs';
const sha = 'a'.repeat(40);
function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'xelra-manifest-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  for (const file of ['index.html', '404.html', '_headers']) writeFileSync(join(dir, file), 'fixture');
  writeFileSync(join(dir, 'release.txt'), sha + '\n');
  return dir;
}
test('manifest is deterministic and accepts the exact bundle', t => {
  const dir = fixture(t), expected = manifest(dir, sha);
  assert.deepEqual(verify(dir, expected, sha), expected);
  assert.deepEqual(manifest(dir, sha), expected);
});
test('rejects changed, missing and extra files', t => {
  for (const action of ['changed', 'missing', 'extra']) {
    const dir = fixture(t), expected = manifest(dir, sha);
    if (action === 'changed') writeFileSync(join(dir, 'index.html'), 'tampered');
    if (action === 'missing') rmSync(join(dir, '404.html'));
    if (action === 'extra') writeFileSync(join(dir, 'extra.js'), 'unexpected');
    assert.throws(() => verify(dir, expected, sha));
  }
});
test('rejects wrong commit, path traversal manifests and server-runtime output', t => {
  const dir = fixture(t), expected = manifest(dir, sha);
  assert.throws(() => verify(dir, expected, 'b'.repeat(40)));
  expected.files[0].path = '../outside';
  assert.throws(() => verify(dir, expected, sha));
  mkdirSync(join(dir, '_worker.js'));
  assert.throws(() => manifest(dir, sha), /server-runtime/);
});
