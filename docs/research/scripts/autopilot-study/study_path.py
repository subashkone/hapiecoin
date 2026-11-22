"""The path of a sold strangle's profit through its life (the owner's question of 22 Nov 2026: track every move with
its time and find the best time to exit). For each expiry the "close now" result is computed at every bar: what the
trade would bank if everything still open were bought back at that bar's mark (exit fees included), with the stop on
each sold option applied as it goes. From those paths: the average close-now result by hour after the entry, when the
day's best moment came, how much of it was given back by settlement, and how often each profit level was reached.
Same trades, fees and fills as study_exits.py (imported; run without -I from this folder).

Usage: python study_path.py <cache_dir> <lot_size> <bar_minutes> <entry_hours_before> <percent_away> "" "" <label> <stop multiple>"""
import sys, datetime as dt
import study_exits as X

LABEL, MULT = sys.argv[8], int(sys.argv[9])
HOUR = dt.timedelta(hours=1)


def path(tr):
    """[(time, close-now result)] at every bar, and the result at settlement."""
    live, realised, t, out = list(range(len(tr.legs))), -tr.fee_in, tr.t0 + X.BAR, []
    while t <= tr.last_b:
        px = {i: tr.series[i].get(t) for i in live}
        sp = tr.spot.get(t, tr.settle_spot)
        for i in list(live):
            if px[i] is not None and px[i] >= MULT * tr.entry[i]:
                realised += -(px[i] - tr.entry[i]) * X.Q - X.fee(sp, px[i])
                live.remove(i)
        if all(px[i] is not None for i in live):
            out.append((t, realised + sum(-(px[i] - tr.entry[i]) * X.Q - X.fee(sp, px[i]) for i in live)))
        t += X.BAR
    return out, realised + sum(tr.settle_leg(i) for i in live)


def ist(t):
    return t.astimezone(X.IST).strftime("%H:%M")


paths = [(e, tr, *path(tr)) for e, tr in X.trades]
n = len(paths)
hours = int(X.ENTRY)
print(f"## {LABEL}: {n} trades, each side {X.PCT * 100:g} % away, entered {X.ENTRY:g} h before settlement ({X.clock(X.ENTRY)}), stop {MULT}x on each sold option; mean premium {sum(tr.credit for _, tr, _, _ in paths) / n:.1f}")
print(f"   held to settlement: mean {sum(s for *_, s in paths) / n:+.2f}")
print("\n   If everything were closed at this time (every day the same clock time):")
print(f"   {'hours in':>8s} {'IST':>6s} {'mean':>8s} {'pos':>5s} {'worst':>8s} {'as % of premium':>16s}   {'days whose best moment fell in the hour before':s}")
peaks = []
for e, tr, p, s in paths:
    best_t, best_v = max(p, key=lambda x: x[1])
    peaks.append((e, tr, best_t, best_v, s))
for h in range(1, hours + 1):
    vals, pct = [], []
    for e, tr, p, s in paths:
        target = tr.t0 + h * HOUR
        at = [v for t, v in p if t <= target]
        if at:
            v = at[-1] if target <= tr.last_b else s
            vals.append(v)
            pct.append(100 * v / tr.credit)
    share = sum(1 for e, tr, bt, bv, s in peaks if (h - 1) * HOUR < bt - tr.t0 <= h * HOUR)
    print(f"   {h:8d} {ist(paths[0][1].t0 + h * HOUR):>6s} {sum(vals) / len(vals):+8.2f} {100 * sum(1 for v in vals if v > 0) / len(vals):4.0f}% {min(vals):+8.1f} {sum(pct) / len(pct):+15.0f}%   {share:3d} ({100 * share / n:.0f} %)")

print("\n   The best moment of each day (hindsight; no rule can know it):")
bv = [b for *_, b, _ in peaks]
gave = [b - s for *_, b, s in peaks]
print(f"      mean best close-now result {sum(bv) / n:+.2f} ({100 * sum(b / tr.credit for _, tr, _, b, _ in peaks) / n:.0f} % of the premium), against {sum(s for *_, s in peaks) / n:+.2f} at settlement: on average {sum(gave) / n:.2f} given back after the best moment")
print(f"      days that were never in profit at any bar: {sum(1 for b in bv if b <= 0)}; days that ended below their best by more than half the premium: {sum(1 for _, tr, _, b, s in peaks if b - s > 0.5 * tr.credit)}")
for lv in (10, 25, 50, 75, 90):
    hit = [(e, tr, p, s) for e, tr, p, s in paths if any(v >= lv / 100 * tr.credit for _, v in p)]
    first = sorted((next(t for t, v in p if v >= lv / 100 * tr.credit) - tr.t0).total_seconds() / 3600 for e, tr, p, s in hit)
    after = [s for e, tr, p, s in hit]
    med = first[len(first) // 2] if first else float("nan")
    print(f"      reached {lv:2d} % of the premium on {len(hit):3d} days ({100 * len(hit) / n:3.0f} %), typically {med:4.1f} h after the entry; those days ended at {sum(after) / max(1, len(after)):+7.2f} on average if held, {sum(1 for a in after if a <= 0)} of them at a loss")
print()
