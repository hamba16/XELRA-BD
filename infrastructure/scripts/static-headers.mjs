import { parse } from 'parse5';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, writeFileSync, lstatSync, existsSync } from 'node:fs';
import { resolve, join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';

export function origin(value) {
  if (!value) throw new Error('Missing public origin');
  const u = new URL(value);
  if (u.protocol !== 'https:' || u.origin !== value || u.username || u.password ||
      /example|REPLACE|PROJECT_REF|ACCOUNT_ID/i.test(value)) throw new Error('Supply a real HTTPS origin without path');
  return u.origin;
}
export function generate(directory, env = process.env) {
  const supabase = origin(env.VITE_SUPABASE_URL ?? env.NEXT_PUBLIC_SUPABASE_URL);
  const files = origin(env.VITE_FILES_ORIGIN ?? env.NEXT_PUBLIC_FILES_ORIGIN);
  const walk = d => readdirSync(d).flatMap(n => {
    const p = join(d, n), s = lstatSync(p);
    if (s.isSymbolicLink()) throw new Error('Symlinks are not allowed in release output');
    return s.isDirectory() ? walk(p) : [p];
  });
  const all = walk(directory);
  const pages = all.filter(p => p.endsWith('.html'));
  if (!pages.length) throw new Error('No HTML in static output');
  if (!all.includes(join(directory, '404.html'))) throw new Error('Static export must include 404.html');
  const hashes = new Set();
  for (const file of all) {
    if (/\.(js|html|json|map)$/.test(file)) {
      const text = readFileSync(file, 'utf8');
      const privilegedJwt = [...text.matchAll(/eyJ[A-Za-z0-9_-]+\.([A-Za-z0-9_-]+)\.[A-Za-z0-9_-]+/g)].some(m => {
        try { return JSON.parse(Buffer.from(m[1], 'base64url')).role === 'service_role'; } catch { return false; }
      });
      if (privilegedJwt || /__XELRA_DEV_SWITCHER__|DEV_ROLE_SWITCHER_MARKER|sb_secret_[A-Za-z0-9_-]{20,}|BEGIN PRIVATE KEY/.test(text))
        throw new Error('Development switcher or privileged credential marker in output');
    }
  }
  for (const page of pages) {
    const html = readFileSync(page, 'utf8');
    const visit = node => {
      for (const a of node.attrs ?? []) {
        if (/^on/i.test(a.name) || /^\s*javascript:/i.test(a.value))
          throw new Error('Inline event handler or javascript URL prohibited');
      }
      if (node.tagName === 'script') {
        const src = node.attrs.find(a => a.name === 'src');
        if (src && (!src.value.startsWith('/') || src.value.startsWith('//') || src.value.includes('\\')))
          throw new Error('Only root-relative scripts allowed');
        if (!src) {
          const loc = node.sourceCodeLocation;
          if (!loc?.endTag) throw new Error('Unclosed script');
          const code = html.slice(loc.startTag.endOffset, loc.endTag.startOffset);
          if (code.trim()) hashes.add(`'sha256-${createHash('sha256').update(code).digest('base64')}'`);
        }
      }
      for (const child of node.childNodes ?? []) visit(child);
      if (node.content) visit(node.content);
    };
    visit(parse(html, { sourceCodeLocationInfo: true }));
  }
  const csp = ["default-src 'self'", `script-src 'self' ${[...hashes].sort().join(' ')}`,
    "style-src 'self' 'unsafe-inline'", `img-src 'self' data: blob: ${files} ${supabase}`,
    "font-src 'self'", `connect-src 'self' ${supabase} ${supabase.replace('https:', 'wss:')} ${files}`,
    "worker-src 'self'", "manifest-src 'self'", "frame-ancestors 'none'", "base-uri 'none'",
    "form-action 'self'", "object-src 'none'"].join('; ');
  // Cloudflare Pages limits each header line to 2,000 characters. Fail closed.
  if (Buffer.byteLength(`  Content-Security-Policy: ${csp}`) > 2000)
    throw new Error('CSP exceeds standby header limit; externalise inline scripts before release');
  // Both hosts merge matching rules. A global no-cache would override the
  // intended immutable asset cache, so apply revalidation only to HTML routes.
  const routes = pages.map(p => relative(directory, p).replaceAll('\\', '/'))
    .filter(p => p === 'index.html' || p.endsWith('/index.html'))
    .map(p => '/' + p.slice(0, -'index.html'.length)).sort();
  const redirects=join(directory,'_redirects');
  if(existsSync(redirects))for(const line of readFileSync(redirects,'utf8').split('\n')){
    const match=line.match(/^(\/[a-z/-]+) \/index\.html 200$/);
    if(match&&!routes.includes(match[1]))routes.push(match[1]);
  }
  routes.push('/sw.js','/manifest.webmanifest','/brand/*');
  if (routes.length + 5 > 100) throw new Error('Standby header rule limit exceeded');
  const htmlHeaders = routes.map(route => `${route}\n  Cache-Control: no-cache\n`).join('');
  const headers = `/*\n  Content-Security-Policy: ${csp}\n  X-Robots-Tag: noindex, nofollow, noarchive\n  X-Content-Type-Options: nosniff\n  X-Frame-Options: DENY\n  Referrer-Policy: strict-origin-when-cross-origin\n  Permissions-Policy: camera=(self), microphone=(), geolocation=(self), payment=()\n  Strict-Transport-Security: max-age=63072000; includeSubDomains\n  Cross-Origin-Opener-Policy: same-origin\n/*.html\n  Cache-Control: no-cache\n${htmlHeaders}/release.txt\n  Cache-Control: no-store\n/assets/*\n  Cache-Control: public, max-age=31536000, immutable\n/_next/static/*\n  Cache-Control: public, max-age=31536000, immutable\n`;
  writeFileSync(join(directory, '_headers'), headers);
  return { pages: pages.length, hashes: hashes.size };
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  console.log(generate(resolve(process.argv[2] ?? 'out')));
