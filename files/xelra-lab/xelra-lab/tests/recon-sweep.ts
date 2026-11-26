import { reconcile, Line } from '../src/lib/recon.ts';
let seed = 1126; const r = () => (seed = (seed * 1664525 + 1013904223) % 2 ** 32) / 2 ** 32;
const payees = ['Roofing Supplies Kampala', 'Nile Cement Depot', 'Total Energies Ntinda', 'MTN Business', 'Hima Cement', 'Kasese Surveyors', 'Stanbic Charges', 'Umeme Prepaid', 'Safari Hardware', 'Mukwano Stationery'];
const iso = (d: number) => new Date(Date.UTC(2026, 9, 1) + d * 864e5).toISOString().slice(0, 10);
function scenario(n: number, dup: number) {
  const ledger: Line[] = [], bank: Line[] = [], truth = new Map<string, string>();
  for (let i = 0; i < n; i++) {
    const p = payees[Math.floor(r() * payees.length)];
    const amount = -(dup > r() * 100 ? 150000 : 20000 + Math.floor(r() * 4000) * 500);
    const d = Math.floor(r() * 28);
    ledger.push({ id: `L${i}`, date: iso(d), amount, text: `Bill ${p} inv ${1000 + i}` });
    if (r() < 0.93) { const lag = Math.floor(r() * 4); const noisy = r() < 0.5 ? `POS ${p.toUpperCase()} KLA` : `TRF ${p.split(' ')[0].toUpperCase()} REF${i}`; bank.push({ id: `B${i}`, date: iso(d + lag), amount, text: noisy }); truth.set(`B${i}`, `L${i}`); }
  }
  return { ledger, bank, truth };
}
console.log('autoAt margin | repeat% auto  wrong  err%   coverage');
for (const autoAt of [0.62, 0.66, 0.70, 0.74]) for (const margin of [0.06, 0.10, 0.15]) {
  const row: string[] = [];
  for (const dup of [0, 10, 30]) {
    seed = 1126 + dup; const { ledger, bank, truth } = scenario(500, dup);
    const res = reconcile(bank, ledger, autoAt, margin);
    const wrong = res.auto.filter(([b, l]) => truth.get(b) !== l).length;
    row.push(`${String(dup).padStart(2)}%: ${String(res.auto.length).padStart(3)} auto, ${wrong} wrong (${(100 * wrong / Math.max(1, res.auto.length)).toFixed(1)}%), cover ${(100 * res.auto.length / bank.length).toFixed(0)}%`);
  }
  console.log(`${autoAt.toFixed(2)}   ${margin.toFixed(2)}  | ${row.join(' | ')}`);
}
