# Setup, release and recovery

## Toolchain and state

Use Terraform 1.14.0, Supabase CLI 2.109.1, Node 22, Python 3.11+, Docker for local Supabase, and a PostgreSQL client matching the hosted major version (17 in the supplied config/workflows). Provider versions and checksums are locked. Do not upgrade the CLI to v3 without reviewing commands and configuration. No provider pricing assumption in the simulation is a live quote.

Cloudflare R2 stores Terraform state in a separate private bucket. It is not part of the tiered backup retention policy. Set `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, and optionally `TF_STATE_BUCKET`, then review `node infrastructure/scripts/bootstrap-state.mjs`; append `--apply` when provisioning. This handles the state-backend bootstrap dependency; do not put the state bucket under the application stack's destroy lifecycle. Use a new bucket with no public custom domains or lifecycle expiry.

Create separate bucket-scoped R2 state access keys. Export them as `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` for Terraform's S3 backend. Copy/edit `infrastructure/terraform/backend.hcl.example` outside tracked source; use different keys for `xelra/production.tfstate` and `xelra/github.tfstate`. The backend uses conditional lock files; prove concurrent lock exclusion against the chosen bucket before the first apply. Never disable locking to work around an error. Keep an encrypted offline state copy after approved changes: R2 is not a versioned-state recovery system. Terraform state and saved plans contain passwords even when outputs are marked sensitive.

## Provision in dependency order

1. Supply the VAIS account/organisation IDs and chosen region. Confirm cloud entitlements and funding. Terraform creates one XELRA Supabase project; it does not create a hosted staging project or touch the marketing site's project.
2. Optionally create the dedicated private repository with `infrastructure/github`. Set `GITHUB_TOKEN` and `TF_VAR_github_owner`, initialise its backend using the separate GitHub state key, plan, review and apply. Import an existing repository instead of trying to recreate it. This root does not push local files or initialise Git automatically.
3. Set `NETLIFY_TOKEN`, `NETLIFY_ACCOUNT_SLUG`, `NETLIFY_SITE_NAME`. Run `node infrastructure/scripts/bootstrap-netlify.mjs` to inspect the create/no-op result; append `--apply` to create the empty site. Capture the returned site ID. The official provider configures existing sites and cannot create one. No Git auto-deployment connection is attached.
4. Copy `production.tfvars.example` to ignored `production.tfvars` and replace every placeholder. Export `SUPABASE_ACCESS_TOKEN`, `CLOUDFLARE_API_TOKEN`, `NETLIFY_TOKEN` and `TF_VAR_database_password`. Account management tokens never become build variables.
5. Run `terraform -chdir=infrastructure/terraform init -backend-config=PATH_TO_BACKEND_FILE`, then `terraform -chdir=infrastructure/terraform plan -var-file=production.tfvars -out=production.tfplan`. Review the exact resource changes. Apply that saved plan with `terraform -chdir=infrastructure/terraform apply production.tfplan`. Do not use destroy; deletion protection exists on the project and data buckets.
6. Verify the hosted PostgreSQL major version. Align local config and backup/restore client versions before proceeding. Review `supabase link --help` and `supabase db push --help`; link only the Terraform-created project, run `supabase db push --linked --dry-run`, review all migrations (including the enhanced spine, approval lifecycle and decision evidence), then apply with `supabase db push --linked`. Never run a database reset against hosted production.
7. Verify hosted grants and anonymous/authenticated denials; run `supabase db advisors --help` and the supported advisor command. The rollback-only SQL tests in `supabase/tests` are for disposable staging, not live health checks: they briefly modify telemetry and create probe objects.
8. Configure DNS manually: the `xelra.dreniak.com` CNAME initially points to the Cloudflare Pages project, TTL 300 where supported. Complete Netlify TLS and Cloudflare Pages custom-domain validation. Do not call standby ready until a real cutover/rollback drill proves TLS, redirects, CORS and cache behaviour. No DNS record is changed by Terraform.

Both Terraform roots can be validated with `init -backend=false` without account credentials. That is not a provider plan or apply. Resource secrets are not emitted as outputs.

## GitHub configuration

Push the source to the dedicated repository. Protect main and release tags, require foundation-ci, disallow bypass/force pushes, and restrict infrastructure/production/recovery environment deployment branches. Environment reviewers and private-repository branch protection depend on the account plan: verify availability, do not assume a YAML `environment` creates an approval gate. Use manual release/provisioning custody until equivalent controls are in place. Set default workflow token permissions to read-only and configure failed-workflow notifications for the operational owner.

Create `production`, `operations` and `recovery` environments. Secrets are consumed only from trusted main/release jobs; pull-request CI has no cloud credentials. Most writes are not enabled at all until the flags below change. The entire repository must be reviewed before trusting any workflow with credentials.

| Location | Values |
| --- | --- |
| Repository variables | `INFRA_OPERATIONS_ENABLED=false`, `APP_RELEASE_ENABLED=false`, `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `R2_ENDPOINT`, `FILES_ORIGIN`, `APP_URL` (HTTPS origin, no trailing slash) |
| Production variables | `NETLIFY_SITE_ID`, `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_PROJECT`, `FALLBACK_URL` (Netlify HTTPS origin), `NETLIFY_FALLBACK_ENABLED=false`, `APP_URL` |
| Production secrets | `NETLIFY_TOKEN`, narrowly scoped `CLOUDFLARE_PAGES_TOKEN` |
| Operations variables | `SUPABASE_URL`, `APP_URL`, `AGE_PUBLIC_KEYS`, `R2_ENDPOINT`, `R2_BACKUP_BUCKET`, comma-separated `R2_BUCKETS` (all four data buckets), `DATABASE_CAPACITY_BYTES`, `R2_CAPACITY_BYTES`, `HOSTING_CAPACITY_CREDITS` |
| Operations secrets | `BACKUP_DATABASE_URL`, `SUPABASE_SECRET_KEY`, `R2_BACKUP_ACCESS_KEY_ID`, `R2_BACKUP_SECRET_ACCESS_KEY`, `R2_METER_ACCESS_KEY_ID`, `R2_METER_SECRET_ACCESS_KEY` |
| Recovery variables | `SUPABASE_URL`, `R2_ENDPOINT`, `R2_BACKUP_BUCKET` |
| Recovery secrets | `AGE_SECRET_KEY`, `SUPABASE_SECRET_KEY`, read-only `R2_RESTORE_ACCESS_KEY_ID`, `R2_RESTORE_SECRET_ACCESS_KEY` |

Use an `sb_secret_...` Supabase server key for operations; the code sends it in `apikey`, not as a JWT bearer token. It is privileged: separate it from publishable keys, restrict custody and rotate it after incidents. Application IT-admin users never receive it. R2 state, file signing, backup upload, backup restore and metrics use separate scoped keys. R2's coarse Object Read & Write permission can include deletion: the backup script never deletes, but that is not an IAM guarantee. Retention and credential custody are separate controls.

Use a direct or session-pooler PostgreSQL connection with TLS for `BACKUP_DATABASE_URL`; never transaction pooling. A complete dump must have the necessary read/BYPASSRLS rights. Test the backup account's coverage without publishing its URL. The backup client must not be older than the server.

Capacities must reflect the actual provider plan, not assumed free-tier numbers. R2 usage counts all four buckets, including backups/archives; state storage adds separately to account usage. Hosting credits are entered from Netlify billing through the capacity-meters workflow's `hosting_credits_used` input. No undocumented billing API is guessed. Readings become stale after 30 hours; missing/stale readings fail monitoring. Automate billing collection later only against a verified API. The IT profile has a read-only health panel. Cloudflare monitoring has a separately configured alert webhook; Graph notifications remain disabled until tenant consent and mailbox scope are verified.

## Backup and recovery acceptance

Generate two age identities outside the repository, one held by a Director and one by the recovery custodian. Store both public recipients as comma-separated AGE_PUBLIC_KEYS in operations. Store only the recovery identity in the protected recovery environment and offline custody. The normal backup job cannot decrypt. Enable operations only after migrations and secrets exist, then run nightly-backup manually. It uses a consistent pg_dump snapshot, encrypts locally, uploads ciphertext/checksum, downloads the ciphertext and verifies it before recording success. Temporary plaintext exists only on the ephemeral runner and is removed on exit. Never upload dumps or logs containing rows as GitHub artifacts.

Run monthly-restore-drill immediately, not only on its monthly schedule. It restores into an ephemeral local Supabase stack, refuses non-loopback database URLs, disables cron job execution, verifies decryption/checksum, restores with stop-on-error and checks the actual foundation access rules. A failed restore cannot write a success heartbeat. Hosted dumps include provider-managed schemas/extensions: version differences, ownership, custom database roles or incompatible extensions can make a full restore fail. Resolve that against a disposable matching stack and retain evidence before accepting recovery. Do not downgrade failures to warnings or filter errors to make the job green.

The dump excludes the transient pg_net HTTP request/response transport tables to prevent replaying outbound calls during restore. Durable business outbox records remain included. It does not include R2/Supabase Storage object bytes, provider account settings, Edge Function source/secrets, database login passwords or DNS. R2 holds the primary document objects; archives are retained without automatic expiry. Provider settings/source are in IaC; keys require a separate recovery inventory. Future custom Postgres roles must be recreated from migrations before restore. Add object recovery tests before document ingestion, and business invariants/data-count checks as each module lands. A passing foundation SQL test does not prove every future module is recoverable.

After the first verified encrypted restore, set `backup_retention_enabled=true` through a reviewed Terraform plan to enable daily expiry after 7 days under `db/`, weekly expiry after 28 days under `weekly/`, and monthly expiry after 366 days under `monthly/`. Business documents, permanent audit archives and screenshots have no age-based expiry. Login purge, audit archive pruning and screenshot deletion must be introduced with their module-specific proof/approval rules.

Targets remain one working day of recoverable loss and one working day to recover; GitHub scheduled jobs can be delayed or disabled and are not an SLA. Backup older than 30 hours, keepalive older than three days or restore proof older than 35 days fails health checks. Prove actual RPO/RTO with live drills. A failed keepalive cannot guarantee an inactive free project stays running.

## Static release and failover

The static Vite app and locked build script now exist. Do not add API routes, SSR middleware or service credentials to Netlify. The authenticated file, monitoring and notification Worker lives in `workers/edge/`. Keep AI context, payments and other outbound integrations disabled until their own acceptance gates pass.

Set `APP_RELEASE_ENABLED=true` only after the production bundle is reviewed. A `release-*` tag must be reachable from main. CI tests first; a secret-free job builds once and generates CSP and a `release-manifest.json` outside the published directory. It records the commit SHA and every file's path, length and SHA-256. Deployment verifies the complete inventory, publishes Cloudflare primary and probes it, then rechecks the local inventory. When NETLIFY_FALLBACK_ENABLED is true, it checks the six-attempt monthly fallback budget, uploads the identical bundle and probes the Netlify fallback. Repository concurrency serialises this workflow; direct dashboard/API deployments outside it can race the budget and must be restricted operationally. A failed primary deploy or acceptance check can leave primary/standby in different states: compare their deployed content before any cutover. Acceptance failure does not automatically undo a deployment.

The host probe checks four paths: release.txt, root HTML, one fingerprinted Next static JS/CSS asset and a deliberately missing URL. It requires exact expected bytes, the generated security headers, immutable asset caching and a genuine custom 404; redirects fail rather than being followed. These are deployment acceptance samples, not complete remote-file verification, authenticated browser tests or failover certification. Host-side HTML/script transformations must be disabled because they break the shared-bundle contract. Each request has a 30-second timeout and reads no more bytes than its expected file size.

For a manual read-only check of an already prepared artifact, run `node infrastructure/scripts/release-manifest.mjs verify out release-manifest.json COMMIT_SHA`, then `node infrastructure/scripts/verify-host.mjs https://HOST out release-manifest.json COMMIT_SHA`. Neither command deploys or changes DNS. Keep the manifest outside `out`; it is an integrity record, not a cryptographic signature or a substitute for trusted build custody.

Headers are shared in `_headers`; no wildcard script hosts, unsafe-eval or inline event handlers. Inline styles remain allowed for React compatibility. CSP generation fails if the shared header exceeds the standby platform limit; externalise scripts or implement a tested route-specific policy before increasing application complexity. HTML and exported directory routes require revalidation, release.txt is no-store, and fingerprinted Vite assets are immutable. There is no global cache directive that conflicts with asset caching. Generation also enforces the standby's 100-rule ceiling. Missing configuration never silently falls back to example domains. The marker scan is defence in depth, not complete secret detection.

Failover: inspect primary outage and both release.txt values; confirm standby's custom hostname/TLS is active; change only the manual CNAME target from Pages to the accepted Netlify fallback hostname; verify login/MFA, scoped reads, signed file access, caching and the release identity using `xelra.dreniak.com`. Keep the same Supabase backend. To roll back DNS, restore the recorded primary CNAME and repeat checks. A browser already open on the app may require refresh. If TLS/domain readiness is unproven, the standby is not accepted regardless of a successful pages.dev deployment.

Release rollback uses a known-good artifact through the same checks; never rebuild an old tag with floating dependencies. Forward-only migrations require a compatible frontend rollback or a forward fix, not destructive SQL reversal. No automatic infrastructure apply or DNS failover runs from a pull request.

## Forward-only migration gate

Blueprint section 3.1 requires forward-only history. On pull requests CI compares the checked-out merge result with the event's base commit; on main pushes it compares with the pre-push commit. It fetches complete history and rejects missing/invalid baselines. Existing migration content and names cannot change, including deletions and renames; new timestamps must be unique, valid calendar timestamps and later than the baseline's latest migration. CRLF/LF differences alone are normalised. The first push's all-zero Git event baseline admits the initial migration set while still checking its names and timestamps.

Use `python infrastructure/scripts/migration-history.py --base FULL_BASE_COMMIT_SHA` in an established repository. This workspace has not been initialised as a Git repository, so local validation uses disposable Git repositories. Branch protection must require this CI status: the gate cannot protect itself from an authorised change to its own source/workflow. The check protects repository history, not evidence of which migrations were applied to a hosted database. The release workflow relies on main's checks; it does not pretend a tag's empty push baseline proves deployed migration history.

These supplements enforce blueprint sections 2.3/2.5 (static trust boundary, CSP and identical standby) and 3.1 (forward-only migrations). Approvals and attendance retention primitives now exist; business-module completion and live retention acceptance are tracked in docs/IMPLEMENTATION.md.

## Microsoft 365 and external services

Phase 0 requires the tenant owner to approve a single-tenant app registration and the `https://PROJECT_REF.supabase.co/auth/v1/callback` redirect. Configure Azure OAuth in Supabase only after that approval; do not use the common/multi-tenant endpoint by default. Microsoft Graph mail must be scoped to the authorised `xelra@dreniak.com` mailbox and permissions reviewed. A Graph notification sender is distinct from Supabase Auth's SMTP/send-email hook; the latter must be configured and tested before invitations are accepted. No registration request or email was sent in this task.

No payment provider, bank feed, AI context provider, error-monitoring vendor, legal consent, payroll rate or business role grant is fabricated. Their integrations and data-handling controls belong to later modules, with explicit deployment acceptance.

## References checked

- [Supabase Terraform](https://supabase.com/docs/guides/deployment/terraform), [CLI configuration](https://supabase.com/docs/guides/local-development/cli/config), [backup/restore](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore), [changelog](https://supabase.com/changelog.md).
- [Netlify API](https://docs.netlify.com/api-and-cli-guides/api-guides/get-started-with-api/) and the pinned provider's generated resource documentation.
- [Cloudflare R2 remote backend](https://developers.cloudflare.com/terraform/advanced-topics/remote-backend/) and [S3 compatibility](https://developers.cloudflare.com/r2/api/s3/api/).
- [Cloudflare Pages header merging and limits](https://developers.cloudflare.com/pages/configuration/headers/) and [GitHub event contexts](https://docs.github.com/en/actions/reference/workflows-and-actions/contexts) were checked for the supplemental gates.

Local provider schema validation does not validate hosted JSON auth settings, account entitlements or external API behaviour. Those are part of the first provisioning acceptance run.


## Enhanced app and Worker setup

1. Run `npm ci --ignore-scripts`, `npm test`, `npm run typecheck`, `npm run build`, and `npm run test:browser`. Serve development on port 3000. The sample walkthrough only exists in development with no configured Supabase connection.
2. Set the public `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_FILES_ORIGIN` and `VITE_APP_ORIGIN`. Files origin is the authenticated Worker, not the S3 endpoint. Never put a service key in VITE variables.
3. Apply all migrations to disposable Supabase first. Expose only `api`, with 50-row API limits. Existing public operations functions are reached through service-only API wrappers. Run the native Supabase linter/advisors and role tests before hosted migration.
4. Invite real users through authorised Supabase administration, then create matching `org.people.id` records and reviewed RBAC assignments. Roles/reference divisions are seeded; people, projects, payment confirmations, consent documents and statutory rates are not. Do not use synthetic lab fixtures in production. Administrative write screens for these remain module work.
5. Configure Azure sign-in for the approved tenant and redirect to `/auth/callback/`. Keep signup disabled. Configure mail delivery/OTP templates and verify Entra MFA; the frontend alone cannot establish those controls.
6. Deploy `workers/edge/wrangler.toml` only to the intended Cloudflare account after adding its approved custom domain. The existing R2 buckets bind as DOCS and BACKUPS. Keep the marketing-site DNS and M365 records unchanged.
7. Worker variables: APP_ORIGIN, SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY. Secrets: SUPABASE_SECRET_KEY, ALERT_WEBHOOK, ALERT_SECRET. Monitoring calls service-only operations RPCs; the file route always forwards the caller's token.
8. For notification delivery supply TENANT_ID, CLIENT_ID, CLIENT_SECRET, MAILBOX and set MAIL_ENABLED=true only after Exchange application access is restricted to the approved mailbox. The five-minute schedule claims leased work, honours 12:30?13:00 recipient quiet time, sends a link only, and retries failures. The monitor runs separately every twelve hours. No Worker was deployed during local integration.
9. Verify an end-to-end hosted request/approval, external client denial/allow, permitted and denied file fetch, notification failure/retry, backup alert, real encrypted restore, and production-bundle absence of development fixtures before enabling releases.

### Isolated Vercel Preview walkthrough

- Keep the Vercel `Production` environment on `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`. In the Vercel `Preview` environment, configure only `VITE_PREVIEW_SUPABASE_URL` and `VITE_PREVIEW_SUPABASE_PUBLISHABLE_KEY` for a separate, disposable Supabase project. Preview builds do not fall back to production variables; without the preview pair, normal sign-in remains unavailable.
- Apply the migrations to that separate project and use synthetic accounts/data only. Never copy production data, real identities, or service-role keys there. The publishable key is public; do not put any service key in a `VITE_` variable.
- Scope `VITE_DEV_LOGIN=true` and a synthetic-only `VITE_DEV_PROFILES` JSON array to `Preview`. The preview login page remains the default; triple-clicking “Authorised access only.” reveals the in-memory walkthrough. That path does not authenticate with Supabase or read/write backend records. Enable Vercel Deployment Protection for Preview deployments; the triple-click is a UI affordance, not access control.
- `VERCEL_ENV` is used as the build-time environment gate. The production build check rejects the switcher and its synthetic markers; preview builds are the only deployed build allowed to include them.
- Configure and verify these Vercel environment scopes in the dashboard before relying on Preview sign-in. This repository change does not provision a Supabase project, change Vercel settings, or deploy anything.

The legacy Terraform resource address/name `cloudflare_pages_project.standby` is intentionally retained to avoid replacing a previously created project. Its operational role is now primary; `primary_hostname` is the new descriptive output. Netlify retains a custom-domain registration for potential failover, but DNS normally points to Pages. Registration alone does not prove fallback TLS readiness.

The full roadmap and unimplemented business workflows are listed explicitly in `docs/IMPLEMENTATION.md`. No source or local test should be reported as hosted execution.

Current documentation consulted for implementation: Supabase custom schemas, Azure sign-in and sessions; Vite getting started; Cloudflare Pages serving routes; Microsoft Graph sendMail. Recheck entitlements and configuration at provisioning.


## Approval lifecycle batch

Apply `20261126121521_approval_lifecycle.sql` before `20261126122932_approval_decision_evidence.sql`, after the existing spine. The UI uses `api.request_page`, `api.request_detail`, `api.withdraw_request` and `api.approval_attention`; deploy migrations before the updated frontend. None accepts a caller-supplied person identifier as authority.

To verify on a machine with native PostgreSQL tools, run `python tests/approval-race.py`. It creates its own disposable loopback cluster on a free port, applies all migrations, proves both terminal-action race orderings and stops that cluster. It does not accept an existing database URL. Normal `npm test` runs the policy regression suites sequentially to keep WebAssembly memory bounded. Browser checks run separately with `npm run test:browser`.

New reasons are captured in audit events. Older events are preserved and use their existing step comments as a compatibility fallback. Withdrawal cancels undelivered queued reminders; an in-flight external message may already have been accepted, but it contains only the inbox link.
