"""The BTC daily "wings-3" structure with a stop at double on each sold option (asked by the build thread at the
owner's word, 27 Nov 2026: a loss-capped BTC daily candidate, to be tabled before anything is built).

The structure of the first daily study (study.py, "strangle 600 with wings at 1600"): at the evening entry the
centre is the spot rounded to 200; a put and a call are SOLD 600 from the centre (three strikes out) and a put and a
call BOUGHT 1,600 from it (eight strikes out). 100 lots a leg. A day on which one of the four has no mark at the
entry bar is left out and counted; so is a day with no net credit.

Exits (the spot, the option series, the entry bar, the fee and the settlement of study_exits.py, imported; run
without -I from this folder):
  stop        a sold option is bought back at the mark of the first bar at which its mark is at or above the stop
              multiple of its sale price.
              A1 "wing kept": the wing of a stopped side stays to settlement (or to a close of the whole trade).
              A2 "wing sold": the wing is sold at that same bar.
  trail       on the whole trade: once it is ahead by the arming share of the NET premium (collected less paid),
              everything is closed when the profit is at or under (1 - give-back) of its best.
  buy-back    a sold option is bought back alone once its mark is at or under a price; its wing is left.
  take        the whole trade closed once it is ahead by a share of the net premium (the app's "take half" at 50 %).
  trail rest  after a stop, the other sold option is bought back once its own profit has given back a share of its
              best since the stop (the app's "trail the rest", 50 %); in A2 its wing is sold with it.
The profit of the whole trade is what was realised (entry costs included) plus the open legs at the mark. A wing
with no mark at a bar is valued, and if need be sold, at its last mark (counted in "carried"). Far strikes are
marked by the exchange's model, not by trades. With "slip" every market fill, the wings included, is worse than the
mark by the share measured on real fills (study_stack.py); a leg left to settlement pays its fee and no fill cost.

Columns: days traded, mean per day, share of days positive, total, worst day, worst three, largest drawdown, the
totals of Aug / Sep / Oct / Nov, the days a stop fired, the days closed by a trail or a take, and the bars at which a
wing was valued at a carried mark.
Header: the days, the days left out, the net premium and the structure's largest possible loss while all four legs
are open (the width of 1,000 less the net premium, plus the entry costs): mean and largest.
That figure bounds the structure HELD. With a stop it is not a bound: a stop realises a loss of the multiple less
one times that option's sale price, and two stops in a day, or a stop and then the other side through its strike,
can add up to more (with the stop at triple, 5 of the 90 traded days to 27 Nov lost more than their own figure).
Once no sold option is open the trade is over for the trail and the take: a wing still held goes to settlement.

Usage: python study_wings_stop.py <cache_dir> <lot_size> <bar_minutes> <entry_hours_before> 1 "" "" <label> <last expiry or ""> [slip]"""
import sys
import study_exits as X

LABEL, LAST = sys.argv[8], sys.argv[9]
SLIP = len(sys.argv) > 10 and sys.argv[10] == "slip"
Q = X.Q
STEP, SOLD, WING = 200, 600, 1600
OPTS = {}


def slip(p, sp):
    if not SLIP:
        return 0.0
    r = p / sp
    return p * Q * (0.01 if r >= 0.004 else 0.025 if r >= 0.0007 else 0.065)


def opts_of(exp):
    if exp not in OPTS:
        OPTS[exp] = X.load(exp)[1]
    return OPTS[exp]


def build(exp, tr, wings):
    """[legs] or a reason string. A leg: sign (-1 sold, +1 bought), kind, strike, series, entry, open, last mark."""
    opts, sp0 = opts_of(exp), tr.spot[tr.t0]
    c = int(round(sp0 / STEP) * STEP)
    want = [(-1, "P", c - SOLD), (-1, "C", c + SOLD)] + ([(1, "P", c - WING), (1, "C", c + WING)] if wings else [])
    legs = []
    for sign, kind, k in want:
        series = opts.get((kind, k))
        if series is None or tr.t0 not in series:
            return "no sold price" if sign < 0 else "no wing price"
        legs.append(dict(sign=sign, kind=kind, k=k, series=series, entry=series[tr.t0], open=True, last=series[tr.t0]))
    if wings and sum(-l["sign"] * l["entry"] for l in legs) <= 0:
        return "no net credit"
    return legs


def run(tr, legs, mult=None, wing_sold=False, trail=None, buyback=None, take=None, rest=None):
    """Returns (result, stop fired 0/1, closed by trail or take 0/1, carried marks)."""
    legs = [dict(l) for l in legs]
    sp0 = tr.spot[tr.t0]
    net = sum(-l["sign"] * l["entry"] for l in legs) * Q
    state = dict(real=-sum(X.fee(sp0, l["entry"]) + slip(l["entry"], sp0) for l in legs), carried=0)
    stopped = closed = 0
    armed, peak = False, 0.0
    rest_on, rest_peak = {}, {}

    def close(l, px, sp):
        state["real"] += l["sign"] * (px - l["entry"]) * Q - X.fee(sp, px) - slip(px, sp)
        l["open"] = False

    def wing_of(l):
        return next((w for w in legs if w["sign"] > 0 and w["kind"] == l["kind"] and w["open"]), None)

    t = tr.t0 + X.BAR
    while t <= tr.last_b and any(l["open"] and l["sign"] < 0 for l in legs):
        sp = tr.spot.get(t, tr.settle_spot)
        fresh = {}
        for l in legs:
            if l["open"]:
                m = l["series"].get(t)
                fresh[id(l)] = m is not None
                if m is not None:
                    l["last"] = m
                elif l["sign"] > 0:
                    state["carried"] += 1
        for l in [x for x in legs if x["open"] and x["sign"] < 0 and fresh[id(x)]]:
            m = l["last"]
            if mult is not None and m >= mult * l["entry"]:
                close(l, m, sp)
                stopped = 1
                w = wing_of(l)
                if wing_sold and w is not None:
                    close(w, w["last"], sp)
                if rest is not None:
                    for o in legs:
                        if o["open"] and o["sign"] < 0:
                            rest_on[id(o)], rest_peak[id(o)] = True, 0.0
            elif buyback is not None and m <= buyback:
                close(l, m, sp)
        for l in [x for x in legs if x["open"] and x["sign"] < 0 and rest_on.get(id(x)) and fresh[id(x)]]:
            p = (l["entry"] - l["last"]) * Q
            rest_peak[id(l)] = max(rest_peak[id(l)], p)
            if rest_peak[id(l)] > 0 and p <= (1 - rest) * rest_peak[id(l)]:
                w = wing_of(l)
                close(l, l["last"], sp)
                if wing_sold and w is not None:
                    close(w, w["last"], sp)
        live = [l for l in legs if l["open"]]
        if (trail or take) and any(l["sign"] < 0 for l in live) and all(fresh[id(l)] for l in live if l["sign"] < 0):
            pnl = state["real"] + sum(l["sign"] * (l["last"] - l["entry"]) * Q for l in live)
            out = take is not None and pnl >= take * net
            if trail:
                if not armed and pnl >= trail[0] * net:
                    armed, peak = True, pnl
                elif armed:
                    peak = max(peak, pnl)
                    out = out or pnl <= (1 - trail[1]) * peak
            if out:
                for l in live:
                    close(l, l["last"], sp)
                closed = 1
        t += X.BAR
    for l in legs:
        if l["open"]:
            v = X.intrinsic(l["kind"], l["k"], tr.settle_spot)
            state["real"] += l["sign"] * (v - l["entry"]) * Q - X.fee(tr.settle_spot, v)
    return state["real"], stopped, closed, state["carried"]


trades = sorted((e, tr) for e, tr in X.trades if not LAST or e <= LAST)
built = {w: {e: build(e, tr, w) for e, tr in trades} for w in (True, False)}


def line(name, wings=True, same_days=False, **kw):
    rows = [(e, run(tr, built[wings][e], **kw)) for e, tr in trades
            if not isinstance(built[wings][e], str) and not (same_days and isinstance(built[True][e], str))]
    v = [r[0] for _, r in rows]
    n = len(v)
    cum = peak = dd = 0.0
    for x in v:
        cum += x
        peak = max(peak, cum)
        dd = max(dd, peak - cum)
    months = " ".join(f"{sum(r[0] for e, r in rows if e[5:7] == m):+6.0f}" for m in ("08", "09", "10", "11"))
    print(f"   {name:58s} {n:4d} {sum(v) / n:+7.2f} {100 * sum(1 for x in v if x > 0) / n:3.0f}% {sum(v):+7.0f} {min(v):+7.1f} {sum(sorted(v)[:3]):+8.1f} {-dd:+8.1f}  {months} "
          f"{sum(r[1] for _, r in rows):5d} {sum(r[2] for _, r in rows):6d} {sum(r[3] for _, r in rows):7d}")


ok = [(e, tr, built[True][e]) for e, tr in trades if not isinstance(built[True][e], str)]
why = {}
for e, _ in trades:
    if isinstance(built[True][e], str):
        why[built[True][e]] = why.get(built[True][e], 0) + 1
nets, caps = [], []
for e, tr, legs in ok:
    net = sum(-l["sign"] * l["entry"] for l in legs) * Q
    costs = sum(X.fee(tr.spot[tr.t0], l["entry"]) + slip(l["entry"], tr.spot[tr.t0]) for l in legs)
    nets.append(net)
    caps.append((WING - SOLD) * Q - net + costs)
print(f"## {LABEL}{' WITH SLIPPAGE' if SLIP else ''}: {len(trades)} days ({trades[0][0]} .. {trades[-1][0]}), entered {X.ENTRY:g} h before settlement; sold {SOLD} and bought {WING} from the spot rounded to {STEP}; {len(ok)} days traded with wings, left out: {why or 'none'}")
print(f"   net premium mean {sum(nets) / len(nets):.1f} (least {min(nets):.1f}); largest possible loss with all four legs open: mean {sum(caps) / len(caps):.1f}, largest {max(caps):.1f}")
print(f"   {'':58s} {'days':>4s} {'mean':>7s} {'win':>4s} {'total':>7s} {'worst':>7s} {'worst 3':>8s} {'drawdown':>8s}  {'Aug':>6s} {'Sep':>6s} {'Oct':>6s} {'Nov':>6s} {'stops':>5s} {'closed':>6s} {'carried':>7s}")
print("   -- reference")
line("wings, held to settlement (no stop)")
line("naked 600, stop 2x on each sold option", wings=False, mult=2)
line("naked 600, stop 3x on each sold option", wings=False, mult=3)
line("naked 600, stop 2x, only the days traded with wings", wings=False, same_days=True, mult=2)
line("naked 600, stop 3x, only the days traded with wings", wings=False, same_days=True, mult=3)
line("naked 600, held, only the days traded with wings", wings=False, same_days=True)
for tag, ws in (("A1 wing kept", False), ("A2 wing sold with its stopped option", True)):
    print(f"   -- wings, stop 2x on each sold option; {tag}")
    line("A  the stop only", mult=2, wing_sold=ws)
    line("B  + trail from 15 %, give back 30 %", mult=2, wing_sold=ws, trail=(0.15, 0.30))
    line("B  + trail from 25 %, give back 30 %", mult=2, wing_sold=ws, trail=(0.25, 0.30))
    line("C  + buy-back of a sold option at a mark of 5", mult=2, wing_sold=ws, buyback=5)
    line("D  + take at 50 % of the net premium", mult=2, wing_sold=ws, take=0.5)
    line("D  + trail the rest by half after a stop", mult=2, wing_sold=ws, rest=0.5)
    line("D  + take at 50 % and trail the rest by half", mult=2, wing_sold=ws, take=0.5, rest=0.5)
    line("E  + trail from 25 % and buy-back at 5", mult=2, wing_sold=ws, trail=(0.25, 0.30), buyback=5)
    line("E  + trail from 25 % and trail the rest", mult=2, wing_sold=ws, trail=(0.25, 0.30), rest=0.5)
print("   -- wings, stop 3x on each sold option (for comparison)")
line("the stop only, wing kept", mult=3)
line("the stop only, wing sold", mult=3, wing_sold=True)
print()
