"""Trail from 90 % of the premium instead of closing there (the owner, 23 Nov 2026, relayed by the build thread:
"Instead of closing at 90% why don't we trial?"). Rows on the same trades: the stop alone, a close at 90 %, the trail
armed at 90 % with a give-back of 5 / 10 / 20 % of the best profit, and arm 75 / give 10 for context. Then what the
trades that reached 90 % did afterwards when simply held. "slip" is how far under its exit level the average trail
exit filled, in points of the premium; "at level" is the mean had every trail exit filled exactly at its level.
Same trades, fees and fills as study_exits.py (imported; run without -I from this folder).

Usage: python study_trail90.py <cache_dir> <lot_size> <bar_minutes> <entry_hours_before> <percent_away> "" "" <label> <stop multiple>"""
import sys
import study_exits as X

LABEL, MULT = sys.argv[8], int(sys.argv[9])


def run(tr, arm=None, give=None, take=None):
    """Returns (result, exit kind, points under the level, first share >= 0.9 seen or None)."""
    live, realised, t, best, stopped, reached = list(range(len(tr.legs))), -tr.fee_in, tr.t0 + X.BAR, None, False, None
    while t <= tr.last_b and live:
        sp = tr.spot.get(t, tr.settle_spot)
        px = {i: tr.series[i].get(t) for i in live}
        for i in list(live):
            if px[i] is not None and px[i] >= MULT * tr.entry[i]:
                realised += -(px[i] - tr.entry[i]) * X.Q - X.fee(sp, px[i])
                live.remove(i)
                stopped = True
        if live and all(px[i] is not None for i in live):
            rest = sum(-(px[i] - tr.entry[i]) * X.Q for i in live)
            total = (realised + tr.fee_in + rest) / tr.credit
            if reached is None and total >= 0.9:
                reached = total
            closed = lambda kind, slip: (realised + rest - sum(X.fee(sp, px[i]) for i in live), kind, slip, reached)
            if take is not None and total >= take:
                return closed("take", None)
            if arm is not None and (best is not None or total >= arm):
                best = total if best is None else max(best, total)
                if total <= best * (1 - give):
                    return closed("trail", best * (1 - give) - total)
        t += X.BAR
    return realised + sum(tr.settle_leg(i) for i in live), ("leg stop" if stopped else "settlement"), None, reached


def line(name, **kw):
    rows = [(e, tr.credit, *run(tr, **kw)) for e, tr in sorted(X.trades, key=lambda x: x[0])]
    vals = [r[2] for r in rows]
    n = len(vals)
    mid = sorted(r[0] for r in rows)[n // 2]
    cum = peak = dd = 0.0
    for v in vals:
        cum += v
        peak = max(peak, cum)
        dd = max(dd, peak - cum)
    k = {x: sum(1 for r in rows if r[3] == x) for x in ("take", "trail", "leg stop", "settlement")}
    slips = [r[4] for r in rows if r[3] == "trail"]
    at_level = sum(r[2] + (r[4] * r[1] if r[3] == "trail" else 0) for r in rows) / n
    h = f"{sum(r[2] for r in rows if r[0] < mid):+.0f} / {sum(r[2] for r in rows if r[0] >= mid):+.0f}"
    print(f"   {name:44s} {n:4d} {sum(vals) / n:+8.2f} {100 * sum(1 for v in vals if v > 0) / n:4.0f}% {sum(vals):+8.0f} {min(vals):+8.1f} {-dd:+9.1f} {h:>14s}   {k['take'] + k['trail']:3d} / {k['leg stop']:3d} / {k['settlement']:3d}" + (f"   {100 * sum(slips) / len(slips):5.1f}   {at_level:+8.2f}" if slips else ""))


print(f"## {LABEL}: {len(X.trades)} trades, each side {X.PCT * 100:g} % away, entered {X.ENTRY:g} h before settlement, stop {MULT}x on each sold option in every row; bars of {int(X.BAR.total_seconds() // 60)} minutes; mean premium {sum(tr.credit for _, tr in X.trades) / len(X.trades):.1f}")
print(f"   {'':44s} {'n':>4s} {'mean':>8s} {'win':>5s} {'total':>8s} {'worst':>8s} {'drawdown':>9s} {'halves':>14s}   exits: take or trail / a leg stopped, rest settled / settled untouched   slip   at level")
line("the stop only, held to settlement")
line("close everything at 90 % of the premium", take=0.9)
for g in (0.05, 0.10, 0.20):
    line(f"trail from 90 %, give back {100 * g:g} % of the best", arm=0.9, give=g)
line("trail from 75 %, give back 10 % of the best", arm=0.75, give=0.10)

# What the trades that reached 90 % did afterwards when simply held (the stop only).
got = []
for e, tr in X.trades:
    res, kind, _, reached = run(tr)
    if reached is not None:
        closed_90, *_ = run(tr, take=0.9)
        got.append((res - closed_90, res / tr.credit, reached, kind))
if got:
    up = [d for d, *_ in got if d > 0.005]
    down = [d for d, *_ in got if d < -0.005]
    print(f"\n   {len(got)} of {len(X.trades)} trades reached 90 % of the premium (first bar close at or over it: {100 * sum(g[2] for g in got) / len(got):.1f} % on average).")
    print(f"   Held on instead of closing there: {len(up)} ended higher (mean {sum(up) / len(up) if up else 0:+.2f}, best {max(up) if up else 0:+.2f}), {len(down)} ended lower (mean {sum(down) / len(down) if down else 0:+.2f}, worst {min(down) if down else 0:+.2f}), {len(got) - len(up) - len(down)} the same; all {len(got)} together {sum(d for d, *_ in got):+.2f} (after the fees of each path).")
    print(f"   Of the {len(got)}: {sum(1 for g in got if g[3] == 'leg stop')} later had a sold option stopped; lowest final result {100 * min(g[1] for g in got):.0f} % of the premium.")
print()
