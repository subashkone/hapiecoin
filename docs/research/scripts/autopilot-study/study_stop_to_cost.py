"""The stop moved down once the trade is ahead (the owner, 27 Nov 2026: "When we have 2x or 3x set as stop loss and
if the price have fallen half on both sides then shall we reduce the stop loss to cost?"). The evening strangle with a
stop on every sold option at a multiple of its sale price; once the trade is "armed" the stop of every option still
open is moved to a lower multiple of its own sale price (1 = its cost).

Armed, two readings:
  both legs   both sold options are open and each has a mark at or under a share of its own sale price at the same bar.
  the trade   the trade as a whole (the open options at the mark, with what a stop already took) is ahead by a share of
              the premium sold.
After that a sold option is bought back at the mark of the first bar at which its mark is at or above the new stop.
The stop is never moved up: an option whose new stop is above its old one keeps the old one.

The trades, fees and fills of study_exits.py (imported; run without -I from this folder). With "slip" every market
fill is worse than the mark by the share measured on real fills (study_stack.py); settlement pays its fee and no
fill cost.

Columns: mean per day, share of days positive, total, worst day, worst three, largest drawdown, the two halves, the
days the rule armed, the days a moved stop then fired, and on those days the sum of the results with the rule and
with the plain stop (what the move gained or cost where it acted).

Usage: python study_stop_to_cost.py <cache_dir> <lot_size> <bar_minutes> <entry_hours_before> <percent_away> "" "" <label> <stop multiple> [slip]"""
import sys
import study_exits as X

LABEL, MULT = sys.argv[8], float(sys.argv[9])
SLIP = len(sys.argv) > 10 and sys.argv[10] == "slip"
Q = X.Q


def slip(p, sp):
    if not SLIP:
        return 0.0
    r = p / sp
    return p * Q * (0.01 if r >= 0.004 else 0.025 if r >= 0.0007 else 0.065)


def run(tr, rule=None):
    """rule = (mode, share, new stop multiple). Returns (result, armed 0/1, moved stops fired)."""
    sp0 = tr.spot[tr.t0]
    n = len(tr.legs)
    stop = [MULT] * n
    live = list(range(n))
    realised = -tr.fee_in - sum(slip(e, sp0) for e in tr.entry)
    premium = sum(tr.entry) * Q
    armed, fired, t = 0, 0, tr.t0 + X.BAR
    while t <= tr.last_b and live:
        sp = tr.spot.get(t, tr.settle_spot)
        for i in list(live):
            m = tr.series[i].get(t)
            if m is not None and m >= stop[i] * tr.entry[i]:
                realised += -(m - tr.entry[i]) * Q - X.fee(sp, m) - slip(m, sp)
                live.remove(i)
                if stop[i] < MULT:
                    fired += 1
        if rule and not armed and live:
            marks = [tr.series[i].get(t) for i in live]
            if None not in marks:
                if rule[0] == "legs":
                    hit = len(live) == n and all(m <= rule[1] * tr.entry[i] for i, m in zip(live, marks))
                else:
                    hit = realised + sum((tr.entry[i] - m) * Q for i, m in zip(live, marks)) >= rule[1] * premium
                if hit:
                    armed = 1
                    for i in live:
                        stop[i] = min(stop[i], rule[2])
        t += X.BAR
    return realised + sum(tr.settle_leg(i) for i in live), armed, fired


trades = sorted(X.trades, key=lambda x: x[0])
n = len(trades)
base = {e: run(tr)[0] for e, tr in trades}
print(f"## {LABEL}{' WITH SLIPPAGE' if SLIP else ''}: {n} days ({trades[0][0]} .. {trades[-1][0]}), each side {X.PCT * 100:g} % away, entered {X.ENTRY:g} h before settlement; stop {MULT:g}x on every sold option")
print(f"   {'':50s} {'mean':>7s} {'win':>4s} {'total':>7s} {'worst':>7s} {'worst 3':>8s} {'drawdown':>8s} {'halves':>13s} {'armed':>5s} {'fired':>5s} {'with':>7s} {'plain':>7s}")


def line(name, rule=None):
    rows = {e: run(tr, rule) for e, tr in trades}
    v = [rows[e][0] for e, _ in trades]
    mid = trades[n // 2][0]
    cum = peak = dd = 0.0
    for x in v:
        cum += x
        peak = max(peak, cum)
        dd = max(dd, peak - cum)
    h = f"{sum(rows[e][0] for e, _ in trades if e < mid):+.0f}/{sum(rows[e][0] for e, _ in trades if e >= mid):+.0f}"
    hit = [e for e, _ in trades if rows[e][2]]
    print(f"   {name:50s} {sum(v) / n:+7.2f} {100 * sum(1 for x in v if x > 0) / n:3.0f}% {sum(v):+7.0f} {min(v):+7.1f} {sum(sorted(v)[:3]):+8.1f} {-dd:+8.1f} {h:>13s} "
          f"{sum(r[1] for r in rows.values()):5d} {len(hit):5d} {sum(rows[e][0] for e in hit):+7.0f} {sum(base[e] for e in hit):+7.0f}")


line("the stop alone")
for mode, what in (("legs", "both options at or under"), ("trade", "the trade ahead by")):
    for share in ((0.5, 0.3) if mode == "legs" else (0.5, 0.7)):
        print(f"   -- armed: {what} {share * 100:g} % of {'their sale price' if mode == 'legs' else 'the premium'}")
        for new in (1.0, 1.5, 0.75):
            if new < MULT:
                line(f"stop moved to {new:g}x{' (cost)' if new == 1.0 else ''}", (mode, share, new))
print()
