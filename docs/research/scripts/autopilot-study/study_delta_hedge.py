"""A sold strangle hedged with the perpetual on a schedule (the owner, 25 Nov 2026: "test the scheduled futures
hedge"), against the same strangle left alone. study_hedge.py hedged at the strike and lost to the crossings; here
the future is set every so many hours to the size that cancels the options' delta at that moment, whatever the spot
has done, and closed at the settlement.

The evening strangle of study_exits.py (imported; run without -I from this folder; with 0 % away it is the two strikes
either side of the spot, a straddle in all but name). At the entry and then every <hours> the delta of every sold
option still open is worked out from its own MARK: Black-Scholes with no interest, the volatility that gives that
mark (bisection), the time left to the settlement; a mark at or under the intrinsic value counts as delta 1 (in the
money) or 0. The future is bought or sold at the spot of that bar to hold the opposite of the total; with a band the
order is sent only when the change is larger than that share of the full size (100 lots). A bar where a mark is
missing is not hedged. Fees: options as study_exits.py; the future a share of the notional a fill plus GST, at the
market rate 0.05 % and the limit rate 0.02 % (both confirmed on the owner's fills; a limit order may not fill, which
this cannot see). With "slip" the options' market fills cost what study_stack.py measured; the future is given none
(not measured).

Rows: the strangle held, and with a stop on each sold option, unhedged; then each schedule, held and with the stop.
Columns: mean per day, share of days positive, total, worst day, worst three, largest drawdown, the two halves, named
expiries, and the future alone (its result after its fees, the fees, the fills).

Usage: python study_delta_hedge.py <cache_dir> <lot_size> <bar_minutes> <entry_hours_before> <percent_away> "" "" <label> <stop multiple> <expiries to show, comma> [slip]"""
import math, sys, datetime as dt
import study_exits as X

LABEL, MULT = sys.argv[8], float(sys.argv[9])
SHOW = [x for x in sys.argv[10].split(",") if x] if len(sys.argv) > 10 else []
SLIP = len(sys.argv) > 11 and sys.argv[11] == "slip"
Q = X.Q
YEAR = 365 * 24 * 3600.0


def slip(p, sp):
    if not SLIP:
        return 0.0
    r = p / sp
    return p * Q * (0.01 if r >= 0.004 else 0.025 if r >= 0.0007 else 0.065)


def N(x):
    return 0.5 * (1 + math.erf(x / math.sqrt(2)))


def bs(kind, s, k, vol, T):
    sd = vol * math.sqrt(T)
    d1 = (math.log(s / k) + 0.5 * sd * sd) / sd
    call = s * N(d1) - k * N(d1 - sd)
    return (call, N(d1)) if kind == "C" else (call - s + k, N(d1) - 1)


def delta(kind, s, k, price, T):
    """The option's delta from its own mark."""
    itm = s > k if kind == "C" else s < k
    if T <= 0 or price <= X.intrinsic(kind, k, s) + 1e-9:
        return (1.0 if kind == "C" else -1.0) if itm else 0.0
    lo, hi = 0.01, 20.0
    for _ in range(60):
        mid = (lo + hi) / 2
        if bs(kind, s, k, mid, T)[0] < price:
            lo = mid
        else:
            hi = mid
    return bs(kind, s, k, (lo + hi) / 2, T)[1]


def run(tr, mult=None, every=None, rate=0.0005, band=0.0):
    """Returns (result, future's result after fees, future's fees, future's fills)."""
    sp0 = tr.spot[tr.t0]
    live = list(range(len(tr.legs)))
    opt = -tr.fee_in - sum(slip(e, sp0) for e in tr.entry)
    fut_q = fut_pnl = fut_fee = 0.0
    fills, last_sp, t = 0, sp0, tr.t0
    step = None if every is None else dt.timedelta(hours=every)
    while t <= tr.last_b:
        sp = tr.spot.get(t, last_sp)
        fut_pnl += fut_q * (sp - last_sp)
        last_sp = sp
        px = {i: tr.series[i].get(t) for i in live}
        if t > tr.t0 and mult is not None:
            for i in list(live):
                if px[i] is not None and px[i] >= mult * tr.entry[i]:
                    opt += -(px[i] - tr.entry[i]) * Q - X.fee(sp, px[i]) - slip(px[i], sp)
                    live.remove(i)
        if step is not None and (t - tr.t0) % step == dt.timedelta(0) and all(px[i] is not None for i in live):
            T = (tr.settle - t).total_seconds() / YEAR
            want = sum(delta(tr.legs[i][0], sp, tr.legs[i][1], px[i], T) for i in live) * Q  # short options: hold +delta
            if abs(want - fut_q) > band * Q or (not live and fut_q):
                fut_fee += abs(want - fut_q) * sp * rate * (1 + X.GST)
                fills += 1
                fut_q = want
        t += X.BAR
    fut_pnl += fut_q * (tr.settle_spot - last_sp)
    if fut_q:
        fut_fee += abs(fut_q) * tr.settle_spot * rate * (1 + X.GST)
        fills += 1
    opt += sum(tr.settle_leg(i) for i in live)
    return opt + fut_pnl - fut_fee, fut_pnl - fut_fee, fut_fee, fills


trades = sorted(X.trades, key=lambda x: x[0])
n = len(trades)
prem = sum(tr.credit for _, tr in trades) / n
print(f"## {LABEL}{' WITH SLIPPAGE' if SLIP else ''}: {n} days ({trades[0][0]} .. {trades[-1][0]}), each side {X.PCT * 100:g} % away, entered {X.ENTRY:g} h before settlement; mean premium {prem:.1f}; stop where named {MULT:g}x")
print(f"   {'':52s} {'mean':>7s} {'win':>4s} {'total':>7s} {'worst':>7s} {'worst 3':>8s} {'drawdown':>8s} {'halves':>13s}  " + "  ".join(f"{e[5:]:>7s}" for e in SHOW) + "   future alone / its fees / fills")


def line(name, kw):
    rows = [(e, run(tr, **kw)) for e, tr in trades]
    v = [r[0] for _, r in rows]
    mid = trades[n // 2][0]
    cum = peak = dd = 0.0
    for x in v:
        cum += x
        peak = max(peak, cum)
        dd = max(dd, peak - cum)
    h = f"{sum(r[0] for e, r in rows if e < mid):+.0f}/{sum(r[0] for e, r in rows if e >= mid):+.0f}"
    by = {e: r[0] for e, r in rows}
    fut = "" if kw.get("every") is None else f"   {sum(r[1] for _, r in rows):+7.0f} / {sum(r[2] for _, r in rows):5.0f} / {sum(r[3] for _, r in rows):5d}"
    print(f"   {name:52s} {sum(v) / n:+7.2f} {100 * sum(1 for x in v if x > 0) / n:3.0f}% {sum(v):+7.0f} {min(v):+7.1f} {sum(sorted(v)[:3]):+8.1f} {-dd:+8.1f} {h:>13s}  "
          + "  ".join(f"{by[e]:+7.1f}" for e in SHOW) + fut)


line("held, no hedge", dict())
line(f"stop {MULT:g}x, no hedge", dict(mult=MULT))
for rate, word in ((0.0005, "market fee 0.05 %"), (0.0002, "limit fee 0.02 %")):
    print(f"   -- future at the {word}")
    for every in (1, 2, 4, 8):
        line(f"held, hedged every {every} h", dict(every=every, rate=rate))
    for band in (0.1, 0.25):
        line(f"held, every 1 h, only a change over {band * 100:g} lots", dict(every=1, rate=rate, band=band))
    line("held, hedged once at the entry only", dict(every=1000, rate=rate))
    for every in (1, 4):
        line(f"stop {MULT:g}x, hedged every {every} h", dict(mult=MULT, every=every, rate=rate))
    line(f"stop {MULT:g}x, every 1 h, only a change over 25 lots", dict(mult=MULT, every=1, rate=rate, band=0.25))
print()
