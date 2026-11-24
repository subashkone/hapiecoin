"""The cautious set-ups of study_stack.py with bought wings (asked by the owner through the build thread, 24 Nov 2026:
"go, and test wings"): a stop limits a loss only as far as its fill, a wing caps it outright. The same evening
strangle, the same fees and fills as study_exits.py (imported; run without -I from this folder), and beyond each sold
strike an option bought a further share of the spot away (the listed strike nearest to that distance that has a mark
at the entry and lies beyond the sold strike). A day with no such strike on either side, or with no net credit, is
left out of that block and counted.

Rows of every block:
  hold           everything to settlement, no stop;
  stack          the cautious stack: a sold option bought back at <stop> times its entry price or once its mark is at
                 or under the buy-back mark, and the whole trade closed by the trail;
                 "wing sold with it": a stop on a sold option also sells that side's wing at the same bar;
                 "wing kept": the wing stays until the trail closes the trade or to settlement.
                 A buy-back of a nearly worthless sold option always leaves its wing (worth less than its fee);
  trail only     no stop and no buy-back, the whole trade closed by the trail.
The trail and "bad days" are judged on the NET premium (collected less paid). A wing with no mark at a bar is valued
at its last mark (counted in "carried"); far strikes are marked by the exchange's model, not by trades.
Columns: mean per day, share of days positive, total, worst day, worst three, largest drawdown, days losing more than
a quarter of the net premium, the two halves, premium collected / paid, and the structure's true largest loss (the
wider side's width less the net premium, plus the entry fees): its mean and its largest over the days.

Usage: python study_wings_stack.py <cache_dir> <lot_size> <bar_minutes> <entry_hours_before> <percent_away> "" "" <label> <buy-back mark> <stop multiple> <trail arm %> <trail give-back %> <wing distances in % of spot, comma> [slip]
       (with "slip" every market fill, the entry and the wings included, is worse than the mark by the share measured
       on real fills; a leg left to settlement pays none)"""
import sys
import study_exits as X

LABEL, MARK, MULT = sys.argv[8], float(sys.argv[9]), float(sys.argv[10])
TRAIL = (float(sys.argv[11]) / 100, float(sys.argv[12]) / 100)
WINGS = [float(x) for x in sys.argv[13].split(",") if x]
Q = X.Q
SLIP = len(sys.argv) > 14 and sys.argv[14] == "slip"


def slip(p, sp):
    """As in study_stack.py: what a market order loses against the mark, from the owner's own fills."""
    if not SLIP:
        return 0.0
    r = p / sp
    return p * Q * (0.01 if r >= 0.004 else 0.025 if r >= 0.0007 else 0.065)


def wing(opts, t0, s0, kind, sold_k, w):
    best = None
    for (kd, k), series in opts.items():
        if kd != kind or t0 not in series or (k <= sold_k if kind == "C" else k >= sold_k):
            continue
        score = abs(k - s0 * (1 + X.PCT + w if kind == "C" else 1 - X.PCT - w))
        if best is None or score < best[0]:
            best = (score, k)
    return None if best is None else best[1]


def build(tr, opts, w):
    """legs: (sign, kind, strike, series, entry price); sign -1 sold, +1 bought. None when a wing is missing."""
    legs = [(-1, kind, k, tr.series[i], tr.entry[i]) for i, (kind, k) in enumerate(tr.legs)]
    if w is None:
        return legs
    for kind, k in tr.legs:
        wk = wing(opts, tr.t0, tr.spot[tr.t0], kind, k, w)
        if wk is None:
            return None
        legs.append((1, kind, wk, opts[(kind, wk)], opts[(kind, wk)][tr.t0]))
    return legs


carried = [0, 0]  # wing bars valued at the last mark, wing bars in all


def run(tr, legs, mult=None, mark=None, trail=None, wing_out=False):
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
            if legs[i][0] > 0:
                carried[1] += 1
                if p is None:
                    carried[0] += 1
                    p = last[i]
            if p is not None:
                last[i] = p
            px[i] = p
        for i in [j for j in live if legs[j][0] < 0]:
            if px[i] is None:
                continue
            hit = mult is not None and px[i] >= mult * legs[i][4]
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


def cap(tr, legs):
    """The largest loss the structure can make at settlement: the wider side's width less the net premium, plus the entry fees."""
    sold = {kind: k for s, kind, k, *_ in legs if s < 0}
    width = max(abs(k - sold[kind]) for s, kind, k, *_ in legs if s > 0)
    return (width * Q - sum(-s * e * Q for s, *_, e in legs)) + sum(X.fee(tr.spot[tr.t0], e) for *_, e in legs)


ROWS = [
    ("hold to settlement, no stop", dict(), False),
    (f"stack: stop {MULT:g}x, buy-back, trail; wing sold with it", dict(mult=MULT, mark=MARK, trail=TRAIL, wing_out=True), True),
    (f"stack: stop {MULT:g}x, buy-back, trail; wing kept", dict(mult=MULT, mark=MARK, trail=TRAIL), False),
    ("trail only", dict(trail=TRAIL), False),
]

trades = sorted(X.trades, key=lambda x: x[0])
opts_of = {e: X.load(e)[1] for e, _ in trades}
print(f"## {LABEL}{' WITH SLIPPAGE' if SLIP else ''}: {len(trades)} days ({trades[0][0]} .. {trades[-1][0]}), sold {X.PCT * 100:g} % away, entered {X.ENTRY:g} h before settlement; stop {MULT:g}x, buy-back mark {MARK:g}, trail from {TRAIL[0] * 100:g} % giving back {TRAIL[1] * 100:g} %")
head = f"   {'':56s} {'mean':>7s} {'win':>4s} {'total':>7s} {'worst':>7s} {'worst 3':>8s} {'drawdown':>8s} {'bad days':>8s} {'halves':>13s}"
for w in [None] + WINGS:
    built = [(e, tr, build(tr, opts_of[e], None if w is None else w / 100)) for e, tr in trades]
    missing = sum(1 for *_, lg in built if lg is None)
    built = [(e, tr, lg) for e, tr, lg in built if lg is not None]
    nocredit = sum(1 for *_, lg in built if sum(-s * x * Q for s, *_, x in lg) <= 0)
    built = [(e, tr, lg) for e, tr, lg in built if sum(-s * x * Q for s, *_, x in lg) > 0]
    n = len(built)
    got = sum(sum(x * Q for s, *_, x in lg if s < 0) for *_, lg in built) / n
    paid = sum(sum(x * Q for s, *_, x in lg if s > 0) for *_, lg in built) / n
    if w is None:
        print(f"\n-- no wings: {n} days; mean premium collected {got:.1f}; the largest loss has no cap")
    else:
        caps = [cap(tr, lg) for _, tr, lg in built]
        far = sum(abs(k - tr.spot[tr.t0]) / tr.spot[tr.t0] for _, tr, lg in built for s, _, k, *_ in lg if s > 0) / (2 * n)
        print(f"\n-- wings {w:g} % of the spot beyond the sold strikes (on average {far * 100:.1f} % from the spot): {n} days ({missing} without a marked wing, {nocredit} without a net credit); mean premium collected {got:.1f}, paid {paid:.1f}, net {got - paid:.1f}; largest possible loss: mean {sum(caps) / n:.1f}, largest {max(caps):.1f}")
    print(head)
    for name, kw, only_winged in ROWS:
        if w is None and only_winged:
            continue
        carried[0] = carried[1] = 0
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
        note = f"  carried {100 * carried[0] / carried[1]:.1f} % of wing bars" if carried[1] else ""
        label = name.replace("; wing kept", "") if w is None else name
        print(f"   {label:56s} {sum(vals) / n:+7.2f} {100 * sum(1 for v in vals if v > 0) / n:3.0f}% {sum(vals):+7.0f} {min(vals):+7.1f} {sum(sorted(vals)[:3]):+8.1f} {-dd:+8.1f} {bad:8d} {h:>13s}{note}")
print()
