import { useState } from 'react';

export interface Approval {
  id: string; kind: 'expense' | 'leave' | 'requisition' | 'booking' | 'site-visit';
  title: string; requester: string; amountUgx?: number; submittedAt: string;
  step: number; steps: number; waitingOn: string; docNo?: string;
}
const KIND = { expense: 'Expense', leave: 'Leave', requisition: 'Purchase', booking: 'Booking', 'site-visit': 'Site visit' } as const;
const ugx = (n: number) => 'UGX ' + new Intl.NumberFormat('en-UG').format(n);

/** Progress ring: one arc per step, filled in the lens colour. Echoes the mark without decorating. */
function StepRing({ done, total }: { done: number; total: number }) {
  const r = 11, c = 2 * Math.PI * r, seg = c / total, gap = total > 1 ? 3 : 0;
  return (
    <svg width="28" height="28" viewBox="0 0 28 28" role="img" aria-label={`Step ${Math.min(done + 1, total)} of ${total}`}>
      {Array.from({ length: total }, (_, i) => (
        <circle key={i} cx="14" cy="14" r={r} fill="none" strokeWidth="3" transform="rotate(-90 14 14)"
          stroke={i < done ? 'var(--lens)' : 'var(--hairline)'} strokeDasharray={`${seg - gap} ${c - seg + gap}`} strokeDashoffset={-i * seg} />
      ))}
    </svg>
  );
}

export function ApprovalCard({ a, onDecide }: { a: Approval; onDecide: (id: string, approve: boolean, comment?: string) => Promise<void> }) {
  const [busy, setBusy] = useState<null | 'approve' | 'reject'>(null);
  const [reason, setReason] = useState('');
  const [rejecting, setRejecting] = useState(false);
  async function go(approve: boolean) {
    setBusy(approve ? 'approve' : 'reject');
    try { await onDecide(a.id, approve, approve ? undefined : reason); } finally { setBusy(null); }
  }
  return (
    <article aria-labelledby={`t-${a.id}`} style={{ background: 'var(--surface)', border: '1px solid var(--hairline)', borderRadius: 'var(--corner-d)', padding: 20, display: 'grid', gap: 12 }}>
      <header style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
        <StepRing done={a.step - 1} total={a.steps} />
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 'var(--t-12)', color: 'var(--text-muted)' }}>{KIND[a.kind]} from {a.requester}{a.docNo && <> <span className="doc-no">{a.docNo}</span></>}</div>
          <h3 id={`t-${a.id}`} style={{ fontSize: 'var(--t-17)', margin: 0 }}>{a.title}</h3>
        </div>
        {a.amountUgx != null && <strong style={{ fontSize: 'var(--t-20)' }}>{ugx(a.amountUgx)}</strong>}
      </header>
      {rejecting ? (
        <div style={{ display: 'grid', gap: 8 }}>
          <label style={{ fontSize: 'var(--t-14)' }}>Tell {a.requester} what to change
            <textarea value={reason} onChange={e => setReason(e.target.value)} rows={2} style={{ width: '100%', border: '1px solid var(--control-border)', padding: 8, font: 'inherit' }} />
          </label>
          <div style={{ display: 'flex', gap: 8 }}>
            <button disabled={!reason.trim() || busy !== null} onClick={() => go(false)}>Send back</button>
            <button onClick={() => setRejecting(false)}>Cancel</button>
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button className="primary" onClick={() => go(true)} disabled={busy !== null}>
            {busy === 'approve' ? 'Approving' : 'Approve'}
          </button>
          <button onClick={() => setRejecting(true)} disabled={busy !== null}>Send back</button>
          <span style={{ marginLeft: 'auto', fontSize: 'var(--t-12)', color: 'var(--text-muted)' }}>Waiting on {a.waitingOn} · {a.submittedAt}</span>
        </div>
      )}
    </article>
  );
}
