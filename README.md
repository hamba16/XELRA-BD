# XELRA ? Dreniak

Dreniak's operations workspace, following the enhanced [blueprint](XELRA_BLUEPRINT.md) supplied in `files/`. The new source takes precedence over the original infrastructure-only brief. Original inputs are unchanged; checksums and earlier documents are preserved in [docs/source](docs/source).

## Run locally

```powershell
npm ci --ignore-scripts
npm run dev
```

Open `http://127.0.0.1:3000`. Without backend configuration, development offers a labelled sample walkthrough. It is excluded from production builds. Sample records live in memory; pending field reports use a separate IndexedDB store per profile.

For the real backend, copy `.env.example` to `.env`, supply the public Supabase connection and authenticated file Worker origin, apply migrations to the intended environment, and provision invited identities and matching `org.people` records. The app never provisions accounts automatically. Hosted sign-in, RLS and integration acceptance remain required.

## Included

- Responsive Vite/React application with the supplied Dreniak mark, division lenses, themes, command palette, request forms, approvals, projects/documents, people, helpdesk/registers, operations health and shadow bank matching.
- Microsoft/OTP entry points, tab-session authentication, draft saving, IndexedDB field notes, idempotent sync and a versioned static-shell service worker.
- Database migration covering identity, permissions, approvals, audit chain, numbering, verified-rate gate, attendance retention, client isolation, registers and notification leases behind a narrow API schema.
- Entire supplied lab: database tests, offline experiment, matching calibration, RLS benchmark, capacity simulations and palette calculations.
- Cloudflare-first releases, optional budget-limited Netlify fallback, private file delivery, independent monitoring, disabled-by-default Graph notifications, and encrypted tiered backups with read-back verification.

**This is an enhanced pre-production workspace, not completion of every business module in the blueprint.** [IMPLEMENTATION.md](docs/IMPLEMENTATION.md) records delivered behaviour, remaining module work and external acceptance gates.

## Verify

```powershell
npm test
npm run typecheck
npm run build
npm run test:browser
npm run infra:check
```

Browser tests need Playwright Chromium (`npx playwright install chromium` if absent). The migration suite runs the actual migrations on disposable PGlite with test-only Supabase role/auth shims. Docker/Supabase and hosted tests remain additional gates.

```powershell
npm run bench -w packages/lab
npm run sim -w packages/lab
npm run palette -w packages/lab
npm run sweep -w packages/lab
```

See [setup/recovery](infrastructure/RUNBOOK.md), [validation](infrastructure/VALIDATION.md) and [UI review](docs/UI_REVIEW.md). No cloud accounts, DNS, tenant permissions or production data were provisioned. Keep release/operations flags disabled until acceptance passes.
