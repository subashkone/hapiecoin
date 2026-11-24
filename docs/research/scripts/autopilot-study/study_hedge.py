"""Delta hedge with a future when the spot crosses a sold strike (strategy lab backlog 11). The sold strangle as in
the other studies; when a bar closes with the spot through a sold strike, a future of the same size as that option
(100 lots) is bought (call side) or sold (put side) at that close; it is closed when the spot closes back inside the
strike by a buffer, and opened again on the next cross. Hedges still open at settlement close at the settlement spot.
The future is taken at the spot mark (the basis and the funding of a few hours are ignored). Its fee is a rate on
the notional of every fill plus 18 % GST; the rate is an argument because it decides the result.
Same trades, option fees and fills as study_exits.py (imported; run without -I from this folder).

Usage: python study_hedge.py <cache_dir> <lot_size> <bar_minutes> <entry_hours_before> <percent_away> "" "" <label> <futures fee rates in per cent, comma>"""
import sys
import study_exits as X

LABEL = sys.argv[8]
RATES = [float(x) / 100 for x in sys.argv[9].split(",")]


def run(tr, mult=None, hedge=False, buffer=0.0, rate=0.0, lead=0.0):
    """mult: the stop on each sold option (None: no stop). hedge: a future while the spot is through the strike.
    buffer: the hedge is closed when the spot is back inside the strike by this share. lead: the hedge is opened this
    share before the strike. Returns (result, futures fills, futures result alone)."""
    live, realised, t = list(range(len(tr.legs))), -tr.fee_in, tr.t0 + X.BAR
    held, fills, fut = {}, 0, 0.0   # leg index -> price the future was opened at
    ffee = lambda sp: rate * sp * X.Q * (1 + X.GST)

    def close_hedge(i, sp):
        nonlocal fills, fut
        sign = 1 if tr.legs[i][0] == "C" else -1
        fut += sign * (sp - held.pop(i)) * X.Q - ffee(sp)
        fills += 1

    while t <= tr.last_b and live:
        sp = tr.spot.get(t, tr.settle_spot)
        for i in list(live):
            px = tr.series[i].get(t)
            kind, k = tr.legs[i]
            if mult is not None and px is not None and px >= mult * tr.entry[i]:
                realised += -(px - tr.entry[i]) * X.Q - X.fee(sp, px)
                live.remove(i)
                if i in held:
                    close_hedge(i, sp)
                continue
            if hedge:
                through = sp >= k * (1 - lead) if kind == "C" else sp <= k * (1 + lead)
                inside = sp <= k * (1 - lead - buffer) if kind == "C" else sp >= k * (1 + lead + buffer)
                if i not in held and through:
                    held[i] = sp
                    fut -= ffee(sp)
                    fills += 1
                elif i in held and inside:
                    close_hedge(i, sp)
        t += X.BAR
    for i in list(held):
        close_hedge(i, tr.settle_spot)
    return realised + sum(tr.settle_leg(i) for i in live) + fut, fills, fut


def line(name, **kw):
    rows = [(e, *run(tr, **kw)) for e, tr in sorted(X.trades, key=lambda x: x[0])]
    vals = [r[1] for r in rows]
    n = len(vals)
    mid = sorted(r[0] for r in rows)[n // 2]
    cum = peak = dd = 0.0
    for v in vals:
        cum += v
        peak = max(peak, cum)
        dd = max(dd, peak - cum)
    h = f"{sum(r[1] for r in rows if r[0] < mid):+.0f} / {sum(r[1] for r in rows if r[0] >= mid):+.0f}"
    extra = f"   {sum(1 for r in rows if r[2]):3d} trades hedged, {sum(r[2] for r in rows):4d} futures fills, futures alone {sum(r[3] for r in rows):+8.0f}" if kw.get("hedge") else ""
    print(f"   {name:62s} {n:4d} {sum(vals) / n:+8.2f} {100 * sum(1 for v in vals if v > 0) / n:4.0f}% {sum(vals):+8.0f} {min(vals):+8.1f} {sum(sorted(vals)[:3]):+9.1f} {-dd:+9.1f} {h:>14s}{extra}")


print(f"## {LABEL}: {len(X.trades)} trades, each side {X.PCT * 100:g} % away, entered {X.ENTRY:g} h before settlement; bars of {int(X.BAR.total_seconds() // 60)} minutes; mean premium {sum(tr.credit for _, tr in X.trades) / len(X.trades):.1f}")
print(f"   {'':62s} {'n':>4s} {'mean':>8s} {'win':>5s} {'total':>8s} {'worst':>8s} {'worst 3':>9s} {'drawdown':>9s} {'halves':>14s}")
line("held to settlement, no stop, no hedge")
line("stop at double on each sold option", mult=2)
line("stop at triple on each sold option", mult=3)
for rate in RATES:
    print(f"   hedge with a future, fee {100 * rate:g} % of the notional a fill")
    for buf in (0.0, 0.0025, 0.005, 0.01):
        line(f"hedge at the strike, closed {100 * buf:g} % back inside; no stop", hedge=True, buffer=buf, rate=rate)
    line("hedge 0.25 % before the strike, closed 0.5 % back; no stop", hedge=True, buffer=0.005, lead=0.0025, rate=rate)
    line("hedge at the strike, closed 0.5 % back; stop at triple too", hedge=True, buffer=0.005, rate=rate, mult=3)
print()
