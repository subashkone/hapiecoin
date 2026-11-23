"""A stepped profit lock on the evening strangle (the owner, 23 Nov 2026, relayed by the build thread: "if it gets
reached 75% then will it set 50"), against the fixed lock, the target with trail and the stop alone. All levels are
shares of the premium collected, on the whole trade's profit before the closing fees; the floor only rises; the trade
closes at the first bar close at or under the floor. A stop at a multiple of the entry price on each sold option in
every row. Same trades, fees and fills as study_exits.py (imported; run without -I from this folder).

Usage: python study_steps.py <cache_dir> <lot_size> <bar_minutes> <entry_hours_before> <percent_away> "" "" <label> <stop multiple>"""
import sys
import study_exits as X

LABEL, MULT = sys.argv[8], int(sys.argv[9])
VARIANTS = [
    ("the stop only, held to settlement", dict()),
    ("fixed lock: 50 > 25", dict(steps=[(0.50, 0.25)])),
    ("stepped lock A: 50 > 25, 75 > 50", dict(steps=[(0.50, 0.25), (0.75, 0.50)])),
    ("stepped lock B: 50 > 25, 75 > 50, 90 > 75", dict(steps=[(0.50, 0.25), (0.75, 0.50), (0.90, 0.75)])),
    ("target with trail: from 50 %, give back 20 % of the best", dict(trail=0.20)),
]


def run(tr, steps=None, trail=None):
    """Returns (result, exit kind, share of the premium at the close for a floor or trail exit)."""
    live, realised, t, floor, best, stopped = list(range(len(tr.legs))), -tr.fee_in, tr.t0 + X.BAR, None, None, False
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
            close = False
            for x, y in steps or []:
                if total >= x and (floor is None or y > floor):
                    floor = y
            if floor is not None and total <= floor:
                close = True
            if trail is not None and (best is not None or total >= 0.5):
                best = total if best is None else max(best, total)
                close = close or total <= best * (1 - trail)
            if close:
                return realised + rest - sum(X.fee(sp, px[i]) for i in live), "floor", total
        t += X.BAR
    return realised + sum(tr.settle_leg(i) for i in live), ("leg stop" if stopped else "settlement"), None


print(f"## {LABEL}: {len(X.trades)} trades, each side {X.PCT * 100:g} % away, entered {X.ENTRY:g} h before settlement, stop {MULT}x on each sold option in every row; bars of {int(X.BAR.total_seconds() // 60)} minutes; mean premium {sum(tr.credit for _, tr in X.trades) / len(X.trades):.1f}")
print(f"   {'':58s} {'n':>4s} {'mean':>8s} {'win':>5s} {'total':>8s} {'worst':>8s} {'drawdown':>9s} {'halves':>14s}   exits: floor or trail / a leg stopped, rest settled / settled untouched   floor exits closed at (mean share of the premium)")
for name, kw in VARIANTS:
    rows = [(e, *run(tr, **kw)) for e, tr in sorted(X.trades, key=lambda x: x[0])]
    vals = [r[1] for r in rows]
    n = len(vals)
    mid = sorted(r[0] for r in rows)[n // 2]
    cum = peak = dd = 0.0
    for v in vals:
        cum += v
        peak = max(peak, cum)
        dd = max(dd, peak - cum)
    kinds = {k: sum(1 for r in rows if r[2] == k) for k in ("floor", "leg stop", "settlement")}
    at = [r[3] for r in rows if r[2] == "floor"]
    h = f"{sum(r[1] for r in rows if r[0] < mid):+.0f} / {sum(r[1] for r in rows if r[0] >= mid):+.0f}"
    print(f"   {name:58s} {n:4d} {sum(vals) / n:+8.2f} {100 * sum(1 for v in vals if v > 0) / n:4.0f}% {sum(vals):+8.0f} {min(vals):+8.1f} {-dd:+9.1f} {h:>14s}   {kinds['floor']:3d} / {kinds['leg stop']:3d} / {kinds['settlement']:3d}" + (f"   {100 * sum(at) / len(at):5.1f} %" if at else ""))
print()
