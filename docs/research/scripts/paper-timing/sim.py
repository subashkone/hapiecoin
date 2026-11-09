"""Backtest the user's daily-expiry BTC structures on Delta India 5-minute MARK candles (fetch.py cache), with the
exchange's real fees: 0.01 % of notional per fill, capped at 3.5 % of the premium, plus 18 % GST; the same taker fee on
every leg still open at settlement. Fills at mark (optimistic; see the slippage sensitivity). 100 lots = 0.1 BTC per leg.
Usage: python -I sim.py <cache_dir> [slippage_pct_of_premium]"""
import json, os, sys, datetime as dt
from collections import defaultdict

CACHE = sys.argv[1]
SLIP = float(sys.argv[2]) / 100 if len(sys.argv) > 2 else 0.0
U = dt.timezone.utc
IST = dt.timezone(dt.timedelta(hours=5, minutes=30))
LOT = 0.001
LOTS = 100
STEP = 200
FEE_RATE, FEE_CAP, GST = 0.0001, 0.035, 0.18

# structures: list of (kind, offset_from_atm, lots_sign) ; sign +1 buy, -1 sell ; lots multiplier
STRUCTS = {
    "iron butterfly +/-600 (sold straddle, wings)": [("C", 0, -1, 1), ("P", 0, -1, 1), ("C", 600, 1, 1), ("P", -600, 1, 1)],
    "iron condor sell +/-400 buy +/-800": [("C", 400, -1, 1), ("P", -400, -1, 1), ("C", 800, 1, 1), ("P", -800, 1, 1)],
    "short strangle +/-600 (naked)": [("C", 600, -1, 1), ("P", -600, -1, 1)],
    "call ladder: sell ATM, buy +400, buy +800 (your 3C)": [("C", 0, -1, 1), ("C", 400, 1, 1), ("C", 800, 1, 1)],
    "long call butterfly 1:2:1 +/-400 (your 3C/3P)": [("C", -400, 1, 1), ("C", 0, -1, 2), ("C", 400, 1, 1)],
    "call ratio: sell ATM, buy 2x +400 (your CS)": [("C", 0, -1, 1), ("C", 400, 1, 2)],
    "put ratio: sell ATM, buy 2x -400 (your PS)": [("P", 0, -1, 1), ("P", -400, 1, 2)],
    "call condor debit: buy -600, sell -200, sell +200, buy +600": [("C", -600, 1, 1), ("C", -200, -1, 1), ("C", 200, -1, 1), ("C", 600, 1, 1)],
}

def fee(spot, price, qty):
    return min(FEE_RATE * spot * qty, FEE_CAP * price * qty) * (1 + GST)

def load_day(exp):
    d = os.path.join(CACHE, exp)
    spot = {}
    opts = defaultdict(dict)
    for f in os.listdir(d):
        rows = json.load(open(os.path.join(d, f)))
        if not rows: continue
        sym = f[:-5].replace("_", ":")
        series = {dt.datetime.fromtimestamp(r["time"], U): float(r["close"]) for r in rows}
        if sym == "MARK:BTCUSD": spot = series
        else:
            _, kind, _, strike, _ = sym.split("-")[0].split(":")[1], sym.split("-")[0][-1], None, int(sym.split("-")[2]), None
            opts[(kind, strike)] = series
    return spot, opts

def payoff_max(legs, entry):
    """Max profit and max loss at expiry over a wide grid, USD, for the entry prices; None when unbounded."""
    ks = [k for _, k, _ in legs]
    grid = [min(ks) - 20000 + i * 25 for i in range(int((max(ks) - min(ks) + 40000) / 25) + 1)]
    best, worst = -1e18, 1e18
    for sp in grid:
        p = 0.0
        for (kind, k, sg), (e, mult) in zip(legs, entry):
            intr = max(0.0, sp - k) if kind == "C" else max(0.0, k - sp)
            p += sg * (intr - e) * LOTS * mult * LOT
        best, worst = max(best, p), min(worst, p)
    unb_up = any(kind == "C" and sum(sg * m for (kk, k2, sg), (_, m) in zip(legs, entry) if kk == "C") > 0 for kind, _, _ in legs)
    unb_dn = any(kind == "P" and sum(sg * m for (kk, k2, sg), (_, m) in zip(legs, entry) if kk == "P") > 0 for kind, _, _ in legs)
    return (None if (unb_up or unb_dn) else best), worst

results = defaultdict(list)  # struct -> list of entries
days = sorted(e for e in os.listdir(CACHE) if os.path.isdir(os.path.join(CACHE, e)))
for exp in days:
    spot, opts = load_day(exp)
    if not spot: continue
    y, m, d = map(int, exp.split("-"))
    settle = dt.datetime(y, m, d, 12, tzinfo=U)
    last_b = settle - dt.timedelta(minutes=5)
    if last_b not in spot: continue
    settle_spot = spot[last_b]
    for h in range(24, 0, -1):
        t0 = settle - dt.timedelta(hours=h)
        if t0 not in spot: continue
        s0 = spot[t0]
        atm = int(round(s0 / STEP) * STEP)
        for name, spec in STRUCTS.items():
            legs = [(kind, atm + off, sg) for kind, off, sg, _ in spec]
            mults = [m for _, _, _, m in spec]
            if any((kind, k) not in opts or t0 not in opts[(kind, k)] for kind, k, _ in legs): continue
            entry = [(opts[(kind, k)][t0] * (1 + SLIP * (1 if sg > 0 else -1)), m) for (kind, k, sg), m in zip(legs, mults)]
            qtys = [LOTS * m * LOT for m in mults]
            fee_in = sum(fee(s0, e, q) for (e, _), q in zip(entry, qtys))
            net_prem = sum(-sg * e * q for (kind, k, sg), (e, _), q in zip(legs, entry, qtys))  # + credit, - debit
            maxp, maxl = payoff_max(legs, entry)
            # path
            path = []
            t = t0
            while t <= last_b:
                if all(t in opts[(kind, k)] for kind, k, _ in legs) and t in spot:
                    pnl = sum(sg * (opts[(kind, k)][t] - e) * q for (kind, k, sg), (e, _), q in zip(legs, entry, qtys))
                    fee_out = sum(fee(spot[t], opts[(kind, k)][t], q) for (kind, k, _), q in zip(legs, qtys))
                    path.append((t, pnl, fee_out))
                t += dt.timedelta(minutes=5)
            if len(path) < 6: continue
            # settlement: intrinsic at the last mark spot, taker fee on open legs
            pnl_s = sum(sg * ((max(0.0, settle_spot - k) if kind == "C" else max(0.0, k - settle_spot)) - e) * q for (kind, k, sg), (e, _), q in zip(legs, entry, qtys))
            fee_s = sum(fee(settle_spot, (max(0.0, settle_spot - k) if kind == "C" else max(0.0, k - settle_spot)), q) for (kind, k, _), q in zip(legs, qtys))
            results[name].append({"exp": exp, "t0": t0, "h": h, "hour_ist": t0.astimezone(IST).hour, "credit": net_prem, "maxp": maxp, "maxl": maxl,
                                  "fee_in": fee_in, "path": path, "settle_gross": pnl_s, "settle_net": pnl_s - fee_in - fee_s})

def with_target(r, base, pct, stop_pct=None):
    """Net P&L if a target of pct% of base (and optional stop of stop_pct% of base) had been armed, else settle."""
    if base is None or base <= 0: return r["settle_net"]
    lvl = base * pct / 100
    stop = -base * stop_pct / 100 if stop_pct else None
    for t, pnl, fee_out in r["path"]:
        if pnl >= lvl: return pnl - r["fee_in"] - fee_out
        if stop is not None and pnl <= stop: return pnl - r["fee_in"] - fee_out
    return r["settle_net"]

def base_of(r):
    return r["maxp"] if r["maxp"] is not None else abs(r["credit"])

def stats(vals):
    n = len(vals)
    if not n: return "n=0"
    mean = sum(vals) / n
    win = sum(1 for v in vals if v > 0) / n
    # max drawdown of the cumulative sum in order
    peak = cum = 0.0; mdd = 0.0
    for v in vals:
        cum += v; peak = max(peak, cum); mdd = min(mdd, cum - peak)
    return f"n={n} mean={mean:+.2f} total={sum(vals):+.0f} win={100*win:.0f}% maxDD={mdd:.0f}"

print(f"days: {len(days)} ({days[0]} .. {days[-1]}), slippage {SLIP*100:.1f}% of premium per fill, 100 lots BTC (0.1 BTC per leg)\n")
for name, rs in results.items():
    print("=" * 100)
    print(name)
    print(f"  entries {len(rs)}; mean credit {sum(r['credit'] for r in rs)/len(rs):+.2f}; mean entry fees {sum(r['fee_in'] for r in rs)/len(rs):.2f}; mean round-trip fees at settlement {sum(r['fee_in'] + (r['settle_gross'] - r['settle_net'] - r['fee_in']) for r in rs)/len(rs):.2f}")
    # by entry hour IST: hold to settlement, and with targets
    print("  entry IST | hold to settlement | target 20% | target 30% | target 50% | target 30% + stop 30%")
    byh = defaultdict(list)
    for r in rs: byh[r["hour_ist"]].append(r)
    for hh in sorted(byh):
        v = byh[hh]
        print(f"  {hh:02d}:00 | {stats([r['settle_net'] for r in v])} | {stats([with_target(r, base_of(r), 20) for r in v])} | {stats([with_target(r, base_of(r), 30) for r in v])} | {stats([with_target(r, base_of(r), 50) for r in v])} | {stats([with_target(r, base_of(r), 30, 30) for r in v])}")
    # all entries pooled
    print(f"  ALL | {stats([r['settle_net'] for r in rs])} | {stats([with_target(r, base_of(r), 20) for r in rs])} | {stats([with_target(r, base_of(r), 30) for r in rs])} | {stats([with_target(r, base_of(r), 50) for r in rs])} | {stats([with_target(r, base_of(r), 30, 30) for r in rs])}")
    # exit-at-clock for the 21:30 IST entry (h = 20 before settlement is 21:30 IST): mean net if closed at HH:00 IST on expiry day
    ev = [r for r in rs if r["h"] == 20]
    if ev:
        line = []
        for hh in range(6, 18):
            vals = []
            for r in ev:
                want = r["t0"].astimezone(IST).replace(hour=hh, minute=0) + dt.timedelta(days=1 if hh < 21 else 0)
                want = want.astimezone(U)
                pt = next((p for p in r["path"] if p[0] == want), None)
                if pt: vals.append(pt[1] - r["fee_in"] - pt[2])
            if vals: line.append(f"{hh:02d}:00 {sum(vals)/len(vals):+.2f} ({100*sum(1 for v in vals if v>0)/len(vals):.0f}%)")
        print("  21:30 IST entry, close at (IST, expiry day) -> mean net (win%):", " | ".join(line))
        print(f"  21:30 IST entry, hold to settlement: {stats([r['settle_net'] for r in ev])}")
    # peak timing for the 21:30 entry: hour of best gross P&L
    if ev:
        pk = defaultdict(int)
        for r in ev:
            best = max(r["path"], key=lambda p: p[1])
            pk[best[0].astimezone(IST).hour] += 1
        print("  21:30 IST entry, hour (IST) of the best moment, count:", ", ".join(f"{h:02d}:{c}" for h, c in sorted(pk.items())))
json.dump({k: [{kk: (str(vv) if isinstance(vv, dt.datetime) else vv) for kk, vv in r.items() if kk != "path"} for r in v] for k, v in results.items()}, open(os.path.join(CACHE, "..", "sim-result.json"), "w"), indent=0)
