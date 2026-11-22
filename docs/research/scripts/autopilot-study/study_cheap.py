"""Buy back a sold option on its own once it is nearly worthless (the owner's idea of 22 Nov 2026, relayed by the
build thread): each sold leg is closed alone when its mark falls to a share of its entry price, the other leg kept
with its stop. Beside it: how often a leg that had been that cheap came back to hurt, and closing the whole trade at
75 / 90 % of the premium. Same trades, fees (the buy-back fee is counted) and fills as study_exits.py (imported; run
without -I from this folder).

Usage: python study_cheap.py <cache_dir> <lot_size> <bar_minutes> <entry_hours_before> <percent_away> "" "" <label> <stop multiple>"""
import sys
import study_exits as X

LABEL, MULT = sys.argv[8], int(sys.argv[9])
SHARES = (0.20, 0.10, 0.05, 0.02)


def run(tr, cheap=None):
    live, realised, t = list(range(len(tr.legs))), -tr.fee_in, tr.t0 + X.BAR
    while t <= tr.last_b and live:
        sp = tr.spot.get(t, tr.settle_spot)
        for i in list(live):
            px = tr.series[i].get(t)
            if px is not None and (px >= MULT * tr.entry[i] or (cheap is not None and px <= cheap * tr.entry[i])):
                realised += -(px - tr.entry[i]) * X.Q - X.fee(sp, px)
                live.remove(i)
        t += X.BAR
    return realised + sum(tr.settle_leg(i) for i in live)


def st(rows):
    vals = [v for _, v in rows]
    n = len(vals)
    mid = sorted(e for e, _ in rows)[n // 2]
    return f"n={n:3d} mean={sum(vals) / n:+8.2f} pos={100 * sum(1 for v in vals if v > 0) / n:3.0f}% worst={min(vals):+8.1f} total={sum(vals):+7.0f}  halves {sum(v for e, v in rows if e < mid):+.0f} / {sum(v for e, v in rows if e >= mid):+.0f}"


print(f"## {LABEL}: {len(X.trades)} trades, each side {X.PCT * 100:g} % away, entered {X.ENTRY:g} h before settlement, stop {MULT}x on each sold option; mean premium {sum(tr.credit for _, tr in X.trades) / len(X.trades):.1f}")
print(f"   {'hold both legs to settlement (the stop only)':52s} {st([(e, run(tr)) for e, tr in X.trades])}")
for f in SHARES:
    print(f"   {'buy a leg back alone at ' + format(100 * f, 'g') + ' % of its entry price':52s} {st([(e, run(tr, f)) for e, tr in X.trades])}")
for lv in (0.75, 0.9):
    print(f"   {'close the whole trade at ' + format(100 * lv, 'g') + ' % of the premium':52s} {st([(e, tr.run(mult=MULT, take=lv)) for e, tr in X.trades])}")

print("\n   What happened to a sold leg after it had been that cheap (legs, not trades; the stop is ignored after the cheap moment only to see the path):")
print(f"   {'':8s} {'legs that got there':>20s} {'hours in (median)':>18s} {'later hit the stop':>19s} {'settled above entry':>20s} {'settled with any value':>23s} {'mean cost of holding on':>24s}")
for f in SHARES:
    got = hurt_stop = hurt_entry = some = 0
    when, cost = [], []
    for e, tr in X.trades:
        for i, (kind, k) in enumerate(tr.legs):
            t, stopped, seen = tr.t0 + X.BAR, False, None
            while t <= tr.last_b:
                px = tr.series[i].get(t)
                if px is not None:
                    if seen is None and px >= MULT * tr.entry[i]:
                        stopped = True
                        break
                    if seen is None and px <= f * tr.entry[i]:
                        seen, seen_px, later_stop = t, px, False
                    elif seen is not None and px >= MULT * tr.entry[i]:
                        later_stop = True
                t += X.BAR
            if stopped or seen is None:
                continue
            got += 1
            when.append((seen - tr.t0).total_seconds() / 3600)
            final = X.intrinsic(kind, k, tr.settle_spot)
            hurt_stop += later_stop
            hurt_entry += final > tr.entry[i]
            some += final > 0
            # holding on instead of buying back at the cheap price: + the cheap price saved, - what it settled at (per 100 lots)
            cost.append((final - seen_px) * X.Q)
    legs = 2 * len(X.trades)
    if got:
        when.sort()
        print(f"   {100 * f:5g} %  {got:6d} of {legs:4d} ({100 * got / legs:3.0f} %) {when[len(when) // 2]:15.1f} h {hurt_stop:19d} {hurt_entry:20d} {some:23d} {sum(cost) / got:+24.2f}")
print()

# The owner's correction (22 Nov 2026): a fixed option price ("it's value 5"), not a share of the entry price.
# Optional 10th argument: marks in USD per unit of the coin, comma separated (for example 10,5,2 for BTC).
if len(sys.argv) > 10 and sys.argv[10]:
    LEVELS = [float(x) for x in sys.argv[10].split(",")]

    def run_abs(tr, level):
        live, realised, t = list(range(len(tr.legs))), -tr.fee_in, tr.t0 + X.BAR
        while t <= tr.last_b and live:
            sp = tr.spot.get(t, tr.settle_spot)
            for i in list(live):
                px = tr.series[i].get(t)
                if px is not None and (px >= MULT * tr.entry[i] or px <= level):
                    realised += -(px - tr.entry[i]) * X.Q - X.fee(sp, px)
                    live.remove(i)
            t += X.BAR
        return realised + sum(tr.settle_leg(i) for i in live)

    print(f"   {LABEL}: buy a sold leg back alone when its mark falls to a fixed price (mean entry price of a leg {sum(sum(tr.entry) for _, tr in X.trades) / (2 * len(X.trades)):.1f})")
    print(f"   {'hold both legs to settlement (the stop only)':52s} {st([(e, run(tr)) for e, tr in X.trades])}")
    for lv in LEVELS:
        print(f"   {'buy a leg back alone at a mark of ' + format(lv, 'g'):52s} {st([(e, run_abs(tr, lv)) for e, tr in X.trades])}")
    print(f"\n   {'mark':>8s} {'legs that got there':>20s} {'hours in (median)':>18s} {'later back above 5x':>20s} {'above 10x':>10s} {'hit the stop':>13s} {'settled above entry':>20s} {'settled with any value':>23s} {'highest later mark (median, max)':>33s}")
    for lv in LEVELS:
        got = x5 = x10 = stop = above = some = 0
        when, highs = [], []
        for e, tr in X.trades:
            for i, (kind, k) in enumerate(tr.legs):
                t, seen, hi, stopped_first, later_stop = tr.t0 + X.BAR, None, 0.0, False, False
                while t <= tr.last_b:
                    px = tr.series[i].get(t)
                    if px is not None:
                        if seen is None:
                            if px >= MULT * tr.entry[i]:
                                stopped_first = True
                                break
                            if px <= lv:
                                seen = t
                        else:
                            hi = max(hi, px)
                            later_stop = later_stop or px >= MULT * tr.entry[i]
                    t += X.BAR
                if stopped_first or seen is None:
                    continue
                final = X.intrinsic(kind, k, tr.settle_spot)
                hi = max(hi, final)
                got += 1
                when.append((seen - tr.t0).total_seconds() / 3600)
                highs.append(hi)
                x5 += hi >= 5 * lv
                x10 += hi >= 10 * lv
                stop += later_stop
                above += final > tr.entry[i]
                some += final > 0
        legs = 2 * len(X.trades)
        if got:
            when.sort(); highs.sort()
            print(f"   {lv:8g} {got:6d} of {legs:4d} ({100 * got / legs:3.0f} %) {when[len(when) // 2]:15.1f} h {x5:20d} {x10:10d} {stop:13d} {above:20d} {some:23d} {highs[len(highs) // 2]:20.1f}, {highs[-1]:9.1f}")
    print()
