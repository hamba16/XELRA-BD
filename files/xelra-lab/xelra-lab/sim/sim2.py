import random, statistics as st
random.seed(77); N=4000
def pct(xs,p): xs=sorted(xs); return xs[int(len(xs)*p/100)-1]

# S1b: which table eats the database? component sizes at month 12 and 24 (lean)
def comp(month):
    staff=random.randint(22,40); apsd=random.uniform(8,30); ab=random.uniform(700,1400); g=random.uniform(.01,.03)
    docm=random.uniform(2500,5000); doct=random.uniform(2500,5000)
    tot=dict(audit=0,timesheets=0,attendance=0,notifications=0,documents=0,finance=0,threads=0,other=0)
    for m in range(1,month+1):
        a=(1+g)**m
        tot['audit']+=staff*22*apsd*ab*a
        tot['timesheets']+=staff*22*3*260*a
        tot['attendance']+=staff*22*3*170*a
        tot['notifications']+=staff*22*6*520*a
        tot['documents']+=random.uniform(120,320)*(docm+doct*1.5)*a
        tot['finance']+=(random.uniform(150,400)*2400+staff*3200)*a
        tot['threads']+=staff*22*random.uniform(2,8)*600*a
        tot['other']+=(random.uniform(40,160)*1800+random.uniform(60,200)*1500)*a
    tot['documents']+=random.randint(400,650)*(docm+doct*1.5)
    return tot
for month in (12,24):
    runs=[comp(month) for _ in range(1500)]
    total={k:st.median([r[k] for r in runs]) for k in runs[0]}
    s=sum(total.values())
    print(f"S1b month {month}: median total {s/1e6:5.0f} MB (+60 MB base) | "+", ".join(f"{k} {v/s:4.0%}" for k,v in sorted(total.items(), key=lambda kv:-kv[1])[:5]))

# S1c: hot audit window of 12 months, older months archived to R2 with an anchor row
def months_to_cap_archive():
    staff=random.randint(22,40); apsd=random.uniform(8,30); ab=random.uniform(700,1400); g=random.uniform(.01,.03)
    docm=random.uniform(2500,5000); doct=random.uniform(2500,5000)
    base=60e6+random.randint(400,650)*(docm+doct*1.5)
    audit_hist=[]; other=0
    for m in range(1,121):
        a=(1+g)**m
        audit_hist.append(staff*22*apsd*ab*a)
        other+=(staff*22*3*260+staff*22*3*170*0+staff*22*6*520*0+random.uniform(120,320)*(docm+doct*1.5)+random.uniform(150,400)*2400+staff*3200+staff*22*random.uniform(2,8)*600+random.uniform(40,160)*1800+random.uniform(60,200)*1500)*a
        if base+other+sum(audit_hist[-12:])>500e6: return m
    return 121
r=[months_to_cap_archive() for _ in range(N)]
print(f"S1c with 12-month hot audit window + R2 archive: median month to cap {st.median(r):.0f} (p10 {pct(r,10)}, p90 {pct(r,90)}), capped at 120 means never in 10 yrs: {sum(x>=121 for x in r)/N:.0%}")

# S6 recalibrated egress: disciplined (paginated, columns selected, cached) vs chatty (select *, no pagination)
def egress(kind):
    users=random.randint(25,60); days=22
    if kind=="disciplined":
        reqs=random.uniform(100,400); kb=random.uniform(3,14)
    else:
        reqs=random.uniform(150,600); kb=random.uniform(40,180)
    api=users*days*reqs*kb
    rt=users*days*random.uniform(150,900)
    exp=random.uniform(2,10)*1024
    return (api+rt+exp)/1024/1024
for kind in ("disciplined","chatty"):
    xs=[egress(kind) for _ in range(N)]
    print(f"S6 egress {kind:11s} median {st.median(xs):5.2f} GB/mo  p90 {pct(xs,90):5.2f}  P(>5 GB cap) {sum(x>5 for x in xs)/N:6.1%}")
