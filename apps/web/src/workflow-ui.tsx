import { useEffect, useState, type ReactNode } from "react";
import type { Backend, Profile } from "./data";

export interface Field {
  name: string;
  label: string;
  type?: "text" | "number" | "date" | "textarea";
  options?: { value: string; label: string }[];
  required?: boolean;
  value?: string;
  min?: number;
  max?: number;
  step?: string;
}
export type Values = Record<string, string>;
export type Row = Record<string, unknown>;
export const text = (value: unknown): string => value == null ? "—" : String(value);
export const options = (values: string[]) => values.map(value => ({ value, label: value.replaceAll("_", " ") }));
export function DivisionField(profile: Profile): Field {
  const allowed = profile.permissions.includes("view.combined") ? ["ENG", "AMG", "COR"] : profile.divisions;
  return { name: "p_division", label: "Division", options: options(allowed), required: true };
}
export function useRpc<T>(backend: Backend, name: string, args: Record<string, unknown> = {}) {
  const [data, setData] = useState<T | null>(null), [error, setError] = useState(""), [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const serialized = JSON.stringify(args);
  useEffect(() => {
    let current = true;
    setLoading(true); setError(""); setData(null);
    backend.rpc(name, JSON.parse(serialized)).then(result => { if (current) setData(result as T); })
      .catch((e: Error) => { if (current) setError(e.message); })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [backend, name, serialized, revision]);
  return { data, error, loading, reload: () => setRevision(n => n + 1) };
}
export function LoadState({ loading, error }: { loading: boolean; error: string }) {
  return <>{loading && <p role="status">Loading records…</p>}{error && <p role="alert" className="notice error">{error}</p>}</>;
}
export function RpcForm({ backend, profile, name, title, fields, build, onSaved, submit = "Save", initialKey = "", children }: {
  backend: Backend; profile: Profile; name: string; title: string; fields: Field[];
  build?: (values: Values) => Record<string, unknown>; onSaved: () => void; submit?: string; initialKey?: string; children?: ReactNode;
}) {
  const key = `xelra-form:${profile.id}:${name}:${initialKey}`;
  const defaults = () => Object.fromEntries(fields.map(f => [f.name, f.value ?? f.options?.[0]?.value ?? ""]));
  const [values, setValues] = useState<Values>(() => {
    try { return { ...defaults(), ...JSON.parse(sessionStorage.getItem(key) || "{}") }; } catch { return defaults(); }
  });
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [saved, setSaved] = useState("");
  useEffect(() => {
    try { sessionStorage.setItem(key, JSON.stringify(values)); setSaved("Draft saved in this tab"); }
    catch { setSaved("Draft could not be saved. Keep this form open."); }
  }, [key, values]);
  return <form className="form-panel" onSubmit={async event => {
    event.preventDefault(); if (busy) return; setBusy(true); setError("");
    try {
      await backend.rpc(name, build ? build(values) : Object.fromEntries(fields.map(f => [f.name, values[f.name] === "" ? null : f.type === "number" ? Number(values[f.name]) : values[f.name]])));
      sessionStorage.removeItem(key); setValues(defaults()); setSaved("Saved"); onSaved();
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }}>
    <h3>{title}</h3><div className="form-grid">
      {fields.map(field => <label key={field.name}>{field.label}
        {field.options ? <select value={values[field.name] || ""} required={field.required} onChange={e => setValues(v => ({ ...v, [field.name]: e.target.value }))}>
          {!field.required && <option value="">None</option>}{field.options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select> : field.type === "textarea" ? <textarea rows={4} maxLength={8000} required={field.required} value={values[field.name] || ""} onChange={e => setValues(v => ({ ...v, [field.name]: e.target.value }))} />
          : <input type={field.type || "text"} maxLength={field.type === "text" || !field.type ? 200 : undefined} min={field.min} max={field.max} step={field.step} required={field.required} value={values[field.name] || ""} onChange={e => setValues(v => ({ ...v, [field.name]: e.target.value }))} />}
      </label>)}
    </div>{children}
    {error && <p role="alert" className="notice error">{error}</p>}
    <div className="actions"><button className="primary" disabled={busy}>{busy ? "Saving…" : submit}</button><small role="status">{saved}</small></div>
  </form>;
}
export function Action({ backend, name, args, children, onDone }: { backend: Backend; name: string; args: Record<string, unknown>; children: ReactNode; onDone: () => void }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  return <span className="workflow-action"><button disabled={busy} onClick={async () => {
    if (busy) return; setBusy(true); setError("");
    try { await backend.rpc(name, args); onDone(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }}>{busy ? "Saving…" : children}</button>{error && <span role="alert" className="error">{error}</span>}</span>;
}
export function Records({ rows, columns, onSelect, label = "Records" }: { rows: Row[]; columns: [string, string][]; onSelect?: (row: Row) => void; label?: string }) {
  return rows.length ? <div className="table-wrap" tabIndex={0} role="region" aria-label={label} onKeyDown={e => {
    if (!["j", "k"].includes(e.key) || e.target instanceof HTMLInputElement) return;
    const buttons = [...e.currentTarget.querySelectorAll<HTMLButtonElement>("tbody button")];
    const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
    buttons[Math.max(0, Math.min(buttons.length - 1, current + (e.key === "j" ? 1 : -1)))]?.focus(); e.preventDefault();
  }}><table><thead><tr>{columns.map(([key, title]) => <th key={key}>{title}</th>)}</tr></thead><tbody>
    {rows.map((row, index) => <tr key={String(row.id ?? row.code ?? index)}>{columns.map(([key], col) => <td key={key}>{col === 0 && onSelect ? <button onClick={() => onSelect(row)}>{text(row[key])}</button> : text(row[key])}</td>)}</tr>)}
  </tbody></table></div> : <p className="empty">No records in this view.</p>;
}
export function Timeline({ events }: { events: Row[] }) {
  return <section><h3>History</h3><ol className="workflow-timeline">{events.map((event, i) => <li key={i}><strong>{text(event.action).replaceAll(".", " ")}</strong> · {new Date(String(event.at)).toLocaleString("en-GB")}{event.actor ? ` · ${text(event.actor)}` : ""}</li>)}</ol></section>;
}
