// Cloudflare Worker, Cron Trigger every 12 hours. Independent of GitHub's scheduler on purpose.
// Jobs: (1) touch the database so a quiet week never pauses it, (2) check the newest backup,
// (3) compare free-tier meters with their caps, (4) email the IT Administrator when something needs a person.
const MB = 1024 * 1024;
export const CAPS = { dbBytes: 500 * MB, storageBytes: 1024 * MB, r2Bytes: 10 * 1024 * MB };
export const WARN = 0.70, CRIT = 0.85, BACKUP_MAX_AGE_H = 36;

/** Pure function: easy to test. Returns a list of {level, key, text}. */
export function evaluate(probe, newestBackupMs, nowMs) {
  const out = [];
  const meter = (key, used, cap, label) => {
    const r = used / cap;
    if (r >= CRIT) out.push({ level: 'critical', key, text: `${label} is at ${(r * 100).toFixed(0)}% of the free cap. Archive or upgrade this week.` });
    else if (r >= WARN) out.push({ level: 'warning', key, text: `${label} is at ${(r * 100).toFixed(0)}% of the free cap.` });
  };
  if (!probe) { out.push({ level: 'critical', key: 'probe', text: 'The database did not answer the probe. Check whether the project is paused.' }); }
  else {
    meter('db', probe.db_bytes, CAPS.dbBytes, 'Database size');
    meter('storage', probe.storage_bytes, CAPS.storageBytes, 'Supabase file storage');
    if (probe.last_backup_ok === false) out.push({ level: 'critical', key: 'restore', text: 'The last restore drill failed.' });
  }
  if (newestBackupMs == null) out.push({ level: 'critical', key: 'backup', text: 'No backup file was found in R2.' });
  else {
    const ageH = (nowMs - newestBackupMs) / 3_600_000;
    if (ageH > BACKUP_MAX_AGE_H) out.push({ level: 'critical', key: 'backup', text: `The newest backup is ${ageH.toFixed(0)} hours old. The nightly job has probably stopped.` });
  }
  return out;
}

export default {
  async scheduled(_event, env, ctx) {
    ctx.waitUntil((async () => {
      let probe = null;
      try {
        const r = await fetch(`${env.SUPABASE_URL}/functions/v1/ops-probe`, { method: 'POST', headers: { 'x-probe-secret': env.PROBE_SECRET } });
        if (r.ok) probe = await r.json();
      } catch { /* leave probe null: that is itself an alert */ }
      const list = await env.BACKUPS.list({ prefix: 'nightly/' });
      const newest = list.objects.reduce((m, o) => Math.max(m, o.uploaded.getTime()), 0) || null;
      const alerts = evaluate(probe, newest, Date.now());
      if (alerts.length) await notify(env, alerts);
    })());
  },
};

async function notify(env, alerts) {
  const tok = await fetch(`https://login.microsoftonline.com/${env.TENANT_ID}/oauth2/v2.0/token`, {
    method: 'POST', body: new URLSearchParams({ client_id: env.CLIENT_ID, client_secret: env.CLIENT_SECRET, scope: 'https://graph.microsoft.com/.default', grant_type: 'client_credentials' }),
  }).then(r => r.json());
  const body = alerts.map(a => `[${a.level.toUpperCase()}] ${a.text}`).join('\n');
  await fetch(`https://graph.microsoft.com/v1.0/users/${env.MAILBOX}/sendMail`, {
    method: 'POST', headers: { Authorization: `Bearer ${tok.access_token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: { subject: 'XELRA needs attention', body: { contentType: 'Text', content: body }, toRecipients: [{ emailAddress: { address: env.ALERT_TO } }] }, saveToSentItems: false }),
  });
}
