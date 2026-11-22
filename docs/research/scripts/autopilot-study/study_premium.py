"""Which strikes to sell: a sold strangle whose call and put are each priced nearest a target premium, against one
sold a percentage of the spot away, for any expiry cycle. One entry per expiry at a fixed number of hours before
settlement. Delta India MARK candles from the caches of the fetch scripts; the exchange's real fees (0.01 % of notional
per fill, capped at 3.5 % of the premium, plus 18 % GST; the same on every leg open at settlement). 100 lots per leg.

Usage: python -I study_premium.py <cache_dir> <lot_size> <bar_minutes> <hours_before, comma> <premiums, comma> <percents, comma> [wing_factor]
       (ASCII output; hours_before 20 is the 21:30 IST entry for the next day's expiry; with wing_factor every shape is also run
       with bought wings that many times as far from the spot as its sold strikes, the stops on the sold options only)"""
import json, os, sys, datetime as dt
from collections import defaultdict

CACHE, LOT, BAR = sys.argv[1], float(sys.argv[2]), dt.timedelta(minutes=int(sys.argv[3]))
ENTRIES = [float(x) for x in sys.argv[4].split(",")]
PREMIUMS = [float(x) for x in sys.argv[5].split(",") if x]
PCTS = [float(x) / 100 for x in sys.argv[6].split(",") if x]
WING = float(sys.argv[7]) if len(sys.argv) > 7 and sys.argv[7] else None
# optional 8th argument: give-backs (per cent of the best profit) for "reach half the premium, then trail" exits
HALF_TRAILS = [int(x) for x in sys.argv[8].split(",") if x] if len(sys.argv) > 8 else []
# optional 9th argument "scale": also the takes at 25 % and 75 % of the premium and the four-part scale-out
SCALE = len(sys.argv) > 9 and sys.argv[9] == "scale"
TAKES = {"+half": 0.5, "+take25": 0.25, "+take75": 0.75}
U = dt.timezone.utc
Q = 100 * LOT
FEE_RATE, FEE_CAP, GST = 0.0001, 0.035, 0.18

def settle_hour():
    """16 for a cache of XAUT (its options settle at 16:00 UTC, 21:30 IST), 12 for BTC and ETH."""
    for e in os.listdir(CACHE):
        d = os.path.join(CACHE, e)
        if os.path.isdir(d) and any(f.startswith("MARK_XAUTUSD") for f in os.listdir(d)):
            return 16
    return 12


SETTLE_H = settle_hour()


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
    best = None
    for (kd, k), series in opts.items():
        if kd != kind or t0 not in series or (k <= s0 if kind == "C" else k >= s0):
            continue
        score = abs(series[t0] - premium) if premium is not None else abs(k - s0 * (1 + pct if kind == "C" else 1 - pct))
        if best is None or score < best[0]:
            best = (score, k)
    return None if best is None else best[1]


def trade(spot, opts, t0, last_b, settle_spot, legs):
    s0 = spot[t0]
    entry = [opts[(kind, k)][t0] for kind, k, _ in legs]
    fee_in = sum(fee(s0, e) for e in entry)
    credit = sum(-sg * e * Q for (_, _, sg), e in zip(legs, entry))
    if credit <= 0:
        return None
    settle_leg = lambda i: legs[i][2] * (intrinsic(legs[i][0], legs[i][1], settle_spot) - entry[i]) * Q - fee(settle_spot, intrinsic(legs[i][0], legs[i][1], settle_spot))
    out = {"credit": credit, "hold": sum(settle_leg(i) for i in range(len(legs))) - fee_in}
    for mult in (2, 3):
        for mode in ("", "+half", "+trail") + (("+take25", "+take75") if SCALE else ()) + tuple(f"+half>trail{g}" for g in HALF_TRAILS):
            live, realised, done, t, stopped, peak, best = list(range(len(legs))), -fee_in, None, t0 + BAR, False, 0.0, None
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
                    if mode in TAKES and realised + fee_in + rest >= TAKES[mode] * credit:
                        done = realised + rest - sum(fee(sp, px[i]) for i in live)
                        break
                    if mode.startswith("+half>trail"):
                        # the owner's question (22 Nov 2026): at half the premium do not close, trail: close when the
                        # profit falls back by g per cent of its best since then
                        total = realised + fee_in + rest
                        if best is not None or total >= 0.5 * credit:
                            best = total if best is None else max(best, total)
                            if total <= best * (1 - int(mode[len("+half>trail"):]) / 100):
                                done = realised + rest - sum(fee(sp, px[i]) for i in live)
                                break
                    if mode == "+trail" and stopped:
                        peak = max(peak, rest)
                        if peak >= 0.01 and rest <= peak * 0.5:
                            done = realised + rest - sum(fee(sp, px[i]) for i in live)
                            break
                t += BAR
            if done is None:
                done = realised + sum(settle_leg(i) for i in live)
            out[f"stop{mult}x{mode}"] = done
        if SCALE:
            # the owner's idea (22 Nov 2026): four equal parts, closed at 25 %, 50 % and 75 % of the premium and at
            # settlement; every amount scales with the size, so it is the mean of the four exits on a quarter each
            out[f"stop{mult}x+scale-out"] = (out[f"stop{mult}x+take25"] + out[f"stop{mult}x+half"] + out[f"stop{mult}x+take75"] + out[f"stop{mult}x"]) / 4
    return out


RULES = ["hold", "stop2x", "stop3x", "stop2x+half", "stop3x+half", "stop2x+trail"] + [f"stop{m}x+half>trail{g}" for m in (2, 3) for g in HALF_TRAILS] + ([f"stop{m}x{x}" for m in (2, 3) for x in ("+take25", "+take75", "+scale-out")] if SCALE else [])
SHAPES = [(f"each side priced near {p:g}", {"premium": p}) for p in PREMIUMS] + [(f"sold {p * 100:g} % away", {"pct": p}) for p in PCTS]
res, credits, dist = defaultdict(list), defaultdict(list), defaultdict(list)
exps = sorted(e for e in os.listdir(CACHE) if os.path.isdir(os.path.join(CACHE, e)))
for exp in exps:
    spot, opts = load(exp)
    y, m, d = map(int, exp.split("-"))
    settle = dt.datetime(y, m, d, SETTLE_H, tzinfo=U)
    last_b = settle - BAR
    if last_b not in spot:
        continue
    for hours in ENTRIES:
        t0 = settle - dt.timedelta(hours=hours) - (BAR if BAR >= dt.timedelta(hours=1) else dt.timedelta(0))  # an hourly bar closes at the entry time
        if t0 not in spot:
            continue
        s0 = spot[t0]
        for label, how in SHAPES:
            pk, ck = pick(opts, t0, s0, "P", **how), pick(opts, t0, s0, "C", **how)
            if pk is None or ck is None:
                continue
            for winged in ((False, True) if WING else (False,)):
                legs, tag = [("P", pk, -1), ("C", ck, -1)], label
                if winged:
                    wp, wc = pick(opts, t0, s0, "P", pct=WING * (s0 - pk) / s0), pick(opts, t0, s0, "C", pct=WING * (ck - s0) / s0)
                    if wp is None or wc is None or wp >= pk or wc <= ck:
                        continue
                    legs, tag = legs + [("P", wp, 1), ("C", wc, 1)], f"{label}, wings {WING:g} times as far"
                r = trade(spot, opts, t0, last_b, spot[last_b], legs)
                if r is None:
                    continue
                credits[(tag, hours)].append(r["credit"])
                dist[(tag, hours)].append(((s0 - pk) + (ck - s0)) / 2 / s0)
                for rule in RULES:
                    res[(tag, hours, rule)].append((exp, r[rule]))


def stats(rows):
    vals = [p for _, p in rows]
    n = len(vals)
    mid = sorted(e for e, _ in rows)[n // 2]
    first, second = sum(p for e, p in rows if e < mid), sum(p for e, p in rows if e >= mid)
    return f"n={n:3d} mean={sum(vals) / n:+8.2f} win={100 * sum(1 for v in vals if v > 0) / n:3.0f}% worst={min(vals):+8.1f} total={sum(vals):+7.0f} | first half {first:+7.0f}, second half {second:+7.0f}"


print(f"expiries in the cache: {len(exps)} ({exps[0]} .. {exps[-1]}); 100 lots x {LOT:g} per leg; net of fees; naked sold strangle\n")
for hours in ENTRIES:
    print("=" * 130)
    print(f"entered {hours:g} hours before settlement")
    for label in [x for lb, _ in SHAPES for x in ([lb, f"{lb}, wings {WING:g} times as far"] if WING else [lb])]:
        cr = credits.get((label, hours), [])
        if not cr:
            continue
        away = dist[(label, hours)]
        print(f"\n  {label}: mean premium collected {sum(cr) / len(cr):6.1f}, sold on average {100 * sum(away) / len(away):4.1f} % away")
        for rule in RULES:
            print(f"      {rule:20s} {stats(res[(label, hours, rule)])}")
