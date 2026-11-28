"""The Friday weekly strangle with a CHECK after one day (the owner, 28 Nov 2026: a cautious trader takes a small
profit and comes out; "if it is negative ... we will not close it and we will continue with our other strategy ...
and the next targets will set").

The trades, fees and marks of study_exits.py (imported; run without -I from this folder, on a weekly cache with
hourly bars and the entry 164 h before the settlement). Every row keeps a stop on each sold option at a multiple of
its sale price for the whole life of the trade.

  check   20 hours after the entry: if the trade is ahead by at least the share of the premium given, everything is
          closed at the mark. If not, the trade goes on.
  after   what the trade does when the check did not close it: "hold" to settlement, or a "take" of the whole trade
          at a share of the premium at any later bar.
  take from the start   no check: the whole trade is closed the first time it is ahead by a share of the premium.

With "slip" every market fill is worse than the mark by the share measured on real fills (study_stack.py); a leg
left to settlement pays its fee and no fill cost. Profit shares are of the premium sold, before the entry costs.

Columns: mean per week, share of weeks positive, total, worst week, worst three, largest drawdown, the two halves,
the weeks closed at the check, the weeks closed by a take, the weeks a stop fired.

Usage: python study_weekly_day_check.py <weekly cache> <lot> 60 164 <percent away> "" "" <label> <stop multiple> [slip or ""] [hours to the check, 20]
(on a daily cache: 5-minute bars, entry 20 h before, and a check after e.g. 10 hours, the next morning)"""
import sys, datetime as dt
import study_exits as X

LABEL, MULT = sys.argv[8], float(sys.argv[9])
SLIP = len(sys.argv) > 10 and sys.argv[10] == "slip"
Q = X.Q
HOURS = float(sys.argv[11]) if len(sys.argv) > 11 else 20.0
CHECK = dt.timedelta(hours=HOURS)


def slip(p, sp):
    if not SLIP:
        return 0.0
    r = p / sp
    return p * Q * (0.01 if r >= 0.004 else 0.025 if r >= 0.0007 else 0.065)


def run(tr, check=None, after=None, take=None, always=False):
    """check: share of the premium needed at the 20-hour bar to close. after: a take share once the check has passed
    without closing. take: a take share from the start. always: close at the check whatever the result.
    Returns (result, closed at check, closed by take, stops)."""
    sp0 = tr.spot[tr.t0]
    n = len(tr.legs)
    live = list(range(n))
    realised = -tr.fee_in - sum(slip(e, sp0) for e in tr.entry)
    costs_in = -realised
    t, t_check, stops = tr.t0 + X.BAR, tr.t0 + CHECK, 0
    while t <= tr.last_b and live:
        sp = tr.spot.get(t, tr.settle_spot)
        px = {i: tr.series[i].get(t) for i in live}
        for i in list(live):
            if px[i] is not None and px[i] >= MULT * tr.entry[i]:
                realised += -(px[i] - tr.entry[i]) * Q - X.fee(sp, px[i]) - slip(px[i], sp)
                live.remove(i)
                stops += 1
        if live and all(px[i] is not None for i in live):
            ahead = (realised + costs_in + sum((tr.entry[i] - px[i]) * Q for i in live)) / tr.credit
            at_check = t == t_check and (always or (check is not None and ahead >= check))
            level = take if take is not None else after if (after is not None and t > t_check) else None
            by_take = not at_check and level is not None and ahead >= level
            if at_check or by_take:
                out = realised + sum((tr.entry[i] - px[i]) * Q - X.fee(sp, px[i]) - slip(px[i], sp) for i in live)
                return out, int(at_check), int(by_take), stops
        t += X.BAR
    return realised + sum(tr.settle_leg(i) for i in live), 0, 0, stops


trades = sorted(X.trades, key=lambda x: x[0])
n = len(trades)
ROWS = 0
print(f"## {LABEL}{' WITH SLIPPAGE' if SLIP else ''}: {n} expiries ({trades[0][0]} .. {trades[-1][0]}), each side {X.PCT * 100:g} % away, entered {X.ENTRY:g} h before settlement; stop {MULT:g}x on every sold option; mean premium {sum(tr.credit for _, tr in trades) / n:.1f}")
print(f"   {'':52s} {'mean':>7s} {'win':>4s} {'total':>7s} {'worst':>7s} {'worst 3':>8s} {'drawdown':>8s} {'halves':>13s} {'check':>5s} {'take':>5s} {'stops':>5s}")


def line(name, **kw):
    global ROWS
    ROWS += 1
    rows = [(e, run(tr, **kw)) for e, tr in trades]
    v = [r[0] for _, r in rows]
    mid = trades[n // 2][0]
    cum = peak = dd = 0.0
    for x in v:
        cum += x
        peak = max(peak, cum)
        dd = max(dd, peak - cum)
    h = f"{sum(r[0] for e, r in rows if e < mid):+.0f}/{sum(r[0] for e, r in rows if e >= mid):+.0f}"
    print(f"   {name:52s} {sum(v) / n:+7.2f} {100 * sum(1 for x in v if x > 0) / n:3.0f}% {sum(v):+7.0f} {min(v):+7.1f} {sum(sorted(v)[:3]):+8.1f} {-dd:+8.1f} {h:>13s} "
          f"{sum(r[1] for _, r in rows):5d} {sum(r[2] for _, r in rows):5d} {sum(1 for _, r in rows if r[3]):5d}")


line("the stop alone, held to settlement")
line(f"closed at the check ({HOURS:g} h) whatever the result", always=True)
print("   -- take from the start (no check)")
for tk in (0.05, 0.10, 0.20, 0.30, 0.50):
    line(f"take at {tk * 100:g} % of the premium", take=tk)
print(f"   -- check {HOURS:g} h after the entry; if it did not close, hold to settlement")
for ck in (0.0, 0.05, 0.10, 0.20):
    line(f"close if ahead by {ck * 100:g} % or more", check=ck)
print(f"   -- check {HOURS:g} h after the entry; if it did not close, take later at a share of the premium")
for ck in (0.05, 0.10):
    for af in (0.0, 0.10, 0.25, 0.50):
        line(f"close if ahead by {ck * 100:g} %; later take at {af * 100:g} %", check=ck, after=af)
print(f"   rows: {ROWS}\n")
