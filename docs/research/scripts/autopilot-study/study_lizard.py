"""The Jade Lizard with the cautious rules (the owner, 24 Nov 2026: "test the Jade Lizard on ETH with the cautious
rules"): the evening strangle of study_exits.py (imported; run without -I from this folder) with a bought wing on ONE
side only, beside the same strangle with no wing, with the wing on the other side, and with both (the iron condor of
study_wings_stack.py, whose rules and conventions these are). The wing is the listed strike with a mark at the entry
nearest a further share of the spot beyond the sold strike. A day with no such strike, or with no net credit, is left
out of that block and counted.

Rows: hold to settlement; stop only; the cautious stack (a sold option bought back at <stop> times its entry price
or once its mark is at or under the buy-back mark, the whole trade closed by the trail on the NET premium), with the
wing sold when its side is stopped, or kept; the trail alone; and, where one side only has a wing, the trail with a
stop on the sold option of the side without one (with and without the buy-back).
Columns as study_wings_stack.py, and the largest loss the PUT side or the CALL side can make at settlement where that
side has a wing (its width less the net premium, plus the entry fees); a side without a wing has no cap.

Usage: python study_lizard.py <cache_dir> <lot_size> <bar_minutes> <entry_hours_before> <percent_away> "" "" <label> <buy-back mark> <stop multiple> <trail arm %> <trail give-back %> <wing distance in % of spot> <expiries to show, comma> [slip]"""
import sys
import study_exits as X

LABEL, MARK, MULT = sys.argv[8], float(sys.argv[9]), float(sys.argv[10])
TRAIL = (float(sys.argv[11]) / 100, float(sys.argv[12]) / 100)
WING = float(sys.argv[13]) / 100
SHOW = [x for x in sys.argv[14].split(",") if x] if len(sys.argv) > 14 else []
SLIP = len(sys.argv) > 15 and sys.argv[15] == "slip"
Q = X.Q


def slip(p, sp):
    if not SLIP:
        return 0.0
    r = p / sp
    return p * Q * (0.01 if r >= 0.004 else 0.025 if r >= 0.0007 else 0.065)


def wing(opts, t0, s0, kind, sold_k):
    best = None
    for (kd, k), series in opts.items():
        if kd != kind or t0 not in series or (k <= sold_k if kind == "C" else k >= sold_k):
            continue
        score = abs(k - s0 * (1 + X.PCT + WING if kind == "C" else 1 - X.PCT - WING))
        if best is None or score < best[0]:
            best = (score, k)
    return None if best is None else best[1]


def build(tr, opts, sides):
    """legs: (sign, kind, strike, series, entry price); sign -1 sold, +1 bought. None when a wing is missing."""
    legs = [(-1, kind, k, tr.series[i], tr.entry[i]) for i, (kind, k) in enumerate(tr.legs)]
    for kind, k in tr.legs:
        if kind not in sides:
            continue
        wk = wing(opts, tr.t0, tr.spot[tr.t0], kind, k)
        if wk is None:
            return None
        legs.append((1, kind, wk, opts[(kind, wk)], opts[(kind, wk)][tr.t0]))
    return legs


def run(tr, legs, mult=None, mark=None, trail=None, wing_out=False, bare=None):
    """bare: a stop at that multiple only on a sold option whose side has no wing (the owner, 24 Nov 2026: "test the
    Jade Lizard with a stop on the call")."""
    winged = {kind for s, kind, *_ in legs if s > 0}
    fee_in = sum(X.fee(tr.spot[tr.t0], e) + slip(e, tr.spot[tr.t0]) for *_, e in legs)
    credit = sum(-s * e * Q for s, *_, e in legs)
    live, realised, t, best = list(range(len(legs))), -fee_in, tr.t0 + X.BAR, None
    last = {i: legs[i][4] for i in live}

    def out(i, p, sp):
        s, _, _, _, e = legs[i]
        live.remove(i)
        return s * (p - e) * Q - X.fee(sp, p) - slip(p, sp)

    while t <= tr.last_b and live:
        sp = tr.spot.get(t, tr.settle_spot)
        px = {}
        for i in live:
            p = legs[i][3].get(t)
            if legs[i][0] > 0 and p is None:
                p = last[i]
            if p is not None:
                last[i] = p
            px[i] = p
        for i in [j for j in live if legs[j][0] < 0]:
            if px[i] is None:
                continue
            hit = mult is not None and px[i] >= mult * legs[i][4]
            hit = hit or (bare is not None and legs[i][1] not in winged and px[i] >= bare * legs[i][4])
            if hit or (mark is not None and px[i] <= mark):
                realised += out(i, px[i], sp)
                if hit and wing_out:
                    for j in [j for j in live if legs[j][0] > 0 and legs[j][1] == legs[i][1]]:
                        realised += out(j, px[j], sp)
        if live and all(px[i] is not None for i in live):
            rest = sum(legs[i][0] * (px[i] - legs[i][4]) * Q for i in live)
            total = (realised + fee_in + rest) / credit
            if trail is not None and (best is not None or total >= trail[0]):
                best = total if best is None else max(best, total)
                if total <= best * (1 - trail[1]):
                    return realised + rest - sum(X.fee(sp, px[i]) + slip(px[i], sp) for i in live)
        t += X.BAR
    for i in live:
        s, kind, k, _, e = legs[i]
        v = X.intrinsic(kind, k, tr.settle_spot)
        realised += s * (v - e) * Q - X.fee(tr.settle_spot, v)
    return realised


def cap(tr, legs, kind):
    """The largest loss that side can make at settlement: its width less the net premium, plus the entry fees."""
    sold = [k for s, kd, k, *_ in legs if s < 0 and kd == kind][0]
    w = [k for s, kd, k, *_ in legs if s > 0 and kd == kind][0]
    return abs(w - sold) * Q - sum(-s * e * Q for s, *_, e in legs) + sum(X.fee(tr.spot[tr.t0], e) for *_, e in legs)


ROWS = [
    ("hold to settlement, no stop", dict(), False),
    (f"stop {MULT:g}x only", dict(mult=MULT), False),
    (f"stop {MULT:g}x only, wing sold with it", dict(mult=MULT, wing_out=True), True),
    (f"cautious: stop {MULT:g}x, buy-back, trail; wing sold with it", dict(mult=MULT, mark=MARK, trail=TRAIL, wing_out=True), True),
    (f"cautious: stop {MULT:g}x, buy-back, trail; wing kept", dict(mult=MULT, mark=MARK, trail=TRAIL), False),
    ("trail only", dict(trail=TRAIL), False),
    ("trail, and a stop 2x on the side without a wing", dict(trail=TRAIL, bare=2), "one"),
    ("trail, and a stop 3x on the side without a wing", dict(trail=TRAIL, bare=3), "one"),
    ("trail, stop 2x on the side without a wing, buy-back", dict(trail=TRAIL, bare=2, mark=MARK), "one"),
    ("trail, stop 3x on the side without a wing, buy-back", dict(trail=TRAIL, bare=3, mark=MARK), "one"),
]
BLOCKS = [("no wing (the strangle)", ""), ("Jade Lizard: wing on the PUT side", "P"), ("Reverse Jade Lizard: wing on the CALL side", "C"), ("wings on both sides", "PC")]

trades = sorted(X.trades, key=lambda x: x[0])
opts_of = {e: X.load(e)[1] for e, _ in trades}
print(f"## {LABEL}{' WITH SLIPPAGE' if SLIP else ''}: {len(trades)} days ({trades[0][0]} .. {trades[-1][0]}), sold {X.PCT * 100:g} % away, wing {WING * 100:g} % of the spot further, entered {X.ENTRY:g} h before settlement; stop {MULT:g}x, buy-back mark {MARK:g}, trail from {TRAIL[0] * 100:g} % giving back {TRAIL[1] * 100:g} %")
head = f"   {'':58s} {'mean':>7s} {'win':>4s} {'total':>7s} {'worst':>7s} {'worst 3':>8s} {'drawdown':>8s} {'bad days':>8s} {'halves':>13s}  " + "  ".join(f"{e[5:]:>7s}" for e in SHOW)
for title, sides in BLOCKS:
    built = [(e, tr, build(tr, opts_of[e], sides)) for e, tr in trades]
    missing = sum(1 for *_, lg in built if lg is None)
    built = [(e, tr, lg) for e, tr, lg in built if lg is not None]
    nocredit = sum(1 for *_, lg in built if sum(-s * x * Q for s, *_, x in lg) <= 0)
    built = [(e, tr, lg) for e, tr, lg in built if sum(-s * x * Q for s, *_, x in lg) > 0]
    n = len(built)
    got = sum(sum(x * Q for s, *_, x in lg if s < 0) for *_, lg in built) / n
    paid = sum(sum(x * Q for s, *_, x in lg if s > 0) for *_, lg in built) / n
    caps = ""
    for kind, word in (("P", "put"), ("C", "call")):
        if kind in sides:
            c = [cap(tr, lg, kind) for _, tr, lg in built]
            caps += f"; largest loss on the {word} side: mean {sum(c) / n:.1f}, largest {max(c):.1f}"
        else:
            caps += f"; no cap on the {word} side"
    print(f"\n-- {title}: {n} days ({missing} without a marked wing, {nocredit} without a net credit); mean premium collected {got:.1f}, paid {paid:.1f}, net {got - paid:.1f}{caps}")
    print(head)
    for name, kw, only_winged in ROWS:
        if (not sides and only_winged) or (only_winged == "one" and len(sides) != 1):
            continue
        rows = [(e, run(tr, lg, **kw), sum(-s * x * Q for s, *_, x in lg)) for e, tr, lg in built]
        vals = [v for _, v, _ in rows]
        mid = sorted(e for e, *_ in rows)[n // 2]
        cum = peak = dd = 0.0
        for v in vals:
            cum += v
            peak = max(peak, cum)
            dd = max(dd, peak - cum)
        bad = sum(1 for _, v, c in rows if v < -0.25 * c)
        h = f"{sum(v for e, v, _ in rows if e < mid):+.0f}/{sum(v for e, v, _ in rows if e >= mid):+.0f}"
        by = {e: v for e, v, _ in rows}
        label = name.replace("; wing kept", "") if not sides else name
        print(f"   {label:58s} {sum(vals) / n:+7.2f} {100 * sum(1 for v in vals if v > 0) / n:3.0f}% {sum(vals):+7.0f} {min(vals):+7.1f} {sum(sorted(vals)[:3]):+8.1f} {-dd:+8.1f} {bad:8d} {h:>13s}  "
              + "  ".join(f"{by[e]:+7.1f}" if e in by else f"{'':>7s}" for e in SHOW))
print()
