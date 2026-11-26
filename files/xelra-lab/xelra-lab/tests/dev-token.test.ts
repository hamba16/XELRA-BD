import assert from 'node:assert/strict';
import { mint, verify } from '../src/lib/dev-token.ts';
const LOCAL = 'super-secret-jwt-token-with-at-least-32-characters-long';   // the well-known local default
const PROD = 'k9Zq7vN3xT1mB8cR5wH2yP6dL0aF4sJgUe';                         // lives only in the production project
const t = mint('00000000-0000-0000-0000-000000000001', LOCAL);
assert.ok(verify(t, LOCAL), 'local project accepts a dev token');
assert.equal(verify(t, PROD), null, 'production project rejects a dev token');
assert.equal(verify(t.slice(0, -2) + 'xx', LOCAL), null, 'tampered signature rejected');
assert.equal(verify(mint('x', LOCAL, 1000), LOCAL, 1000 + 3601), null, 'expired token rejected');
console.log('dev-token: 4/4 passed');
