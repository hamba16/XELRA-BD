# Foundation validation — 26 November 2026

## Passed locally

| Check | Evidence |
| --- | --- |
| Terraform 1.14.0 formatting and validation | Both `infrastructure/terraform` and `infrastructure/github` pass without warnings |
| Provider selection | Supabase 1.11.1, Cloudflare 5.29.0, Netlify 0.4.4, GitHub 6.13.0; lockfiles include verified Windows/Linux amd64 package checksums |
| Static bundle controls | Five Node tests pass: exact inline-script hashing, parsed HTML/comments, unsafe-handler/remote-script rejection, missing/placeholder origins, development/secret/JWT markers, header-limit failure |
| Configuration | Supabase and Netlify TOML parse; invitation-only signup, anonymous-login denial, TOTP, token duration and seed restrictions checked |
| Workflows | All six root workflows pass actionlint 1.7.12 and YAML parsing; third-party Actions are pinned to resolved commit IDs |
| Script syntax | All infrastructure JavaScript parses, Python compiles, and each Bash script passes `bash -n` |
| Actual migrations | All three migrations applied successfully to an isolated native PostgreSQL 18 instance |
| Database security | Both SQL suites pass: anon/authenticated denial, service-role positive controls, forced RLS, stale health, invalid kinds/values, measured database size and safe future-object defaults |
| Database round trip | Custom archive dumped and restored with stop-on-error; heartbeat/meter sentinel values and timestamps match exactly; both SQL suites pass again against restored database |

The native database tests used test-only Supabase role stand-ins, including service-role BYPASSRLS and legacy permissive defaults. They tested the delivered migrations, not the separate simulation schema. Test fixtures were confined to a temporary local cluster, which was stopped after validation. The dump/restore was plaintext on this isolated local test data; it was not an encrypted cloud-backup test. Automatic approval review blocked deletion of the temporary files, so the stopped cluster and test dump remain under the ignored `.validation` directory.

## Not executed or proven

- Docker was unavailable (`docker_engine` named pipe missing). Local Supabase/PostgreSQL 17 startup, Supabase database lint/advisors and the complete GitHub database job were not run. CI is configured to execute these checks and fail on lint warnings.
- No Terraform account-backed plan/apply, repository creation, Netlify bootstrap, R2 state bootstrap, cloud schema migration, DNS change or deployment ran.
- No state-lock contention test, account entitlement check, hosted auth-settings read-back, Azure registration or SMTP/Graph test ran.
- No nightly age-encrypted R2 upload/read-back or full provider-schema restore drill ran. Their workflows are code awaiting configured credentials and live acceptance. Local PostgreSQL evidence cannot establish hosted recovery compatibility.
- No application exists yet, so there is no browser, production bundle, real role/MFA test, signed-file test or production/standby TLS failover proof.
- Historical simulation results were read, not relabelled as new validation results. They do not certify the delivered foundation.

Production operations and app releases are initially disabled. Backup expiry is disabled until a verified encrypted restore. Required setup, credential boundaries, manual hosting-credit measurements and acceptance steps are in RUNBOOK.md.

## Supplemental validation — same day

The blueprint was reviewed again and three infrastructure additions implemented: forward-only Git migration checks, exact release manifests, and deployed-host acceptance probes. The host work also corrected overlapping global/immutable cache directives in the shared header generator.

- `npm test`: **11 Node tests and 5 Python tests pass**. Tests cover unexpected/missing/changed bundle files, unsafe manifest paths, wrong revision/server output, missing CSP, redirects, stale content, oversized bodies, conflicting asset caching and soft 404s. Disposable Git histories exercise edited/deleted/renamed migrations, backdated additions, duplicate/invalid timestamps, missing baselines and valid append-only changes.
- All six workflow files pass actionlint after the gates were connected. `npm run infra:check` passes.
- Host checks were tested with injected HTTP responses, not live providers. Their production execution remains gated on a real application release. No network probe, deployment, database change, Terraform apply or DNS change was made by this supplement.
- Database migrations and Terraform resource definitions were not changed; the earlier local results retain their stated limits. There is still no repository history here against which to run the new guard outside the disposable fixtures.
