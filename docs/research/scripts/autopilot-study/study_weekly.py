"""Sold strangles on BTC weekly (Friday) and monthly (last Friday) expiries, on Delta India 1-hour MARK candles (the
cache written by fetch_weekly.py), with the exchange's real fees (0.01 % of notional per fill, capped at 3.5 % of the
premium, plus 18 % GST; the same on every leg open at settlement). Fills at the hourly mark close. 100 lots = 0.1 BTC
per leg. Strikes are a percentage of the spot away, rounded to the 500 ladder.

Entries: N days before expiry at 16:00 UTC (21:30 IST). Exits: hold to settlement; each sold option bought back at 2x
or 3x its price; the same with the whole trade closed at half the premium; with bought wings, hold.

Usage: python -I study_weekly.py <cache_dir>      (ASCII output)"""
import json, os, sys, datetime as dt
from collections import defaultdict

CACHE = sys.argv[1]
U = dt.timezone.utc
LOT, LOTS, STEP = 0.001, 100, 500
FEE_RATE, FEE_CAP, GST = 0.0001, 0.035, 0.18
H = dt.timedelta(hours=1)


def fee(spot, price, qty):
    return min(FEE_RATE * spot * qty, FEE_CAP * price * qty) * (1 + GST)


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


def trade(spot, opts, t0, last_b, settle_spot, sold_pct, wing_pct):
    """A strangle sold `sold_pct` of the spot away at t0 (wings bought `wing_pct` away when given). Returns the
    outcomes by exit rule, or None when a leg has no price at t0."""
    s0 = spot[t0]
    near = lambda x: int(round(x / STEP) * STEP)
    legs = [("P", near(s0 * (1 - sold_pct)), -1), ("C", near(s0 * (1 + sold_pct)), -1)]
    if wing_pct is not None:
        legs += [("P", near(s0 * (1 - wing_pct)), 1), ("C", near(s0 * (1 + wing_pct)), 1)]
    if legs[0][1] >= legs[1][1] or any((kind, k) not in opts or t0 not in opts[(kind, k)] for kind, k, _ in legs):
        return None
    q = LOTS * LOT
    entry = [opts[(kind, k)][t0] for kind, k, _ in legs]
    fee_in = sum(fee(s0, e, q) for e in entry)
    credit = sum(-sg * e * q for (_, _, sg), e in zip(legs, entry))
    if credit <= 0:
        return None
    settle_leg = lambda i: legs[i][2] * (intrinsic(legs[i][0], legs[i][1], settle_spot) - entry[i]) * q - fee(settle_spot, intrinsic(legs[i][0], legs[i][1], settle_spot), q)
    out = {"credit": credit, "fee_in": fee_in, "hold": sum(settle_leg(i) for i in range(len(legs))) - fee_in}
    for mult in (2, 3):
        for take in (None, 0.5):
            live, realised, done, t = list(range(len(legs))), -fee_in, None, t0 + H
            while t <= last_b and live:
                px = {i: opts[legs[i][:2]].get(t) for i in live}
                if any(v is None for v in px.values()):
                    t += H
                    continue
                sp = spot.get(t, settle_spot)
                for i in list(live):
                    if legs[i][2] < 0 and px[i] >= mult * entry[i]:
                        realised += legs[i][2] * (px[i] - entry[i]) * q - fee(sp, px[i], q)
                        live.remove(i)
                open_pnl = sum(legs[i][2] * (px[i] - entry[i]) * q for i in live)
                if take is not None and live and realised + fee_in + open_pnl >= take * credit:
                    done = realised + open_pnl - sum(fee(sp, px[i], q) for i in live)
                    break
                t += H
            if done is None:
                done = realised + sum(settle_leg(i) for i in live)
            out[f"stop{mult}x" + ("+half" if take else "")] = done
    return out


def stats(vals):
    n = len(vals)
    if not n:
        return "n= 0"
    mean, win = sum(vals) / n, sum(1 for v in vals if v > 0) / n
    peak = cum = mdd = 0.0
    for v in vals:
        cum += v
        peak = max(peak, cum)
        mdd = min(mdd, cum - peak)
    return f"n={n:2d} mean={mean:+8.2f} total={sum(vals):+7.0f} win={100 * win:3.0f}% worst={min(vals):+8.1f} maxDD={mdd:7.0f}"


exps = sorted(e for e in os.listdir(CACHE) if os.path.isdir(os.path.join(CACHE, e)))
is_monthly = lambda e: (dt.date.fromisoformat(e) + dt.timedelta(days=7)).month != dt.date.fromisoformat(e).month
SHAPES = {
    "weekly": {"days": [7, 6, 5, 4, 3, 2, 1], "sold": [0.03, 0.05, 0.07], "wing": 0.04},
    "monthly": {"days": [28, 21, 14, 7], "sold": [0.05, 0.08, 0.12], "wing": 0.06},
}
RULES = ["hold", "stop2x", "stop3x", "stop2x+half", "stop3x+half"]
res = defaultdict(list)  # (cycle, days, sold, winged, rule) -> [(expiry, pnl)]
credits = defaultdict(list)
used = defaultdict(int)
for exp in exps:
    spot, opts = load(exp)
    y, m, d = map(int, exp.split("-"))
    settle = dt.datetime(y, m, d, 12, tzinfo=U)
    last_b = settle - H
    if last_b not in spot:
        continue
    cycles = ["weekly"] + (["monthly"] if is_monthly(exp) else [])
    for cycle in cycles:
        used[cycle] += 1
        shape = SHAPES[cycle]
        for days in shape["days"]:
            # a candle's time is its start, so the bar starting 15:00 UTC closes at 16:00 UTC (21:30 IST): the entry price
            t0 = settle - dt.timedelta(days=days) + dt.timedelta(hours=3)
            if t0 not in spot:
                continue
            for sold in shape["sold"]:
                for winged in (False, True):
                    r = trade(spot, opts, t0, last_b, spot[last_b], sold, sold + shape["wing"] if winged else None)
                    if r is None:
                        continue
                    credits[(cycle, days, sold, winged)].append(r["credit"])
                    for rule in RULES:
                        res[(cycle, days, sold, winged, rule)].append((exp, r[rule]))

print(f"expiries in the cache: {len(exps)} ({exps[0]} .. {exps[-1]}); weekly cycles used {used['weekly']}, monthly {used['monthly']}; 100 lots (0.1 BTC) per leg; net of fees; hourly marks\n")
for cycle, shape in SHAPES.items():
    print("=" * 118)
    print(f"{cycle.upper()} expiry: a strangle sold N days before, at 21:30 IST")
    print("=" * 118)
    for sold in shape["sold"]:
        for winged in (False, True):
            label = f"sold {sold * 100:.0f} % away" + (f", wings {(sold + shape['wing']) * 100:.0f} % away" if winged else " (naked)")
            print(f"\n{label}")
            for days in shape["days"]:
                cr = credits.get((cycle, days, sold, winged), [])
                if not cr:
                    continue
                print(f"  {days:2d} days before, mean premium {sum(cr) / len(cr):6.1f}")
                for rule in (["hold"] if winged else RULES):
                    v = [p for _, p in res[(cycle, days, sold, winged, rule)]]
                    halves = [sum(p for e, p in res[(cycle, days, sold, winged, rule)] if (e < "2026-06-01") == first) for first in (True, False)]
                    print(f"      {rule:12s} {stats(v)}   Dec-May {halves[0]:+7.0f} | Jun-Nov {halves[1]:+7.0f}")
