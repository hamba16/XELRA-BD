# Enhanced integration validation ? 26 November 2026

Original infrastructure validation is archived in `docs/source/VALIDATION.infrastructure.previous.md`. This record concerns the enhanced workspace.

| Check | Result |
| --- | --- |
| Input preservation | 34 source files inventoried with SHA-256; archive and extracted lab byte-identical; original inputs unchanged |
| Supplied lab | 61/61 database tests; 8 cron, 5 quiet-time, 4 dev-token and 5 command checks pass |
| Offline experiment | 1,000 sessions, 8,640 reports, 10,536 flush calls, 1,247 restarts; zero simulated loss/duplication |
| Reconciliation | Supplied three repeat-amount scenarios pass; calibration sweep rerun; remains shadow-only |
| Actual migration | Disposable PGlite applies all four migrations; scope, client publication/payment gate, suspended approver, negative amounts, private functions/pay, conflicting replay, audit and RLS checks pass |
| Worker | File origin/method/token/key checks; backup pagination; delivery failure; notification quiet-time/retry tests pass |
| Existing infrastructure tests | Manifest, host acceptance, headers and five migration-history tests pass |
| Types/build | App and lab TypeScript pass; production Vite build succeeds; 135,750 bytes gzip JS (about 136 KB, including the configured Supabase client), below 250 KB; no dev marker/fixtures in bundle |
| Browser | Three Chromium flows pass, including separate synthetic profile login, approval/request/draft/lens/command/offline-sync, plus 375/320 px mobile dark layout; no serious/critical axe findings in checked contexts |
| RLS benchmark | 200,000 rows, 66,666 visible: per-row 18,117 ms; correlated 17,477 ms; set-based 174 ms (best of three); about 104x/101x faster in this run |
| Models | Both capacity scripts, palette calculation and matcher sweep executed; assumptions remain illustrative |
| IaC/workflows | Terraform configuration validation and actionlint; no provider plan/apply |

The migration tests use test-only roles/auth helpers on a disposable PostgreSQL-compatible engine. Docker is unavailable on this host, so native Supabase local startup/lint/advisors and hosted Auth/PostgREST checks were not run. This is not proof of live Supabase RLS, provider provisioning or tenant identity configuration.

No cloud deployment, DNS change, live mail, real file-store access, backup encryption/restore, payroll computation on real data or production workload test was performed. Physical mobile eviction, assistive-technology output and measured mobile Core Web Vitals remain unverified. Keep release/operations/mail gates disabled pending runbook acceptance.

Local outputs and screenshots are under `.validation/`. All simulation results refer to synthetic inputs. The implementation boundary and remaining business workflows are recorded in `docs/IMPLEMENTATION.md`.
