# Blueprint implementation inventory

Status date: 26 November 2026

This inventory compares the integrated [XELRA blueprint](../XELRA_BLUEPRINT.md) with the executable workspace and the [implementation record](IMPLEMENTATION.md).

## Status rules

| Status | Meaning |
| --- | --- |
| **Complete — local** | Implemented in executable code, migration, or lab, with focused verification. This does not mean hosted, provider-approved or externally accepted. |
| **In progress** | A real implementation exists, but one or more blueprint pieces, acceptance surfaces or external dependencies remain. |
| **Untouched** | No implementation exists in the workspace, or only a design/seed placeholder exists. |

## Executive summary

- **Complete — local:** foundations, reusable approval/document/audit primitives, the permission and RLS spine, the local UI shell, offline field primitives, reconciliation, effective-dated PAYE primitives, and the supplied lab evidence.
- **In progress:** document R2 transport, notification deployment, audit anchoring and archival, attendance administration, helpdesk administration, field camera/PWA hardening, external workspaces, and several role homes.
- **Untouched:** full people/payroll/project-money modules, complete employee and contract administration, full expense/requisition/invoice workflows, calendar, SharePoint, AI context, accounting live integration, bank feeds, mobile money, payment providers, e-signature providers, WhatsApp, URA automation, and production sign-in/provisioning.

## Phase-level status

| Blueprint phase | Status | Implemented boundary | Remaining boundary |
| --- | --- | --- | --- |
| Phase 0 — Ground work | In progress | Vite/static bundle, Vite and PGlite checks, Division Lens, local 61-test lab, migration history, Worker and monitor code, backup scripts | Throwaway-host acceptance, TLS/custom domain, real DNS, live nightly dump/restore, both schedulers deployed, M365 registration, final DNS records |
| Phase 1 — Core platform | In progress | RLS/RBAC, approvals, audit chain, document numbering, document lifecycle metadata, outbox primitives, helpdesk/register, operations meters | Notification delivery deployment, audit weekly anchor and archive, complete helpdesk SLA/incident flows, complete admin console, hosted acceptance |
| Phase 2 — People | Untouched | Basic people read model and attendance export/purge primitives | Employee records/contracts, leave balances, timesheets, onboarding/offboarding, recruitment, benefits, appraisals, equipment lifecycle |
| Phase 3 — Money and projects | In progress | Project read model, budgets/actual/progress read model, expense approval ladder, reconciliation shadow matcher, PAYE primitive | Full projects, expenses, requisitions, supplier bills, quotations, invoices, payroll period workflow, journals, cash forecast, fixed assets |
| Phase 4 — External and field | In progress | Per-profile IndexedDB field reports, idempotent sync, client visibility gate, external principal checks, reconciliation, generic reconciliation UI | Client/contractor/auditor homes, camera capture, cold-start auth/offline, auditor seats, policy library, AI generic mode, legacy document migration, Asset Management module |
| Phase 5 — Sign-in and hardening | In progress | OAuth/OTP UI, sessionStorage/PKCE, idle lock, development switcher isolation, bundle-secret checks, RLS tests | Entra tenant/MFA, OTP delivery, step-up, provisioning, session revoke, security review, physical acceptance, load test, training/handover |

## Architecture and foundations

| Blueprint item | Status | Evidence / boundary |
| --- | --- | --- |
| Static Vite/React SPA | Complete — local | `apps/web`, strict TypeScript, build and browser tests |
| Supabase/Postgres/PostgREST API | Complete — local | Thin `api` wrappers and `security_invoker` views |
| Narrow exposed API schema | Complete — local | Private schemas and exact grants in migrations |
| Set-based RLS | Complete — local | Effective permissions, scoped policies and benchmark tests |
| Cloudflare primary static host | In progress | Configuration/release scripts exist; hosted domain and TLS are not accepted |
| Netlify static fallback | In progress | Static-only code exists; fallback enablement remains gated |
| Three environments | In progress | Local and synthetic preview exist; hosted preview/production are not configured here |
| Forward-only migration gate | Complete — local | Migration history checks and two added forward migrations |
| Secret and development-marker build gate | Complete — local | App build, header and marker checks |
| 250 KB initial-JavaScript gate | Complete — local | Production build currently passes the budget |
| RLS gate for every application table | Complete — local | PGlite and lab RLS gates |
| Private file Worker | In progress | Method, origin, JWT and key checks exist; R2 upload and hosted delivery remain unaccepted |
| Independent Cloudflare monitor | In progress | Worker code exists; tenant Worker and alert endpoint are undeployed |
| GitHub operations workflows | In progress | Workflows/scripts exist; hosted provider output is not acceptance |
| Two backup recipients and recovery key | Untouched | External setup and live key custody required |
| Live encrypted backup/restore execution | Untouched | Scripts and isolated evidence exist; no live backup or restore accepted |
| Bucket lifecycle enforcement | Untouched | R2 lifecycle configuration and live verification required |

## Identity, RBAC and sessions

| Blueprint item | Status | Evidence / boundary |
| --- | --- | --- |
| Staff, Director, Client, Contractor, Auditor and IT principals | In progress | Schema/principal distinctions and synthetic profiles exist; real provisioned accounts do not |
| Supabase/Entra staff sign-in | In progress | OAuth entry point exists; tenant application, MFA and custom claims are external |
| OTP link/code for clients and contractors | In progress | OTP entry point exists; real Graph hook and OTP delivery are external |
| Passwordless contractor sign-in | Untouched | No contractor OTP provisioning/profile workflow |
| Named auditor seats | Untouched | No seat UI or expiry lifecycle beyond grant mechanics |
| Current-person permission lookup | Complete — local | Active status, assignments and expiry checks |
| Combined-view consent/grants | In progress | Consent/grant SQL and test mechanism exist; complete UI/provisioning is absent |
| Delegation and five-day cover limit | Complete — local | SQL constraint, expiry and PGlite tests |
| Step-up for sensitive actions | Untouched | No elevation record or step-up UI |
| Suspended/offboarded identity revocation | Complete — local | Permission joins and lab test |
| IT session revoke | Untouched | No Edge Function/admin workflow |
| MFA/rate limit | Untouched | External Entra/platform controls or further implementation |
| Development switcher isolation | Complete — local | Synthetic-only preview, build-marker and signature-separation tests |

## Shape S1 — Record with a life

| Blueprint feature | Status | Evidence / boundary |
| --- | --- | --- |
| Generic project register | In progress | Read model and projects UI exist; full project lifecycle is incomplete |
| Generic document-like record | In progress | Lifecycle exists for documents; generic module kit is not complete |
| Employee records and contracts | Untouched | No employee/contract module |
| Recruitment candidates | Untouched | No candidate workflow |
| Suppliers | Untouched | Only generic register shape |
| Fixed assets | Untouched | No fixed-asset register/workflow |
| Benefits | Untouched | No benefits module |
| Completed-project ratings | Untouched | No rating workflow |
| Contractor profiles | Untouched | No contractor profile module |
| Client profiles | Untouched | No complete client administration |

## Shape S2 — Request with approvals

| Blueprint feature | Status | Evidence / boundary |
| --- | --- | --- |
| Shared approval engine | Complete — local | Submit, row-lock, step, manager/permission, four-eyes and expiry tests |
| Leave requests | In progress | Submission/detail/withdrawal and sample UI exist; balances and leave calendar are absent |
| Expense claims | In progress | Request ladder and approval steps exist; claim workflow/receipts/export are incomplete |
| Requisitions | Untouched | No requisition module |
| Booking/site visit | Untouched | No booking/module workflow |
| Payroll approval | Untouched | No payroll approval period |
| Hiring approval | Untouched | No hiring workflow |
| Document release approval | In progress | Direct document release exists; it is not yet a shared approval-card workflow |
| Role changes | Untouched | No role-change approval UI |
| Salary advance/travel | Untouched | No workflow |
| Withdrawal | Complete — local | Owner-only pending withdrawal, audit and notification invalidation |
| Purchasing ladder/Purchase Orders | In progress | UGX ladder primitive exists; quotes/PO/Director confirmation remain absent |
| Bulk approval and undo | Untouched | No bulk-safe approval or ten-minute undo |
| Pagination/saved views/keyboard history | Complete — local | Server-side page/filter logic and browser coverage |

## Shape S3 — Ledger of dated lines

| Blueprint feature | Status | Evidence / boundary |
| --- | --- | --- |
| Attendance log | In progress | Export/checksum/confirm/purge primitives and tests; no event-capture UI |
| Timesheets | Untouched | No timesheet workflow |
| Expense lines | Untouched | No expense ledger |
| Invoice lines | Untouched | No invoice ledger |
| Journals | Untouched | No journal posting |
| Payroll lines | Untouched | No payroll period engine |
| Bank lines | In progress | Lab reconciliation models and matcher exist; no imported bank ledger UI |
| Tax records | Untouched | No tax module |
| Depreciation | Untouched | No fixed-asset depreciation |

## Shape S4 — Register with expiry

| Blueprint feature | Status | Evidence / boundary |
| --- | --- | --- |
| Generic expiry register | In progress | Generic records/tombstone-style deletion and expiry fields exist |
| Certifications/standards register | In progress | Register shape exists; no full certificate workflow/reminders |
| Equipment custody | Untouched | No custody register |
| Contracts register | Untouched | No contracts register |
| Auditor seats | Untouched | No seat UI/workflow |
| Delegations | Complete — local | SQL and lab tests |
| Access grants | In progress | Grant mechanism exists; complete UI and renewal are absent |

## Shape S5 — Document-bound

| Blueprint feature | Status | Evidence / boundary |
| --- | --- | --- |
| Collision-free document numbering | Complete — local | Sequential numbering and PGlite tests |
| Metadata and 4 KB excerpt cap | Complete — local | SQL and lifecycle test |
| Draft/In review/Released/Superseded/Withdrawn lifecycle | Complete — local | SQL primitives and synthetic UI |
| Private file metadata and checksum | Complete — local | Attachment RPC and SHA-256 validation |
| Scoped document search/copy/download | In progress | Search/copy UI exists; download depends on configured hosted Worker |
| R2 upload | Untouched | No browser/Worker upload implementation |
| Revision release workflow | In progress | Revision metadata exists; the full approval/release/file-review chain is incomplete |
| Reviewed legacy migration | Untouched | Inventory/classification/review queue are absent |
| SharePoint/OneDrive links | Untouched | No Microsoft integration |
| Document acknowledgements/e-signature | Untouched | No typed-name, timestamp or provider signature workflow |
| Client documents/invoices | Untouched | No external document workspace |

## Shape S6 — Thread

| Blueprint feature | Status | Evidence / boundary |
| --- | --- | --- |
| Staff comments/messages | Untouched | No thread/message module |
| Client messages | Untouched | No client thread |
| Helpdesk ticket thread | In progress | Ticket/register entry exists; complete discussion/SLA workflow is absent |
| Grievances | Untouched | No grievance exclusion/routing workflow |
| Approval comments | Complete — local | Decision and withdrawal reasons are stored and displayed |

## Shape S7 — Checklist run

| Blueprint feature | Status | Evidence / boundary |
| --- | --- | --- |
| Generic checklist entries | In progress | `work.records` supports register/checklist data; no checklist-run engine |
| Onboarding | Untouched | No checklist workflow |
| Offboarding | Untouched | No checklist workflow |
| Quarterly staff audit | Untouched | No checklist workflow |
| Restore drill | In progress | Database/backup scripts and receipts exist; live restore acceptance remains external |
| Site incident reports | Untouched | No incident workflow |
| Quality reports | Untouched | No quality workflow |
| Appraisals | Untouched | No appraisal workflow |

## Shape S8 — Read model

| Blueprint feature | Status | Evidence / boundary |
| --- | --- | --- |
| Project budget/actual/progress | Complete — local | Project read model and UI |
| Project health | In progress | Progress exists; health thresholds are not fully implemented |
| Budget versus actual | In progress | Budget/actual fields exist; no complete report |
| Cash position | Untouched | No bank/bills/payroll model |
| 13-week forecast | Untouched | No forecast workflow |
| Accountability metrics | Untouched | No task/turnaround/compliance read model |
| Headcount | Untouched | No role/division dashboard |
| Operations meters | In progress | Meters/health SQL and console exist; live measurements and deployment remain external |
| Calendar | Untouched | No company/leave/calendar integration |

## Bespoke and module work

| Blueprint item | Status | Evidence / boundary |
| --- | --- | --- |
| Approval engine | Complete — local | Core lifecycle and local acceptance tests |
| Bank matcher | In progress | Lab matcher/sweep and reconciliation UI; no live statement import/posting |
| Offline field PWA | In progress | IndexedDB, idempotency and service shell exist; no camera/compression/cold-start/physical iPhone acceptance |
| AI gateway | Untouched | No provider interface or data-bearing context |
| Notification dispatcher | In progress | Outbox, leases, quiet time and Worker dispatch code exist; Graph tenant/disabled config remains |
| Sign-in and provisioning | In progress | Local auth shell/UI exists; real Entra/OTP/MFA/provisioning is external |
| Legacy document migration | Untouched | No inventory, classification or review queue |
| Rule-based forecasting | Untouched | No forecasting engine |
| Named-seat auditor access | Untouched | No auditor seat and findings UI |
| Passwordless contractor sign-in | Untouched | No contractor sign-in flow |

## Module 6.1–6.15 inventory

| Section | Status | Complete / in-progress pieces | Untouched pieces |
| --- | --- | --- | --- |
| 6.1 Approvals | In progress | Engine, lifecycle, withdrawal, scoped detail, filters, audit reasons | Purchasing rules, bulk approval/undo |
| 6.2 Documents | In progress | Numbering, lifecycle metadata, revision and private-key model | R2 upload, legacy migration, SharePoint, e-signature |
| 6.3 Notifications | In progress | Outbox, leases, retries, quiet-time, link-only mail source | Tenant setup, mail delivery, auth-email hook |
| 6.4 Audit | In progress | Chain, append-only triggers, verify, private writes | External anchors, verified archive/pruning |
| 6.5 Attendance | In progress | Export/checksum/confirm/purge primitives | Event capture UI and live retention job |
| 6.6 Helpdesk/admin | In progress | Generic helpdesk/register submission, technical health panel | Provisioning, SLA calendar, screenshot lifecycle, incident/user workflows |
| 6.7 Field | In progress | Text queue, per-profile IndexedDB, sync, conflict protection | Camera, compression, cold-start authenticated offline and physical iPhone |
| 6.8 Finance/reconciliation | In progress | Matcher/sweep, text comparison, shadow mode | PDF, bank mappings, many-to-one, posting/accounting export |
| 6.9 Payroll | In progress | Effective-dated/unverified PAYE primitive and test vectors | Payroll preparation, approvals, period lock, payslip, bank file, shadow run |
| 6.10 Spending/settings | Complete — local | Scale setting and tested ladder | GBP converted limits/editor UX and purchasing sub-flow |
| 6.11 Read models | In progress | Budgets/actual/progress/approval health | Cash, forecast, accountability, headcount and complete dashboards |
| 6.12 External workspaces | Untouched | Membership, published/payment gate and external exclusions exist in database design | Complete client/contractor/auditor homes and grievance routing |
| 6.13 AI | Untouched | Explicitly disabled/absent | Generic and context-aware assistant |
| 6.14 Privacy/data location | Untouched | No live data-region decision | Region choice, DPIA/legal safeguards, consent language, registration, breach runbook |
| 6.15 Integrations | Untouched or in progress | Graph notification source, neutral CSV direction, private file boundary | Entra/Graph deployment, calendar, SharePoint, live accounting, bank/mobile money/payments, e-signature, URA |

## UX and acceptance inventory

| Blueprint requirement | Status | Evidence / boundary |
| --- | --- | --- |
| Dreniak mark and Division Lens | Complete — local | Desktop/mobile UI and palette tests |
| Ink actions and status icons | Complete — local | Shared status and button conventions |
| Light/dark combined lens | Complete — local | Contrast and browser checks |
| Responsive SPA and narrow viewports | Complete — local | 375/320 px Playwright checks |
| Command palette | Complete — local | Permission registry and lab tests |
| Keyboard table navigation | Complete — local | J/K/Enter and request/document flows |
| Draft autosave | Complete — local | Session/tab draft behavior |
| Loading/error/empty/offline states | In progress | Core states exist; they are not complete across every module |
| Role homes | In progress | General shell/inbox exists; Morning Board and all named role homes are incomplete |
| Mobile bottom bar and camera capture | In progress | Bottom shell exists; camera-first capture is not complete |
| Sync pill/queue | In progress | Queue UI and status exist; full PWA behavior is incomplete |
| Bulk safe data-table actions | Untouched | No complete data-table bulk-action bar |
| WCAG 2.2 AA evidence | In progress | Axe serious/critical checks pass in tested contexts; full accessibility certification is absent |
| Licensed Sweet Sans/General Sans | Untouched | Font licence and production font delivery |
| All-role physical and assistive-technology acceptance | Untouched | Physical Safari/iPhone and role/device assistive-technology testing remain |

## Open blueprint decisions

| Open item | Status | Current workspace position |
| --- | --- | --- |
| Spending scale | Complete — local assumption | Scale is 1; Director editing is not complete |
| GBP limits | Untouched | Finance rate/editor decision remains external |
| Hosting Netlify vs Cloudflare | In progress | Cloudflare is primary, Netlify is fallback; neither is remotely accepted |
| Paid no-training AI | Untouched | Generic mode only is the recommendation; no provider/configuration |
| Legacy document source/location | Untouched | No shared-drive inventory |
| Past payroll month | Untouched | No privacy-approved shadow inputs |
| Supabase paid-service funding | Untouched | External decision |
| Accounting package | Untouched | Neutral CSV direction only |
| Mobile-money statement provider | Untouched | No provider or sample statements |
| Budgets versus actuals | In progress | Read-model fields exist; complete report/dashboard is absent |

## Backlog in dependency order

1. Hosted Phase 0: DNS/TLS, Cloudflare/Netlify acceptance, real M365 registration, backups and scheduled monitors.
2. Complete Phase 1: notification tenant setup, audit anchors/archive, helpdesk SLA/admin workflows, complete document R2 upload and revision approval.
3. Complete Phase 2: people/contracts, leave balances/calendar, attendance capture/admin UI, timesheets and checklists.
4. Complete Phase 3: project/expense/requisition/supplier/invoice/journal workflows, payroll period engine and shadow run, bank import/posting and cash forecast.
5. Complete Phase 4: client/contractor/auditor homes, field camera/PWA, policy library, legacy migration, generic AI and remaining external modules.
6. Complete Phase 5: Entra/OTP/MFA/provisioning, step-up, session revoke, security review, restore drill, load testing, physical/mobile acceptance and handover.

## Current verification limits

The workspace may prove migrations, lab behavior, bundle behavior and synthetic browser flows. It does not prove hosted RLS, provider authentication, real mail delivery, DNS/TLS, R2 delivery, encrypted backups, restore acceptance, statutory rate approval, legal adequacy, accessibility certification or production device behavior.
