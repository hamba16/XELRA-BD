# XELRA infrastructure foundation

Infrastructure as code for Dreniak's operations platform. There is no application UI or business-module implementation in this delivery. Nothing has been provisioned in a cloud account.

The complete supplied Master Plan, blueprint, simulation scripts, recorded results and nested IaC examples were read. Original inputs remain unchanged. See [source context](infrastructure/CONTEXT.md) for scope, contradictions and dependencies.

| Area | Implementation |
| --- | --- |
| Repository | Private GitHub repository, restricted Actions sources, vulnerability alerts; separate Terraform state |
| Data platform | Supabase project/settings, invitation-only auth, 15-minute JWTs, TOTP, local staging configuration |
| Security baseline | Default-deny object grants, private schema, forced RLS, service-only operations RPCs; no development accounts |
| Files | Private R2 documents, screenshots, archives and backups; signed-access CORS; public domains disabled |
| Hosting | Netlify site bootstrap/settings; direct-upload Cloudflare Pages standby; custom-domain registration, manual DNS |
| Releases | Release tags from main; checks; one static build; shared CSP/headers; standby first; six-attempt monthly primary deploy cap |
| Release acceptance | Exact SHA-256 file inventory; rejects extra/missing/changed files; deployed revision, content, security-header, immutable-asset and 404 probes |
| Migration history | CI compares migrations to the trusted Git baseline and rejects edits, deletion, renaming, duplicate timestamps and backdated additions |
| Recovery | Nightly consistent database dump, age encryption, upload/read-back checksum; monthly disposable-local restore workflow |
| Operations | Hourly keepalive and stale-job checks, database/R2 meters, operator-entered hosting credits; 70% warning / 85% critical |

Start with [the setup and recovery runbook](infrastructure/RUNBOOK.md). Provider tokens, account IDs, state credentials and the recovery key are deliberately absent.

Local checks:

```powershell
npm ci --ignore-scripts
npm test
npm run infra:check
terraform -chdir=infrastructure/terraform init -backend=false -input=false
terraform -chdir=infrastructure/terraform validate
terraform -chdir=infrastructure/github init -backend=false -input=false
terraform -chdir=infrastructure/github validate
```

With Docker and Supabase CLI **2.109.1** installed, `supabase start` applies the migrations to local staging. Set `TEST_DATABASE_URL` to `postgresql://postgres:postgres@127.0.0.1:54322/postgres` and run `python tests/run-database.py`. Run `supabase db lint --local --level warning --fail-on warning` afterwards. Never use `--bootstrap` against Supabase: it is only for empty, disposable vanilla PostgreSQL clusters.

Do not enable `APP_RELEASE_ENABLED` yet: the application and its `npm run build` script intentionally do not exist. The release job fails if they are absent. Keep `INFRA_OPERATIONS_ENABLED=false` until the hosted project, migrations, credentials and initial backup are in place.

Validation performed on 26 November 2026 is recorded in [VALIDATION.md](infrastructure/VALIDATION.md). Local validation is not evidence of cloud provisioning, hosted RLS, successful GitHub jobs, encrypted R2 recovery, DNS/TLS readiness or a working application.
