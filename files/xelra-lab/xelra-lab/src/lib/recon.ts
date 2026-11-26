// Bank reconciliation matcher. Scores every (bank line, ledger entry) pair, auto-matches only when the
// score is high AND clearly ahead of the runner-up, and queues the rest as suggestions for a person.
export interface Line { id: string; date: string; amount: number; text: string }   // amount in UGX, signed
const day = (s: string) => Date.parse(s + 'T00:00:00Z') / 86_400_000;
const tokens = (s: string) => new Set(s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(t => t.length > 2));
const jaccard = (a: Set<string>, b: Set<string>) => { if (!a.size || !b.size) return 0; let i = 0; for (const t of a) if (b.has(t)) i++; return i / (a.size + b.size - i); };

export function score(bank: Line, led: Line): number {
  if (bank.amount !== led.amount) return 0;                               // amounts must agree exactly; fees are separate lines
  const dd = Math.abs(day(bank.date) - day(led.date));
  if (dd > 7) return 0;
  const near = dd <= 1 ? 1 : dd <= 3 ? 0.7 : 0.4;
  const txt = jaccard(tokens(bank.text), tokens(led.text));
  return 0.45 + 0.25 * near + 0.30 * txt;                                 // 0.45 floor for exact amount inside a week
}

export interface Result { auto: [string, string][]; suggest: { bank: string; options: [string, number][] }[]; unmatched: string[] }
export function reconcile(bank: Line[], ledger: Line[], autoAt = 0.62, margin = 0.10): Result {
  const taken = new Set<string>(), auto: [string, string][] = [], suggest: Result['suggest'] = [], unmatched: string[] = [];
  const ranked = bank.map(b => ({ b, c: ledger.map(l => [l.id, score(b, l)] as [string, number]).filter(([, s]) => s > 0).sort((x, y) => y[1] - x[1]) }));
  ranked.sort((x, y) => (y.c[0]?.[1] ?? 0) - (x.c[0]?.[1] ?? 0));      // most certain lines first, so they claim their entries
  for (const { b, c } of ranked) {
    const open = c.filter(([id]) => !taken.has(id));
    if (!open.length) { unmatched.push(b.id); continue; }
    const [top, second] = [open[0], open[1]];
    if (top[1] >= autoAt && (!second || top[1] - second[1] >= margin)) { auto.push([b.id, top[0]]); taken.add(top[0]); }
    else suggest.push({ bank: b.id, options: open.slice(0, 3) });
  }
  return { auto, suggest, unmatched };
}
