import { useEffect, useState } from "react";
import type { Backend, Snapshot } from "./data";
import { csvExport, parseCsv, statementCsv, groupMatches } from "../../../packages/lab/src/lib/finance";
import { reconcile, type Line } from "../../../packages/lab/src/lib/recon";
import { Action, DivisionField, LoadState, Records, RpcForm, options, text, useRpc, type Row } from "./workflow-ui";
import type { FinanceChartStyle } from "./workspace-preferences";

type Props = { backend: Backend; data: Snapshot };
const money = (amount: number) => new Intl.NumberFormat("en-UG", {
  style: "currency", currency: "UGX", maximumFractionDigits: 0,
}).format(amount);
export function saveCsv(name: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a"); link.href = url; link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function FinancialRecords({ backend, data }: Props) {
  const [offset, setOffset] = useState(0), [selected, setSelected] = useState<Row | null>(null);
  const list = useRpc<Row[]>(backend, "financial_page", { p_offset: offset }), profile = data.profile;
  const suppliers = useRpc<Row[]>(backend, "register_page", { p_module: "suppliers" });
  const manage = profile.permissions.includes("finance.manage");
  return <section className="workflow-stack"><LoadState {...list} />
    <Records rows={(list.data || []).map(row => ({ ...row, total_ugx: money(Number(row.total_ugx)) }))} columns={[["title", "Record"], ["kind", "Type"], ["number", "Number"], ["total_ugx", "UGX"], ["approval_status", "Approval"], ["status", "Status"]]} onSelect={r => { if (r.status === "draft") setSelected(r); }} />
    <div className="actions"><button disabled={!offset} onClick={() => setOffset(n => n - 50)}>Previous financial records</button><button disabled={(list.data?.length || 0) < 50} onClick={() => setOffset(n => n + 50)}>Next financial records</button>{selected && <button onClick={() => setSelected(null)}>Create another draft</button>}</div>
    {list.data?.filter(r => r.created_by === profile.id).map(r => <div className="actions" key={String(r.id)}><span>{text(r.title)}</span>
      {r.status === "draft" && ["expense", "requisition"].includes(String(r.kind)) && <Action backend={backend} name="submit_financial_record" args={{ p_id: r.id }} onDone={list.reload}>Submit for approval</Action>}
      {r.approval_status === "pending" && <Action backend={backend} name="withdraw_request" args={{ p_id: r.request_id, p_reason: "Withdrawn by the owner" }} onDone={list.reload}>Withdraw claim</Action>}
      {["rejected", "cancelled"].includes(String(r.approval_status)) && <Action backend={backend} name="reopen_financial_record" args={{ p_id: r.id }} onDone={list.reload}>Reopen draft</Action>}
    </div>)}
    <button disabled={!list.data?.length} onClick={() => saveCsv("xelra-financial-records.csv", csvExport(["number", "kind", "title", "division", "total_ugx", "status"], (list.data || []).map(r => [String(r.number || r.id), String(r.kind), String(r.title), String(r.division), Number(r.total_ugx), String(r.approval_status || r.status)])))}>Export visible records</button>
    <RpcForm key={`${selected?.id || "new"}:${selected?.version || 0}`} initialKey={`${selected?.id || "new"}:${selected?.version || 0}`} backend={backend} profile={profile} name="save_financial_record" title={selected ? "Edit financial draft" : "New financial draft"} fields={[
      { name: "p_kind", label: "Record type", value: String(selected?.kind || "expense"), options: options(manage ? ["expense", "requisition", "invoice", "supplier-bill", "purchase-order"] : ["expense", "requisition"]), required: true },
      { ...DivisionField(profile), ...(selected ? { value: String(selected.division) } : {}) }, { name: "p_title", label: "Title", value: String(selected?.title || ""), required: true },
      { name: "lines", label: "Lines — CSV: description,quantity,unit_ugx (without a header)", type: "textarea", value: selected ? (selected.lines as Row[]).map(l => `"${String(l.description).replaceAll('"', '""')}",${l.quantity},${l.unit_ugx}`).join("\n") : "", required: true },
      { name: "p_project", label: "Project", value: String(selected?.project || ""), options: data.projects.map(p => ({ value: p.code, label: `${p.code} · ${p.title}` })) },
      { name: "p_supplier", label: "Supplier", value: String(selected?.supplier_id || ""), options: (suppliers.data || []).map(s => ({ value: String(s.id), label: String(s.title) })) },
      { name: "p_document", label: "Receipt or supporting document", value: String(selected?.document_id || ""), options: data.documents.map(d => ({ value: d.id, label: d.doc_no })) },
      { name: "p_due", label: "Due date", type: "date", value: String(selected?.due_on || "") },
    ]} build={v => {
      const lines = parseCsv(v.lines, 100).map(r => { if (r.length !== 3 || !/^\d+$/.test(r[1]) || !/^\d+$/.test(r[2])) throw Error("Use three columns: description, whole quantity, whole unit amount."); return { description: r[0], quantity: Number(r[1]), unit_ugx: Number(r[2]) }; });
      return { p_kind: v.p_kind, p_division: v.p_division, p_title: v.p_title, p_lines: lines, p_project: v.p_project || null, p_supplier: v.p_supplier || null, p_document: v.p_document || null, p_due: v.p_due || null, p_id: selected?.id || null, p_version: selected?.version || 0 };
    }} onSaved={() => { setSelected(null); list.reload(); }}><p className="muted">Expenses require a receipt before submission. Invoice, bill and purchase-order records remain drafts until their approval routing is agreed.</p></RpcForm>
  </section>;
}
function Journals({ backend, data }: Props) {
  const list = useRpc<Row[]>(backend, "journal_page"), profile = data.profile;
  return <section className="workflow-stack"><LoadState {...list} /><Records rows={list.data || []} columns={[["number", "Journal"], ["date", "Date"], ["description", "Description"], ["division", "Division"]]} />
    <button disabled={!list.data?.length} onClick={() => saveCsv("xelra-journals.csv", csvExport(["date", "journal_no", "account_code", "account_name", "description", "debit", "credit", "currency", "project_code", "division", "source_doc_no"], (list.data || []).flatMap(j => (j.lines as Row[]).map(l => [String(j.date), String(j.number), String(l.account_code), String(l.account_name || ""), String(j.description), Number(l.debit), Number(l.credit), "UGX", String(j.project || ""), String(j.division), String(j.source_doc_no || "")]))))}>Export journal lines</button>
    {profile.permissions.includes("journal.post") && <>
      <RpcForm backend={backend} profile={profile} name="save_account" title="Configure an account" fields={[{ name: "p_code", label: "Account code", required: true }, { name: "p_name", label: "Account name", required: true }]} onSaved={list.reload} />
      <RpcForm backend={backend} profile={profile} name="post_journal" title="Post a balanced internal journal" fields={[DivisionField(profile), { name: "p_date", label: "Journal date", type: "date", required: true }, { name: "p_number", label: "Journal number", required: true }, { name: "p_description", label: "Description", required: true }, { name: "lines", label: "Lines — CSV: account_code,debit,credit (without a header)", type: "textarea", required: true }]}
        build={v => ({ p_division: v.p_division, p_date: v.p_date, p_number: v.p_number, p_description: v.p_description, p_lines: parseCsv(v.lines, 100).map(r => { if (r.length !== 3 || !/^\d+$/.test(r[1]) || !/^\d+$/.test(r[2])) throw Error("Use account code, whole debit and whole credit."); return { account_code: r[0], debit: Number(r[1]), credit: Number(r[2]) }; }) })} onSaved={list.reload} submit="Post journal" />
    </>}
  </section>;
}
function Payroll({ backend, data }: Props) {
  const workspace = useRpc<{ periods: Row[]; lines: Row[]; payslips: Row[] }>(backend, "payroll_workspace"), profile = data.profile;
  return <section className="workflow-stack"><p className="notice">Shadow payroll uses verified PAYE tables and explicitly supplied deductions. These records do not execute payments or establish statutory accuracy.</p><LoadState {...workspace} />
    <Records rows={workspace.data?.periods || []} columns={[["title", "Period"], ["starts", "Start"], ["ends", "End"], ["status", "Status"]]} />
    <Records rows={(workspace.data?.lines || []).map(row => ({ ...row, gross_ugx: money(Number(row.gross_ugx)), paye_ugx: money(Number(row.paye_ugx)), net_ugx: money(Number(row.net_ugx)), variance_ugx: money(Number(row.variance_ugx)) }))} columns={[["person_id", "Employee"], ["gross_ugx", "Gross UGX"], ["paye_ugx", "PAYE UGX"], ["net_ugx", "Net UGX"], ["variance_ugx", "Shadow variance UGX"]]} />
    <h3>My shadow payslips</h3><Records rows={(workspace.data?.payslips || []).map(row => ({ ...row, gross_ugx: money(Number(row.gross_ugx)), paye_ugx: money(Number(row.paye_ugx)), other_deductions_ugx: money(Number(row.other_deductions_ugx)), net_ugx: money(Number(row.net_ugx)) }))} columns={[["period", "Period"], ["gross_ugx", "Gross UGX"], ["paye_ugx", "PAYE UGX"], ["other_deductions_ugx", "Other deductions"], ["net_ugx", "Net UGX"]]} />
    <button disabled={!workspace.data?.payslips.length} onClick={() => saveCsv("xelra-my-shadow-payslips.csv", csvExport(["period", "gross_ugx", "paye_ugx", "other_deductions_ugx", "net_ugx", "mode"], (workspace.data?.payslips || []).map(p => [String(p.period), Number(p.gross_ugx), Number(p.paye_ugx), Number(p.other_deductions_ugx), Number(p.net_ugx), "shadow"])))}>Export my shadow payslips</button>
    {profile.permissions.includes("payroll.prepare") && <>
      {workspace.data?.periods.map(p => <div key={String(p.id)} className="actions"><span>{text(p.title)}</span>{p.status !== "locked" && <Action backend={backend} name={p.status === "preparing" ? "submit_payroll_period" : "lock_payroll_period"} args={{ p_id: p.id }} onDone={workspace.reload}>{p.status === "preparing" ? "Submit for HR and department review" : "Lock approved period"}</Action>}</div>)}
      <RpcForm backend={backend} profile={profile} name="create_payroll_period" title="Prepare a shadow period" fields={[DivisionField(profile), { name: "p_title", label: "Period title", required: true }, { name: "p_starts", label: "Starts", type: "date", required: true }, { name: "p_ends", label: "Ends", type: "date", required: true }]} onSaved={workspace.reload} />
      {!!workspace.data?.periods.some(p => p.status === "preparing") && <RpcForm key={workspace.data.periods.map(p => p.id).join()} backend={backend} profile={profile} name="save_payroll_line" title="Payroll inputs" fields={[
        { name: "p_period", label: "Period", options: workspace.data.periods.filter(p => p.status === "preparing").map(p => ({ value: String(p.id), label: String(p.title) })), required: true },
        { name: "p_person", label: "Employee", options: data.people.map(p => ({ value: p.id, label: p.full_name })), required: true },
        { name: "p_gross", label: "Gross UGX", type: "number", min: 0, required: true }, { name: "p_deductions", label: "Other authorised deductions UGX", type: "number", min: 0, required: true },
        { name: "p_note", label: "Input source and deduction authority", type: "textarea", required: true }, { name: "p_expected", label: "Comparison net UGX", type: "number", min: 0 },
      ]} onSaved={workspace.reload} />}
    </>}
  </section>;
}
function Reconciliation({ profileId }: { profileId: string }) {
  const storageKey = `xelra-reconciliation:${profileId}`;
  const [saved] = useState(() => { try { return JSON.parse(sessionStorage.getItem(storageKey) || "{}") as { bank?: Line[]; ledger?: Line[]; reviewed?: { bank: string[]; ledger: string[]; at: string }[] }; } catch { return {}; } });
  const [bank, setBank] = useState<Line[]>(saved.bank || []), [ledger, setLedger] = useState<Line[]>(saved.ledger || []), [error, setError] = useState(""), [duplicates, setDuplicates] = useState(0);
  const [reviewed, setReviewed] = useState<{ bank: string[]; ledger: string[]; at: string }[]>(saved.reviewed || []), [selectedBank, setSelectedBank] = useState<string[]>([]), [selectedLedger, setSelectedLedger] = useState<string[]>([]);
  const [mapping, setMapping] = useState({ reference: "reference", date: "date", amount: "amount", description: "description" });
  useEffect(() => { try { sessionStorage.setItem(storageKey, JSON.stringify({ bank, ledger, reviewed })); } catch { setError("This reconciliation could not be saved in this tab. Export the review history before leaving."); } }, [storageKey, bank, ledger, reviewed]);
  const importFile = async (file: File | undefined, target: "bank" | "ledger") => {
    if (!file) return; setError("");
    try {
      if (file.size > 2_000_000) throw Error("Choose a CSV file up to 2 MB.");
      const parsed = statementCsv(await file.text(), mapping);
      if (target === "bank") setBank(parsed.lines); else setLedger(parsed.lines);
      setDuplicates(parsed.duplicates); setReviewed([]); setSelectedBank([]); setSelectedLedger([]);
    } catch (e) { setError((e as Error).message); }
  };
  const bankOpen = bank.filter(l => !reviewed.some(r => r.bank.includes(l.id))), ledgerOpen = ledger.filter(l => !reviewed.some(r => r.ledger.includes(l.id)));
  const suggestions = reconcile(bankOpen, ledgerOpen);
  const select = (id: string, list: string[], setter: (value: string[]) => void) => setter(list.includes(id) ? list.filter(x => x !== id) : [...list, id]);
  return <section className="workflow-stack"><p>Shadow reconciliation. Import UTF-8 CSV with columns reference,date,amount,description. Dates use YYYY-MM-DD; amounts are signed whole UGX. Files stay in this browser. Matches require review and never post journals.</p>
    <details><summary>CSV column mapping</summary><div className="form-grid">{(Object.keys(mapping) as (keyof typeof mapping)[]).map(key => <label key={key}>{key} column<input value={mapping[key]} onChange={e => setMapping(m => ({ ...m, [key]: e.target.value }))} /></label>)}</div></details>
    <div className="form-grid"><label>Bank CSV<input type="file" accept=".csv,text/csv" onChange={e => void importFile(e.target.files?.[0], "bank")} /></label><label>Ledger CSV<input type="file" accept=".csv,text/csv" onChange={e => void importFile(e.target.files?.[0], "ledger")} /></label></div>
    {error && <p role="alert" className="notice error">{error}</p>}<p>{duplicates} duplicate rows ignored · {suggestions.auto.length} high-confidence suggestions · {reviewed.length} reviewed matches</p>
    <div className="form-grid">{([["Bank lines", bankOpen, selectedBank, setSelectedBank], ["Ledger lines", ledgerOpen, selectedLedger, setSelectedLedger]] as const).map(([label, lines, selected, setter]) => <fieldset key={label}><legend>{label}</legend>{lines.map(line => <label className="check-row" key={line.id}><input type="checkbox" checked={selected.includes(line.id)} onChange={() => select(line.id, selected, setter)} />{line.id} · {line.amount} · {line.text}</label>)}</fieldset>)}</div>
    <button disabled={!selectedBank.length || !selectedLedger.length} onClick={() => {
      try {
        const b = bankOpen.filter(l => selectedBank.includes(l.id)), l = ledgerOpen.filter(l => selectedLedger.includes(l.id));
        if (b.length > 6 || l.length > 6 || (b.length > 1 && l.length > 1)) throw Error("Review one-to-one, one-to-many or many-to-one groups, with at most six candidates.");
        if (b.length === 1 && l.length > 1 && !groupMatches(b[0], l).some(g => g.length === l.length)) throw Error("Split amounts and dates do not agree.");
        if (l.length === 1 && b.length > 1 && !groupMatches(l[0], b).some(g => g.length === b.length)) throw Error("Grouped amounts and dates do not agree.");
        if (b.reduce((s, x) => s + x.amount, 0) !== l.reduce((s, x) => s + x.amount, 0) || Math.abs(Date.parse(b[0].date) - Date.parse(l[0].date)) > 7 * 86400000) throw Error("Amounts must agree exactly and dates must be within seven days.");
        setReviewed(r => [...r, { bank: selectedBank, ledger: selectedLedger, at: new Date().toISOString() }]); setSelectedBank([]); setSelectedLedger([]); setError("");
      } catch (e) { setError((e as Error).message); }
    }}>Confirm selected match</button>
    <button disabled={!reviewed.length} onClick={() => saveCsv("xelra-shadow-reconciliation.csv", csvExport(["bank_references", "ledger_references", "reviewed_at", "mode"], reviewed.map(r => [r.bank.join(";"), r.ledger.join(";"), r.at, "shadow"])))}>Export review history</button>
  </section>;
}
function FinanceOverview({ backend, data, chartStyle }: Props & { chartStyle: FinanceChartStyle }) {
  const records = useRpc<Row[]>(backend, "financial_page", { p_offset: 0 });
  const payroll = useRpc<{ periods: Row[]; lines: Row[]; payslips: Row[] }>(backend, "payroll_workspace");
  const rows = records.data || [];
  const total = rows.reduce((sum, row) => {
    const amount = Number(row.total_ugx);
    return Number.isFinite(amount) ? sum + amount : sum;
  }, 0);
  const now = new Date();
  const months = Array.from({ length: 6 }, (_, index) => {
    const date = new Date(now.getFullYear(), now.getMonth() - 5 + index, 1);
    return { key: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`, label: date.toLocaleString("en-UG", { month: "short" }), total: 0 };
  });
  for (const row of rows) {
    const date = new Date(String(row.created_at || ""));
    if (!Number.isFinite(date.getTime())) continue;
    const month = months.find(item => item.key === `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`);
    const amount = Number(row.total_ugx);
    if (month && Number.isFinite(amount)) month.total += amount;
  }
  const maxAmount = Math.max(0, ...months.map(month => month.total));
  const points = months.map((month, index) => ({
    ...month,
    x: 54 + index * 106,
    y: 190 - (maxAmount ? month.total / maxAmount * 142 : 0),
  }));
  const stages = new Map<string, number>();
  for (const row of rows) {
    const stage = String(row.approval_status || row.status || "unavailable").replaceAll("_", " ");
    stages.set(stage, (stages.get(stage) || 0) + 1);
  }
  const stageRows = [...stages.entries()].sort((a, b) => b[1] - a[1]);
  const pendingCount = rows.filter(row => row.approval_status === "pending").length;
  const payrollNet = (payroll.data?.lines || []).reduce((sum, row) => sum + Number(row.net_ugx || 0), 0);
  return <section className="finance-overview">
    <LoadState {...records} />
    <LoadState {...payroll} />
    {records.error ? <p className="empty">Finance figures are unavailable until the records view loads successfully.</p> : <>
      <p className="finance-scope-note">Figures reflect the records currently visible to your profile · up to 50 records · amounts in UGX</p>
      <div className="finance-metrics">
        <article className="finance-metric finance-metric--lead"><span>Visible record value</span><strong>{rows.length ? money(total) : "—"}</strong><small>{rows.length ? `${rows.length} records in this view` : "No financial records in this view yet"}</small></article>
        <article className="finance-metric"><span>Awaiting approval</span><strong>{records.loading ? "—" : pendingCount}</strong><small>Visible expense and requisition records</small></article>
        <article className="finance-metric"><span>Payroll lines in scope</span><strong>{payroll.loading || payroll.error ? "—" : payroll.data?.lines.length || 0}</strong><small>{payroll.error ? "Payroll figures unavailable" : payroll.data?.lines.length ? `Net value ${money(payrollNet)} · shadow data` : "No visible payroll lines"}</small></article>
      </div>
      <div className="finance-visual-grid">
        <figure className="finance-chart-card">
          <figcaption><div><h2>Record value over time</h2><p>Monthly totals · last six months</p></div><span className="chart-unit">UGX</span></figcaption>
          <svg className="finance-chart" viewBox="0 0 640 250" role="img" aria-label={`Monthly financial record value, displayed as a ${chartStyle} chart`}>
            {[48, 95, 143, 190].map(y => <line key={y} x1="52" x2="592" y1={y} y2={y} className="chart-gridline" />)}
            {chartStyle === "columns" && points.map(point => <rect key={point.key} x={point.x - 20} y={point.y} width="40" height={190 - point.y} rx="2" className="chart-column" />)}
            {chartStyle === "area" && <polygon points={`${points[0].x},190 ${points.map(point => `${point.x},${point.y}`).join(" ")} ${points[points.length - 1].x},190`} className="chart-area" />}
            {chartStyle !== "columns" && <polyline points={points.map(point => `${point.x},${point.y}`).join(" ")} className="chart-line" />}
            {chartStyle !== "columns" && points.map(point => <circle key={point.key} cx={point.x} cy={point.y} r="4" className="chart-point" />)}
            {points.map(point => <text key={point.key} x={point.x} y="222" textAnchor="middle" className="chart-label">{point.label}</text>)}
          </svg>
          <ul className="finance-chart-values">{points.map(point => <li key={point.key}><span>{point.label}</span><strong>{money(point.total)}</strong></li>)}</ul>
        </figure>
        <section className="finance-chart-card finance-status-card" aria-labelledby="finance-status-heading">
          <div className="finance-chart-caption"><div><h2 id="finance-status-heading">Workflow mix</h2><p>Current visible records by status</p></div><span className="chart-unit">{rows.length} total</span></div>
          {stageRows.length ? <ul className="finance-status-list">{stageRows.map(([stage, count]) => <li key={stage}>
            <div><span>{stage}</span><strong>{count} · {Math.round(count / rows.length * 100)}%</strong></div>
            <span className="finance-status-track"><span style={{ width: `${count / rows.length * 100}%` }} /></span>
          </li>)}</ul> : <p className="finance-empty-chart">Status visuals will appear when financial records are available.</p>}
          <p className="finance-footnote">These are workflow records, not cash movement or a bank balance.</p>
        </section>
      </div>
    </>}
  </section>;
}
export default function FinanceWorkspace({ ...props }: Props & { chartStyle: FinanceChartStyle }) {
  const [tab, setTab] = useState("overview");
  const tabs = ["overview", "records", "payroll", ...(props.data.profile.permissions.includes("finance.read") ? ["journals", "reconciliation"] : [])];
  return <div className="workflow-stack"><div className="actions" role="group" aria-label="Finance workspace">{tabs.map(t => <button key={t} aria-pressed={tab === t} onClick={() => setTab(t)}>{t[0].toUpperCase() + t.slice(1)}</button>)}</div>
    {tab === "overview" ? <FinanceOverview {...props} /> : tab === "records" ? <FinancialRecords {...props} /> : tab === "payroll" ? <Payroll {...props} /> : tab === "journals" ? <Journals {...props} /> : <Reconciliation profileId={props.data.profile.id} />}
  </div>;
}
