# XELRA Agent Guide

## Project purpose

XELRA is Dreniak's pre-production operations workspace. It is a static Vite/React SPA backed by Supabase/Postgres, RLS-protected API functions/views, and an authenticated Cloudflare Worker for private file delivery and operations jobs.

Treat the supplied enhanced blueprint as the product authority:

- `files/XELRA_Blueprint.md` is the complete source authority.
- `XELRA_BLUEPRINT.md` is the integrated workspace edition.
- `docs/IMPLEMENTATION.md` defines implemented behaviour and remaining acceptance boundaries.
- `docs/UI_REVIEW.md` records the current UI evidence and known verification gaps.
- `infrastructure/CONTEXT.md`, `infrastructure/RUNBOOK.md`, and `infrastructure/VALIDATION.md` define infrastructure and operations constraints.

This repository is not feature-complete. Do not present local simulations or passing prototype tests as production certification.

## Working rules

- Preserve existing behaviour and current work. Before editing, inspect `git status` and the relevant files; the worktree may contain unrelated in-progress changes.
- Prefer surgical changes. Do not rewrite migrations, generated build output, lockfiles, archived source, or unrelated documentation.
- Keep the code's existing style unless a focused change requires a local deviation.
- Use strict TypeScript and preserve explicit types. There is no backend function in the browser that should replace the database RLS or security model.
- Do not add service keys, credentials, real identities, tax assumptions, or provider secrets to source, build variables, test fixtures, screenshots, logs, commits, or VITE variables.
- Do not fabricate completion, external acceptance, provider entitlements, DNS/TLS readiness, tax/legal conclusions, or live deployment state.
- Publication and infrastructure actions are gated. A code change is not a deployment, migration, DNS change, release, or backup acceptance.
- Respect forward-only SQL history. Existing migration content and names are immutable.
- Keep the development profile switcher synthetic and development-only. It must never sign in to Supabase, impersonate real identities, access live data, or reach production builds.

## Repository map

- `apps/web/src/main.tsx`: application shell, authentication state, navigation, command palette, theming, queues, and page composition.
- `apps/web/src/data.ts`: Supabase client, public backend interface, snapshot types, RPC calls, live table reads, and private file download.
- `apps/web/src/RequestWorkspace.tsx`: request list/detail, approval decisions, withdrawal, filters, pagination, keyboard navigation, and approval health.
- `apps/web/src/style.css`: application-specific responsive styling.
- `apps/web/src/dev/preview.ts` and `apps/web/src/dev/profiles.ts`: synthetic local/backend preview only.
- `apps/web/src/queue.ts`: per-profile IndexedDB field-report store.
- `packages/lab/`: integrated executable lab: reusable UI, offline queue, reconciliation, branding, worker helpers, benchmarks and simulations.
- `supabase/migrations/`: ordered PostgreSQL migrations. Base schema, operations, enhanced spine, and approval lifecycle all live here.
- `supabase/tests/`: Supabase database policy tests.
- `workers/edge/`: Cloudflare file proxy and notification/operations Worker code.
- `tests/`: Node, Python, PGlite, browser, release, header, migration-history and worker tests.
- `tests/browser/workspace.spec.ts`: primary Playwright UX and accessibility smoke coverage.
- `infrastructure/terraform/`: application/provider infrastructure.
- `infrastructure/github/`: repository infrastructure.
- `infrastructure/scripts/`: validation, build, release, migration, backup-meter, recovery and integration scripts.
- `.github/workflows/`: CI, release, operations, backup and restore-drill workflows.
- `xelra-sim-kit/`: historical Monte Carlo/evidence kit; do not treat it as the active lab.

Generated or runtime-only areas include `node_modules/`, `out/`, `test-results/`, `.validation/`, `.tools/`, and `.terraform/`. Do not edit them as source.

## Toolchain

- Node 22; package engines require Node >=22 and <25.
- npm workspaces; root package plus `packages/lab`.
- React 19, strict TypeScript 7, Vite 8.
- Supabase CLI 2.109.1 and PostgreSQL 17 conventions.
- Python 3.11+ for infrastructure and migration tests.
- Terraform 1.14.0.
- Playwright Chromium and axe-core.

Install from the lockfile with `npm ci --ignore-scripts` unless a dependency-manifest change intentionally requires a different package-manager action.

## Local commands

```powershell
npm run dev
npm run typecheck
npm run build
npm test
npm run test:browser
npm run infra:check
npm run infra:headers
```

Targeted lab commands:

```powershell
npm test -w packages/lab
npm run bench -w packages/lab
npm run sim -w packages/lab
npm run palette -w packages/lab
npm run sweep -w packages/lab
```

Browser tests start a synthetic profile server on port 3001. If Chromium is missing, install it with `npx playwright install chromium`.

Database tests run disposable PGlite/Postgres shims and actual migration files. CI also starts Supabase locally. Do not run reset or destructive database commands against hosted production.

## Frontend and UX conventions

- Prefer existing components and tokens in `packages/lab/src/ui/` and `apps/web/src/style.css`.
- Keep division colour semantically separate from action state: Engineering is red, Asset Management is indigo, buttons use ink actions, and status text/icon is not communicated by colour alone.
- Preserve light/dark combined-lens contrast and narrow-viewport behaviour.
- Keep meaningful states explicit: loading, empty, error, offline, pending, approved, rejected, withdrawn, and/or unavailable.
- Drafts and form values must survive navigation and expected close/reopen flows.
- Offline field data is scoped by profile. It must not leak across identities or silently lose conflict information.
- Preserve keyboard command navigation, focus targets, accessible names, labels, dialogs, and table regions.
- Page routes are static known SPA paths. Unknown paths must retain the application's genuine 404 behaviour; do not add SSR or server route middleware.
- Public build code must not contain development profile switchers or synthetic/live auth mixing.

For UI changes, run the smallest relevant Playwright test first, then the browser suite when the change affects global layout or accessibility. Add axe assertions or viewport checks only for behavior that can actually regress.

## Backend, SQL and migrations

- Supabase runtime schema exposure is deliberately narrow. Prefer `api` RPC wrappers/views over broad base-schema access.
- Use set-based RLS/policy logic. Avoid per-row or expensive function patterns when a set-based equivalent is valid.
- Permissions must reflect current active people, assignments, divisions, expiry, delegation and grant state.
- Writes must be transactional and idempotent where required. Preserve row locks and terminal-state checks for approval lifecycle operations.
- Keep audit events append-only and hash-chained. Never rewrite or backfill an old event solely to hide or replace its recorded reason.
- New decision/rejection reasons belong in the structured audit detail and must remain bounded.
- Keep notification delivery link-only unless an approved module introduces otherwise. Preserve quiet-time and lease behavior.
- Private file access must remain method-, origin-, JWT-, key-, and authorization-checked. Do not expose R2/Supabase object URLs.
- Forward-only migrations: add a uniquely timestamped later migration; never edit, rename, reorder, or delete an existing migration.
- Seeded roles/reference divisions are separate from real people, projects, consent, statutory rates, grants, and payment confirmations.

When changing SQL behavior, extend PGlite approval/spine tests or add a focused migration test that covers both an allowed and denied principal. Run:

```powershell
npm test
python tests/run-database.py
supabase db lint --local --level warning --fail-on warning
```

The `supabase/tests` suite requires local Docker/Supabase and is not a hosted health check.

## Workers and infrastructure

- `workers/edge/wrangler.toml` owns Worker bindings/configuration. Add secrets only through the intended environment or protected CI configuration.
- File delivery checks the caller token and RPC authorization; it must not become a public bucket proxy.
- Operations scripts must fail closed on missing or stale readings, alert delivery failure, invalid host state, and unverified backup evidence.
- Static release files require exact CSP/headers, immutable fingerprinted assets, revalidation for HTML, no-store release identity, and genuine custom 404 behavior.
- Cloudflare is primary; Netlify is a static-only budget-limited fallback. Keep fallback enablement and infrastructure flags disabled until acceptance.
- Terraform plans and provider applies require explicit reviewed credentials and saved plans. Never silently apply Terraform or change DNS.
- Backup plaintext belongs only on ephemeral runner storage and must be removed; upload ciphertext/checksum and verify read-back. Never publish dumps or secrets.

Relevant checks:

```powershell
python infrastructure/scripts/check.py
terraform -chdir=infrastructure/terraform fmt -check
terraform -chdir=infrastructure/terraform init -backend=false -input=false -lockfile=readonly
terraform -chdir=infrastructure/terraform validate
terraform -chdir=infrastructure/github fmt -check
terraform -chdir=infrastructure/github init -backend=false -input=false -lockfile=readonly
terraform -chdir=infrastructure/github validate
```

## Testing and verification

For every code change:

1. Identify the smallest relevant test/command.
2. Run typecheck or the focused test.
3. Add a focused regression test for new behavior or a bug fix.
4. Run the relevant broader suite.
5. Inspect the final diff and status for accidental secret/build/archive changes.

Minimum default validation for application changes:

```powershell
npm run typecheck
npm test
npm run build
npm run test:browser
npm run infra:check
```

Use documentation-only changes when appropriate: no test runner is required unless documentation tests exist.

For SQL/migration changes, run actual PGlite migration tests and local Supabase lint. For infrastructure changes, run Terraform format/init/validate and shell syntax checks. For static release changes, run the release-manifest and host-verification tests without deploying or changing DNS.

Do not weaken tests, replace failures with warnings, skip denied cases, or make an integration success look like production acceptance.
