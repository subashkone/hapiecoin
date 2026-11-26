"""Adjustments made during the trade when the market runs one way (the owner, 26 Nov 2026: "the market in completly
one direction after we have went into the trade and most of our trades hit stop loss ... on a fly we can add
adjustments in this kind of situations ... in last 4 days this has happened twice"). The evening strangle with a
stop on every sold option, and on top of it one adjustment, made once a trade:

  roll the winner   when the trigger comes, the option on the OTHER side (the one the move helps) is bought back and
                    a new one of its kind sold nearer, a share of the spot of that moment away, with the same stop.
  add a winner      the same, but the old option on the other side is kept and the new one is extra.
  roll the loser    when a sold option reaches a multiple of its sale price below the stop, it is bought back and a
                    new one of its kind sold further out, a share of the spot of that moment away, with the same stop.
  spot exit         everything is closed once the spot is a share away from where it was at the entry.
  earlier stop      the stop at a lower multiple; or half of each option closed at a lower multiple and the rest at
                    the stop.
The trigger of the first two is the first stop that fires, or the first time a sold option reaches a multiple of
its sale price below the stop (an early warning). No new option is sold with under 2 hours left; the new strike is
the listed one nearest the target with a mark at that bar, not taken when it is more than 0.5 % of the spot off the
target or, for a roll, when it is the strike already held.

Already tested elsewhere and not repeated: a future at the strike (study_hedge.py), a scheduled futures hedge
(study_delta_hedge.py), an option bought when a stop fires (study_moves.py), closing a side near its strike
(study_exits.py), what to do with the other option after a stop without a new sale (study_after_stop.py).

The trades, fees and fills of study_exits.py (imported; run without -I from this folder). With "slip" every market
fill is worse than the mark by the share measured on real fills (study_stack.py); settlement pays its fee and no
fill cost.

Columns: mean per day, share of days positive, total, worst day, worst three, largest drawdown, the two halves, the
mean on the days a stop fires in the plain trade and on the other days, the number of adjustments made, and the
adjustments' own result (new options sold, less what the roll paid to close the old one; "-" where the rule changes
the stop itself).

Usage: python study_adjust.py <cache_dir> <lot_size> <bar_minutes> <entry_hours_before> <percent_away> "" "" <label> <stop multiple> [slip]"""
import sys, datetime as dt
import study_exits as X

LABEL, MULT = sys.argv[8], float(sys.argv[9])
SLIP = len(sys.argv) > 10 and sys.argv[10] == "slip"
Q = X.Q
MIN_LEFT = dt.timedelta(hours=2)
OPTS = {}


def slip(p, sp, size=1.0):
    if not SLIP:
        return 0.0
    r = p / sp
    return size * p * Q * (0.01 if r >= 0.004 else 0.025 if r >= 0.0007 else 0.065)


def opts_of(exp):
    if exp not in OPTS:
        OPTS[exp] = X.load(exp)[1]
    return OPTS[exp]


def new_option(exp, kind, t, sp, away, not_strike=None):
    """(strike, series) of the listed option of `kind` nearest `away` of the spot from it, with a mark at t; or None."""
    target, best = sp * (1 + away if kind == "C" else 1 - away), None
    for (kd, k), series in opts_of(exp).items():
        if kd != kind or t not in series or (k <= sp if kind == "C" else k >= sp):
            continue
        if best is None or abs(k - target) < abs(best[0] - target):
            best = (k, series)
    if best is None or abs(best[0] - target) > 0.005 * sp or best[0] == not_strike:
        return None
    return best


def run(exp, tr, adj=None, mult=MULT, half_at=None):
    """Returns (result, adjustments made, the adjustments' own result, 1 when a stop fired on an original option)."""
    sp0 = tr.spot[tr.t0]
    pos = []
    for i, (kind, k) in enumerate(tr.legs):
        if half_at is None:
            pos.append(dict(kind=kind, k=k, series=tr.series[i], entry=tr.entry[i], stop=mult, size=1.0, new=False))
        else:
            pos.append(dict(kind=kind, k=k, series=tr.series[i], entry=tr.entry[i], stop=half_at, size=0.5, new=False))
            pos.append(dict(kind=kind, k=k, series=tr.series[i], entry=tr.entry[i], stop=mult, size=0.5, new=False))
    realised = -tr.fee_in - sum(slip(e, sp0) for e in tr.entry)
    t, done, n_adj, adj_pl, stopped = tr.t0 + X.BAR, False, 0, 0.0, 0

    def close(p, px, sp):
        pl = p["size"] * (-(px - p["entry"]) * Q - X.fee(sp, px)) - slip(px, sp, p["size"])
        pos.remove(p)
        return pl

    def sell(kind, t, sp, away, not_strike=None):
        got = new_option(exp, kind, t, sp, away, not_strike)
        if got is None:
            return None
        e = got[1][t]
        pos.append(dict(kind=kind, k=got[0], series=got[1], entry=e, stop=mult, size=1.0, new=True))
        return -X.fee(sp, e) - slip(e, sp)

    while t <= tr.last_b and pos:
        sp = tr.spot.get(t, tr.settle_spot)
        px = {id(p): p["series"].get(t) for p in pos}
        trigger = None      # the kind of the option under pressure at this bar
        for p in list(pos):
            m = px[id(p)]
            if m is None:
                continue
            if m >= p["stop"] * p["entry"]:
                pl = close(p, m, sp)
                realised += pl
                if p["new"]:
                    adj_pl += pl
                else:
                    stopped = 1
                    if adj and adj[0] in ("roll winner", "add winner") and adj[1] == "stop":
                        trigger = p["kind"]
            elif adj and not p["new"] and adj[1] != "stop" and adj[0] != "spot exit" and m >= adj[1] * p["entry"]:
                trigger = p["kind"]
        late = tr.settle - t < MIN_LEFT
        if adj and adj[0] == "spot exit" and not done and abs(sp / sp0 - 1) >= adj[1] and all(px[id(p)] is not None for p in pos):
            realised += sum(close(p, px[id(p)], sp) for p in list(pos))
            done, n_adj = True, 1
        elif adj and trigger and not done and not late:
            other = "P" if trigger == "C" else "C"
            if adj[0] == "roll loser":
                old = [p for p in pos if p["kind"] == trigger and not p["new"]]
                if old and px[id(old[0])] is not None:
                    cost = sell(trigger, t, sp, adj[2], old[0]["k"])
                    if cost is not None:
                        realised += cost + close(old[0], px[id(old[0])], sp)     # the old option's result stays with the trade
                        adj_pl += cost
                        done, n_adj = True, 1
            else:
                old = [p for p in pos if p["kind"] == other and not p["new"]]
                if adj[0] == "add winner":
                    cost = sell(other, t, sp, adj[2])
                    if cost is not None:
                        realised, adj_pl, done, n_adj = realised + cost, adj_pl + cost, True, 1
                elif old and px[id(old[0])] is not None:
                    cost = sell(other, t, sp, adj[2], old[0]["k"])
                    if cost is not None:
                        m = px[id(old[0])]
                        paid = X.fee(sp, m) + slip(m, sp)          # what closing the old one early costs; its profit so far is the trade's
                        realised += cost + close(old[0], m, sp)
                        adj_pl += cost - paid
                        done, n_adj = True, 1
        t += X.BAR
    for p in pos:
        v = X.intrinsic(p["kind"], p["k"], tr.settle_spot)
        pl = p["size"] * (-(v - p["entry"]) * Q - X.fee(tr.settle_spot, v))
        realised += pl
        if p["new"]:
            adj_pl += pl
    return realised, n_adj, adj_pl, stopped


trades = sorted(X.trades, key=lambda x: x[0])
n = len(trades)
base = {e: run(e, tr) for e, tr in trades}
stop_days = [e for e, _ in trades if base[e][3]]
flags = [base[e][3] for e, _ in trades]
pairs = sum(1 for i in range(n) if flags[i] and any(flags[max(0, i - 3):i]))
runs4 = sum(1 for i in range(n - 3) if sum(flags[i:i + 4]) >= 2)
print(f"## {LABEL}{' WITH SLIPPAGE' if SLIP else ''}: {n} days ({trades[0][0]} .. {trades[-1][0]}), each side {X.PCT * 100:g} % away, entered {X.ENTRY:g} h before settlement; stop {MULT:g}x on every sold option")
print(f"   a stop fires on {len(stop_days)} of {n} days ({100 * len(stop_days) / n:.0f} %); on {pairs} of those days another stop day lies within the 3 days before; {runs4} of the {n - 3} windows of 4 days in a row hold 2 or more stop days")
print(f"   {'':52s} {'mean':>7s} {'win':>4s} {'total':>7s} {'worst':>7s} {'worst 3':>8s} {'drawdown':>8s} {'halves':>13s} {'stop days':>9s} {'other':>7s} {'adj':>4s} {'adj own':>8s}")


def line(name, own=True, **kw):
    rows = {e: run(e, tr, **kw) for e, tr in trades}
    v = [rows[e][0] for e, _ in trades]
    mid = trades[n // 2][0]
    cum = peak = dd = 0.0
    for x in v:
        cum += x
        peak = max(peak, cum)
        dd = max(dd, peak - cum)
    h = f"{sum(rows[e][0] for e, _ in trades if e < mid):+.0f}/{sum(rows[e][0] for e, _ in trades if e >= mid):+.0f}"
    on = [rows[e][0] for e in stop_days]
    off = [rows[e][0] for e, _ in trades if not base[e][3]]
    print(f"   {name:52s} {sum(v) / n:+7.2f} {100 * sum(1 for x in v if x > 0) / n:3.0f}% {sum(v):+7.0f} {min(v):+7.1f} {sum(sorted(v)[:3]):+8.1f} {-dd:+8.1f} {h:>13s} "
          f"{sum(on) / max(1, len(on)):+9.2f} {sum(off) / max(1, len(off)):+7.2f} {sum(r[1] for r in rows.values()):4d} " + (f"{sum(r[2] for r in rows.values()):+8.0f}" if own else f"{'-':>8s}"))


WARN = [m for m in (1.5, 2.0) if m < MULT]
line("the stop alone")
print("   -- roll the winner nearer (old one bought back, a new one sold)")
for trig in ["stop"] + WARN:
    for away in (0.01, 0.0075, 0.005):
        line(f"at {'the first stop' if trig == 'stop' else f'{trig:g}x on the other side'}: new one {away * 100:g} % away", adj=("roll winner", trig, away))
print("   -- add a winner (old one kept, one more sold)")
for trig in ["stop"] + WARN:
    for away in (0.01, 0.005):
        line(f"at {'the first stop' if trig == 'stop' else f'{trig:g}x on the other side'}: one more {away * 100:g} % away", adj=("add winner", trig, away))
print("   -- roll the loser further out before its stop")
for trig in WARN:
    for away in (0.01, 0.015):
        line(f"at {trig:g}x: new one {away * 100:g} % away", adj=("roll loser", trig, away))
print("   -- spot exit: everything closed once the spot has moved from the entry")
for mv in (0.005, 0.0075, 0.01, 0.0125):
    line(f"spot {mv * 100:g} % from the entry", own=False, adj=("spot exit", mv))
print("   -- earlier stop")
for m in (1.5, 2.0, 2.5):
    if m < MULT:
        line(f"stop at {m:g}x", own=False, mult=m)
        line(f"half at {m:g}x, the rest at {MULT:g}x", own=False, half_at=m)
print()
