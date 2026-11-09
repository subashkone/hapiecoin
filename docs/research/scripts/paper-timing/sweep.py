"""Synthetic entry-hour sweep on the stored BTC 5-minute marks: at every hour, open a standard short iron condor on the
nearest daily expiry that settles after the entry (sell ATM +/- 2 steps, buy ATM +/- 4 steps, 1 lot = 0.001 BTC), and
follow its mark P&L to settlement (12:00 UTC). Read-only; no fees. Answers 'which entry hour / exit hour / target'
without depending on the hours the user happened to trade."""
import csv, sys, re
from collections import defaultdict
from datetime import datetime, timedelta, timezone

D = sys.argv[1]
LOT = 0.001
IST = timezone(timedelta(hours=5, minutes=30))
SYM = re.compile(r"^([CP])-BTC-(\d+)-(\d{2})(\d{2})(\d{2})$")

def ts(s):
    s = s.replace(" ", "T")
    if s.endswith("+00"): s += ":00"
    return datetime.fromisoformat(s).astimezone(timezone.utc)

# marks[expiry][bucket][(kind, strike)] = mark
marks = defaultdict(lambda: defaultdict(dict))
with open(f"{D}/btcmarks.csv", newline="") as f:
    for sym, t, m in csv.reader(f):
        g = SYM.match(sym)
        if not g: continue
        exp = f"20{g[5]}-{g[4]}-{g[3]}"
        b = ts(t).replace(second=0, microsecond=0)
        b = b.replace(minute=(b.minute // 5) * 5)
        marks[exp][b][(g[1], int(g[2]))] = float(m)

def settle(exp):
    y, m, d = map(int, exp.split("-"))
    return datetime(y, m, d, 12, 0, tzinfo=timezone.utc)

def chain_at(exp, b):
    c = marks[exp].get(b)
    return c if c and len(c) >= 20 else None

def atm(c):
    ks = sorted({k for _, k in c})
    best, bk = 1e18, None
    for k in ks:
        if ("C", k) in c and ("P", k) in c:
            d = abs(c[("C", k)] - c[("P", k)])
            if d < best: best, bk = d, k
    return bk, ks

results = []
exps = sorted(marks)
for exp in exps:
    st = settle(exp)
    buckets = sorted(b for b in marks[exp] if b < st)
    if not buckets: continue
    # entries on the hour, from 24 h before settlement
    for b in buckets:
        if b.minute != 0 or b < st - timedelta(hours=24): continue
        c = chain_at(exp, b)
        if not c: continue
        k0, ks = atm(c)
        if k0 is None: continue
        i = ks.index(k0)
        if i < 4 or i + 4 >= len(ks): continue
        legs = [("C", ks[i + 2], -1), ("C", ks[i + 4], 1), ("P", ks[i - 2], -1), ("P", ks[i - 4], 1)]
        if any((kd, k) not in c for kd, k, _ in legs): continue
        entry = {(kd, k): c[(kd, k)] for kd, k, _ in legs}
        credit = sum(-sg * entry[(kd, k)] for kd, k, sg in legs) * LOT
        width = (ks[i + 4] - ks[i + 2]) * LOT
        maxloss = width - credit
        path = []
        t = b
        while t < st:
            cc = marks[exp].get(t)
            if cc and all((kd, k) in cc for kd, k, _ in legs):
                pnl = sum(sg * (cc[(kd, k)] - entry[(kd, k)]) * LOT for kd, k, sg in legs)
                path.append((t, pnl))
            t += timedelta(minutes=5)
        if len(path) < 12: continue
        last = path[-1]
        # settlement value only if the last point is within 15 min of settlement
        settled = last[1] if (st - last[0]) <= timedelta(minutes=15) else None
        pk = max(path, key=lambda x: x[1])
        results.append({"exp": exp, "entry": b, "entry_ist": b.astimezone(IST).strftime("%d %b %H:%M"), "hour_ist": b.astimezone(IST).hour,
                        "atm": k0, "credit": credit, "maxloss": maxloss, "peak": pk[1], "peak_ist": pk[0].astimezone(IST).strftime("%d %b %H:%M"),
                        "peak_after_h": (pk[0] - b).total_seconds() / 3600, "settled": settled, "path": path, "coverage": len(path) / max(1, (st - b).total_seconds() / 300)})

print(f"synthetic condors: {len(results)} entries over expiries {', '.join(e for e in exps if any(r['exp'] == e for r in results))}")
print("\nentry IST | expiry | ATM | credit | max loss | peak (when, +h) | at settlement | peak/credit | coverage")
for r in results:
    print(f"{r['entry_ist']} | {r['exp']} | {r['atm']} | {r['credit']:.2f} | {r['maxloss']:.2f} | {r['peak']:.2f} ({r['peak_ist']}, +{r['peak_after_h']:.1f}h) | {('%.2f' % r['settled']) if r['settled'] is not None else '-'} | {r['peak']/r['credit'] if r['credit'] else 0:.2f} | {r['coverage']:.2f}")

# by entry hour IST: mean credit, mean peak/credit, mean settled/credit, share of entries that ever reached +25% / +50% of credit
by = defaultdict(list)
for r in results: by[r["hour_ist"]].append(r)
print("\nentry hour IST | n | mean credit | mean peak % of credit | mean settle % of credit (n settled) | reached 25% | reached 50% | mean h to peak")
for h in sorted(by):
    v = by[h]; s = [r for r in v if r["settled"] is not None]
    r25 = sum(1 for r in v if r["peak"] >= 0.25 * r["credit"]); r50 = sum(1 for r in v if r["peak"] >= 0.5 * r["credit"])
    print(f"{h:02d} | {len(v)} | {sum(r['credit'] for r in v)/len(v):.2f} | {100*sum(r['peak']/r['credit'] for r in v)/len(v):.0f}% | {('%.0f%%' % (100*sum(r['settled']/r['credit'] for r in s)/len(s))) if s else '-'} ({len(s)}) | {r25}/{len(v)} | {r50}/{len(v)} | {sum(r['peak_after_h'] for r in v)/len(v):.1f}")

# target sweep on the synthetic set (entries with a settlement value): take X% of credit when reached, else settle
s = [r for r in results if r["settled"] is not None]
print(f"\ntarget % of credit (n={len(s)} settled entries) | hit | mean P&L with rule | mean P&L holding to settlement")
hold = sum(r["settled"] for r in s) / len(s) if s else 0
for pct in (10, 20, 25, 30, 40, 50, 60, 75):
    tot, hit = 0.0, 0
    for r in s:
        lvl = r["credit"] * pct / 100
        if any(p[1] >= lvl for p in r["path"]): hit += 1; tot += lvl
        else: tot += r["settled"]
    print(f"{pct}% | {hit}/{len(s)} | {tot/len(s):.2f} | {hold:.2f}")

# exit-at-clock: P&L if closed at HH:00 IST on the expiry day (entries from the evening before, 19:00-23:59 IST)
ev = [r for r in s if 19 <= r["hour_ist"] <= 23]
print(f"\nevening entries (19:00-23:59 IST, n={len(ev)}): exit hour IST on expiry day | n with a point | mean P&L | mean % of credit")
for hh in (6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17):
    vals = []
    for r in ev:
        want = settle(r["exp"]).astimezone(IST).replace(hour=hh, minute=0)
        pts = [p for p in r["path"] if abs((p[0] - want).total_seconds()) <= 300]
        if pts: vals.append((pts[0][1], pts[0][1] / r["credit"]))
    if vals: print(f"{hh:02d}:00 | {len(vals)} | {sum(v[0] for v in vals)/len(vals):.2f} | {100*sum(v[1] for v in vals)/len(vals):.0f}%")
