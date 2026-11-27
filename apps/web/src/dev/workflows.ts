// Synthetic adapters only. This module is reachable solely through the DEV import.
import type { Profile, Snapshot } from "../data";
type Row = Record<string, unknown>;
const names = new Set(["create_ticket", "ticket_page", "ticket_detail", "reply_ticket", "update_ticket", "save_project", "project_detail", "save_milestone", "people_workspace", "add_contract", "adjust_leave", "capture_attendance", "change_person_status", "register_page", "create_record", "record_detail", "update_record", "assign_asset", "return_asset", "checklist_workspace", "create_checklist_template", "start_checklist", "check_checklist_item", "complete_checklist", "notification_page", "read_notification", "verify_audit", "audit_page", "financial_page", "save_financial_record", "submit_financial_record", "reopen_financial_record", "journal_page", "save_account", "post_journal", "payroll_workspace", "create_payroll_period", "save_payroll_line", "submit_payroll_period", "lock_payroll_period"]);
export function createWorkflowPreview(profile: Profile, snapshot: Snapshot) {
  const tables = new Map<string, Row[]>();
  const table = (name: string) => { if (!tables.has(name)) tables.set(name, []); return tables.get(name)!; };
  const can = (permission: string) => profile.permissions.includes(permission);
  const require = (permission: string) => { if (!can(permission)) throw Error("This action is not assigned to your profile."); };
  const add = (name: string, row: Row) => { const record = { id: crypto.randomUUID(), created_at: new Date().toISOString(), created_by: profile.id, version: 1, ...row }; table(name).unshift(record); return record; };
  const find = (name: string, id: unknown) => { const row = table(name).find(r => r.id === id); if (!row) throw Error("This record is not available."); return row; };
  const log = (action: string, entity: unknown) => add("audit", { seq: table("audit").length + 1, at: new Date().toISOString(), actor: profile.name, action, entity_id: entity });
  const registerPermission = (module: unknown) => ["benefits", "recruitment", "appraisals", "contracts"].includes(String(module)) ? "hr.manage" : module === "suppliers" ? "suppliers.manage" : "registers.manage";
  return {
    has: (name: string) => names.has(name),
    async rpc(name: string, a: Row): Promise<unknown> {
      switch (name) {
        case "create_ticket": { const t = add("tickets", { title: a.p_title, description: a.p_description, category: a.p_category, status: "open", priority: 3, division: profile.divisions[0] || "COR" }); log("ticket.created", t.id); return t.id; }
        case "ticket_page": return structuredClone(table("tickets").filter(t => a.p_status === "all" || t.status === a.p_status).slice(Number(a.p_offset || 0), Number(a.p_offset || 0) + 50));
        case "ticket_detail": return structuredClone({ ticket: find("tickets", a.p_id), messages: table("messages").filter(m => m.ticket_id === a.p_id), timeline: table("audit").filter(m => m.entity_id === a.p_id) });
        case "reply_ticket": { const t = find("tickets", a.p_id); if (t.status === "closed") throw Error("This ticket is closed."); const m = add("messages", { ticket_id: a.p_id, body: a.p_body, actor: profile.name, at: new Date().toISOString() }); log("ticket.reply", t.id); return m.id; }
        case "update_ticket": { require("helpdesk.manage"); const t = find("tickets", a.p_id); if (t.version !== a.p_version) throw Error("This ticket changed. Refresh before saving."); Object.assign(t, { status: a.p_status, priority: a.p_priority, assigned_to: a.p_assigned, version: Number(t.version) + 1 }); log("ticket.updated", t.id); return t.version; }
        case "save_project": { require("projects.manage"); let p = snapshot.projects.find(p => p.code === a.p_code); if (!p) { p = { code: String(a.p_code), division: a.p_division as "ENG", title: String(a.p_title), budget_ugx: 0, actual_ugx: 0, progress: 0 }; snapshot.projects.push(p); } Object.assign(p, { title: a.p_title, budget_ugx: a.p_budget, actual_ugx: a.p_actual, progress: a.p_progress, status: a.p_status, version: Number(a.p_version || 0) + 1 }); log("project.saved", p.code); return Number(a.p_version || 0) + 1; }
        case "project_detail": { const p = snapshot.projects.find(p => p.code === a.p_code); if (!p) throw Error("This project is not available."); return structuredClone({ project: { status: "active", version: 1, ...p, variance_ugx: p.budget_ugx - p.actual_ugx, health: !p.budget_ugx ? "unavailable" : p.actual_ugx / p.budget_ugx * 100 <= p.progress + 5 ? "green" : p.actual_ugx / p.budget_ugx * 100 <= p.progress + 15 ? "amber" : "red" }, milestones: table("milestones").filter(m => m.project === p.code), timeline: table("audit").filter(m => m.entity_id === p.code) }); }
        case "save_milestone": { require("projects.manage"); const m = a.p_id ? find("milestones", a.p_id) : add("milestones", { project: a.p_project }); Object.assign(m, { title: a.p_title, due_on: a.p_due, published: a.p_published || false, completed_at: a.p_completed ? new Date().toISOString() : null }); log("project.milestone", a.p_project); return m.id; }
        case "people_workspace": { const target = a.p_person || profile.id; if (target !== profile.id) require("hr.manage"); return structuredClone({ person: snapshot.people.find(p => p.id === target), contracts: table("contracts").filter(r => r.person_id === target), balances: Object.entries(table("leave").filter(r => r.person_id === target).reduce<Record<string, number>>((s, r) => { s[String(r.kind)] = (s[String(r.kind)] || 0) + Number(r.units); return s; }, {})).map(([kind, units]) => ({ kind, units })), leave_history: table("leave").filter(r => r.person_id === target), leave_calendar: [], attendance: table("attendance").filter(r => r.person_id === target) }); }
        case "add_contract": require("hr.manage"); return add("contracts", { person_id: a.p_person, title: a.p_title, starts: a.p_starts, ends: a.p_ends }).id;
        case "adjust_leave": require("hr.manage"); return add("leave", { person_id: a.p_person, kind: a.p_kind, units: a.p_units, reason: a.p_reason }).id;
        case "capture_attendance": { const old = table("attendance").find(r => r.client === a.p_client); return old?.id || add("attendance", { person_id: profile.id, client: a.p_client, kind: a.p_event, at: new Date().toISOString() }).id; }
        case "change_person_status": { require("people.manage"); const p = snapshot.people.find(p => p.id === a.p_person); if (!p || p.id === profile.id) throw Error("You cannot change this profile."); p.status = String(a.p_status); return p.status; }
        case "register_page": return can(registerPermission(a.p_module)) ? structuredClone(table("registers").filter(r => r.module === a.p_module && !r.deleted_at && String(r.title).toLowerCase().includes(String(a.p_search || "").toLowerCase())).slice(Number(a.p_offset || 0), Number(a.p_offset || 0) + 50)) : [];
        case "create_record": { require(registerPermission(a.p_module)); const r = add("registers", { module: a.p_module, title: a.p_title, division: a.p_division, data: a.p_data, expires_on: a.p_expires, status: "active", owner_id: profile.id }); log("record.created", r.id); return r.id; }
        case "record_detail": { const r = find("registers", a.p_id); require(registerPermission(r.module)); return structuredClone({ record: r, timeline: table("audit").filter(e => e.entity_id === r.id) }); }
        case "update_record": { const r = find("registers", a.p_id); require(registerPermission(r.module)); if (r.version !== a.p_version) throw Error("This record changed."); Object.assign(r, { title: a.p_title, data: a.p_data, status: a.p_status, expires_on: a.p_expires, version: Number(r.version) + 1 }); log("record.updated", r.id); return r.version; }
        case "assign_asset": require("registers.manage"); if (table("custody").some(r => r.asset === a.p_asset && !r.returned)) throw Error("This asset already has a custodian."); return add("custody", { asset: a.p_asset, person: a.p_person }).id;
        case "return_asset": require("registers.manage"); find("custody", a.p_id).returned = true; return "returned";
        case "checklist_workspace": return structuredClone({ templates: can("checklists.manage") ? table("templates") : [], runs: table("runs").filter(r => r.owner_id === profile.id || can("checklists.manage")) });
        case "create_checklist_template": require("checklists.manage"); return add("templates", { title: a.p_title, division: a.p_division, kind: a.p_kind, items: a.p_items }).id;
        case "start_checklist": { require("checklists.manage"); const t = find("templates", a.p_template); return add("runs", { title: t.title, subject: a.p_subject, due_on: a.p_due, owner_id: a.p_owner, status: "open", items: (t.items as string[]).map(title => ({ title, done: false })) }).id; }
        case "check_checklist_item": { const r = find("runs", a.p_id); if (r.version !== a.p_version || r.status !== "open") throw Error("This checklist changed or is complete."); (r.items as Row[])[Number(a.p_index)].done = a.p_done; r.version = Number(r.version) + 1; return r.version; }
        case "complete_checklist": { const r = find("runs", a.p_id); if (r.version !== a.p_version || (r.items as Row[]).some(i => !i.done)) throw Error("Finish every task before completing this checklist."); r.status = "completed"; return "completed"; }
        case "notification_page": return [];
        case "read_notification": return false;
        case "verify_audit": if (!can("audit.read") && !can("ops.read")) throw Error("You cannot verify the audit chain."); return { ok: true, checked: table("audit").length, first_bad_seq: null };
        case "audit_page": require("audit.read"); return structuredClone(table("audit").filter(e => Number(e.seq) > Number(a.p_after || 0)).reverse().slice(0, 50));
        case "financial_page": return structuredClone(table("financial"));
        case "save_financial_record": { if (!["expense", "requisition"].includes(String(a.p_kind))) require("finance.manage"); const lines = a.p_lines as Row[]; const total = lines.reduce((n, l) => n + Number(l.quantity) * Number(l.unit_ugx), 0); if (total <= 0) throw Error("Enter an amount above zero."); return add("financial", { kind: a.p_kind, title: a.p_title, division: a.p_division, lines, total_ugx: total, status: "draft", document_id: a.p_document }).id; }
        case "submit_financial_record": { const r = find("financial", a.p_id); if (r.kind === "expense" && !r.document_id) throw Error("Attach a receipt document before submitting this claim."); r.status = "submitted"; r.approval_status = "pending"; return crypto.randomUUID(); }
        case "reopen_financial_record": throw Error("The synthetic claim has not been returned or withdrawn.");
        case "journal_page": return can("finance.read") ? structuredClone(table("journals")) : [];
        case "save_account": require("journal.post"); return add("accounts", { code: a.p_code, name: a.p_name }).id;
        case "post_journal": { require("journal.post"); const lines = a.p_lines as Row[]; if (lines.some(l => !table("accounts").some(c => c.code === l.account_code))) throw Error("Choose an active configured account."); if (lines.reduce((n, l) => n + Number(l.debit) - Number(l.credit), 0) !== 0) throw Error("Journal debits and credits must balance."); return add("journals", { division: a.p_division, date: a.p_date, number: a.p_number, description: a.p_description, lines }).id; }
        case "payroll_workspace": return { periods: can("payroll.read") ? structuredClone(table("periods")) : [], lines: [], payslips: [] };
        case "create_payroll_period": require("payroll.prepare"); return add("periods", { title: a.p_title, starts: a.p_starts, ends: a.p_ends, division: a.p_division, status: "preparing" }).id;
        case "save_payroll_line": throw Error("No verified PAYE table is configured in this synthetic walkthrough. No payroll was calculated.");
        case "submit_payroll_period": throw Error("Add payroll inputs before review.");
        case "lock_payroll_period": throw Error("HR and department review must both be approved.");
        default: throw Error("This action is not available in the walkthrough.");
      }
    },
  };
}
