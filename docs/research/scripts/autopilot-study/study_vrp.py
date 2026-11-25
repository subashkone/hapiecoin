"""Sell only when the options are priced above what the coin has been moving (the owner, 25 Nov 2026: "find couple
more well proven in the market"). The published case for selling options is that implied volatility is on average
above the volatility that follows (the variance risk premium); the usual filter built on it is to sell only when the
implied volatility at the entry is above the realised volatility of the days before.

The evening strangle of study_exits.py (imported; run without -I from this folder; same fees), each sold option
closed on its own at <stop multiple> times its entry price, the rest held to settlement. At the entry:
  implied   the mean of the two sold options' volatilities, each the Black-Scholes volatility (no interest) that
            gives its MARK, by bisection, with the time left to the settlement;
  realised  from the 5-minute spot closes of the 1, 3 or 7 days before the entry (all the expiries of the cache
            joined): the root of the sum of squared log returns, annualised by the time actually covered. A window
            with fewer than 90 % of its bars gives no ratio and the day is traded as usual.
The filter trades a day only when implied / realised is above (or, to show the other side, at or below) a threshold
fixed in advance: nothing is fitted on the history and nothing later than the entry is used.

Columns: days traded, mean per day traded, share positive, total, mean over ALL days (a skipped day counts 0), worst
day, worst three, largest drawdown, the two halves.

Usage: python study_vrp.py <cache_dir> <lot_size> <bar_minutes> <entry_hours_before> <percent_away> "" "" <label> <stop multiple> [slip]"""
import math, os, sys, datetime as dt
import study_exits as X

LABEL, MULT = sys.argv[8], float(sys.argv[9])
SLIP = len(sys.argv) > 10 and sys.argv[10] == "slip"
Q = X.Q
YEAR = 365 * 24 * 3600.0


def slip(p, sp):
    if not SLIP:
        return 0.0
    r = p / sp
    return p * Q * (0.01 if r >= 0.004 else 0.025 if r >= 0.0007 else 0.065)


def N(x):
    return 0.5 * (1 + math.erf(x / math.sqrt(2)))


def price(kind, s, k, vol, T):
    sd = vol * math.sqrt(T)
    d1 = (math.log(s / k) + 0.5 * sd * sd) / sd
    call = s * N(d1) - k * N(d1 - sd)
    return call if kind == "C" else call - s + k


def implied(kind, s, k, p, T):
    if T <= 0 or p <= X.intrinsic(kind, k, s) + 1e-9:
        return None
    lo, hi = 0.01, 20.0
    for _ in range(60):
        mid = (lo + hi) / 2
        if price(kind, s, k, mid, T) < p:
            lo = mid
        else:
            hi = mid
    return (lo + hi) / 2


spot_all = {}
for e in sorted(os.listdir(X.CACHE)):
    if os.path.isdir(os.path.join(X.CACHE, e)):
        spot_all.update(X.load(e)[0])


def realised(t0, days):
    want = int(days * 24 * 60 / (X.BAR.total_seconds() / 60))
    pts = [spot_all.get(t0 - X.BAR * i) for i in range(want + 1)]
    ss, n = 0.0, 0
    for a, b in zip(pts, pts[1:]):
        if a is not None and b is not None:
            ss += math.log(a / b) ** 2
            n += 1
    if n < 0.9 * want:
        return None
    return math.sqrt(ss / (n * X.BAR.total_seconds() / YEAR))


def run(tr):
    sp0 = tr.spot[tr.t0]
    live = list(range(len(tr.legs)))
    res, t = -tr.fee_in - sum(slip(e, sp0) for e in tr.entry), tr.t0 + X.BAR
    while t <= tr.last_b and live:
        sp = tr.spot.get(t, tr.settle_spot)
        for i in list(live):
            p = tr.series[i].get(t)
            if p is not None and p >= MULT * tr.entry[i]:
                res += -(p - tr.entry[i]) * Q - X.fee(sp, p) - slip(p, sp)
                live.remove(i)
        t += X.BAR
    return res + sum(tr.settle_leg(i) for i in live)


trades = sorted(X.trades, key=lambda x: x[0])
n_all = len(trades)
base = {e: run(tr) for e, tr in trades}
iv = {}
for e, tr in trades:
    sp0, T = tr.spot[tr.t0], (tr.settle - tr.t0).total_seconds() / YEAR
    vs = [implied(kind, sp0, k, tr.entry[i], T) for i, (kind, k) in enumerate(tr.legs)]
    iv[e] = None if any(v is None for v in vs) else sum(vs) / len(vs)

print(f"## {LABEL}{' WITH SLIPPAGE' if SLIP else ''}: {n_all} days ({trades[0][0]} .. {trades[-1][0]}), each side {X.PCT * 100:g} % away, entered {X.ENTRY:g} h before settlement, stop {MULT:g}x")
print(f"   {'':46s} {'days':>4s} {'mean':>7s} {'win':>4s} {'total':>7s} {'per all':>7s} {'worst':>7s} {'worst 3':>8s} {'drawdown':>8s} {'halves':>13s}")


def line(name, keep):
    v = [base[e] if keep(e) else None for e, _ in trades]
    took = [x for x in v if x is not None]
    if not took:
        print(f"   {name:46s} {0:4d}")
        return
    mid = trades[n_all // 2][0]
    cum = peak = dd = 0.0
    for x in v:
        cum += x or 0.0
        peak = max(peak, cum)
        dd = max(dd, peak - cum)
    h = f"{sum(base[e] for e, _ in trades if keep(e) and e < mid):+.0f}/{sum(base[e] for e, _ in trades if keep(e) and e >= mid):+.0f}"
    print(f"   {name:46s} {len(took):4d} {sum(took) / len(took):+7.2f} {100 * sum(1 for x in took if x > 0) / len(took):3.0f}% {sum(took):+7.0f} {sum(took) / n_all:+7.2f} {min(took):+7.1f} {sum(sorted(took)[:3]):+8.1f} {-dd:+8.1f} {h:>13s}")


line("every day", lambda e: True)
for days in (1, 3, 7):
    ratio = {}
    for e, tr in trades:
        rv = realised(tr.t0, days)
        ratio[e] = None if rv is None or iv[e] is None or rv <= 0 else iv[e] / rv
    known = sorted(r for r in ratio.values() if r is not None)
    med = known[len(known) // 2] if known else float("nan")
    print(f"-- realised over the {days} day(s) before the entry: ratio known on {len(known)} days, median {med:.2f}, above 1 on {sum(1 for r in known if r > 1)}")
    for th in (1.0, 1.2, 1.5):
        line(f"  only when implied / realised > {th:g}", lambda e, th=th: ratio[e] is None or ratio[e] > th)
        line(f"  only when implied / realised <= {th:g}", lambda e, th=th: ratio[e] is not None and ratio[e] <= th)
print()
