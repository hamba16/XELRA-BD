import assert from 'node:assert/strict';
import { Outbox, Job, Store } from '../src/lib/offline-queue.ts';

// Deterministic PRNG so the experiment is repeatable
let seed = 20261125; const rnd = () => (seed = (seed * 1664525 + 1013904223) % 2 ** 32) / 2 ** 32;

class MemStore implements Store {
  m = new Map<string, Job>();
  async put(j: Job) { this.m.set(j.id, structuredClone(j)); }
  async remove(id: string) { this.m.delete(id); }
  async all() { return [...this.m.values()].map(j => structuredClone(j)); }
}

let sessions = 0, reportsMade = 0, lost = 0, duplicates = 0, killedMidFlush = 0, flushes = 0;
for (let s = 0; s < 1000; s++) {
  sessions++;
  const store = new MemStore();                 // survives "app kills" like IndexedDB does
  const server = new Map<string, number>();     // client_id -> times stored (must end at 1)
  const flaky = 0.1 + rnd() * 0.5;              // 10% to 60% of requests fail
  const send = async (job: Job) => {
    if (rnd() < flaky) throw new Error('network');
    // the server may store the row and then the response gets lost on the way back
    const had = server.has(job.id);
    server.set(job.id, (server.get(job.id) ?? 0) + (had ? 0 : 1)); // ON CONFLICT DO NOTHING
    if (rnd() < flaky / 2) throw new Error('response lost');
    return had ? 'duplicate' : 'created';
  };
  const ids: string[] = [];
  let box = new Outbox(store, send);
  const n = 3 + Math.floor(rnd() * 12);
  for (let i = 0; i < n; i++) {
    ids.push(await box.enqueue('field_report', { note: `r${i}` }, `s${s}-r${i}`)); reportsMade++;
    if (rnd() < 0.3) { await box.flush(); flushes++; }
    if (rnd() < 0.15) { box = new Outbox(store, send); killedMidFlush++; }   // app killed, new instance reads the same store
  }
  for (let tries = 0; tries < 200 && (await store.all()).length; tries++) { await box.flush(); flushes++; }
  for (const id of ids) {
    if (!server.has(id)) lost++;
    if ((server.get(id) ?? 0) > 1) duplicates++;
  }
}
console.log(`sessions ${sessions}, reports ${reportsMade}, flush calls ${flushes}, app restarts ${killedMidFlush}`);
console.log(`lost on server: ${lost}   duplicated on server: ${duplicates}`);
assert.equal(lost, 0); assert.equal(duplicates, 0);
console.log('offline-queue: zero lost, zero duplicated');
