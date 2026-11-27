import { useState } from "react";
import type { Backend, Snapshot } from "./data";
import { Action, DivisionField, LoadState, Records, RpcForm, Timeline, options, text, useRpc, type Field, type Row } from "./workflow-ui";

type Props = { backend: Backend; data: Snapshot; onChanged: () => void };
const titleField: Field = { name: "p_title", label: "Title", required: true };
const descriptionField: Field = { name: "p_description", label: "Description", type: "textarea", required: true };
const personOptions = (data: Snapshot) => data.people.map(p => ({ value: p.id, label: p.full_name }));
function Helpdesk(props: Props) {
  const { backend, data } = props, profile = data.profile;
  const [offset, setOffset] = useState(0), [status, setStatus] = useState("all"), [selected, setSelected] = useState("");
  const list = useRpc<Row[]>(backend, "ticket_page", { p_offset: offset, p_status: status });
  return <div className="workflow-stack">
    <RpcForm backend={backend} profile={profile} name="create_ticket" title="Ask IT for help" fields={[titleField, descriptionField, { name: "p_category", label: "Category", required: true }]}
      build={v => ({ ...v, p_context: { page: location.pathname, browser: navigator.userAgent.slice(0, 500), version: "0.2.0" } })} onSaved={list.reload} submit="Send ticket" />
    <label>Ticket status<select value={status} onChange={e => { setStatus(e.target.value); setOffset(0); }}>{options(["all", "open", "acknowledged", "in_progress", "resolved", "closed"]).map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select></label>
    <LoadState {...list} /><Records rows={list.data || []} columns={[["title", "Ticket"], ["status", "Status"], ["priority", "Priority"]]} onSelect={row => setSelected(String(row.id))} />
    <div className="actions"><button disabled={!offset} onClick={() => setOffset(n => n - 50)}>Previous tickets</button><button disabled={(list.data?.length || 0) < 50} onClick={() => setOffset(n => n + 50)}>Next tickets</button></div>
    {selected && <TicketDetail key={selected} {...props} id={selected} onChanged={list.reload} />}
  </div>;
}
function TicketDetail({ backend, data, id, onChanged }: Props & { id: string }) {
  const detail = useRpc<{ ticket: Row; messages: Row[]; timeline: Row[] }>(backend, "ticket_detail", { p_id: id });
  const refresh = () => { detail.reload(); onChanged(); };
  const ticket = detail.data?.ticket;
  const next: Record<string, string[]> = { open: ["acknowledged"], acknowledged: ["in_progress"], in_progress: ["resolved"], resolved: ["closed", "in_progress"], closed: [] };
  return <section className="workflow-stack"><LoadState {...detail} />{ticket && <>
    <h3>{text(ticket.title)}</h3><p>{text(ticket.description)}</p><p>Status: {text(ticket.status)}</p>
    {data.profile.permissions.includes("helpdesk.manage") && <div className="actions">{(next[String(ticket.status)] || []).map(status => <Action key={status} backend={backend} name="update_ticket" args={{ p_id: id, p_version: ticket.version, p_status: status, p_priority: ticket.priority, p_assigned: data.profile.id }} onDone={refresh}>Mark {status.replaceAll("_", " ")}</Action>)}</div>}
    <Records rows={detail.data!.messages} columns={[["actor", "From"], ["body", "Message"], ["at", "Sent"]]} label="Ticket discussion" />
    {ticket.status !== "closed" && <RpcForm backend={backend} profile={data.profile} name="reply_ticket" title="Reply to ticket" initialKey={id} fields={[{ name: "p_body", label: "Reply", type: "textarea", required: true }]} build={v => ({ p_id: id, ...v })} onSaved={refresh} submit="Send reply" />}
    <Timeline events={detail.data!.timeline} />
  </>}</section>;
}
function Projects(props: Props) {
  const { backend, data } = props, profile = data.profile;
  const [selected, setSelected] = useState(data.projects[0]?.code || ""), [newProject, setNewProject] = useState(false);
  const manage = profile.permissions.includes("projects.manage");
  return <div className="workflow-stack">
    <Records rows={data.projects as unknown as Row[]} columns={[["code", "Project"], ["title", "Title"], ["progress", "Progress %"]]} onSelect={r => setSelected(String(r.code))} />
    {manage && <button onClick={() => setNewProject(v => !v)}>{newProject ? "Close project form" : "Create project"}</button>}
    {newProject && <RpcForm backend={backend} profile={profile} name="save_project" title="New project" fields={[
      { name: "p_code", label: "Project code", required: true }, DivisionField(profile), titleField,
      { name: "p_budget", label: "Budget (UGX)", type: "number", min: 0, required: true },
    ]} build={v => ({ ...v, p_budget: Number(v.p_budget), p_actual: 0, p_progress: 0, p_status: "planned", p_version: 0 })} onSaved={props.onChanged} />}
    {selected && <ProjectDetail key={selected} {...props} code={selected} />}
  </div>;
}
function ProjectDetail({ backend, data, code, onChanged }: Props & { code: string }) {
  const detail = useRpc<{ project: Row; milestones: Row[]; timeline: Row[] }>(backend, "project_detail", { p_code: code });
  const p = detail.data?.project, manage = data.profile.permissions.includes("projects.manage");
  const refresh = () => { detail.reload(); onChanged(); };
  return <section className="workflow-stack"><LoadState {...detail} />{p && <>
    <h3>{text(p.title)}</h3><p>{text(p.status)} · Progress {text(p.progress)}%{p.health ? ` · Health: ${text(p.health)} · Budget remaining: UGX ${text(p.variance_ugx)}` : ""}</p>
    <Records rows={detail.data!.milestones} columns={[["title", "Milestone"], ["due_on", "Due"], ["completed_at", "Completed"]]} />
    {manage && <>
      {detail.data!.milestones.filter(m => !m.completed_at).map(m => <Action key={String(m.id)} backend={backend} name="save_milestone" args={{ p_project: code, p_id: m.id, p_title: m.title, p_due: m.due_on, p_completed: true, p_published: m.published }} onDone={refresh}>Complete {text(m.title)}</Action>)}
      <RpcForm key={String(p.version)} backend={backend} profile={data.profile} name="save_project" initialKey={`${code}:${p.version}`} title="Project administration" fields={[
        { ...titleField, value: String(p.title) }, { name: "p_budget", label: "Budget (UGX)", type: "number", min: 0, value: String(p.budget_ugx), required: true },
        { name: "p_actual", label: "Recorded actual cost (UGX)", type: "number", min: 0, value: String(p.actual_ugx), required: true },
        { name: "p_progress", label: "Progress (%)", type: "number", min: 0, max: 100, value: String(p.progress), required: true },
        { name: "p_status", label: "Project status", options: options(["planned", "active", "completed", "closed"]), value: String(p.status), required: true },
      ]} build={v => ({ ...v, p_code: code, p_division: p.division, p_version: p.version, p_budget: Number(v.p_budget), p_actual: Number(v.p_actual), p_progress: Number(v.p_progress) })} onSaved={refresh} />
      <RpcForm backend={backend} profile={data.profile} name="save_milestone" initialKey={code} title="Add milestone" fields={[titleField, { name: "p_due", label: "Due date", type: "date" }, { name: "published", label: "External visibility", options: options(["internal", "published"]), required: true }]}
        build={v => ({ p_project: code, p_title: v.p_title, p_due: v.p_due || null, p_published: v.published === "published" })} onSaved={refresh} />
    </>}<Timeline events={detail.data!.timeline} />
  </>}</section>;
}
function People({ backend, data }: Props) {
  const profile = data.profile, manage = profile.permissions.includes("hr.manage");
  const [person, setPerson] = useState(profile.id);
  const workspace = useRpc<{ person: Row; contracts: Row[]; balances: Row[]; leave_history: Row[]; attendance: Row[]; leave_calendar: Row[] }>(backend, "people_workspace", { p_person: person });
  return <div className="workflow-stack">
    {manage && <label>Employee<select value={person} onChange={e => setPerson(e.target.value)}>{personOptions(data).map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select></label>}
    <LoadState {...workspace} />{workspace.data && <>
      <h3>{text(workspace.data.person?.full_name)}</h3>
      <h3>Contracts</h3><Records rows={workspace.data.contracts} columns={[["title", "Contract"], ["starts", "Effective from"], ["ends", "Effective to"]]} />
      <h3>Recorded leave balance</h3><Records rows={workspace.data.balances} columns={[["kind", "Leave type"], ["units", "Recorded units"]]} />
      <h3>Leave calendar</h3><Records rows={workspace.data.leave_calendar} columns={[["title", "Request"], ["starts", "From"], ["ends", "To"], ["status", "Status"]]} />
      <h3>Leave history</h3><Records rows={workspace.data.leave_history} columns={[["kind", "Type"], ["units", "Adjustment"], ["reason", "Reason"]]} />
      <h3>Attendance</h3><Records rows={workspace.data.attendance} columns={[["kind", "Event"], ["at", "Recorded at"]]} />
      {person === profile.id && profile.principal === "staff" && <div className="actions">{["login", "logout"].map(kind => <Action key={kind} backend={backend} name="capture_attendance" args={{ p_client: crypto.randomUUID(), p_event: kind }} onDone={workspace.reload}>Record {kind}</Action>)}</div>}
    </>}
    {manage && <>
      <RpcForm key={`contract:${person}`} backend={backend} profile={profile} name="add_contract" title="Add effective-dated contract" initialKey={person} fields={[DivisionField(profile), titleField, { name: "p_starts", label: "Start date", type: "date", required: true }, { name: "p_ends", label: "End date", type: "date" }]}
        build={v => ({ ...v, p_person: person, p_ends: v.p_ends || null })} onSaved={workspace.reload} />
      <RpcForm key={`leave:${person}`} backend={backend} profile={profile} name="adjust_leave" title="Record authorised leave adjustment" initialKey={person} fields={[DivisionField(profile), { name: "p_kind", label: "Leave type", required: true }, { name: "p_units", label: "Signed units", type: "number", step: "0.01", required: true }, { name: "p_reason", label: "Authority and reason", type: "textarea", required: true }]}
        build={v => ({ ...v, p_person: person, p_units: Number(v.p_units) })} onSaved={workspace.reload} />
      {person !== profile.id && <RpcForm key={`status:${person}`} backend={backend} profile={profile} name="change_person_status" title="Employee status" initialKey={person} fields={[{ name: "p_status", label: "New status", options: options(["active", "suspended", "offboarded"]), required: true }, { name: "p_reason", label: "Reason", type: "textarea", required: true }]}
        build={v => ({ ...v, p_person: person })} onSaved={workspace.reload} />}
    </>}
  </div>;
}
function Registers({ backend, data }: Props) {
  const profile = data.profile;
  const modules = [
    ...(profile.permissions.includes("registers.manage") ? ["assets", "certifications", "portfolio"] : []),
    ...(profile.permissions.includes("suppliers.manage") ? ["suppliers"] : []),
    ...(profile.permissions.includes("hr.manage") ? ["contracts", "benefits", "recruitment", "appraisals"] : []),
  ];
  const [module, setModule] = useState(modules[0] || ""), [search, setSearch] = useState(""), [offset, setOffset] = useState(0), [selected, setSelected] = useState<Row | null>(null);
  const list = useRpc<Row[]>(backend, "register_page", { p_module: module, p_search: search, p_offset: offset });
  if (!modules.length) return <p>No registers are assigned to your profile.</p>;
  return <div className="workflow-stack"><div className="form-grid"><label>Register<select value={module} onChange={e => { setModule(e.target.value); setSelected(null); setOffset(0); }}>{options(modules).map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select></label>
    <label>Search register<input value={search} onChange={e => { setSearch(e.target.value); setOffset(0); }} /></label></div>
    <LoadState {...list} /><Records rows={list.data || []} columns={[["title", "Record"], ["status", "Status"], ["expires_on", "Expiry"]]} onSelect={setSelected} />
    <div className="actions"><button disabled={!offset} onClick={() => setOffset(n => n - 50)}>Previous records</button><button disabled={(list.data?.length || 0) < 50} onClick={() => setOffset(n => n + 50)}>Next records</button></div>
    <RpcForm key={module} backend={backend} profile={profile} name="create_record" title={`Add ${module} record`} initialKey={module} fields={[DivisionField(profile), titleField, descriptionField, { name: "p_expires", label: "Expiry date", type: "date" }]}
      build={v => ({ p_module: module, p_division: v.p_division, p_title: v.p_title, p_data: { description: v.p_description }, p_expires: v.p_expires || null })} onSaved={list.reload} />
    {selected && <RecordDetail key={`${selected.id}:${selected.version}`} backend={backend} data={data} row={selected} onChanged={() => { setSelected(null); list.reload(); }} />}
  </div>;
}
function RecordDetail({ backend, data, row, onChanged }: Props & { row: Row }) {
  const detail = useRpc<{ record: Row; timeline: Row[] }>(backend, "record_detail", { p_id: row.id });
  return <section className="workflow-stack"><LoadState {...detail} />
    <RpcForm backend={backend} profile={data.profile} name="update_record" title="Update record" initialKey={`${row.id}:${row.version}`} fields={[
      { ...titleField, value: String(row.title) }, { ...descriptionField, value: String((row.data as Row)?.description || "") }, { name: "p_status", label: "Record status", value: String(row.status), options: options(["active", "inactive"]), required: true }, { name: "p_expires", label: "Expiry date", type: "date", value: String(row.expires_on || "") },
    ]} build={v => ({ p_id: row.id, p_version: row.version, p_title: v.p_title, p_data: { ...(row.data as Row), description: v.p_description }, p_status: v.p_status, p_expires: v.p_expires || null, p_owner: row.owner_id })} onSaved={onChanged} />
    {row.module === "assets" && <RpcForm backend={backend} profile={data.profile} name="assign_asset" title="Assign custody" initialKey={String(row.id)} fields={[{ name: "p_person", label: "Custodian", options: personOptions(data), required: true }]} build={v => ({ ...v, p_asset: row.id })} onSaved={detail.reload} />}
    {detail.data && <Timeline events={detail.data.timeline} />}
  </section>;
}
function Checklists({ backend, data }: Props) {
  const profile = data.profile, manage = profile.permissions.includes("checklists.manage");
  const workspace = useRpc<{ templates: Row[]; runs: (Row & { items: Row[] })[] }>(backend, "checklist_workspace");
  return <div className="workflow-stack"><LoadState {...workspace} />
    {workspace.data?.runs.map(run => <section className="form-panel" key={String(run.id)}><h3>{text(run.title)} · {text(run.subject)}</h3><p>{text(run.status)} · Due {text(run.due_on)}</p>
      <ol>{run.items.map((item, i) => <li key={i}>{item.done ? "✓" : "○"} {text(item.title)} {run.status === "open" && <Action backend={backend} name="check_checklist_item" args={{ p_id: run.id, p_version: run.version, p_index: i, p_done: !item.done }} onDone={workspace.reload}>{item.done ? "Reopen task" : "Complete task"}</Action>}</li>)}</ol>
      {run.status === "open" && <Action backend={backend} name="complete_checklist" args={{ p_id: run.id, p_version: run.version }} onDone={workspace.reload}>Complete checklist</Action>}
    </section>)}
    {!workspace.loading && !workspace.data?.runs.length && <p>No checklist runs are assigned to you.</p>}
    {manage && <>
      <RpcForm backend={backend} profile={profile} name="create_checklist_template" title="Create checklist template" fields={[DivisionField(profile), titleField, { name: "p_kind", label: "Workflow", options: options(["onboarding", "offboarding", "staff-audit", "site-incident", "quality", "appraisal", "project", "asset"]), required: true }, { name: "tasks", label: "Tasks — one per line", type: "textarea", required: true }]}
        build={v => ({ p_division: v.p_division, p_title: v.p_title, p_kind: v.p_kind, p_items: v.tasks.split(/\r?\n/).map(s => s.trim()).filter(Boolean) })} onSaved={workspace.reload} />
      {!!workspace.data?.templates.length && <RpcForm key={workspace.data.templates.map(t => t.id).join()} backend={backend} profile={profile} name="start_checklist" title="Start checklist run" fields={[
        { name: "p_template", label: "Template", options: workspace.data.templates.map(t => ({ value: String(t.id), label: String(t.title) })), required: true },
        { name: "p_owner", label: "Owner", options: personOptions(data), required: true }, { name: "p_subject", label: "Person, project or asset reference", required: true }, { name: "p_due", label: "Due date", type: "date" },
      ]} onSaved={workspace.reload} />}
    </>}
  </div>;
}
export function NotificationHistory({ backend }: { backend: Backend }) {
  const list = useRpc<Row[]>(backend, "notification_page");
  return <details className="workflow-notifications"><summary>Notification history</summary><LoadState {...list} />
    {list.data?.map(row => <div className="section-heading" key={String(row.id)}><span>{text(row.event).replaceAll(".", " ")} · {row.read_at ? "Read" : "Unread"}{row.failed_at ? " · Delivery failed" : ""}</span>
      <Action backend={backend} name="read_notification" args={{ p_id: row.id }} onDone={list.reload}>Mark read</Action></div>)}
    {!list.loading && !list.data?.length && <p>No notifications yet.</p>}
  </details>;
}
function Audit({ backend, data }: Props) {
  const integrity = useRpc<Row>(backend, "verify_audit");
  const [after, setAfter] = useState(0);
  return <section className="workflow-stack"><h3>Audit integrity</h3><LoadState {...integrity} />{integrity.data && <p role="status">{integrity.data.ok ? "Chain verifies" : "Integrity failure"} · {text(integrity.data.checked)} events checked{integrity.data.first_bad_seq ? ` · First bad event ${text(integrity.data.first_bad_seq)}` : ""}</p>}
    <button onClick={integrity.reload}>Verify again</button>
    {data.profile.permissions.includes("audit.read") && <AuditEvents backend={backend} after={after} onNext={setAfter} />}
  </section>;
}
function AuditEvents({ backend, after, onNext }: { backend: Backend; after: number; onNext: (n: number) => void }) {
  const events = useRpc<Row[]>(backend, "audit_page", { p_after: after });
  return <><LoadState {...events} /><Records rows={events.data || []} columns={[["seq", "Event"], ["at", "Time"], ["action", "Action"], ["entity", "Record type"]]} />
    <div className="actions"><button onClick={() => onNext(0)} disabled={!after}>First events</button><button disabled={(events.data?.length || 0) < 50} onClick={() => onNext(Number(events.data?.at(-1)?.seq))}>Next events</button></div></>;
}
export default function BusinessWorkspace(props: Props & { mode: string }) {
  const [tab, setTab] = useState("helpdesk");
  if (props.mode === "projects") return <Projects {...props} />;
  if (props.mode === "people") return <People {...props} />;
  if (props.mode === "admin") return <Audit {...props} />;
  return <div className="workflow-stack"><div className="actions" role="group" aria-label="Operations workspace">{["helpdesk", "registers", "checklists"].map(t => <button key={t} aria-pressed={tab === t} onClick={() => setTab(t)}>{t[0].toUpperCase() + t.slice(1)}</button>)}</div>
    {tab === "helpdesk" ? <Helpdesk {...props} /> : tab === "registers" ? <Registers {...props} /> : <Checklists {...props} />}
  </div>;
}
