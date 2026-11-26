import random, statistics as st

random.seed(2611)
N = 4000  # Monte Carlo runs per scenario

def pct(xs, p):
    xs = sorted(xs); return xs[int(len(xs) * p / 100) - 1]

# ------------------------------------------------------------------
# S1. Database growth against Supabase Free 500 MB
# ------------------------------------------------------------------
def db_growth(months=60, lean=True):
    staff = random.randint(22, 40)
    ext = random.randint(10, 40)
    audit_per_staff_day = random.uniform(8, 30)          # sensitive events only
    audit_bytes = random.uniform(700, 1400)              # row + index + jsonb detail
    growth = random.uniform(0.01, 0.03)                  # monthly headcount/activity growth
    legacy_docs = random.randint(400, 650)
    doc_meta = random.uniform(2_500, 5_000)
    # store extracted text for search?  lean: 4 KB excerpt, naive: full text 25-60 KB
    doc_text = random.uniform(2_500, 5_000) if lean else random.uniform(25_000, 60_000)
    size = 60e6                                          # extensions, catalog, seeded defaults
    size += legacy_docs * (doc_meta + doc_text * 1.5)
    for m in range(1, months + 1):
        act = (1 + growth) ** m
        audit = staff * 22 * audit_per_staff_day * audit_bytes * act
        timesheets = staff * 22 * 3 * 260 * act
        attendance = staff * 22 * 3 * 170 * act
        notif = staff * 22 * 6 * 520 * act
        helpdesk = random.uniform(40, 160) * 1_800 * act
        docs = random.uniform(120, 320) * (doc_meta + doc_text * 1.5) * act
        finance = random.uniform(150, 400) * 2_400 * act + staff * 3_200 * 1  # invoices/bills/payroll lines
        projects = random.uniform(60, 200) * 1_500 * act
        threads = staff * 22 * random.uniform(2, 8) * 600 * act
        size += audit + timesheets + attendance + notif + helpdesk + docs + finance + projects + threads
        if size > 500e6:
            return m, size
    return months + 1, size

for lean in (True, False):
    res = [db_growth(lean=lean)[0] for _ in range(N)]
    label = "lean (4 KB search excerpt)" if lean else "naive (full extracted text in DB)"
    print(f"S1 DB 500 MB cap, {label:36s} median month {st.median(res):4.0f}  p10 {pct(res,10):3d}  p90 {pct(res,90):3d}  hit within 12m: {sum(r<=12 for r in res)/N:5.1%}")

# prune notification outbox >90 days and attendance >12 months (planned retention) -> how much does it buy?
def db_growth_pruned(months=60):
    staff = random.randint(22, 40); audit_per_staff_day = random.uniform(8, 30); audit_bytes = random.uniform(700, 1400)
    growth = random.uniform(0.01, 0.03); size = 60e6 + random.randint(400, 650) * 12_000
    hist_att, hist_notif = [], []
    for m in range(1, months + 1):
        act = (1 + growth) ** m
        audit = staff * 22 * audit_per_staff_day * audit_bytes * act
        att = staff * 22 * 3 * 170 * act; notif = staff * 22 * 6 * 520 * act
        rest = (staff * 22 * 3 * 260 + random.uniform(120, 320) * 12_000 + random.uniform(150, 400) * 2_400 + 60_000 + 80_000 + staff * 22 * 5 * 600) * act
        hist_att.append(att); hist_notif.append(notif)
        keep_att = sum(hist_att[-12:]); keep_notif = sum(hist_notif[-3:])
        size += audit + rest
        total = size + keep_att + keep_notif
        if total > 500e6: return m
    return months + 1
res = [db_growth_pruned() for _ in range(N)]
print(f"S1 DB cap with pruning (attendance 12m, notifications 3m)  median month {st.median(res):4.0f}  p10 {pct(res,10):3d}  p90 {pct(res,90):3d}")

# ------------------------------------------------------------------
# S2. Hosting credits on Netlify Free (300) vs static on Cloudflare
# ------------------------------------------------------------------
DEPLOY, GB_BW, GBH, REQ10K = 15, 20, 10, 2
def netlify_month(ssr, deploys, users, bot_requests=0, bundle_mb=1.3):
    loads = users * 22 * random.uniform(1.0, 2.5)
    bw_gb = loads * bundle_mb / 1024 + (bot_requests * 0.04 / 1024)  # bots mostly hit shell/HTML ~40 KB
    credits = deploys * DEPLOY + bw_gb * GB_BW
    reqs = users * 22 * random.uniform(120, 400) * (1 if ssr else 0.05) + bot_requests
    credits += reqs / 10_000 * REQ10K
    if ssr:
        gbh = reqs * 0.2 * 1.0 / 3600                    # 200 ms on a 1 GB function
        credits += gbh * GBH
    return credits

def over(f, n=N):
    xs = [f() for _ in range(n)]; return sum(x > 300 for x in xs) / n, st.median(xs)

for label, kw in [
    ("build phase: 45 deploys/mo, SPA static", dict(ssr=False, deploys=45, users=8)),
    ("build phase: 45 deploys/mo, Next SSR", dict(ssr=True, deploys=45, users=8)),
    ("live: 12 deploys/mo, 40 users, SPA static", dict(ssr=False, deploys=12, users=40)),
    ("live: 12 deploys/mo, 40 users, Next SSR", dict(ssr=True, deploys=12, users=40)),
    ("live SPA + one 400k-request bot burst", dict(ssr=False, deploys=12, users=40, bot_requests=400_000)),
    ("live SSR + one 400k-request bot burst", dict(ssr=True, deploys=12, users=40, bot_requests=400_000)),
]:
    p, med = over(lambda kw=kw: netlify_month(**kw))
    print(f"S2 Netlify Free  {label:44s} median credits {med:6.0f}/300   P(site paused) {p:6.1%}")
print("S2 Cloudflare static assets: requests to static assets are free and unlimited -> P(pause from traffic) = 0; only Worker/API calls count (100k/day)")

# ------------------------------------------------------------------
# S3. Keep-alive: probability of a 7-day gap with no database activity
#     during a quiet fortnight (e.g. 24 Dec - 6 Jan), staff traffic = 0
# ------------------------------------------------------------------
def gap_prob(p_drop, schedulers, period_h=48, days=14):
    fails = 0
    for _ in range(N):
        times = []
        for s in range(schedulers):
            t = random.uniform(0, period_h)
            while t < days * 24:
                if random.random() > p_drop:
                    delay = random.expovariate(1 / 1.5) if random.random() < 0.3 else random.uniform(0, 0.3)
                    times.append(t + delay)
                t += period_h
        times = sorted(times) + [days * 24]
        last, worst = 0, 0
        for x in times:
            worst = max(worst, x - last); last = x
        if worst > 7 * 24: fails += 1
    return fails / N
print("\nS3 P(project pauses during a 14-day quiet spell), keep-alive every 48 h")
print("   drop rate | 1 scheduler (GitHub only) | 2 independent schedulers (GitHub + Cloudflare)")
for p in (0.05, 0.15, 0.30, 0.50):
    print(f"   {p:8.0%}  | {gap_prob(p,1):24.2%}  | {gap_prob(p,2):24.4%}")

# ------------------------------------------------------------------
# S4. Backups: R2 footprint of dumps under different retention rules
# ------------------------------------------------------------------
print("\nS4 Backup footprint on R2 (dump = 28% of DB size, compressed+encrypted)")
for db_mb in (100, 250, 400, 500):
    dump = db_mb * 0.28
    daily30 = 30 * dump / 1024
    gfs = (7 + 4 + 12) * dump / 1024
    print(f"   DB {db_mb:3d} MB: dump {dump:5.0f} MB | keep 30 dailies = {daily30:4.2f} GB | 7 daily+4 weekly+12 monthly = {gfs:4.2f} GB")
print("   Actions minutes: ~7 min/night x 30 = 210 of 2,000 free minutes; restore drill monthly ~15 min")

# ------------------------------------------------------------------
# S5. R2 storage vs 10 GB free (documents + field photos)
# ------------------------------------------------------------------
def r2_month():
    gb = random.randint(400, 650) * random.uniform(1.5, 4.0) / 1024     # legacy documents
    field = random.randint(8, 20); trips = random.uniform(2.0, 4.5); ph = random.uniform(6, 14); kb = random.uniform(250, 600)
    docs_new = random.uniform(120, 320) * random.uniform(1.0, 3.0) / 1024
    backups = 1.5
    for m in range(1, 61):
        gb += field * trips * 4.3 * ph * kb / 1e6 + docs_new
        if gb + backups > 10: return m, gb + backups
    return 61, gb
res = [r2_month() for _ in range(N)]
ms = [r[0] for r in res]
print(f"\nS5 R2 10 GB-month free cap crossed: median month {st.median(ms):.0f}, p10 {pct(ms,10)}, p90 {pct(ms,90)}")
cost12 = [max(0, (r2_month()[1] if False else 0)) for _ in range(1)]
def r2_cost_at(month):
    xs = []
    for _ in range(N):
        gb = random.randint(400, 650) * random.uniform(1.5, 4.0) / 1024
        field = random.randint(8, 20); trips = random.uniform(2.0, 4.5); ph = random.uniform(6, 14); kb = random.uniform(250, 600)
        docs_new = random.uniform(120, 320) * random.uniform(1.0, 3.0) / 1024
        gb += month * (field * trips * 4.3 * ph * kb / 1e6 + docs_new) + 1.5
        xs.append(max(0, gb - 10) * 0.015)
    return st.median(xs)
for mth in (12, 24, 36):
    print(f"   month {mth}: median monthly R2 bill ${r2_cost_at(mth):.2f}")

# ------------------------------------------------------------------
# S6. Supabase egress 5 GB/month
# ------------------------------------------------------------------
def egress():
    users = random.randint(25, 60); days = 22
    api_kb = users * days * random.uniform(250, 900) * random.uniform(20, 60)      # API payload per user-day
    realtime_kb = users * days * random.uniform(1_000, 6_000)
    export_kb = random.uniform(5, 40) * 1024 * random.uniform(1, 6)               # report exports pulled via API
    return (api_kb + realtime_kb + export_kb) / 1024 / 1024
xs = [egress() for _ in range(N)]
print(f"\nS6 Supabase DB egress per month (5 GB cap): median {st.median(xs):.2f} GB, p90 {pct(xs,90):.2f} GB, P(>5 GB) {sum(x>5 for x in xs)/N:.1%}")
