"""Three ideas for the days of a large move (the owner, 24 Nov 2026: "How can we avoid losses and when these kind of
moves happen and how to get benifitted from it?", then "test the three ideas"), each laid over one base set of rules
on the evening strangle of study_exits.py (imported; run without -I from this folder; same fees and fills):

  1. one side   by the spot's move over the 4 hours before the entry: after a fall beyond a threshold only the call
                is sold, after a rise only the put ("with the move"), or the reverse ("against"), or only the put is
                dropped after a fall, or no trade at all after a fall (or after either); otherwise both sides as usual. The base rules run on whatever was sold.
  2. follow     when a stop fires on a sold option, an option of the same kind is bought at that bar, the listed
                strike with a mark nearest a distance from the spot at that moment (further out of the money), 100
                lots, and held to settlement. It does not touch the base trade: its result is added.
  3. crash      at the entry a share of the premium collected is spent on far options, the listed strikes with a
                mark nearest a distance from the spot, the same quantity on each side (or puts alone), held to
                settlement. The quantity is whatever the budget buys, capped at 500 lots a side; a real order
                needs whole lots. It does not touch the base trade: its result is added.

Columns: mean per day, share of days positive, total, worst day, worst three, largest drawdown, the two halves, the
result on the expiries named, and for 2 and 3 the add-on alone (total, days it was bought, days it paid).

Usage: python study_moves.py <cache_dir> <lot_size> <bar_minutes> <entry_hours_before> <percent_away> "" "" <label> <buy-back mark, 0 for none> <stop multiple> <trail arm %, 0 for none> <trail give-back %> <expiries to show, comma> [slip]
       (with "slip" every market fill is worse than the mark by the share measured on real fills; settlement pays none)"""
import os, sys, datetime as dt
import study_exits as X

LABEL, MARK, MULT = sys.argv[8], float(sys.argv[9]) or None, float(sys.argv[10])
TRAIL = (float(sys.argv[11]) / 100, float(sys.argv[12]) / 100) if float(sys.argv[11]) else None
SHOW = [x for x in sys.argv[13].split(",") if x] if len(sys.argv) > 13 else []
SLIP = len(sys.argv) > 14 and sys.argv[14] == "slip"
Q = X.Q


def slip(p, sp, q=None):
    """As in study_stack.py: what a market order loses against the mark, from the owner's own fills."""
    if not SLIP:
        return 0.0
    r = p / sp
    return p * (Q if q is None else q) * (0.01 if r >= 0.004 else 0.025 if r >= 0.0007 else 0.065)


def fee(sp, p, q):
    return X.fee(sp, p) * q / Q


spot_all = {}
for e in sorted(os.listdir(X.CACHE)):
    if os.path.isdir(os.path.join(X.CACHE, e)):
        spot_all.update(X.load(e)[0])


def move4(tr):
    past = spot_all.get(tr.t0 - dt.timedelta(hours=4))
    return None if past is None else tr.spot[tr.t0] / past - 1


def run(tr, sides=(0, 1)):
    """The base rules on the legs in `sides` (0 put, 1 call as tr.legs has them). Returns the result and the stops
    that fired as (time, kind, spot)."""
    live = [i for i in range(len(tr.legs)) if i in sides]
    if not live:
        return 0.0, []
    sp0 = tr.spot[tr.t0]
    fee_in = sum(X.fee(sp0, tr.entry[i]) for i in live)
    credit = sum(tr.entry[i] * Q for i in live)
    realised, t, best, stops = -fee_in - sum(slip(tr.entry[i], sp0) for i in live), tr.t0 + X.BAR, None, []
    while t <= tr.last_b and live:
        sp = tr.spot.get(t, tr.settle_spot)
        px = {i: tr.series[i].get(t) for i in live}
        for i in list(live):
            if px[i] is None:
                continue
            hit = px[i] >= MULT * tr.entry[i]
            if hit or (MARK is not None and px[i] <= MARK):
                realised += -(px[i] - tr.entry[i]) * Q - X.fee(sp, px[i]) - slip(px[i], sp)
                live.remove(i)
                if hit:
                    stops.append((t, tr.legs[i][0], sp))
        if TRAIL is not None and live and all(px[i] is not None for i in live):
            rest = sum(-(px[i] - tr.entry[i]) * Q for i in live)
            total = (realised + fee_in + rest) / credit
            if best is not None or total >= TRAIL[0]:
                best = total if best is None else max(best, total)
                if total <= best * (1 - TRAIL[1]):
                    return realised + rest - sum(X.fee(sp, px[i]) + slip(px[i], sp) for i in live), stops
        t += X.BAR
    return realised + sum(tr.settle_leg(i) for i in live), stops


def far(opts, t, sp, kind, dist):
    """The listed strike of that kind with a mark at t nearest dist from the spot, out of the money."""
    best = None
    for (kd, k), series in opts.items():
        if kd != kind or t not in series or (k <= sp if kind == "C" else k >= sp):
            continue
        score = abs(k - sp * (1 + dist if kind == "C" else 1 - dist))
        if best is None or score < best[0]:
            best = (score, k)
    return None if best is None else best[1]


def bought(tr, opts, t, sp, kind, dist, q):
    """Buy q of the far option at t, hold to settlement. None when no strike has a mark."""
    k = far(opts, t, sp, kind, dist)
    if k is None:
        return None
    p = opts[(kind, k)][t]
    v = X.intrinsic(kind, k, tr.settle_spot)
    return (v - p) * q - fee(sp, p, q) - slip(p, sp, q) - fee(tr.settle_spot, v, q)


trades = sorted(X.trades, key=lambda x: x[0])
opts_of = {e: X.load(e)[1] for e, _ in trades}
base = {e: run(tr) for e, tr in trades}
n = len(trades)


def line(name, vals, extra=""):
    v = [vals[e] for e, _ in trades]
    mid = trades[n // 2][0]
    cum = peak = dd = 0.0
    for x in v:
        cum += x
        peak = max(peak, cum)
        dd = max(dd, peak - cum)
    h = f"{sum(vals[e] for e, _ in trades if e < mid):+.0f}/{sum(vals[e] for e, _ in trades if e >= mid):+.0f}"
    print(f"   {name:58s} {sum(v) / n:+7.2f} {100 * sum(1 for x in v if x > 0) / n:3.0f}% {sum(v):+7.0f} {min(v):+7.1f} {sum(sorted(v)[:3]):+8.1f} {-dd:+8.1f} {h:>13s}  "
          + "  ".join(f"{vals[e]:+7.1f}" if e in vals else f"{'':>7s}" for e in SHOW) + extra)


rules = f"stop {MULT:g}x" + (f", buy-back at {MARK:g}" if MARK else "") + (f", trail from {TRAIL[0] * 100:g} % giving back {TRAIL[1] * 100:g} %" if TRAIL else "")
print(f"## {LABEL}{' WITH SLIPPAGE' if SLIP else ''}: {n} days ({trades[0][0]} .. {trades[-1][0]}), each side {X.PCT * 100:g} % away, entered {X.ENTRY:g} h before settlement; base rules: {rules}")
print(f"   {'':58s} {'mean':>7s} {'win':>4s} {'total':>7s} {'worst':>7s} {'worst 3':>8s} {'drawdown':>8s} {'halves':>13s}  " + "  ".join(f"{e[5:]:>7s}" for e in SHOW))
line("base: both sides every day", {e: r for e, (r, _) in base.items()})

print("\n-- 1. one side by the move over the 4 hours before the entry")
mv = {e: move4(tr) for e, tr in trades}
for th in (0.005, 0.01, 0.015):
    up = sum(1 for e in mv if mv[e] is not None and mv[e] > th)
    dn = sum(1 for e in mv if mv[e] is not None and mv[e] < -th)
    print(f"   beyond {th * 100:g} %: {dn} days after a fall, {up} after a rise, {sum(1 for e in mv if mv[e] is None)} without history")
    for name, after_fall, after_rise in (("with the move: fall > call only, rise > put only", (1,), (0,)),
                                         ("after a fall the call only; after a rise both", (1,), (0, 1)),
                                         ("after a rise the put only; after a fall both", (0, 1), (0,)),
                                         ("against the move: fall > put only, rise > call only", (0,), (1,)),
                                         ("no trade after a fall; after a rise both", (), (0, 1)),
                                         ("no trade after a fall or a rise", (), ())):
        vals = {}
        for e, tr in trades:
            m = mv[e]
            sides = (0, 1) if m is None or abs(m) <= th else after_fall if m < 0 else after_rise
            idx = tuple(i for i, (kind, _) in enumerate(tr.legs) if (1 if kind == "C" else 0) in sides)
            vals[e] = base[e][0] if len(idx) == 2 else run(tr, idx)[0]
        line(f"  {name}", vals)

print("\n-- 2. follow the move: on a stop, buy the same kind further out, 100 lots, to settlement")
nstop = sum(len(s) for _, s in base.values())
print(f"   {nstop} stops on {sum(1 for _, s in base.values() if s)} days")
for dist in (0.0, 0.005, 0.01, 0.02):
    vals, add, used, paid, miss = {}, 0.0, 0, 0, 0
    for e, tr in trades:
        r, stops = base[e]
        a = 0.0
        for t, kind, sp in stops:
            b = bought(tr, opts_of[e], t, sp, kind, dist, Q)
            if b is None:
                miss += 1
                continue
            a += b
            used += 1
            paid += b > 0
        vals[e] = r + a
        add += a
    line(f"  buy {dist * 100:g} % beyond the spot at the stop", vals, f"   add-on alone {add:+.0f}; bought {used}, paid {paid}, no mark {miss}")

print("\n-- 3. a standing crash purchase at the entry, a share of the premium, to settlement")
for share in (0.1, 0.2):
    for dist in (0.03, 0.04, 0.05):
        for kinds, tag in ((("P", "C"), "both sides"), (("P",), "puts only")):
            vals, add, used, paid, miss, lots = {}, 0.0, 0, 0, 0, []
            for e, tr in trades:
                sp0 = tr.spot[tr.t0]
                ks = [(kind, far(opts_of[e], tr.t0, sp0, kind, dist)) for kind in kinds]
                if any(k is None for _, k in ks):
                    miss += 1
                    vals[e] = base[e][0]
                    continue
                cost = sum(opts_of[e][(kind, k)][tr.t0] for kind, k in ks)
                q = min(share * tr.credit / cost, 5 * Q) if cost > 0 else 0.0
                a = sum(bought(tr, opts_of[e], tr.t0, sp0, kind, dist, q) for kind, _ in ks) if q else 0.0
                lots.append(q / X.LOT)
                vals[e] = base[e][0] + a
                add += a
                used += 1
                paid += a > 0
            line(f"  {share * 100:g} % of the premium, {dist * 100:g} % away, {tag}", vals,
                 f"   add-on alone {add:+.0f}; bought {used}, paid {paid}, no mark {miss}, mean {sum(lots) / max(1, len(lots)):.0f} lots a side")
print()
