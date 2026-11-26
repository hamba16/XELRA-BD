import assert from 'node:assert/strict';
import { reconcile, Line } from '../src/lib/recon.ts';
let seed = 1126; const r = () => (seed = (seed * 1664525 + 1013904223) % 2 ** 32) / 2 ** 32;
const payees = ['Roofing Supplies Kampala', 'Nile Cement Depot', 'Total Energies Ntinda', 'MTN Business', 'Hima Cement', 'Kasese Surveyors', 'Stanbic Charges', 'Umeme Prepaid', 'Safari Hardware', 'Mukwano Stationery'];
const iso = (d: number) => new Date(Date.UTC(2026, 9, 1) + d * 864e5).toISOString().slice(0, 10);
function scenario(n: number, dupAmounts: number) {
  const ledger: Line[] = [], bank: Line[] = [], truth = new Map<string, string>();
  for (let i = 0; i < n; i++) {
    const p = payees[Math.floor(r() * payees.length)];
    const amount = -(dupAmounts > r() * 100 ? 150000 : 20000 + Math.floor(r() * 4000) * 500);   // some amounts repeat exactly
    const d = Math.floor(r() * 28);
    ledger.push({ id: `L${i}`, date: iso(d), amount, text: `Bill ${p} inv ${1000 + i}` });
    if (r() < 0.93) {                                                                         // 7% of ledger entries never clear the bank
      const lag = Math.floor(r() * 4);
      const noisy = r() < 0.5 ? `POS ${p.toUpperCase()} KLA` : `TRF ${p.split(' ')[0].toUpperCase()} REF${i}`;
      bank.push({ id: `B${i}`, date: iso(d + lag), amount, text: noisy }); truth.set(`B${i}`, `L${i}`);
    }
  }
  return { ledger, bank, truth };
}
for (const dup of [0, 10, 30]) {
  const { ledger, bank, truth } = scenario(500, dup);
  const res = reconcile(bank, ledger);
  const right = res.auto.filter(([b, l]) => truth.get(b) === l).length;
  const wrong = res.auto.length - right;
  const top1 = res.suggest.filter(s => s.options[0]?.[0] === truth.get(s.bank)).length;
  console.log(`repeat-amount rate ${String(dup).padStart(2)}%: bank lines ${bank.length}, auto-matched ${res.auto.length} (wrong ${wrong}), suggested ${res.suggest.length} (top suggestion right ${top1}), unmatched ${res.unmatched.length}`);
  assert.ok(wrong / Math.max(res.auto.length, 1) < 0.02, 'auto-match error rate must stay under 2%');
}
