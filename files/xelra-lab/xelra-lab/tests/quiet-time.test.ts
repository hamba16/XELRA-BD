import assert from 'node:assert/strict';
import { nextSendTime } from '../src/lib/quiet-time.ts';
const t = (iso: string) => new Date(iso);
// 12:40 in Kampala (UTC+3) = 09:40Z
assert.equal(nextSendTime(t('2026-12-01T09:40:00Z'), 'Africa/Kampala').toISOString(), '2026-12-01T10:00:00.000Z');
// 12:29 is outside
assert.equal(nextSendTime(t('2026-12-01T09:29:00Z'), 'Africa/Kampala').toISOString(), '2026-12-01T09:29:00.000Z');
// 13:00 sharp is outside
assert.equal(nextSendTime(t('2026-12-01T10:00:00Z'), 'Africa/Kampala').toISOString(), '2026-12-01T10:00:00.000Z');
// Same instant, London (UTC+0 in December): 09:40 local, no hold
assert.equal(nextSendTime(t('2026-12-01T09:40:00Z'), 'Europe/London').toISOString(), '2026-12-01T09:40:00.000Z');
// London in summer (BST, UTC+1): 12:45 local = 11:45Z, held to 12:00Z
assert.equal(nextSendTime(t('2026-07-01T11:45:00Z'), 'Europe/London').toISOString(), '2026-07-01T12:00:00.000Z');
console.log('quiet-time: 5/5 passed');
