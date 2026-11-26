// Development-only token minting for the role switcher. It signs with the LOCAL Supabase JWT secret.
// Production verifies with a different secret that is never in the repository, so these tokens are
// worthless there even if this file were bundled by mistake.
import { createHmac, timingSafeEqual } from 'node:crypto';
const b64 = (o: unknown) => Buffer.from(typeof o === 'string' ? o : JSON.stringify(o)).toString('base64url');

export function mint(personId: string, secret: string, now = Math.floor(Date.now() / 1000)): string {
  const head = b64({ alg: 'HS256', typ: 'JWT' });
  const body = b64({ sub: personId, role: 'authenticated', aud: 'authenticated', iat: now, exp: now + 3600, dev: true });
  const sig = createHmac('sha256', secret).update(`${head}.${body}`).digest('base64url');
  return `${head}.${body}.${sig}`;
}
/** What a Supabase project does with an incoming token: check the signature against ITS secret. */
export function verify(token: string, secret: string, now = Math.floor(Date.now() / 1000)): { sub: string } | null {
  const [h, p, s] = token.split('.');
  if (!h || !p || !s) return null;
  const want = createHmac('sha256', secret).update(`${h}.${p}`).digest();
  const got = Buffer.from(s, 'base64url');
  if (got.length !== want.length || !timingSafeEqual(got, want)) return null;
  const claims = JSON.parse(Buffer.from(p, 'base64url').toString());
  return claims.exp > now ? { sub: claims.sub } : null;
}
