// Secret key is sent only in apikey. Works with Supabase's new secret-key format.
import { origin } from './static-headers.mjs';
const url = origin(process.env.SUPABASE_URL);
const key = process.env.SUPABASE_SECRET_KEY;
if (!key) throw new Error('SUPABASE_SECRET_KEY required');
const mode = process.argv[2];
const endpoint = mode === 'heartbeat' ? 'record_heartbeat' : mode === 'meter' ? 'record_meter' : mode === 'database' ? 'record_database_meter' : 'infrastructure_health';
let payload = {};
if (mode === 'heartbeat') payload = { p_kind: process.argv[3] };
else if (mode === 'meter') {
  payload = { p_kind: process.argv[3], p_value: Number(process.argv[4]), p_capacity: Number(process.argv[5]) };
  if (!Number.isFinite(payload.p_value) || !Number.isFinite(payload.p_capacity)) throw new Error('Invalid meter');
} else if (mode === 'database') {
  payload = { p_capacity: Number(process.env.DATABASE_CAPACITY_BYTES) };
  if (!(payload.p_capacity > 0)) throw new Error('DATABASE_CAPACITY_BYTES required');
} else if (mode !== 'check') throw new Error('Use heartbeat, meter, database or check');
const res = await fetch(`${url}/rest/v1/rpc/${endpoint}`, {
  method: 'POST', headers: { apikey: key, 'Content-Type': 'application/json', 'Content-Profile': 'api', 'Accept-Profile': 'api' },
  body: JSON.stringify(payload), signal: AbortSignal.timeout(30000),
});
if (!res.ok) throw new Error(`Operations RPC failed: ${res.status}`);
if (mode === 'check') {
  const h = await res.json();
  const kinds = new Set(h.meters.map(m => m.kind));
  const missing = ['database_bytes','r2_bytes','hosting_credits'].filter(k => !kinds.has(k));
  console.log(JSON.stringify({ ...h, missing_meters: missing }));
  if (!h.backup_ok || !h.keepalive_ok || !h.restore_drill_ok || missing.length || h.meters.some(m => m.critical || m.stale))
    process.exitCode = 1;
}
