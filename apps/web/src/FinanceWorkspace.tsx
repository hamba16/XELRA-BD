import { useState } from "react";
import type { Backend, Snapshot } from "./data";
import { csvExport, parseCsv, statementCsv, groupMatches } from "../../../packages/lab/src/lib/finance";
import { reconcile, type Line } from "../../../packages/lab/src/lib/recon";
import { Action, DivisionField, LoadState, Records, RpcForm, options, text, useRpc, type Row } from "./workflow-ui";

type Props = { backend: Backend; data: Snapshot };
export function saveCsv(name: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a"); link.href = url; link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function FinancialRecords({ backend, data }: Props) {
  const list = useRpc<Row[]>(backend, "financial_page"), profile = data.profile;
  const manage = profile.permissions.includes("finance.manage");
  return <section className="workflow-stack"><LoadState {...list} />
    <Records rows={list.data || []} columns={[["title", "Record"], ["kind", "Type"], ["number", "Number"], ["total_ugx", "UGX"], ["approval_status", "Approval"], ["status", "Status"]]} />
    {list.data?.filter(r => r.created_by === profile.id).map(r => <div className="actions" key={String(r.id)}><span>{text(r.title)}</span>
      {r.status === "draft" && ["expense", "requisition"].includes(String(r.kind)) && <Action backend={backend} name="submit_financial_record" args={{ p_id: r.id }} onDone={list.reload}>Submit for approval</Action>}
      {r.approval_status === "pending" && <Action backend={backend} name="withdraw_request" args={{ p_id: r.request_id, p_reason: "Withdrawn by the owner" }} onDone={list.reload}>Withdraw claim</Action>}
      {["rejected", "cancelled"].includes(String(r.approval_status)) && <Action backend={backend} name="reopen_financial_record" args={{ p_id: r.id }} onDone={list.reload}>Reopen draft</Action>}
    </div>)}
    <button disabled={!list.data?.length} onClick={() => saveCsv("xelra-financial-records.csv", csvExport(["number", "kind", "title", "division", "total_ugx", "status"], (list.data || []).map(r => [String(r.number || r.id), String(r.kind), String(r.title), String(r.division), Number(r.total_ugx), String(r.approval_status || r.status)])))}>Export visible records</button>
    <RpcForm backend={backend} profile={profile} name="save_financial_record" title="New financial draft" fields={[
      { name: "p_kind", label: "Record type", options: options(manage ? ["expense", "requisition", "invoice", "supplier-bill", "purchase-order"] : ["expense", "requisition"]), required: true },
      DivisionField(profile), { name: "p_title", label: "Title", required: true },
      { name: "lines", label: "Lines — CSV: description,quantity,unit_ugx (without a header)", type: "textarea", required: true },
      { name: "p_project", label: "Project", options: data.projects.map(p => ({ value: p.code, label: `${p.code} · ${p.title}` })) },
      { name: "p_document", label: "Receipt or supporting document", options: data.documents.map(d => ({ value: d.id, label: d.doc_no })) },
      { name: "p_due", label: "Due date", type: "date" },
    ]} build={v => {
      const lines = parseCsv(v.lines, 100).map(r => { if (r.length !== 3 || !/^\d+$/.test(r[1]) || !/^\d+$/.test(r[2])) throw Error("Use three columns: description, whole quantity, whole unit amount."); return { description: r[0], quantity: Number(r[1]), unit_ugx: Number(r[2]) }; });
      return { p_kind: v.p_kind, p_division: v.p_division, p_title: v.p_title, p_lines: lines, p_project: v.p_project || null, p_document: v.p_document || null, p_due: v.p_due || null };
    }} onSaved={list.reload}><p className="muted">Expenses require a receipt before submission. Invoice, bill and purchase-order records remain drafts until their approval routing is agreed.</p></RpcForm>
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
    <Records rows={workspace.data?.lines || []} columns={[["person_id", "Employee"], ["gross_ugx", "Gross UGX"], ["paye_ugx", "PAYE UGX"], ["net_ugx", "Net UGX"], ["variance_ugx", "Shadow variance UGX"]]} />
    <h3>My shadow payslips</h3><Records rows={workspace.data?.payslips || []} columns={[["period", "Period"], ["gross_ugx", "Gross UGX"], ["paye_ugx", "PAYE UGX"], ["other_deductions_ugx", "Other deductions"], ["net_ugx", "Net UGX"]]} />
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
function Reconciliation() {
  const [bank, setBank] = useState<Line[]>([]), [ledger, setLedger] = useState<Line[]>([]), [error, setError] = useState(""), [duplicates, setDuplicates] = useState(0);
  const [reviewed, setReviewed] = useState<{ bank: string[]; ledger: string[]; at: string }[]>([]), [selectedBank, setSelectedBank] = useState<string[]>([]), [selectedLedger, setSelectedLedger] = useState<string[]>([]);
  const importFile = async (file: File | undefined, target: "bank" | "ledger") => {
    if (!file) return; setError("");
    try {
      const parsed = statementCsv(await file.text(), { reference: "reference", date: "date", amount: "amount", description: "description" });
      if (target === "bank") setBank(parsed.lines); else setLedger(parsed.lines);
      setDuplicates(parsed.duplicates); setReviewed([]); setSelectedBank([]); setSelectedLedger([]);
    } catch (e) { setError((e as Error).message); }
  };
  const bankOpen = bank.filter(l => !reviewed.some(r => r.bank.includes(l.id))), ledgerOpen = ledger.filter(l => !reviewed.some(r => r.ledger.includes(l.id)));
  const suggestions = reconcile(bankOpen, ledgerOpen);
  const select = (id: string, list: string[], setter: (value: string[]) => void) => setter(list.includes(id) ? list.filter(x => x !== id) : [...list, id]);
  return <section className="workflow-stack"><p>Shadow reconciliation. Import UTF-8 CSV with columns reference,date,amount,description. Dates use YYYY-MM-DD; amounts are signed whole UGX. Files stay in this browser. Matches require review and never post journals.</p>
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
export default function FinanceWorkspace(props: Props) {
  const [tab, setTab] = useState("records");
  const tabs = ["records", "payroll", ...(props.data.profile.permissions.includes("finance.read") ? ["journals", "reconciliation"] : [])];
  return <div className="workflow-stack"><div className="actions" role="group" aria-label="Finance workspace">{tabs.map(t => <button key={t} aria-pressed={tab === t} onClick={() => setTab(t)}>{t[0].toUpperCase() + t.slice(1)}</button>)}</div>
    {tab === "records" ? <FinancialRecords {...props} /> : tab === "payroll" ? <Payroll {...props} /> : tab === "journals" ? <Journals {...props} /> : <Reconciliation />}
  </div>;
}
