// Quiet time: 12:30 to 13:00 in each recipient's own time zone.
// Notifications that would land inside the window are held until it ends.
export interface QuietWindow { startMin: number; endMin: number } // minutes after local midnight
export const LUNCH: QuietWindow = { startMin: 12 * 60 + 30, endMin: 13 * 60 };

function localMinutes(d: Date, tz: string): number {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(d);
  const h = Number(parts.find(p => p.type === 'hour')!.value);
  const m = Number(parts.find(p => p.type === 'minute')!.value);
  return h * 60 + m;
}

/** Returns the moment the message may be sent: `now` if outside the window, else the window's end. */
export function nextSendTime(now: Date, tz: string, w: QuietWindow = LUNCH): Date {
  const mins = localMinutes(now, tz);
  if (mins < w.startMin || mins >= w.endMin) return now;
  const wait = w.endMin - mins; // minutes until quiet time ends
  const out = new Date(now.getTime() + wait * 60_000);
  out.setUTCSeconds(0, 0);
  return out;
}
