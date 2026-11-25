"""A sold put alone on the BTC weekly, every week and only when the trend is up (the owner, 25 Nov 2026: "test the
21-day exit and the put-only weekly"). The published model is the exchange put-write index on US shares: an
at-the-money put sold against cash and held to expiry. Here on Delta India 1-hour MARK candles of the Friday expiries
(the cache of fetch_weekly.py), fees and the 500 strike ladder as study_weekly.py, 100 lots (0.1 BTC), fills at the
hourly mark close.

Entry: 7 days before the settlement at 16:00 UTC (Friday 21:30 IST). Sold: the put alone, the call alone, or both,
each 0, 3 or 5 % of the spot away (0: the strike nearest the spot). Exits: hold to settlement, or each sold option
bought back at 2 or 3 times its entry price.

Trend, known at the entry from the spot bars of every expiry in the cache joined: the spot against its own mean
over the N days before (up: above it). "put when up" sells the put only in the weeks the trend is up and nothing
otherwise; "put when up, call when down" sells the call in the other weeks; a week with no history is not traded.
With "slip" every market fill is worse than the mark by the share measured on real daily fills (study_stack.py);
settlement pays none.

Columns: weeks traded, mean per week traded, share positive, total, worst week, worst three, largest drawdown, the
two halves of the weeks in the cache.

Usage: python -I study_put_weekly.py <cache_dir> [slip]"""
import json, os, sys, datetime as dt
from collections import defaultdict

CACHE = sys.argv[1]
SLIP = len(sys.argv) > 2 and sys.argv[2] == "slip"
U = dt.timezone.utc
LOT, LOTS, STEP = 0.001, 100, 500
FEE_RATE, FEE_CAP, GST = 0.0001, 0.035, 0.18
H = dt.timedelta(hours=1)
Q = LOTS * LOT


def fee(spot, price):
    return min(FEE_RATE * spot * Q, FEE_CAP * price * Q) * (1 + GST)


def slip(p, sp):
    if not SLIP:
        return 0.0
    r = p / sp
    return p * Q * (0.01 if r >= 0.004 else 0.025 if r >= 0.0007 else 0.065)


def intrinsic(kind, k, sp):
    return max(0.0, sp - k) if kind == "C" else max(0.0, k - sp)


def load(exp):
    d = os.path.join(CACHE, exp)
    spot, opts = {}, defaultdict(dict)
    for f in os.listdir(d):
        rows = json.load(open(os.path.join(d, f)))
        if not rows:
            continue
        sym = f[:-5].replace("_", ":")
        series = {dt.datetime.fromtimestamp(r["time"], U): float(r["close"]) for r in rows}
        if sym == "MARK:BTCUSD":
            spot = series
        else:
            body = sym.split(":")[1].split("-")
            opts[(body[0], int(body[2]))] = series
    return spot, opts


def trade(spot, opts, t0, last_b, settle_spot, kinds, pct, mult):
    """The options of `kinds` sold `pct` away at t0; each closed at `mult` times its entry (None: held). None when a leg has no price."""
    s0 = spot[t0]
    near = lambda x: int(round(x / STEP) * STEP)
    legs = [(k, near(s0 * (1 - pct if k == "P" else 1 + pct))) for k in kinds]
    if any(leg not in opts or t0 not in opts[leg] for leg in legs):
        return None
    entry = [opts[leg][t0] for leg in legs]
    res = -sum(fee(s0, e) + slip(e, s0) for e in entry)
    live, t = list(range(len(legs))), t0 + H
    while mult is not None and t <= last_b and live:
        sp = spot.get(t, settle_spot)
        for i in list(live):
            p = opts[legs[i]].get(t)
            if p is not None and p >= mult * entry[i]:
                res += -(p - entry[i]) * Q - fee(sp, p) - slip(p, sp)
                live.remove(i)
        t += H
    for i in live:
        v = intrinsic(legs[i][0], legs[i][1], settle_spot)
        res += -(v - entry[i]) * Q - fee(settle_spot, v)
    return res


exps = sorted(e for e in os.listdir(CACHE) if os.path.isdir(os.path.join(CACHE, e)))
data, spot_all = {}, {}
for exp in exps:
    spot, opts = load(exp)
    spot_all.update(spot)
    y, m, d = map(int, exp.split("-"))
    settle = dt.datetime(y, m, d, 12, tzinfo=U)
    last_b, t0 = settle - H, settle - dt.timedelta(days=7) + dt.timedelta(hours=3)
    if last_b in spot and t0 in spot:
        data[exp] = (spot, opts, t0, last_b)
weeks = sorted(data)


def trend(t0, days):
    """True up, False down, None when under 90 % of the hourly bars of the window exist."""
    pts = [spot_all.get(t0 - H * i) for i in range(1, days * 24 + 1)]
    have = [p for p in pts if p is not None]
    if len(have) < 0.9 * len(pts) or t0 not in spot_all:
        return None
    return spot_all[t0] > sum(have) / len(have)


def line(name, choose, pct, mult):
    """choose(exp) -> the kinds to sell that week, or None for no trade."""
    rows = []
    for exp in weeks:
        kinds = choose(exp)
        spot, opts, t0, last_b = data[exp]
        r = None if not kinds else trade(spot, opts, t0, last_b, spot[last_b], kinds, pct, mult)
        rows.append((exp, r))
    took = [r for _, r in rows if r is not None]
    if not took:
        print(f"   {name:44s} {0:3d}")
        return
    mid = weeks[len(weeks) // 2]
    cum = peak = dd = 0.0
    for _, r in rows:
        cum += r or 0.0
        peak = max(peak, cum)
        dd = max(dd, peak - cum)
    h = f"{sum(r for e, r in rows if r is not None and e < mid):+.0f}/{sum(r for e, r in rows if r is not None and e >= mid):+.0f}"
    print(f"   {name:44s} {len(took):3d} {sum(took) / len(took):+8.1f} {100 * sum(1 for x in took if x > 0) / len(took):3.0f}% {sum(took):+7.0f} {min(took):+8.1f} {sum(sorted(took)[:3]):+8.1f} {-dd:+8.1f} {h:>13s}")


print(f"## BTC weekly{' WITH SLIPPAGE' if SLIP else ''}: {len(weeks)} Friday expiries ({weeks[0]} .. {weeks[-1]}), sold 7 days before at 21:30 IST; 100 lots (0.1 BTC); net of fees; hourly marks")
first, last = spot_all[data[weeks[0]][2]], spot_all[data[weeks[-1]][3]]
print(f"   spot at the first entry {first:.0f}, at the last settlement {last:.0f} ({100 * (last / first - 1):+.1f} %)")
for pct in (0.0, 0.03, 0.05):
    for mult in (None, 2, 3):
        rule = "held to settlement" if mult is None else f"stop {mult}x"
        print(f"\n-- sold {pct * 100:g} % away, {rule}")
        print(f"   {'':44s} {'wks':>3s} {'mean':>8s} {'win':>4s} {'total':>7s} {'worst':>8s} {'worst 3':>8s} {'drawdown':>8s} {'halves':>13s}")
        line("put and call, every week", lambda e: ("P", "C"), pct, mult)
        line("put only, every week", lambda e: ("P",), pct, mult)
        line("call only, every week", lambda e: ("C",), pct, mult)
        for days in (7, 14, 28):
            up = {e: trend(data[e][2], days) for e in weeks}
            n_up, n_dn = sum(1 for v in up.values() if v), sum(1 for v in up.values() if v is False)
            line(f"put when up ({days} d mean; {n_up} up, {n_dn} down)", lambda e: ("P",) if up[e] else None, pct, mult)
            line(f"put when up, call when down ({days} d)", lambda e: None if up[e] is None else ("P",) if up[e] else ("C",), pct, mult)
            line(f"put when DOWN ({days} d), the other side", lambda e: ("P",) if up[e] is False else None, pct, mult)
print()
