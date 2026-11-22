"""Strikes by the market's expected move (strategy lab backlog 8). The expected move to settlement is read from the
options themselves: the price of the at-the-money straddle (call + put at the listed strike nearest the spot) at the
entry. Each side is sold at the listed strike nearest spot +/- m x straddle, against a fixed percentage of the spot.
Also splits the fixed strangle by whether the day's expected move was low, middle or high (thirds of the period).
Same fees and fills as study_exits.py (imported; run without -I from this folder).

Usage: python study_move.py <cache_dir> <lot_size> <bar_minutes> <entry_hours_before> <percent_away> "" "" <label>"""
import os, sys, datetime as dt
import study_exits as X

LABEL = sys.argv[8]
MULTS = (0.5, 0.75, 1.0, 1.25, 1.5, 2.0)
PCTS = (0.25, 0.5, 0.75, 1.0, 1.5)
RULES = [("hold", lambda tr: tr.hold()), ("stop 2x", lambda tr: tr.run(mult=2)), ("stop 3x", lambda tr: tr.run(mult=3)), ("stop 3x, take half", lambda tr: tr.run(mult=3, take=0.5))]


def nearest(opts, t0, kind, target, s0):
    best = None
    for (kd, k), series in opts.items():
        if kd != kind or t0 not in series or (k <= s0 if kind == "C" else k >= s0):
            continue
        d = abs(k - target)
        if best is None or d < best[0]:
            best = (d, k)
    return None if best is None else best[1]


days = []  # (expiry, spot, opts, t0, settle, s0, straddle as a share of the spot)
for exp in sorted(e for e in os.listdir(X.CACHE) if os.path.isdir(os.path.join(X.CACHE, e))):
    spot, opts = X.load(exp)
    y, m, d = map(int, exp.split("-"))
    settle = dt.datetime(y, m, d, X.SETTLE_H, tzinfo=X.U)
    t0 = settle - dt.timedelta(hours=X.ENTRY) - X.shift
    if settle - X.BAR not in spot or t0 not in spot:
        continue
    s0 = spot[t0]
    atm = min((k for (kd, k), sr in opts.items() if kd == "C" and t0 in sr and ("P", k) in opts and t0 in opts[("P", k)]), key=lambda k: abs(k - s0), default=None)
    if atm is None:
        continue
    days.append((exp, spot, opts, t0, settle, s0, (opts[("C", atm)][t0] + opts[("P", atm)][t0]) / s0))


def build(day, dist):
    exp, spot, opts, t0, settle, s0, _ = day
    pk, ck = nearest(opts, t0, "P", s0 * (1 - dist), s0), nearest(opts, t0, "C", s0 * (1 + dist), s0)
    if pk is None or ck is None:
        return None
    tr = X.Trade(spot, opts, t0, settle, [("P", pk), ("C", ck)])
    tr.away = ((s0 - pk) + (ck - s0)) / 2 / s0
    return tr if tr.credit > 0 else None


def st(rows):
    vals = [v for _, v in rows]
    n = len(vals)
    if not n:
        return "n=  0"
    mid = days[len(days) // 2][0]
    return f"n={n:3d} mean={sum(vals) / n:+7.2f} pos={100 * sum(1 for v in vals if v > 0) / n:3.0f}% worst={min(vals):+7.1f} total={sum(vals):+6.0f}  halves {sum(v for e, v in rows if e < mid):+.0f} / {sum(v for e, v in rows if e >= mid):+.0f}"


def table(name, dist_of):
    trs = [(d[0], build(d, dist_of(d))) for d in days]
    trs = [(e, t) for e, t in trs if t is not None]
    print(f"\n   {name}: premium {sum(t.credit for _, t in trs) / len(trs):5.1f}, sold on average {100 * sum(t.away for _, t in trs) / len(trs):4.2f} % away")
    for rname, fn in RULES:
        print(f"      {rname:20s} {st([(e, fn(t)) for e, t in trs])}")


sd = sorted(d[6] for d in days)
print(f"## {LABEL}: {len(days)} expiries, entered {X.ENTRY:g} h before settlement; straddle (expected move) as a share of the spot: lowest {100 * sd[0]:.2f} %, median {100 * sd[len(sd) // 2]:.2f} %, highest {100 * sd[-1]:.2f} %")
for p in PCTS:
    table(f"fixed {p:g} % away", lambda d, p=p: p / 100)
for m in MULTS:
    table(f"{m:g} x the straddle away", lambda d, m=m: m * d[6])
lo, hi = sd[len(sd) // 3], sd[2 * len(sd) // 3]
print(f"\n   the fixed {X.PCT * 100:g} % strangle, split by the day's expected move (thirds: below {100 * lo:.2f} %, above {100 * hi:.2f} %)")
for name, test in (("low", lambda v: v < lo), ("middle", lambda v: lo <= v < hi), ("high", lambda v: v >= hi)):
    sub = [(d[0], build(d, X.PCT)) for d in days if test(d[6])]
    sub = [(e, t) for e, t in sub if t is not None]
    for rname, fn in RULES[1:3]:
        print(f"      expected move {name:6s} {rname:10s} {st([(e, fn(t)) for e, t in sub])}")
print()

# a rule a live engine could apply: compare today's expected move with the days BEFORE it only (no hindsight)
print(f"   the fixed {X.PCT * 100:g} % strangle, stop 3x, traded only when today's expected move is at or above a mark set from earlier days")
full = [(d[0], d[6], build(d, X.PCT)) for d in days]
for look in (10, 20, 30):
    for q, qname in ((1 / 3, "lowest third"), (0.5, "median")):
        took, left = [], []
        for i, (e, v, t) in enumerate(full):
            if i < look or t is None:
                continue
            past = sorted(x[1] for x in full[i - look:i])
            (took if v >= past[int(q * look)] else left).append((e, t.run(mult=3)))
        print(f"      last {look:2d} days, above their {qname:12s} taken   {st(took)}")
        print(f"      {'':35s} left out {st(left)}")
print()
