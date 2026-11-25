"""Overlays on the evening strangle against a late move (the owner, 25 Nov 2026, after a day that stood at most of
its premium in the afternoon and gave a third back in the last hours: "is it good to apply any others on top of this
strategies like buy back, trail and others?"). One stop on every sold option, then on top of it, alone and together:

  buy-back   each sold option is bought back on its own once its mark has fallen to a share of the price it was sold
             at (the rule of the paper strategy "buy back at 20 % of the premium"); the other option stays.
  take       the whole trade is closed once it is up by a share of the premium collected.
  trail      once the trade is up by the arm share of the premium, it is closed when it gives back a share of its best.

The trades, fees and fills of study_exits.py (imported; run without -I from this folder). With "slip" every market
fill (entry, stop, buy-back, take, trail) is worse than the mark by the share measured on real fills
(study_stack.py); settlement pays none.

Columns: mean per day, share of days positive, total, worst day, worst three, largest drawdown, the two halves, the
named expiries, and how many options were bought back / days closed by the take or the trail.

Usage: python study_overlays.py <cache_dir> <lot_size> <bar_minutes> <entry_hours_before> <percent_away> "" "" <label> <stop multiple> <expiries to show, comma> [slip]"""
import sys
import study_exits as X

LABEL, MULT = sys.argv[8], float(sys.argv[9])
SHOW = [x for x in sys.argv[10].split(",") if x] if len(sys.argv) > 10 else []
SLIP = len(sys.argv) > 11 and sys.argv[11] == "slip"
Q = X.Q


def slip(p, sp):
    if not SLIP:
        return 0.0
    r = p / sp
    return p * Q * (0.01 if r >= 0.004 else 0.025 if r >= 0.0007 else 0.065)


def run(tr, back=None, take=None, trail=None):
    """Returns (result, options bought back, 1 when the take or the trail closed the trade)."""
    sp0 = tr.spot[tr.t0]
    live = list(range(len(tr.legs)))
    cost_in = tr.fee_in + sum(slip(e, sp0) for e in tr.entry)
    realised, t, best, n_back = -cost_in, tr.t0 + X.BAR, None, 0
    while t <= tr.last_b and live:
        sp = tr.spot.get(t, tr.settle_spot)
        px = {i: tr.series[i].get(t) for i in live}
        for i in list(live):
            if px[i] is None:
                continue
            hit = px[i] >= MULT * tr.entry[i]
            if hit or (back is not None and px[i] <= back * tr.entry[i]):
                realised += -(px[i] - tr.entry[i]) * Q - X.fee(sp, px[i]) - slip(px[i], sp)
                live.remove(i)
                n_back += not hit
        if live and all(px[i] is not None for i in live) and (take is not None or trail is not None):
            rest = sum(-(px[i] - tr.entry[i]) * Q for i in live)
            total = (realised + cost_in + rest) / tr.credit
            out = take is not None and total >= take
            if trail is not None and (best is not None or total >= trail[0]):
                best = total if best is None else max(best, total)
                out = out or total <= best * (1 - trail[1])
            if out:
                return realised + rest - sum(X.fee(sp, px[i]) + slip(px[i], sp) for i in live), n_back, 1
        t += X.BAR
    return realised + sum(tr.settle_leg(i) for i in live), n_back, 0


trades = sorted(X.trades, key=lambda x: x[0])
n = len(trades)
print(f"## {LABEL}{' WITH SLIPPAGE' if SLIP else ''}: {n} days ({trades[0][0]} .. {trades[-1][0]}), each side {X.PCT * 100:g} % away, entered {X.ENTRY:g} h before settlement; stop {MULT:g}x on every sold option")
print(f"   {'':44s} {'mean':>7s} {'win':>4s} {'total':>7s} {'worst':>7s} {'worst 3':>8s} {'drawdown':>8s} {'halves':>13s}  " + "  ".join(f"{e[5:]:>7s}" for e in SHOW) + "   bought back / closed early")


def line(name, **kw):
    rows = {e: run(tr, **kw) for e, tr in trades}
    v = [rows[e][0] for e, _ in trades]
    mid = trades[n // 2][0]
    cum = peak = dd = 0.0
    for x in v:
        cum += x
        peak = max(peak, cum)
        dd = max(dd, peak - cum)
    h = f"{sum(rows[e][0] for e, _ in trades if e < mid):+.0f}/{sum(rows[e][0] for e, _ in trades if e >= mid):+.0f}"
    print(f"   {name:44s} {sum(v) / n:+7.2f} {100 * sum(1 for x in v if x > 0) / n:3.0f}% {sum(v):+7.0f} {min(v):+7.1f} {sum(sorted(v)[:3]):+8.1f} {-dd:+8.1f} {h:>13s}  "
          + "  ".join(f"{rows[e][0]:+7.1f}" for e in SHOW) + f"   {sum(r[1] for r in rows.values()):4d} / {sum(r[2] for r in rows.values()):3d}")


line("the stop alone")
print("   -- buy-back of each option at a share of its sale price")
for b in (0.05, 0.1, 0.2, 0.3, 0.5):
    line(f"buy-back at {b * 100:g} %", back=b)
print("   -- take: the whole trade closed at a share of the premium")
for k in (0.5, 0.7, 0.8, 0.9):
    line(f"take at {k * 100:g} %", take=k)
print("   -- trail: armed at a share of the premium, closed on a give-back of the best")
for arm, give in ((0.5, 0.2), (0.6, 0.15), (0.7, 0.1), (0.7, 0.2), (0.8, 0.1)):
    line(f"trail from {arm * 100:g} %, give back {give * 100:g} %", trail=(arm, give))
print("   -- together")
for b, arm, give in ((0.2, 0.7, 0.1), (0.2, 0.7, 0.2), (0.1, 0.7, 0.1), (0.2, 0.5, 0.2)):
    line(f"buy-back {b * 100:g} % + trail {arm * 100:g} / {give * 100:g}", back=b, trail=(arm, give))
line("buy-back 20 % + take 80 %", back=0.2, take=0.8)
print()
