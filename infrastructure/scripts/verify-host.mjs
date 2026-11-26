import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { verify, sha256 } from './release-manifest.mjs';

function httpsOrigin(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.origin !== value || url.username || url.password)
    throw new Error('Supply an HTTPS origin without a path');
  return url.origin;
}
function securityHeaders(source) {
  const required = ['content-security-policy', 'x-content-type-options', 'x-frame-options',
    'referrer-policy', 'permissions-policy', 'strict-transport-security', 'cross-origin-opener-policy'];
  const result = new Map();
  let inGlobal = false;
  for (const line of source.split(/\r?\n/)) {
    if (line === '/*') { inGlobal = true; continue; }
    if (line && !/^\s/.test(line)) inGlobal = false;
    const match = inGlobal && line.match(/^\s+([^:]+):\s*(.+)$/);
    if (match && required.includes(match[1].toLowerCase())) result.set(match[1].toLowerCase(), match[2]);
  }
  if (required.some(name => !result.has(name))) throw new Error('Incomplete local security headers');
  return result;
}
const normalise = text => text.trim().replace(/\s+/g, ' ');

export async function verifyHost(origin, root, expected, revision, fetcher = fetch) {
  origin = httpsOrigin(origin);
  verify(root, expected, revision);
  const headers = securityHeaders(readFileSync(join(root, '_headers'), 'utf8'));
  const asset = expected.files.find(f => (f.path.startsWith('assets/') || f.path.startsWith('_next/static/')) && /\.(js|css)$/.test(f.path));
  if (!asset) throw new Error('No static asset available for acceptance check');
  const find = path => expected.files.find(f => f.path === path);
  const probes = [
    { path: '/release.txt', file: find('release.txt'), status: 200 },
    { path: '/', file: find('index.html'), status: 200, secure: true },
    { path: '/' + asset.path, file: asset, status: 200, secure: true, immutable: true },
    { path: `/__xelra_missing_${revision}/`, file: find('404.html'), status: 404, secure: true },
  ];
  for (const probe of probes) {
    const response = await fetcher(origin + probe.path, {
      redirect: 'manual', signal: AbortSignal.timeout(30000), headers: { 'Cache-Control': 'no-cache' },
    });
    if (response.status !== probe.status) throw new Error(`Unexpected status at ${probe.path}: ${response.status}`);
    if (probe.secure) for (const [name, value] of headers)
      if (normalise(response.headers.get(name) ?? '') !== normalise(value))
        throw new Error(`Security header mismatch at ${probe.path}: ${name}`);
    if (probe.immutable) {
      const cache = (response.headers.get('cache-control') ?? '').toLowerCase().split(',').map(x => x.trim());
      if (!cache.includes('immutable') || !cache.includes('max-age=31536000') ||
          cache.some(x => /^(no-cache|no-store|private)(=|$)/.test(x)))
        throw new Error('Static asset cache policy mismatch');
    }
    if (!response.body) throw new Error('Missing response body');
    const reader = response.body.getReader(), chunks = [];
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > probe.file.bytes) throw new Error(`Oversized body at ${probe.path}`);
        chunks.push(value);
      }
    } finally { await reader.cancel(); }
    if (size !== probe.file.bytes || sha256(Buffer.concat(chunks)) !== probe.file.sha256)
      throw new Error(`Deployed content mismatch at ${probe.path}`);
  }
  return { origin, revision, probes: probes.length, passed: true };
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [origin, directory = 'out', file = 'release-manifest.json', revision = process.env.GITHUB_SHA] = process.argv.slice(2);
  console.log(JSON.stringify(await verifyHost(origin, directory, JSON.parse(readFileSync(file, 'utf8')), revision)));
}
