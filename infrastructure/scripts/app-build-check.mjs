import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import {createHash} from 'node:crypto';
import { gzipSync } from 'node:zlib';
const files = readdirSync('out/assets').filter(f => f.endsWith('.js'));
let total = 0;
for (const file of files) {
  const source = readFileSync(`out/assets/${file}`);
  if (/__XELRA_DEV_SWITCHER__|DEV_ROLE_SWITCHER_MARKER|sb_secret_[A-Za-z0-9_-]{20,}|BEGIN PRIVATE KEY|@xelra\.test/.test(source.toString())) throw Error('Unsafe development or credential content in build');
  total += gzipSync(source).length;
}
if (total > 250 * 1024) throw Error(`JavaScript budget exceeded: ${total} bytes gzip`);
// Explicit known routes retain a real 404 for unknown paths on both hosts.
writeFileSync('out/_redirects', ['/auth/callback/ /index.html 200', '/inbox /index.html 200', '/projects /index.html 200', '/people /index.html 200', '/documents /index.html 200', '/finance /index.html 200', '/capture /index.html 200', '/help /index.html 200', '/admin /index.html 200'].join('\n') + '\n');
const version=createHash('sha256').update(readFileSync('out/index.html')).digest('hex').slice(0,16);
const cacheFiles=['/','/index.html','/manifest.webmanifest',...readdirSync('out/assets').map(f=>'/assets/'+f),...readdirSync('out/brand').map(f=>'/brand/'+f)];
writeFileSync('out/sw.js', `const CACHE='xelra-shell-${version}';const FILES=${JSON.stringify(cacheFiles)};
self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(FILES))));
self.addEventListener('message',e=>{if(e.data==='ACTIVATE')self.skipWaiting();});
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('xelra-shell-')&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',e=>{const u=new URL(e.request.url);if(e.request.method!=='GET'||u.origin!==location.origin)return;
 if(e.request.mode==='navigate'){e.respondWith(fetch(e.request).catch(()=>caches.match('/index.html')));return;}
 if(FILES.includes(u.pathname))e.respondWith(caches.match(e.request).then(r=>r||fetch(e.request)));
});\n`);
console.log(`Production JavaScript: ${total} bytes gzip / 256000 budget; development code absent.`);
