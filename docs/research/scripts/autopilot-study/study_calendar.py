"""Calendar spreads (strategy lab backlog 7): sell the next day's strangle and buy the same strikes in the Friday
weekly, for one day. At the evening entry the daily call and put are sold at the strikes nearest the distance asked
that are listed in BOTH the daily and the weekly chain; the same strikes of the next Friday expiry at least a day
later are bought (100 lots each); the weekly options are sold at the daily settlement. Beside it the same daily
strangle alone. The weekly marks are hourly (a candle's close is the price at the end of its hour); the daily marks
and the stop on the sold options are as in study_exits.py (imported; run without -I from this folder). The option
fee is charged on every fill of both expiries.

Usage: python study_calendar.py <daily_cache> <lot_size> <bar_minutes> <entry_hours_before> <percent_away> "" "" <label> <weekly_cache>"""
import json, os, sys, datetime as dt
import study_exits as X

LABEL, WEEKLY = sys.argv[8], sys.argv[9]
H = dt.timedelta(hours=1)
weeks = sorted(e for e in os.listdir(WEEKLY) if os.path.isdir(os.path.join(WEEKLY, e)))
wbook = {}


def weekly(exp):
    if exp not in wbook:
        d, opts = os.path.join(WEEKLY, exp), {}
        for f in os.listdir(d):
            sym = f[:-5].replace("_", ":")
            if sym.endswith("USD"):
                continue
            rows = json.load(open(os.path.join(d, f)))
            body = sym.split(":")[1].split("-")
            opts[(body[0], int(body[2]))] = {dt.datetime.fromtimestamp(r["time"], X.U): float(r["close"]) for r in rows}
        wbook[exp] = opts
    return wbook[exp]


def wpx(series, t):
    """The weekly mark at time t: the close of the last hourly candle that had ended by then."""
    return series.get(t.replace(minute=0, second=0, microsecond=0) - H)


def near(strikes, s0, kind):
    target = s0 * (1 + X.PCT if kind == "C" else 1 - X.PCT)
    ok = [k for k in strikes if (k > s0 if kind == "C" else k < s0)]
    return min(ok, key=lambda k: abs(k - target)) if ok else None


def run(tr, wk, mult=None, calendar=False, sell_with_stop=False):
    """Returns (result, result of the weekly options alone)."""
    live, realised, t = list(range(len(tr.legs))), -tr.fee_in, tr.t0 + X.BAR
    wlive, wpl = [], 0.0
    if calendar:
        for i in range(len(tr.legs)):
            p = wpx(wk[i], tr.t0)
            wpl -= X.fee(tr.spot[tr.t0], p)
            wlive.append(i)
    while t <= tr.last_b and live:
        sp = tr.spot.get(t, tr.settle_spot)
        for i in list(live):
            px = tr.series[i].get(t)
            if mult is not None and px is not None and px >= mult * tr.entry[i]:
                realised += -(px - tr.entry[i]) * X.Q - X.fee(sp, px)
                live.remove(i)
                if sell_with_stop and i in wlive:
                    w = wpx(wk[i], t)
                    if w is not None:
                        wpl += (w - wpx(wk[i], tr.t0)) * X.Q - X.fee(sp, w)
                        wlive.remove(i)
        t += X.BAR
    for i in wlive:
        w = wpx(wk[i], tr.settle)
        wpl += (w - wpx(wk[i], tr.t0)) * X.Q - X.fee(tr.settle_spot, w)
    return realised + sum(tr.settle_leg(i) for i in live) + wpl, wpl


trades, dist, wcost = [], [], []
for exp in sorted(e for e in os.listdir(X.CACHE) if os.path.isdir(os.path.join(X.CACHE, e))):
    spot, opts = X.load(exp)
    y, m, d = map(int, exp.split("-"))
    settle = dt.datetime(y, m, d, X.SETTLE_H, tzinfo=X.U)
    t0 = settle - dt.timedelta(hours=X.ENTRY)
    if settle - X.BAR not in spot or t0 not in spot:
        continue
    fri = next((w for w in weeks if dt.date(*map(int, w.split("-"))) >= dt.date(y, m, d) + dt.timedelta(days=1)), None)
    if fri is None:
        continue
    wk = weekly(fri)
    s0, legs, wser = spot[t0], [], []
    for kind in ("P", "C"):
        both = [k for (kd, k), s in opts.items() if kd == kind and t0 in s and (kd, k) in wk and wpx(wk[(kd, k)], t0) is not None and wpx(wk[(kd, k)], settle) is not None]
        k = near(both, s0, kind)
        if k is not None:
            legs.append((kind, k))
            wser.append(wk[(kind, k)])
    if len(legs) < 2:
        continue
    tr = X.Trade(spot, opts, t0, settle, legs)
    if tr.credit <= 0:
        continue
    trades.append((exp, tr, wser))
    dist.append(((s0 - legs[0][1]) + (legs[1][1] - s0)) / 2 / s0)
    wcost.append(sum(wpx(s, t0) for s in wser) * X.Q)


def line(name, **kw):
    rows = [(e, *run(tr, wk, **kw)) for e, tr, wk in trades]
    vals = [r[1] for r in rows]
    n = len(vals)
    mid = sorted(r[0] for r in rows)[n // 2]
    cum = peak = dd = 0.0
    for v in vals:
        cum += v
        peak = max(peak, cum)
        dd = max(dd, peak - cum)
    h = f"{sum(r[1] for r in rows if r[0] < mid):+.0f} / {sum(r[1] for r in rows if r[0] >= mid):+.0f}"
    extra = f"   the weekly options alone {sum(r[2] for r in rows) / n:+8.2f} a trade" if kw.get("calendar") else ""
    print(f"   {name:66s} {n:4d} {sum(vals) / n:+8.2f} {100 * sum(1 for v in vals if v > 0) / n:4.0f}% {sum(vals):+8.0f} {min(vals):+8.1f} {sum(sorted(vals)[:3]):+9.1f} {-dd:+9.1f} {h:>14s}{extra}")


n = len(trades)
print(f"## {LABEL}: {n} trades with both strikes listed in the daily and in the Friday weekly a day or more later; aimed {X.PCT * 100:g} % away, on average {100 * sum(dist) / n:.2f} % away; entered {X.ENTRY:g} h before the daily settlement")
print(f"   mean premium of the sold daily strangle {sum(tr.credit for _, tr, _ in trades) / n:.1f}; mean price paid for the weekly strangle {sum(wcost) / n:.1f}")
print(f"   {'':66s} {'n':>4s} {'mean':>8s} {'win':>5s} {'total':>8s} {'worst':>8s} {'worst 3':>9s} {'drawdown':>9s} {'halves':>14s}")
line("daily strangle alone, held, no stop")
line("daily strangle alone, stop at triple", mult=3)
line("calendar: weekly bought, all held to the daily settlement", calendar=True)
line("calendar: stop at triple on the daily, weekly kept to the end", calendar=True, mult=3)
line("calendar: stop at triple, that side's weekly sold with it", calendar=True, mult=3, sell_with_stop=True)
print()
