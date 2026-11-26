// Run after `next build` with output: "export". Computes sha256 hashes for every inline script in out/**/*.html
// and writes out/_headers with a strict Content-Security-Policy. Fails the build if no HTML is found.
import { readdirSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";

const OUT = process.argv[2] ?? "out";
const SUPABASE = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://example.supabase.co";
const FILES = process.env.NEXT_PUBLIC_FILES_ORIGIN ?? "https://files.dreniak.com";

const walk = (d) => readdirSync(d).flatMap((n) => {
  const p = join(d, n);
  return statSync(p).isDirectory() ? walk(p) : p.endsWith(".html") ? [p] : [];
});
const pages = walk(OUT);
if (pages.length === 0) throw new Error(`no html found in ${OUT}`);

const hashes = new Set();
for (const f of pages) {
  const html = readFileSync(f, "utf8");
  for (const m of html.matchAll(/<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/g)) {
    if (m[1].trim()) hashes.add(`'sha256-${createHash("sha256").update(m[1]).digest("base64")}'`);
  }
}
const ws = SUPABASE.replace("https://", "wss://");
const csp = [
  "default-src 'self'",
  `script-src 'self' ${[...hashes].join(" ")}`,
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' data: blob: ${FILES}`,
  `font-src 'self'`,
  `connect-src 'self' ${SUPABASE} ${ws} ${FILES}`,
  "worker-src 'self'",
  "manifest-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");
writeFileSync(join(OUT, "_headers"), `/*\n  Content-Security-Policy: ${csp}\n`);
console.log(`CSP written with ${hashes.size} inline-script hashes across ${pages.length} pages`);
