import { createHash } from 'node:crypto';
import { readdirSync, lstatSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export function snapshot(root) {
  if (lstatSync(root).isSymbolicLink()) throw new Error('Bundle root cannot be a symlink');
  const files = [];
  function walk(directory, prefix = '') {
    for (const name of readdirSync(directory).sort()) {
      if (!/^[A-Za-z0-9_.@()-]+$/.test(name) || name === '.git' || name.startsWith('.env') ||
          ['_worker.js', 'functions', '.netlify', '.next'].includes(name))
        throw new Error('Unsafe or server-runtime bundle path');
      const path = join(directory, name), stat = lstatSync(path), relative = prefix + name;
      if (stat.isSymbolicLink()) throw new Error('Bundle symlinks prohibited');
      if (stat.isDirectory()) walk(path, relative + '/');
      else if (stat.isFile()) files.push({ path: relative, bytes: stat.size, sha256: sha256(readFileSync(path)) });
      else throw new Error('Non-regular bundle file');
    }
  }
  walk(root);
  for (const required of ['index.html', '404.html', '_headers', 'release.txt'])
    if (!files.some(f => f.path === required)) throw new Error(`Missing ${required}`);
  return files.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
}
export function manifest(root, revision) {
  if (!/^[0-9a-f]{40}$/.test(revision ?? '')) throw new Error('A full release commit SHA is required');
  if (readFileSync(join(root, 'release.txt'), 'utf8') !== revision + '\n') throw new Error('Release identity mismatch');
  return { version: 1, revision, files: snapshot(root) };
}
export function verify(root, expected, revision) {
  const actual = manifest(root, revision);
  // Compare the entire inventory: sha256sum alone would not reject extra files.
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error('Release manifest mismatch');
  return actual;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [mode, directory = 'out', file = 'release-manifest.json', revision = process.env.GITHUB_SHA] = process.argv.slice(2);
  if (mode === 'create') writeFileSync(file, JSON.stringify(manifest(directory, revision), null, 2) + '\n');
  else if (mode === 'verify') verify(directory, JSON.parse(readFileSync(file, 'utf8')), revision);
  else throw new Error('Use create or verify');
  console.log(`Release manifest ${mode} passed`);
}
