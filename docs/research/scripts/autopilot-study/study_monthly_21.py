"""The published monthly routine on the monthly cache (the owner, 25 Nov 2026: "test the 21-day exit and the put-only
weekly"): a strangle sold about 45 days before the expiry at about 16 delta a side, closed at half the premium or
with 21 days left, whichever comes first (tastylive's studies on US stocks). Here on Delta India 1-hour MARK candles
(the cache of fetch_monthly.py), fees as study_monthly.py, 100 lots a leg, fills at the hourly mark close.

Entry: every day from 50 to 40 days before the settlement, at 16:00 UTC (21:30 IST); the entries of one expiry
overlap heavily, so read the expiry columns, not the entry count. Strikes: the out-of-the-money strike of each kind
whose delta is nearest the target (Black-Scholes, no interest, the volatility that gives its own mark, by bisection),
or a fixed percentage of the spot away for comparison.

Exits, each alone and with a stop on every sold option at 2 or 3 times its entry price:
  hold          to settlement
  21 days       everything closed at the mark on the first bar with 21 days or less to the settlement
  half          everything closed once the trade is up by half the premium collected
  half or 21    whichever comes first (the published routine)
With "slip" every market fill is worse than the mark by the share measured on real daily fills (study_stack.py;
not measured on monthly options, whose spreads are likely wider); settlement pays none.
An expiry whose files were written before its settlement is left out: the candle endpoint pads the series with the
last price up to the expiry, so its settlement would be invented.

Usage: python -I study_monthly_21.py <cache_dir> <lot_size> <label> [slip]"""
import json, math, os, sys, datetime as dt
from collections import defaultdict

CACHE, LOT, LABEL = sys.argv[1], float(sys.argv[2]), sys.argv[3]
SLIP = len(sys.argv) > 4 and sys.argv[4] == "slip"
U = dt.timezone.utc
LOTS = 100
FEE_RATE, FEE_CAP, GST = 0.0001, 0.035, 0.18
H = dt.timedelta(hours=1)
Q = LOTS * LOT
YEAR = 365 * 24 * 3600.0


def fee(spot, price):
    return min(FEE_RATE * spot * Q, FEE_CAP * price * Q) * (1 + GST)


def slip(p, sp):
    if not SLIP:
        return 0.0
    r = p / sp
    return p * Q * (0.01 if r >= 0.004 else 0.025 if r >= 0.0007 else 0.065)


def intrinsic(kind, k, sp):
    return max(0.0, sp - k) if kind == "C" else max(0.0, k - sp)


def N(x):
    return 0.5 * (1 + math.erf(x / math.sqrt(2)))


def bs(kind, s, k, vol, T):
    sd = vol * math.sqrt(T)
    d1 = (math.log(s / k) + 0.5 * sd * sd) / sd
    call = s * N(d1) - k * N(d1 - sd)
    return (call, N(d1)) if kind == "C" else (call - s + k, N(d1) - 1)


def delta(kind, s, k, price, T):
    if price <= intrinsic(kind, k, s) + 1e-9:
        return None
    lo, hi = 0.01, 20.0
    for _ in range(60):
        mid = (lo + hi) / 2
        if bs(kind, s, k, mid, T)[0] < price:
            lo = mid
        else:
            hi = mid
    return abs(bs(kind, s, k, (lo + hi) / 2, T)[1])


def load(exp):
    d = os.path.join(CACHE, exp)
    spot, opts = {}, defaultdict(dict)
    for f in os.listdir(d):
        rows = json.load(open(os.path.join(d, f)))
        if not rows:
            continue
        sym = f[:-5].replace("_", ":")
        series = {dt.datetime.fromtimestamp(r["time"], U): float(r["close"]) for r in rows}
        if sym.endswith("USD"):
            spot = series
        else:
            body = sym.split(":")[1].split("-")
            opts[(body[0], int(body[2]))] = series
    return spot, opts


def pick(opts, t0, s0, kind, T, target=None, pct=None):
    best = None
    for (kd, k), series in opts.items():
        if kd != kind or t0 not in series or (k <= s0 if kind == "C" else k >= s0):
            continue
        if target is not None:
            d = delta(kind, s0, k, series[t0], T)
            if d is None:
                continue
            score = abs(d - target)
        else:
            score = abs(k - s0 * (1 + pct if kind == "C" else 1 - pct))
        if best is None or score < best[0]:
            best = (score, k)
    return None if best is None else best[1]


MODES = ["hold", "21 days", "half", "half or 21"]


def trade(spot, opts, t0, settle, last_b, settle_spot, legs):
    """legs: [(kind, strike)], all sold. {(stop, mode): (result, days held)}."""
    s0 = spot[t0]
    entry = [opts[leg][t0] for leg in legs]
    fee_in = sum(fee(s0, e) for e in entry)
    cost_in = fee_in + sum(slip(e, s0) for e in entry)
    credit = sum(e * Q for e in entry)
    cut = settle - dt.timedelta(days=21)
    settle_leg = lambda i: -(intrinsic(legs[i][0], legs[i][1], settle_spot) - entry[i]) * Q - fee(settle_spot, intrinsic(legs[i][0], legs[i][1], settle_spot))
    out = {}
    for mult in (None, 2, 3):
        for mode in MODES:
            live, realised, done, t, end = list(range(len(legs))), -cost_in, None, t0 + H, settle
            while t <= last_b and live:
                px = {i: opts[legs[i]].get(t) for i in live}
                sp = spot.get(t, settle_spot)
                if mult is not None:
                    for i in list(live):
                        if px[i] is not None and px[i] >= mult * entry[i]:
                            realised += -(px[i] - entry[i]) * Q - fee(sp, px[i]) - slip(px[i], sp)
                            live.remove(i)
                if live and all(px[i] is not None for i in live):
                    rest = sum(-(px[i] - entry[i]) * Q for i in live)
                    if ("half" in mode and realised + cost_in + rest >= 0.5 * credit) or ("21" in mode and t >= cut):
                        done, end = realised + rest - sum(fee(sp, px[i]) + slip(px[i], sp) for i in live), t
                        break
                if not live:
                    end = t
                t += H
            if done is None:
                done = realised + sum(settle_leg(i) for i in live)
            out[(mult, mode)] = (done, (end - t0).total_seconds() / 86400)
    return credit, out


SHAPES = [("16 delta a side", {"target": 0.16}), ("10 delta a side", {"target": 0.10}), ("25 delta a side", {"target": 0.25}),
          ("12 % away", {"pct": 0.12}), ("16 % away", {"pct": 0.16})]
res, credits, dist = defaultdict(list), defaultdict(list), defaultdict(list)
exps = sorted(e for e in os.listdir(CACHE) if os.path.isdir(os.path.join(CACHE, e)))
skipped = []
settle_h = 16 if "XAUT" in CACHE.upper() else 12
for exp in exps:
    spot, opts = load(exp)
    y, m, d = map(int, exp.split("-"))
    settle = dt.datetime(y, m, d, settle_h, tzinfo=U)
    last_b = settle - H
    fetched = max(os.path.getmtime(os.path.join(CACHE, exp, f)) for f in os.listdir(os.path.join(CACHE, exp)))
    if last_b not in spot or settle.timestamp() > fetched:
        # the candle endpoint pads a series with its last price up to the expiry: an expiry fetched before it settled is not a result
        skipped.append(exp)
        continue
    for days in range(50, 39, -1):
        t0 = settle.replace(hour=15) - dt.timedelta(days=days)
        if t0 not in spot:
            continue
        s0, T = spot[t0], (settle - t0).total_seconds() / YEAR
        for label, how in SHAPES:
            pk, ck = pick(opts, t0, s0, "P", T, **how), pick(opts, t0, s0, "C", T, **how)
            if pk is None or ck is None:
                continue
            credit, out = trade(spot, opts, t0, settle, last_b, spot[last_b], [("P", pk), ("C", ck)])
            credits[label].append(credit)
            dist[label].append(((s0 - pk) / s0 + (ck - s0) / s0) / 2)
            for key, r in out.items():
                res[(label, key)].append((exp, r))


def stats(rows):
    vals = [r[0] for _, r in rows]
    n = len(vals)
    by = defaultdict(list)
    for e, r in rows:
        by[e].append(r[0])
    means = {e: sum(v) / len(v) for e, v in by.items()}
    pos = sum(1 for v in means.values() if v > 0)
    return (f"entries={n:3d} mean={sum(vals) / n:+8.1f} win={100 * sum(1 for v in vals if v > 0) / n:3.0f}% worst={min(vals):+8.0f} held {sum(r[1] for _, r in rows) / n:4.1f} d"
            f" | expiries: mean of means {sum(means.values()) / len(means):+8.1f}, positive {pos:2d} of {len(means):2d}, worst {min(means.values()):+8.0f}, best {max(means.values()):+8.0f}")


print(f"## {LABEL}{' WITH SLIPPAGE' if SLIP else ''}: monthly expiries in the cache {len(exps)} ({exps[0]} .. {exps[-1]}); sold 50 to 40 days before, every day at 21:30 IST; {LOTS} lots x {LOT:g} a leg; net of fees; hourly marks")
if skipped:
    print(f"   left out, fetched before the settlement (the series is padded with its last price): {', '.join(skipped)}")
for label, _ in SHAPES:
    cr = credits.get(label)
    if not cr:
        print(f"\n{label}: no entry could be priced")
        continue
    print(f"\n{label}: mean premium {sum(cr) / len(cr):7.1f}, sold on average {100 * sum(dist[label]) / len(dist[label]):4.1f} % away")
    for mult in (None, 2, 3):
        for mode in MODES:
            name = ("no stop" if mult is None else f"stop {mult}x") + ", " + mode
            print(f"   {name:22s} {stats(res[(label, (mult, mode))])}")
print()
