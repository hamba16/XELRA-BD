import { useEffect, useId, useState } from 'react';
import { MARK_D, MARK_VIEWBOX } from './mark';

export type Lens = 'eng' | 'amg' | 'combined';
const COLOURS = { eng: '#991923', amg: '#0d3251', ink: '#111111' } as const;

/** The mark, split on its centre line. Left half Engineering, right half Asset Management.
 *  Halves a user cannot see are drawn as an empty outline: isolation made visible. */
export function SplitMark({ lens, canSee, size = 28 }: { lens: Lens; canSee: Record<'eng' | 'amg', boolean>; size?: number }) {
  const id = useId();
  const half = (side: 'eng' | 'amg') => {
    const active = lens === 'combined' || lens === side;
    const visible = canSee[side];
    return { fill: visible ? COLOURS[side] : 'none', fillOpacity: visible && !active ? 0.28 : 1, stroke: visible ? 'none' : '#767671', strokeOpacity: 0.7 };
  };
  const L = half('eng'), R = half('amg');
  return (
    <svg width={size} height={size * 105 / 122} viewBox={MARK_VIEWBOX} role="img" aria-label={`Viewing ${lens === 'combined' ? 'both divisions' : lens === 'eng' ? 'Engineering' : 'Asset Management'}`}>
      <defs>
        <clipPath id={`${id}-l`}><rect x="0" y="0" width="61" height="105" /></clipPath>
        <clipPath id={`${id}-r`}><rect x="61" y="0" width="61" height="105" /></clipPath>
      </defs>
      <path d={MARK_D} clipPath={`url(#${id}-l)`} {...L} strokeWidth="1.5" style={{ transition: 'fill-opacity 200ms cubic-bezier(.2,.7,.1,1)' }} />
      <path d={MARK_D} clipPath={`url(#${id}-r)`} {...R} strokeWidth="1.5" style={{ transition: 'fill-opacity 200ms cubic-bezier(.2,.7,.1,1)' }} />
    </svg>
  );
}

/** The lens control. People scoped to one division get a fixed lens and no choice to make. */
export function LensSwitcher({ value, onChange, canSee }: { value: Lens; onChange: (l: Lens) => void; canSee: Record<'eng' | 'amg', boolean> }) {
  const both = canSee.eng && canSee.amg;
  useEffect(() => { document.documentElement.dataset.lens = value === 'combined' ? '' : value; }, [value]);
  const options: { key: Lens; label: string; enabled: boolean }[] = [
    { key: 'eng', label: 'Engineering', enabled: canSee.eng },
    { key: 'amg', label: 'Asset Management', enabled: canSee.amg },
    { key: 'combined', label: 'Both', enabled: both },
  ];
  return (
    <div role="radiogroup" aria-label="Division" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      <SplitMark lens={value} canSee={canSee} />
      {options.filter(o => o.enabled).length > 1 && options.map(o => (
        <button key={o.key} role="radio" aria-checked={value === o.key} disabled={!o.enabled}
          title={o.enabled ? undefined : 'You do not have access to this view.'}
          onClick={() => onChange(o.key)}
          style={{ background: value === o.key ? 'var(--lens)' : 'transparent', color: value === o.key ? 'var(--lens-on)' : 'var(--text)', border: '1px solid var(--control-border)', padding: '6px 12px', font: 'inherit', fontSize: 'var(--t-14)', opacity: o.enabled ? 1 : .4 }}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Convenience hook: remembers the last lens per person, never assumes a lens the person cannot see. */
export function useLens(canSee: Record<'eng' | 'amg', boolean>): [Lens, (l: Lens) => void] {
  const fallback: Lens = canSee.eng && canSee.amg ? 'combined' : canSee.eng ? 'eng' : 'amg';
  const [lens, set] = useState<Lens>(() => {
    try { const s = sessionStorage.getItem('xelra.lens') as Lens | null; if (s && (s === 'combined' ? canSee.eng && canSee.amg : canSee[s])) return s; } catch { /* storage can be empty */ }
    return fallback;
  });
  return [lens, (l) => { set(l); try { sessionStorage.setItem('xelra.lens', l); } catch { /* ignore */ } }];
}
