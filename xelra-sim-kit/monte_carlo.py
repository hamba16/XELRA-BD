"""XELRA scenario simulations: capacity, hosting credits, offline sync, approvals, payroll shape, colour accessibility.
Deterministic seed. All assumptions are named at the top so they can be changed and rerun.
Usage: python monte_carlo.py
"""
import json, math, random, statistics as st, colorsys

random.seed(2026)
R = {}

def pct(xs, p):
    xs = sorted(xs); i = min(len(xs) - 1, max(0, int(round(p / 100 * (len(xs) - 1))))); return xs[i]

# ---------- S1 file storage growth (R2 free 10 GB) ----------
def storage_run(compress):
    legacy = sum(random.lognormvariate(math.log(2.2), 0.7) for _ in range(500)) / 1024  # GB
    total, monthly, cross, series = legacy, 1.0 * compress, None, []
    for m in range(1, 37):
        if m > 1 and (m - 1) % 3 == 0:
            monthly *= 1 + random.uniform(0.10, 0.25)
        total += monthly; series.append(total)
        if cross is None and total > 10: cross = m
    return cross or 99, series
for label, c in [('no_compression', 1.0), ('photos_compressed_on_device', 0.4)]:
    runs = [storage_run(c) for _ in range(4000)]
    cr = [r[0] for r in runs]
    cost = {m: round(st.mean(max(0, r[1][m - 1] - 10) * 0.015 for r in runs), 2) for m in (12, 24, 36)}
    R.setdefault('S1_storage', {})[label] = dict(month_crosses_10GB_p10=pct(cr, 10), p50=pct(cr, 50), p90=pct(cr, 90),
        mean_monthly_cost_usd_at_month=cost, gb_at_month_12_p50=round(pct([r[1][11] for r in runs], 50), 1),
        gb_at_month_36_p50=round(pct([r[1][35] for r in runs], 50), 1))

# ---------- S2 database size (Supabase Free 500 MB) ----------
ROW = dict(audit=(12, 450), login=(4, 160), notify=(8, 300), message=(6, 500), timesheet=(3, 200), task=(5, 350), doc=(2, 600), approval=(1.2, 400))
def db_run(prune):
    size, cross = 70.0, None   # MB base incl. system schemas (assumption)
    hist = []
    for m in range(1, 37):
        users = 52 if m <= 2 else min(124, 52 + (m - 2) * 3.3)
        act = random.lognormvariate(0, 0.35)
        mb = 0
        for k, (n, b) in ROW.items():
            f = 1.0
            if prune and k in ('notify', 'message'): f = 0.25   # 90 day prune keeps ~ a quarter of the stream
            if prune and k == 'audit': f = 0.40                  # old partitions archived to R2 as compressed jsonl
            if prune and k == 'login': f = 1.0                   # 12 months kept by policy
            mb += n * b * f * 22 * users * act / 1e6 * 1.6       # 1.6 = index overhead
        size += mb; hist.append(size)
        if cross is None and size > 400: cross = m
    return cross or 99, hist
for label, pr in [('no_pruning', False), ('prune_and_archive', True)]:
    runs = [db_run(pr) for _ in range(3000)]; cr = [r[0] for r in runs]
    R.setdefault('S2_database', {})[label] = dict(month_hits_400MB_p10=pct(cr, 10), p50=pct(cr, 50), p90=pct(cr, 90),
        mb_at_month_12_p50=round(pct([r[1][11] for r in runs], 50)), mb_at_month_36_p50=round(pct([r[1][35] for r in runs], 50)))

# ---------- S3 hosting credits (Netlify Free: 300 credits hard cap) ----------
RATE = dict(deploy=15, gbh=10, gb=20, req_per_10k=2)
def credits(users, mode, deploys):
    nav = random.lognormvariate(math.log(70), 0.3)       # route changes per user per working day
    days = 22; navs = users * nav * days
    if mode == 'ssr':
        fn_ms = random.lognormvariate(math.log(180), 0.3)
        compute = navs * (fn_ms / 3.6e6) * 1.0 * RATE['gbh']          # 1 GB functions
        bw_gb = (navs * 45e3 + users * 1.2e6 * deploys) / 1e9
        reqs = navs * 6
    else:                                                  # static shell, data direct from Supabase, privileged work off Netlify
        compute = 0.0
        bw_gb = (users * days * 12e3 + users * 1.2e6 * deploys) / 1e9
        reqs = users * days * 8
    return deploys * RATE['deploy'] + compute + bw_gb * RATE['gb'] + reqs / 1e4 * RATE['req_per_10k']
for users in (20, 52, 124):
    for mode in ('ssr', 'static_first'):
        xs = [credits(users, mode, deploys=6) for _ in range(4000)]
        R.setdefault('S3_netlify_credits_per_month', {})[f'{users}_users_{mode}'] = dict(p50=round(pct(xs, 50)), p90=round(pct(xs, 90)),
            share_of_months_over_300=round(sum(x > 300 for x in xs) / len(xs), 3))
R['S3_netlify_credits_per_month']['deploy_budget'] = dict(credits_per_prod_deploy=15, max_prod_deploys_if_nothing_else_used=300 // 15)
# Supabase egress (5 GB free): same for both modes because both read the database
def egress(users):
    nav = random.lognormvariate(math.log(70), 0.3)
    return users * nav * 22 * 15e3 / 1e9
for users in (52, 124):
    xs = [egress(users) for _ in range(4000)]
    R.setdefault('S3b_supabase_egress_gb_per_month', {})[f'{users}_users'] = dict(p50=round(pct(xs, 50), 2), p90=round(pct(xs, 90), 2))

# ---------- S4 offline sync conflict strategies ----------
def sync_run(strategy, users=30, days=20, pool=200):
    edits = []   # (user, record, field, t_edit, t_sync)
    for u in range(users):
        for d in range(days):
            t0 = d * 24 + random.uniform(6, 18)
            off = min(96, random.lognormvariate(math.log(6), 1.0))     # hours offline
            for _ in range(max(1, int(random.expovariate(1 / 3)))):
                t = t0 + random.uniform(0, off); edits.append((u, random.randrange(pool), random.choice(['status', 'note', 'assignee']), t, t0 + off))
    lost = 0; manual = 0
    by_rec = {}
    for e in edits: by_rec.setdefault(e[1], []).append(e)
    for rec, es in by_rec.items():
        es.sort(key=lambda e: e[3])
        for i, a in enumerate(es):
            for b in es[i + 1:]:
                if a[0] != b[0] and b[3] < a[4]:       # b edited before a reached the server: concurrent
                    if strategy == 'last_write_wins_record': lost += 1
                    elif strategy == 'field_level_merge' and a[2] == b[2]: lost += 1
                    elif strategy == 'event_log_with_rules' and a[2] == b[2] == 'status': manual += 1
    return len(edits), lost, manual
for s in ('last_write_wins_record', 'field_level_merge', 'event_log_with_rules'):
    n = lost = man = 0
    for _ in range(40):
        a, b, c = sync_run(s); n += a; lost += b; man += c
    R.setdefault('S4_offline_sync', {})[s] = dict(lost_updates_per_1000_edits=round(lost / n * 1000, 1), manual_resolutions_per_1000_edits=round(man / n * 1000, 1))

# ---------- S5 approvals: stuck requests with and without fallback ----------
def approval_run(fallback, n=6000):
    waits = []
    chain_by_tier = {0: ['lead'], 1: ['lead', 'finance_officer'], 2: ['dept_head', 'finance_manager'], 3: ['central_director', 'finance_manager']}
    delegate_exists = {'lead': False, 'finance_officer': False, 'dept_head': False, 'finance_manager': False, 'central_director': False}
    away_p = {'lead': .10, 'finance_officer': .08, 'dept_head': .10, 'finance_manager': .08, 'central_director': .20}
    for _ in range(n):
        tier = random.choices([0, 1, 2, 3], [.45, .35, .15, .05])[0]; t = 0.0
        for who in chain_by_tier[tier]:
            away = random.random() < away_p[who]
            if away:
                dur = random.expovariate(1 / 3.0)            # days absent
                if fallback and dur > 2:
                    t += 2 + random.uniform(.2, .8)          # escalate to next level after 2 days
                else:
                    t += dur + random.uniform(.2, 1)
            else:
                t += random.uniform(.1, 1.0)
        waits.append(t)
    return dict(p50_days=round(pct(waits, 50), 2), p90_days=round(pct(waits, 90), 2), over_5_days_pct=round(sum(w > 5 for w in waits) / n * 100, 2))
R['S5_approvals'] = dict(no_fallback=approval_run(False), delegate_and_2_day_escalation=approval_run(True))

# ---------- S6 payroll engine shape (illustrative bands only, not real statutory rates) ----------
BANDS = [(0, 200_000, 0.0), (200_000, 500_000, 0.10), (500_000, 1_000_000, 0.20), (1_000_000, float('inf'), 0.30)]
def tax(g):
    t = 0.0
    for lo, hi, r in BANDS:
        if g > lo: t += (min(g, hi) - lo) * r
    return round(t)
bad = 0; max_resid = 0
for _ in range(20000):
    gross = round(random.lognormvariate(math.log(900_000), 0.6)); pension = round(gross * 0.05); allow = round(random.choice([0, 50_000, 120_000]))
    g = gross + allow; ded = tax(g) + pension + round(random.choice([0, 30_000, 80_000]))
    net = g - ded
    if net != g - (tax(g) + (ded - tax(g))): bad += 1
    if tax(g) != tax(g): bad += 1
    max_resid = max(max_resid, abs(round(tax(g)) - tax(g)))
R['S6_payroll_shape'] = dict(cases=20000, violations=bad, max_rounding_residual_ugx=max_resid, note='bands are illustrative placeholders for engine testing only')

# ---------- S7 colour accessibility ----------
def lum(h):
    h = h.lstrip('#'); c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    c = [x / 12.92 if x <= .03928 else ((x + .055) / 1.055) ** 2.4 for x in c]; return .2126 * c[0] + .7152 * c[1] + .0722 * c[2]
def cr(a, b):
    la, lb = lum(a), lum(b); hi, lo = max(la, lb), min(la, lb); return round((hi + .05) / (lo + .05), 2)
def mix(h, w, a):
    h = h.lstrip('#'); c = [int(h[i:i + 2], 16) for i in (0, 2, 4)]
    return '#%02x%02x%02x' % tuple(round(x * (1 - a) + w * a) for x in c)
RED, IND, INK, PAPER, MUTED, LINE = '#991923', '#0d3251', '#111111', '#f7f7f5', '#646464', '#dcdcd9'
pairs = {'ink on paper': (INK, PAPER), 'muted on paper': (MUTED, PAPER), 'red on paper': (RED, PAPER), 'indigo on paper': (IND, PAPER),
         'white on red': ('#ffffff', RED), 'white on indigo': ('#ffffff', IND), 'red on white': (RED, '#ffffff'), 'line on paper (non-text, need 3)': (LINE, PAPER),
         'dark mode: paper on #080808': (PAPER, '#080808'), 'dark mode: muted-light #a8a8a8 on #080808': ('#a8a8a8', '#080808'),
         'dark mode: red-tint #e8838b on #080808': ('#e8838b', '#080808'), 'dark mode: indigo-tint #7fa6cc on #080808': ('#7fa6cc', '#080808')}
R['S7_contrast'] = {k: cr(*v) for k, v in pairs.items()}
ramp = {}
for name, base in (('red', RED), ('indigo', IND)):
    ramp[name] = {f'tint{int(a * 100)}': dict(hex=mix(base, 255, a), ink_on_it=cr(INK, mix(base, 255, a))) for a in (.92, .84, .72, .55)}
    ramp[name]['shade'] = dict(hex=mix(base, 0, .25), white_on_it=cr('#ffffff', mix(base, 0, .25)))
R['S7_ramps'] = ramp
badge = []
for i in range(12):
    h = i / 12
    for l in [x / 100 for x in range(60, 20, -1)]:
        r, g, b = colorsys.hls_to_rgb(h, l, 0.55); hx = '#%02x%02x%02x' % (round(r * 255), round(g * 255), round(b * 255))
        if cr('#ffffff', hx) >= 4.5: badge.append(hx); break
R['S7_auditor_badge_palette_white_text_AA'] = badge
print(json.dumps(R, indent=1))
