# Enhanced workspace integration · 26 November 2026

## Source coverage

All 34 files in `files/` are covered by `docs/source/inventory.json`. The ZIP and nested extracted lab match byte for byte. Both PNGs were inspected; the enhanced 1200-pixel root PNG is used by the workspace. The SVG/TS mark retains the supplied geometry. Source text, SQL, TypeScript, Python, tests, workflow, configuration and simulation assumptions were read before integration.

The full enhanced blueprint replaces the shorter root blueprint. Earlier documents are archived. Nothing in `files/` was modified. The active lab is `packages/lab/`, with locked dependencies, portable Python commands, corrected dark combined-lens contrast and invalid matching-input handling.

## Coverage and acceptance

| Blueprint area | Implemented | Remaining boundary |
| --- | --- | --- |
| 2, 9 · brand/UI | Split mark, division lens, ink actions, D corner, themes, responsive shell, command search, states, rejection reason, tab drafts | Licensed font, all-role physical-device and assistive-technology acceptance |
| 3 · reusable shapes | Requests, project/document read models, basic lifecycle/expiry registers and checklist entries | Generic records do not complete each module's ten-artifact kit |
| 4 · architecture | Vite bundle, thin API, private schemas, known SPA routes/real unknown-path 404, bundle/dev-code checks | Hosted API/domain/header acceptance |
| 4.4 · backups | Consistent dump/read-back verification, two recipients, daily/weekly/monthly tiers; restored audit verification | No live encrypted backup/restore or bucket lifecycle execution |
| 4.5 · scheduling | GitHub monitoring plus independent Cloudflare monitor, paginated backup checks, meter/receipt checks, alert webhook | Worker and alert endpoint deployment |
| 5 · identity/RLS | Invited OAuth/OTP UI, sessionStorage/PKCE, short tokens, current permissions, active/expiry checks, IT business-data wall | Tenant MFA, real OTP delivery, step-up/provisioning/session-admin workflows |
| 6.1 · approvals | Submit/decide/withdraw, shared row lock, manager/permission steps, four-eyes, delegation expiry, hashed decision reasons, scoped audit timeline, paginated saved views, orphan alerts and transactional notifications | Full purchasing rules and bulk-safe approval/undo |
| 6.2 · documents | Numbering, metadata/4 KB excerpt cap, scoped lifecycle create/attach/submit/release/revise/withdraw, scoped search/copy/download, caller-token Worker | R2 upload transport, reviewed legacy auto-filing and SharePoint filing |
| 6.3 · notifications | Transactional outbox, SKIP LOCKED leases, token-bound completion, quiet time, link-only Graph mail, retries | Disabled until tenant/mailbox setup; auth-email hook still needed. Delivery may duplicate after ambiguous provider failures |
| 6.4 · audit | Append-only chain, canonical structured hashing, verification, private writes, restore invariant | External anchors and verified monthly archival/pruning not implemented |
| 6.5 · attendance | Export/checksum/confirm/purge primitives, 12-month floor, exact exported IDs protect later backdated arrivals | Admin UI and attendance event capture |
| 6.6 · helpdesk/admin | Own helpdesk/basic register submission; IT-only health panel | Provisioning, SLA calendar, screenshot deletion/tombstones and incident workflows |
| 6.7 · field | Per-profile IndexedDB notes; manual/open/online sync; ownership/project checks; conflicting-replay protection; shell cache/update prompt | Text notes only; camera/compression, cold-start authenticated offline flows and physical iPhone testing remain |
| 6.8 · reconciliation | Matcher/sweep, tab-separated bank/ledger shadow comparison, unique IDs and row cap, no posting | PDF extraction, bank mappings, many-to-one matching and ledger posting |
| 6.9–6.11 · money | Verified effective-dated PAYE primitive, spending scale, budget/progress read model | Full payroll/shadow/export/period workflow, journals, cash forecasts and finance modules |
| 6.12 · external | Membership plus published/payment client gate; clients cannot capture staff reports; expiry checks | Complete client/contractor/auditor homes, grievance exclusion and findings |
| 6.13–6.15 · integrations | AI/context, payments and bank feeds remain absent/disabled; Graph notification source supplied | No AI data transmission. Accounting, legal approvals, merchant access, calendar/SharePoint remain open |
| 7–8 · evidence | Simulations/benchmark rerunnable, actual-migration and Worker negative controls, browser/axe flows | Local proof only, not production certification |
| 10–12 · lab/roadmap | Entire lab integrated; phase order/open decisions preserved | Phase exit criteria are not marked complete merely because source exists |

## Hardening relative to the prototype

- No production auth shims, blanket function execution or synthetic people/rates.
- Invoker API wrappers and security-invoker views; exact dependency grants.
- Current dates/status/scopes checked on writes; inactive managers cannot approve.
- Consent bound to released document, currently authorised Director, recipient, permission, scope, expiry and one-time use; arbitrary UUIDs do not count.
- Attendance purge deletes the exported IDs only.
- Duplicate field acknowledgement requires the same owner, project, timestamp and content.
- Structured audit hashing prevents ambiguous delimiter encodings.
- File method/origin/JWT/key checks and no-store delivery; no public bucket URL.
- Monitor scans every R2 page, ignores checksum timestamps and fails on alert-delivery failure.

## External setup and remaining product work

The supplied blueprint describes a multi-phase platform beyond the executable lab. Continue the remaining workflows in its dependency order and preserve its ten-artifact module acceptance standard. This integration does not claim the full business roadmap is finished.

Needed externally: provider/account access and region, Microsoft consent/mailbox/MFA settings, DNS/TLS, two backup recipients/recovery key, hosted migrations/RLS acceptance, physical mobile testing, font licence, Finance-verified rates, legal transfer/privacy decisions, accounting/payment choices, legacy document corpus and anonymised payroll shadow inputs.

The workspace has no Git repository; no commit or push was performed. No cloud deployment, production migration, external message or DNS change was made.


## Completed batch: approval lifecycle

See [batch acceptance record](batches/approval-lifecycle.md). Requesters can withdraw pending requests, including after an intermediate approval; previous decisions remain visible. Request details expose only authorised steps/events. New decision reasons are included in the hash chain, with a compatibility fallback for older step comments. No old audit event is rewritten.

History has server-side status/view/division filters, 50-row pages, per-profile saved preferences and keyboard navigation. Stuck requests are visible within business access scopes; IT receives aggregate counts only. Unsent notifications and leases are invalidated on withdrawal; mail already accepted by an external provider cannot be recalled.

The current workspace now has a Git repository. This batch preserved existing work and did not create commits or push. Original Files inputs and earlier migrations remain unchanged; two forward migrations implement this batch.

## Completed batch: document lifecycle

See [batch acceptance record](batches/document-lifecycle.md). Forward-only metadata transitions now cover draft creation, private-file attachment, review submission, release, revision and withdrawal. SQL checks ownership and division/permission scope, requires SHA-256 for release, and records every lifecycle event in the hash chain.

The synthetic document centre provides create and lifecycle controls. This batch does not upload objects to R2 or claim hosted file delivery, legacy migration, SharePoint filing or external document acceptance.
