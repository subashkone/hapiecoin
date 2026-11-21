"""Sold strangles on the monthly (last Friday) expiry of an underlying, entered 14 to 75 days before, on Delta India
1-hour MARK candles (the cache written by fetch_monthly.py), with the exchange's real fees (0.01 % of notional per
fill, capped at 3.5 % of the premium, plus 18 % GST; the same on every leg open at settlement). Fills at the hourly
mark close. 100 lots per leg.

Strikes: either the call and the put each priced nearest a target premium (the way the owner describes a competitor's
monthly trade: about 1,000 a side on BTC), or a percentage of the spot away. Entry: every day in the window at
16:00 UTC (21:30 IST), so the entries of one expiry overlap heavily: the last column counts expiries, not entries.

Usage: python -I study_monthly.py <cache_dir> <lot_size> <premium targets, comma separated>   (ASCII output)"""
import json, os, sys, datetime as dt
from collections import defaultdict

CACHE, LOT = sys.argv[1], float(sys.argv[2])
PREMIUMS = [float(x) for x in sys.argv[3].split(",")]
U = dt.timezone.utc
LOTS = 100
FEE_RATE, FEE_CAP, GST = 0.0001, 0.035, 0.18
H = dt.timedelta(hours=1)
Q = LOTS * LOT


def fee(spot, price):
    return min(FEE_RATE * spot * Q, FEE_CAP * price * Q) * (1 + GST)


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
        if sym.endswith("USD"):
            spot = series
        else:
            body = sym.split(":")[1].split("-")
            opts[(body[0], int(body[2]))] = series
    return spot, opts


def pick(opts, t0, s0, kind, premium=None, pct=None):
    """The out-of-the-money strike of `kind` priced nearest `premium` at t0, or nearest `pct` of the spot away."""
    best = None
    for (kd, k), series in opts.items():
        if kd != kind or t0 not in series or (k <= s0 if kind == "C" else k >= s0):
            continue
        score = abs(series[t0] - premium) if premium is not None else abs(k - s0 * (1 + pct if kind == "C" else 1 - pct))
        if best is None or score < best[0]:
            best = (score, k)
    return None if best is None else best[1]


def trade(spot, opts, t0, last_b, settle_spot, legs):
    """legs: [(kind, strike, sign)]. Outcomes by exit rule; None when the structure collects nothing."""
    s0 = spot[t0]
    entry = [opts[(kind, k)][t0] for kind, k, _ in legs]
    fee_in = sum(fee(s0, e) for e in entry)
    credit = sum(-sg * e * Q for (_, _, sg), e in zip(legs, entry))
    if credit <= 0:
        return None
    settle_leg = lambda i: legs[i][2] * (intrinsic(legs[i][0], legs[i][1], settle_spot) - entry[i]) * Q - fee(settle_spot, intrinsic(legs[i][0], legs[i][1], settle_spot))
    out = {"credit": credit, "hold": sum(settle_leg(i) for i in range(len(legs))) - fee_in}
    for mult in (2, 3):
        for mode in ("", "+half", "+trail"):
            live, realised, done, t, stopped, peak = list(range(len(legs))), -fee_in, None, t0 + H, False, 0.0
            while t <= last_b and live:
                px = {i: opts[legs[i][:2]].get(t) for i in live}
                sp = spot.get(t, settle_spot)
                for i in list(live):
                    if legs[i][2] < 0 and px[i] is not None and px[i] >= mult * entry[i]:
                        realised += legs[i][2] * (px[i] - entry[i]) * Q - fee(sp, px[i])
                        live.remove(i)
                        stopped = True
                if live and all(px[i] is not None for i in live):
                    rest = sum(legs[i][2] * (px[i] - entry[i]) * Q for i in live)
                    if mode == "+half" and realised + fee_in + rest >= 0.5 * credit:
                        done = realised + rest - sum(fee(sp, px[i]) for i in live)
                        break
                    if mode == "+trail" and stopped:
                        peak = max(peak, rest)
                        if peak >= 0.01 and rest <= peak * 0.5:
                            done = realised + rest - sum(fee(sp, px[i]) for i in live)
                            break
                t += H
            if done is None:
                done = realised + sum(settle_leg(i) for i in live)
            out[f"stop{mult}x{mode}"] = done
    return out


BUCKETS = [(60, 75, "60 to 75 days before (the competitor's window)"), (45, 59, "45 to 59 days before"), (30, 44, "30 to 44 days before"), (14, 29, "14 to 29 days before")]
RULES = ["hold", "stop2x", "stop3x", "stop2x+half", "stop3x+half", "stop2x+trail"]
SHAPES = [(f"each side priced near {p:g}", {"premium": p}) for p in PREMIUMS] + [(f"sold {int(p * 100)} % away", {"pct": p}) for p in (0.08, 0.12, 0.16, 0.2)]
res = defaultdict(list)  # (shape, winged, bucket, rule) -> [(expiry, pnl)]
credits = defaultdict(list)
dist = defaultdict(list)
exps = sorted(e for e in os.listdir(CACHE) if os.path.isdir(os.path.join(CACHE, e)))
for exp in exps:
    spot, opts = load(exp)
    y, m, d = map(int, exp.split("-"))
    settle = dt.datetime(y, m, d, 12, tzinfo=U)
    last_b = settle - H
    if last_b not in spot:
        continue
    for days in range(75, 13, -1):
        t0 = settle - dt.timedelta(days=days) + dt.timedelta(hours=3)  # the bar that closes at 16:00 UTC
        if t0 not in spot:
            continue
        bucket = next(b[2] for b in BUCKETS if b[0] <= days <= b[1])
        s0 = spot[t0]
        for label, how in SHAPES:
            pk, ck = pick(opts, t0, s0, "P", **how), pick(opts, t0, s0, "C", **how)
            if pk is None or ck is None:
                continue
            for winged in (False, True):
                legs = [("P", pk, -1), ("C", ck, -1)]
                if winged:
                    # wings half as far again from the spot as the sold strikes, on the listed strikes
                    wp, wc = pick(opts, t0, s0, "P", pct=1.5 * (s0 - pk) / s0), pick(opts, t0, s0, "C", pct=1.5 * (ck - s0) / s0)
                    if wp is None or wc is None or wp >= pk or wc <= ck:
                        continue
                    legs += [("P", wp, 1), ("C", wc, 1)]
                r = trade(spot, opts, t0, last_b, spot[last_b], legs)
                if r is None:
                    continue
                credits[(label, winged, bucket)].append(r["credit"])
                dist[(label, bucket)].append(((s0 - pk) / s0 + (ck - s0) / s0) / 2)
                for rule in RULES:
                    res[(label, winged, bucket, rule)].append((exp, r[rule]))


def stats(rows):
    vals = [p for _, p in rows]
    n = len(vals)
    by = defaultdict(list)
    for e, p in rows:
        by[e].append(p)
    means = {e: sum(v) / len(v) for e, v in by.items()}
    pos = sum(1 for v in means.values() if v > 0)
    return f"entries={n:3d} mean={sum(vals) / n:+8.1f} win={100 * sum(1 for v in vals if v > 0) / n:3.0f}% worst={min(vals):+8.0f} | expiries positive {pos:2d} of {len(means):2d}, worst expiry {min(means.values()):+8.0f}, best {max(means.values()):+8.0f}"


print(f"monthly expiries in the cache: {len(exps)} ({exps[0]} .. {exps[-1]}); {LOTS} lots x {LOT:g} per leg; net of fees; hourly marks; entry 21:30 IST on every day of the window\n")
for label, _ in SHAPES:
    for winged in (False, True):
        print("=" * 150)
        print(f"{label}" + (", wings half as far again" if winged else " (naked)"))
        for _, _, bucket in BUCKETS:
            cr = credits.get((label, winged, bucket), [])
            if not cr:
                continue
            away = dist.get((label, bucket), [0])
            print(f"  {bucket}: mean premium {sum(cr) / len(cr):7.1f}, sold on average {100 * sum(away) / len(away):4.1f} % away")
            for rule in RULES:
                print(f"      {rule:12s} {stats(res[(label, winged, bucket, rule)])}")
