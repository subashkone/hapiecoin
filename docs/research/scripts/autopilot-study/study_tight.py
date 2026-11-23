"""Tighter exits for the sold strangle (the owner, 22 Nov 2026: "tight the trades"), found by reviewing the paper
trades and tested here on the history. On top of the stop on each sold option:
  1. buy a sold option back alone at a fixed mark (study_cheap.py), and then tighten the stop on the option still open;
  2. buy it back at that mark only while the spot is still near its strike (the case that can come back);
  3. close the whole trade once nearly all the premium is in hand (95 / 98 / 99 %).
Same trades, fees and fills as study_exits.py (imported; run without -I from this folder).

Usage: python study_tight.py <cache_dir> <lot_size> <bar_minutes> <entry_hours_before> <percent_away> "" "" <label> <stop multiple> <marks, comma>"""
import sys
import study_exits as X

LABEL, MULT = sys.argv[8], int(sys.argv[9])
LEVELS = [float(x) for x in sys.argv[10].split(",")]


def run(tr, level=None, after=None, near=None, take=None, rearm=None):
    """level: buy a leg back alone at or under this mark. after: the stop multiple of the other leg once one leg has
    been bought back cheap. near: buy back only while the spot is within this share of the leg's strike. take: close
    everything once the profit before the closing fees is this share of the premium. rearm (a, b): once a leg's mark
    has been at or under a times its entry price, its stop moves down to b times its entry price."""
    live, realised, t, mult = list(range(len(tr.legs))), -tr.fee_in, tr.t0 + X.BAR, {i: MULT for i in range(len(tr.legs))}
    while t <= tr.last_b and live:
        sp = tr.spot.get(t, tr.settle_spot)
        px = {i: tr.series[i].get(t) for i in live}
        for i in list(live):
            if px[i] is None:
                continue
            if rearm is not None and px[i] <= rearm[0] * tr.entry[i]:
                mult[i] = min(mult[i], rearm[1])
            cheap = level is not None and px[i] <= level and (near is None or abs(tr.legs[i][1] - sp) <= near * sp)
            if px[i] >= mult[i] * tr.entry[i] or cheap:
                realised += -(px[i] - tr.entry[i]) * X.Q - X.fee(sp, px[i])
                live.remove(i)
                if cheap and after is not None:
                    for j in live:
                        mult[j] = after
        if take is not None and live and all(px[i] is not None for i in live):
            rest = sum(-(px[i] - tr.entry[i]) * X.Q for i in live)
            if realised + tr.fee_in + rest >= take * tr.credit:
                return realised + rest - sum(X.fee(sp, px[i]) for i in live)
        t += X.BAR
    return realised + sum(tr.settle_leg(i) for i in live)


def st(rows):
    vals = [v for _, v in rows]
    n = len(vals)
    mid = sorted(e for e, _ in rows)[n // 2]
    worst3 = sorted(vals)[:3]
    return f"n={n:3d} mean={sum(vals) / n:+8.2f} pos={100 * sum(1 for v in vals if v > 0) / n:3.0f}% worst={min(vals):+8.1f} worst three={sum(worst3):+8.1f} total={sum(vals):+7.0f}  halves {sum(v for e, v in rows if e < mid):+.0f} / {sum(v for e, v in rows if e >= mid):+.0f}"


def line(text, **kw):
    print(f"   {text:66s} {st([(e, run(tr, **kw)) for e, tr in X.trades])}")


print(f"## {LABEL}: {len(X.trades)} trades, each side {X.PCT * 100:g} % away, entered {X.ENTRY:g} h before settlement, stop {MULT}x on each sold option; mean premium {sum(tr.credit for _, tr in X.trades) / len(X.trades):.1f}")
line("the stop only, held to settlement")
for lv in LEVELS:
    line(f"buy a leg back at a mark of {lv:g}", level=lv)
    for a in (2, 1.5):
        if a < MULT:
            line(f"buy back at {lv:g}, then the other leg's stop at {a:g}x", level=lv, after=a)
    for nr in (0.02, 0.01):
        line(f"buy back at {lv:g} only while the spot is within {100 * nr:g} % of the strike", level=lv, near=nr)
for a in (0.25, 0.1, 0.05):
    for b in (1.0, 0.5, 0.25):
        if b > a:
            line(f"once a leg is under {100 * a:g} % of its entry, its stop at {100 * b:g} % of entry", rearm=(a, b))
for tk in (0.95, 0.98, 0.99):
    line(f"close everything at {100 * tk:g} % of the premium", take=tk)
    line(f"close everything at {100 * tk:g} %, and buy a leg back at {LEVELS[-1]:g}", take=tk, level=LEVELS[-1])
print()
