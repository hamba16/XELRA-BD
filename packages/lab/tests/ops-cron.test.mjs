import assert from 'node:assert/strict';
import { evaluate, CAPS } from '../src/worker/ops-cron.mjs';
const MB = 1024 * 1024, H = 3_600_000, now = Date.UTC(2026, 11, 1, 6, 0, 0);
const ok = { db_bytes: 100 * MB, storage_bytes: 100 * MB, last_backup_ok: true };
assert.deepEqual(evaluate(ok, now - 5 * H, now), []);
assert.equal(evaluate({ ...ok, db_bytes: 360 * MB }, now - H, now)[0].level, 'warning');           // 72%
assert.equal(evaluate({ ...ok, db_bytes: 430 * MB }, now - H, now)[0].level, 'critical');          // 86%
assert.equal(evaluate({ ...ok, db_bytes: 0.85 * CAPS.dbBytes }, now - H, now)[0].level, 'critical'); // exactly 85%
assert.equal(evaluate(ok, now - 40 * H, now)[0].key, 'backup');                                     // stale backup
assert.equal(evaluate(ok, null, now)[0].key, 'backup');                                             // no backup at all
assert.equal(evaluate(null, now - H, now)[0].key, 'probe');                                         // paused or unreachable
assert.equal(evaluate({ ...ok, last_backup_ok: false }, now - H, now)[0].key, 'restore');
console.log('ops-cron: 8/8 passed');
