# Source context and boundaries

The original workspace contained 13 files: the Master Plan DOCX; XELRA_BLUEPRINT.md; the simulation kit README, two Python scripts and two JSON result files; and six nested infrastructure examples (Netlify configuration, CSP script and four workflows). The DOCX contains text and tables in document.xml, with no embedded media, footnotes, comments or revision parts. Its full text and table content were extracted and read. This task concerns meaning, not Word layout editing.

## Authority and gaps

The 26 November blueprint explicitly supersedes the Master Plan's server-rendered hosting choice and treats Supabase Pro as an expected first-year expense. Static Next.js export, direct Supabase access under RLS, privileged Edge Functions and private R2 files are therefore the foundation. No paid plan is selected by this code.

The supplied blueprint ends at section 5.5. Its references to sections 6–18 and to a Sprint 0 prompt cannot be resolved from this workspace. The referenced archived client-portal branch, discovery questionnaire and original answers are also absent. No code was imported from another repository. Provider account IDs, DNS ownership, region, budget owner, Microsoft tenant approval and credentials are not supplied.

The demonstration harness creates its own schema. Its results are historical evidence for that schema, not certification of these migrations. It does not implement the blueprint's T9 consent test or MFA checks; its payroll positive controls are not part of its aggregate violation count. Examples must not be copied as production authorisation logic. Illustrative tax bands are not statutory rates.

## Application model retained for later phases

XELRA serves Engineering, Asset Management and corporate operations, with self, team, division, project and explicitly granted combined scopes. Five reusable shapes are entities, scope, workflow, append-only ledgers and versioned documents. The Central Director also heads Asset Management. Engineering has a director and a standing Pro-Consultant delegate. IT administration is outside the business reporting structure.

Sixteen role templates are required later: Central Director, Engineering Director, Department Head, Project Lead, Engineer/Consultant, Finance Manager, Finance Officer, HR Lead, HR Officer, Admin Assistant, Intern/Trainee, Legal Consultant, Auditor seat, Client user, Contractor and IT Administrator. Sensitive role grants require uploaded Director consent. The Master Plan includes all Finance/HR/payroll grants; the sample blueprint trigger names only some senior roles. Use the stronger data-driven sensitive-role rule when implementing this subsystem.

IT administrators manage identities, authenticators, sessions, health and system audit events; that role must not grant access to salaries, bank details, disciplinary records, contract financial terms, projects or finance. Emergency business access requires time-limited Director-approved grants and a trail. Future scope helpers must also reject inactive profiles and expired roles, use fixed search paths and narrowly granted execution. Sensitive reads require aal2. No user-editable metadata may grant permissions.

Future modules include employee records/contracts, attendance, timesheets, leave, hiring/onboarding, appraisals, training/certification, equipment/benefits, discipline/grievance and staff audits; projects/tasks/milestones/budgets/field events; quotations/invoices/expenses/requisitions/suppliers/payments/reconciliation/fixed assets/tax/forecasting; Uganda payroll; documents/policies; external client/contractor/auditor workspaces; communication, helpdesk and administration. None are implemented here.

Approval ladders are configurable, prohibit self-approval, use delegates and escalate after two days; cover approvals expire after five days. Spending scale, GBP interpretation and accounting package remain open. Payroll rates must be effective-dated and Finance-verified, use integer minor units and locked approved periods, and pass a historical shadow run. UUID identifiers, UTC timestamptz, indexed scope keys, idempotent queued writes and forward-only migrations are baseline conventions.

Audit events are permanent and append-only; no activity surveillance. Login-event deletion needs a 12-month export, checksum, confirmed download and concurrency-safe verification. HR/finance/documents are marked inactive after five years, not silently deleted. Screenshots are deleted on ticket resolution. Offline field capture uses an append-only event queue, compressed photos and explicit confirmed sync; payroll and sensitive records must not enter offline caches. Audit archive deletion needs verified durable export and retained hash/index evidence.

External people have named authenticated identities even when described as lightweight accounts. Client visibility depends on recorded payment and matching project data. Auditor seats expire and require personal MFA. Contractors use emailed links/codes. Microsoft 365 staff login and Graph mail/calendar need tenant approval; a shared mailbox does not itself supply Supabase Auth email transport. AI context access stays off; generic drafting remains a future module. Merchant APIs, live bank feeds, VAT automation and statutory verification are not infrastructure setup.

Brand: Engineering red #991923, Asset Management indigo #0d3251, ink #111111 and paper #f7f7f5; Sweet Sans Pro licensing is unresolved. These inform future UI only. No visual design or frontend screens were added.

## Foundation ownership

Terraform owns hosted project settings and resources. Supabase migrations own database objects. The local config is staging configuration, not an instruction to overwrite hosted settings. Runtime secrets belong in protected environments or Edge Function secret storage; public browser values are separate. Future business migrations must add policies and tests together before grants/screens, and schedule retention only after the relevant workflow exists.

DNS remains manual under the Master Plan. Standby uses the same application hostname after failover, preserving auth redirects and CORS. The pages.dev hostname is a deployment verification target, not an approved production login origin. Registration in code alone cannot establish that its custom-domain certificate is active.
