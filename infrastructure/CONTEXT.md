# Source authority and integration decisions

The complete `files/XELRA_Blueprint.md` takes precedence. Its 12 sections, appendices, lab source, tests, simulations, workflow and images were reviewed. The ZIP exactly matches the extracted lab. The root blueprint adds an integration note and corrects the stale opening test count; original inputs remain unchanged.

Earlier blueprint/infrastructure documents are archived under `docs/source/`. `xelra-sim-kit/` remains historical evidence. The new executable lab is `packages/lab/`; only this copy receives integration changes. A SHA-256 inventory covers all 34 input files.

| Subject | Decision |
| --- | --- |
| Architecture | Vite/React static SPA, browser user token, thin API schema, private base schemas |
| Hosting | Cloudflare primary; same-build Netlify fallback optional and budget-limited |
| Existing safeguards | Keep 15-minute JWTs, invitations, default-deny grants, forward-only migrations, exact manifests and host acceptance |
| Branding | Supplied mark/enhanced PNG, red/indigo identity, ink actions, D corner, dark tints; system fallback until font licensing settled |
| Prototype | Preserve lab separately; never deploy its auth shims or blanket grants |
| Permissions | Current assignments/grants, active status/expiry, set-based list policies |
| Consent | Bound, unused Director consent required; browser grant-management helpers remain closed |
| Offline | Per-profile durable queue, server confirmation, conflicting replays rejected |
| Finance | Shadow reconciliation; no production statutory rates seeded |
| Recovery | Two public recipients; daily/weekly/monthly expiry disabled until recovery proof |
| External services | Source/configuration only; no deployments or messages sent |

The blueprint's source research, tax/legal assertions and price assumptions remain attributed source material, not new certification. Verify current provider limits, tax tables and legal wording before live use.

The lab's passing tests do not establish that its helpers can safely be exposed. The actual migration is tested separately with negative controls. See [coverage and remaining work](../docs/IMPLEMENTATION.md).
