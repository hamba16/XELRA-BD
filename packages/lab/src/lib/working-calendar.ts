export interface WorkingCalendar {
  timeZone: string;
  weekdays: Partial<Record<number, [number, number][]>>;
  holidays: string[];
  workingDayMinutes: number;
}
/** Configured working minutes, including overnight/weekend and holiday pauses. */
export function workingMinutes(start: Date, end: Date, calendar: WorkingCalendar): number {
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end < start || end.getTime() - start.getTime() > 366 * 86400000) throw Error("Choose an ordered SLA interval of at most one year.");
  if (!Number.isInteger(calendar.workingDayMinutes) || calendar.workingDayMinutes <= 0 || calendar.workingDayMinutes > 1440) throw Error("Configure the length of a working day.");
  for (const [day, windows] of Object.entries(calendar.weekdays)) {
    if (!/^[0-6]$/.test(day)) throw Error("Calendar weekdays must run from 0 to 6.");
    let previousEnd = -1;
    for (const [from, to] of windows || []) {
      if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to > 1440 || from >= to || from < previousEnd) throw Error("Working windows must be ordered, non-overlapping minute ranges.");
      previousEnd = to;
    }
  }
  const formatter = new Intl.DateTimeFormat("en-CA", { timeZone: calendar.timeZone, year: "numeric", month: "2-digit", day: "2-digit", weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  let elapsed = 0;
  for (let t = Math.floor(start.getTime() / 60000) * 60000; t < end.getTime(); t += 60000) {
    const parts = Object.fromEntries(formatter.formatToParts(new Date(t)).map(p => [p.type, p.value]));
    if (calendar.holidays.includes(`${parts.year}-${parts.month}-${parts.day}`)) continue;
    const minute = Number(parts.hour) * 60 + Number(parts.minute);
    if ((calendar.weekdays[weekday.indexOf(parts.weekday)] || []).some(([from, to]) => minute >= from && minute < to)) elapsed += Math.max(0, Math.min(t + 60000, end.getTime()) - Math.max(t, start.getTime())) / 60000;
  }
  return elapsed;
}
export function acknowledgementSla(priority: 1 | 2 | 3 | 4, created: Date, until: Date, calendar: WorkingCalendar | null) {
  if (!calendar) return { state: "unconfigured" as const, elapsed: null, target: null };
  const elapsed = workingMinutes(created, until, calendar);
  const target = priority === 1 ? 120 : priority === 2 ? 240 : calendar.workingDayMinutes * (priority === 4 ? 2 : 1);
  return { state: elapsed > target ? "overdue" as const : "within_target" as const, elapsed, target };
}
