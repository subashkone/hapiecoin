"""Three questions about daily-expiry BTC option structures, on Delta India 5-minute MARK candles (the cache written by
../paper-timing/fetch.py), with the exchange's real fees (0.01 % of notional per fill, capped at 3.5 % of the premium,
plus 18 % GST; the same fee on every leg still open at settlement). Fills at mark. 100 lots = 0.1 BTC per leg.

  A. Reward to risk: what each structure offers at entry, and what happens if only entries with at least 3 to 1 are taken.
  B. Entry hour: every hour of the 24 before settlement (17:30 IST), per structure and exit rule.
  C. Laddering: after the evening entry, open the same structure again on the new at-the-money strike whenever the
     price has moved a set distance from every centre held so far. Is the ladder better than the single trade?

Usage: python -I study.py <cache_dir> [slippage_pct_of_premium]
Output is ASCII (this Windows box prints cp1252)."""
import json, os, sys, datetime as dt
from collections import defaultdict

CACHE = sys.argv[1]
SLIP = float(sys.argv[2]) / 100 if len(sys.argv) > 2 else 0.0
U = dt.timezone.utc
IST = dt.timezone(dt.timedelta(hours=5, minutes=30))
LOT, LOTS, STEP = 0.001, 100, 200
FEE_RATE, FEE_CAP, GST = 0.0001, 0.035, 0.18
EVENING_H = 20  # hours before settlement: 16:00 UTC = 21:30 IST, after the US cash open

# (kind, offset from the at-the-money strike, +1 buy / -1 sell, lots multiplier)
STRUCTS = {
    "iron butterfly 600 (sell ATM straddle, buy wings)": [("C", 0, -1, 1), ("P", 0, -1, 1), ("C", 600, 1, 1), ("P", -600, 1, 1)],
    "iron butterfly 1000": [("C", 0, -1, 1), ("P", 0, -1, 1), ("C", 1000, 1, 1), ("P", -1000, 1, 1)],
    "iron condor 400/800": [("C", 400, -1, 1), ("P", -400, -1, 1), ("C", 800, 1, 1), ("P", -800, 1, 1)],
    "short strangle 600 (naked)": [("C", 600, -1, 1), ("P", -600, -1, 1)],
    "short strangle 1000 (naked)": [("C", 1000, -1, 1), ("P", -1000, -1, 1)],
    "long call butterfly 200": [("C", -200, 1, 1), ("C", 0, -1, 2), ("C", 200, 1, 1)],
    "long call butterfly 400": [("C", -400, 1, 1), ("C", 0, -1, 2), ("C", 400, 1, 1)],
    "long call butterfly 800": [("C", -800, 1, 1), ("C", 0, -1, 2), ("C", 800, 1, 1)],
    "bull call spread ATM/+400": [("C", 0, 1, 1), ("C", 400, -1, 1)],
    "bear put spread ATM/-400": [("P", 0, 1, 1), ("P", -400, -1, 1)],
    "bull put credit spread -400/-800": [("P", -400, -1, 1), ("P", -800, 1, 1)],
    "bear call credit spread +400/+800": [("C", 400, -1, 1), ("C", 800, 1, 1)],
    "long straddle ATM": [("C", 0, 1, 1), ("P", 0, 1, 1)],
    # round 2: the sold strangle at other widths, at the money, and with far wings bought to cap the loss
    "short straddle ATM (naked)": [("C", 0, -1, 1), ("P", 0, -1, 1)],
    "short strangle 400 (naked)": [("C", 400, -1, 1), ("P", -400, -1, 1)],
    "short strangle 800 (naked)": [("C", 800, -1, 1), ("P", -800, -1, 1)],
    "short strangle 1400 (naked)": [("C", 1400, -1, 1), ("P", -1400, -1, 1)],
    "strangle 600 with wings at 1600": [("C", 600, -1, 1), ("P", -600, -1, 1), ("C", 1600, 1, 1), ("P", -1600, 1, 1)],
    "strangle 1000 with wings at 2000": [("C", 1000, -1, 1), ("P", -1000, -1, 1), ("C", 2000, 1, 1), ("P", -2000, 1, 1)],
}
NAKED = {n for n in STRUCTS if "(naked)" in n}
LEGSTOP = NAKED | {"strangle 600 with wings at 1600", "strangle 1000 with wings at 2000"}


def fee(spot, price, qty):
    return min(FEE_RATE * spot * qty, FEE_CAP * price * qty) * (1 + GST)


def load_day(exp):
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
            body = sym.split(":")[1].split("-")  # C-BTC-64000-191126
            opts[(body[0], int(body[2]))] = series
    return spot, opts


def intrinsic(kind, k, sp):
    return max(0.0, sp - k) if kind == "C" else max(0.0, k - sp)


def open_struct(name, centre, t0, spot, opts):
    """The structure centred on `centre`, filled at the marks of bar t0; None when a leg has no price then."""
    spec = STRUCTS[name]
    legs = [(kind, centre + off, sg, m) for kind, off, sg, m in spec]
    if any((kind, k) not in opts or t0 not in opts[(kind, k)] for kind, k, _, _ in legs):
        return None
    s0 = spot[t0]
    entry = [opts[(kind, k)][t0] * (1 + SLIP * sg) for kind, k, sg, _ in legs]
    qty = [LOTS * m * LOT for _, _, _, m in legs]
    fee_in = sum(fee(s0, e, q) for e, q in zip(entry, qty))
    credit = sum(-sg * e * q for (_, _, sg, _), e, q in zip(legs, entry, qty))  # + received, - paid

    def at(sp):
        return sum(sg * (intrinsic(kind, k, sp) - e) * q for (kind, k, sg, _), e, q in zip(legs, entry, qty))

    ks = sorted({k for _, k, _, _ in legs})
    pts = [at(k) for k in ks] + [at(ks[0] - 20000), at(ks[-1] + 20000)]
    naked = name in NAKED
    return {"name": name, "centre": centre, "t0": t0, "legs": legs, "entry": entry, "qty": qty, "fee_in": fee_in, "credit": credit,
            "maxp": None if naked else max(pts), "maxl": None if naked else -min(pts)}


def run(st, spot, opts, last_b, settle_spot):
    """Attach the 5-minute path (gross P&L, exit fee if closed there) and the settlement outcome."""
    path, t = [], st["t0"]
    while t <= last_b:
        if t in spot and all(t in opts[(kind, k)] for kind, k, _, _ in st["legs"]):
            pnl = sum(sg * (opts[(kind, k)][t] - e) * q for (kind, k, sg, _), e, q in zip(st["legs"], st["entry"], st["qty"]))
            fee_out = sum(fee(spot[t], opts[(kind, k)][t], q) for (kind, k, _, _), q in zip(st["legs"], st["qty"]))
            path.append((t, pnl, fee_out))
        t += dt.timedelta(minutes=5)
    gross = sum(sg * (intrinsic(kind, k, settle_spot) - e) * q for (kind, k, sg, _), e, q in zip(st["legs"], st["entry"], st["qty"]))
    fee_s = sum(fee(settle_spot, intrinsic(kind, k, settle_spot), q) for (kind, k, _, _), q in zip(st["legs"], st["qty"]))
    st["path"], st["hold"] = path, gross - st["fee_in"] - fee_s
    # the usual way a sold strangle is run: each sold option has its own stop at a multiple of the price it was sold
    # for; the option that is hit is bought back, the other one stays to settlement
    st["legstop"] = {}
    for mult in (2, 3):
        total = -st["fee_in"]
        for (kind, k, sg, _), e, q in zip(st["legs"], st["entry"], st["qty"]):
            done, t = False, st["t0"] + dt.timedelta(minutes=5)
            while sg < 0 and t <= last_b:
                px = opts[(kind, k)].get(t)
                if px is not None and px >= mult * e:
                    total += sg * (px - e) * q - fee(spot.get(t, settle_spot), px, q)
                    done = True
                    break
                t += dt.timedelta(minutes=5)
            if not done:
                total += sg * (intrinsic(kind, k, settle_spot) - e) * q - fee(settle_spot, intrinsic(kind, k, settle_spot), q)
        st["legstop"][mult] = total
    # the same stops with a profit take: close everything once the trade as a whole is up by half the premium collected
    st["legtp"] = {}
    for mult in (2, 3):
        live = list(range(len(st["legs"])))
        realised, out, t = -st["fee_in"], None, st["t0"] + dt.timedelta(minutes=5)
        want = 0.5 * st["credit"]
        while t <= last_b and live and st["credit"] > 0:
            px = {i: opts[st["legs"][i][:2]].get(t) for i in live}
            sp = spot.get(t, settle_spot)
            for i in list(live):
                kind, k, sg, _ = st["legs"][i]
                if sg < 0 and px[i] is not None and px[i] >= mult * st["entry"][i]:
                    realised += sg * (px[i] - st["entry"][i]) * st["qty"][i] - fee(sp, px[i], st["qty"][i])
                    live.remove(i)
            if any(px[i] is None for i in live):
                t += dt.timedelta(minutes=5)
                continue
            open_pnl = sum(st["legs"][i][2] * (px[i] - st["entry"][i]) * st["qty"][i] for i in live)
            if live and realised + st["fee_in"] + open_pnl >= want:
                out = realised + open_pnl - sum(fee(sp, px[i], st["qty"][i]) for i in live)
                break
            t += dt.timedelta(minutes=5)
        if out is None:
            out = realised + sum(st["legs"][i][2] * (intrinsic(st["legs"][i][0], st["legs"][i][1], settle_spot) - st["entry"][i]) * st["qty"][i] - fee(settle_spot, intrinsic(st["legs"][i][0], st["legs"][i][1], settle_spot), st["qty"][i]) for i in live)
        st["legtp"][mult] = out
    # "this leg, then trail the rest" (ADR-104): once a sold option has been stopped, the profit of what is left is
    # trailed and the rest is closed when it falls back by `give` of its best; the rest keeps its own stop meanwhile.
    # `exit_rest` 1.0 is the plain alternative: close everything the moment the first stop is hit.
    st["legtrail"] = {}
    for mult in (2, 3):
        for give in (0.1, 0.3, 0.5, 1.0):
            live = list(range(len(st["legs"])))
            realised, out, t, stopped, peak = -st["fee_in"], None, st["t0"] + dt.timedelta(minutes=5), False, 0.0
            while t <= last_b and live:
                px = {i: opts[st["legs"][i][:2]].get(t) for i in live}
                sp = spot.get(t, settle_spot)
                for i in list(live):
                    kind, k, sg, _ = st["legs"][i]
                    if sg < 0 and px[i] is not None and px[i] >= mult * st["entry"][i]:
                        realised += sg * (px[i] - st["entry"][i]) * st["qty"][i] - fee(sp, px[i], st["qty"][i])
                        live.remove(i)
                        stopped = True
                if stopped and live and all(px[i] is not None for i in live):
                    rest = sum(st["legs"][i][2] * (px[i] - st["entry"][i]) * st["qty"][i] for i in live)
                    peak = max(peak, rest)
                    if give >= 1.0 or (peak >= 0.01 and rest <= peak * (1 - give)):
                        out = realised + rest - sum(fee(sp, px[i], st["qty"][i]) for i in live)
                        break
                t += dt.timedelta(minutes=5)
            if out is None:
                out = realised + sum(st["legs"][i][2] * (intrinsic(st["legs"][i][0], st["legs"][i][1], settle_spot) - st["entry"][i]) * st["qty"][i] - fee(settle_spot, intrinsic(st["legs"][i][0], st["legs"][i][1], settle_spot), st["qty"][i]) for i in live)
            st["legtrail"][(mult, give)] = out
    return st


def outcome(st, target_pct=None, stop_pct=None):
    """Net P&L. target_pct: share of the maximum profit (of the credit when naked). stop_pct: share of the maximum
    loss (a multiple of the credit when naked, as a percentage). None, None is hold to settlement."""
    if target_pct == "leg":
        return st["legstop"][stop_pct]
    if target_pct == "legtp":
        return st["legtp"][stop_pct]
    if target_pct is None and stop_pct is None:
        return st["hold"]
    win_base = st["maxp"] if st["maxp"] is not None else abs(st["credit"])
    loss_base = st["maxl"] if st["maxl"] is not None else abs(st["credit"])
    tp = None if target_pct is None or win_base <= 0 else win_base * target_pct / 100
    sl = None if stop_pct is None or loss_base <= 0 else -loss_base * stop_pct / 100
    for _, pnl, fee_out in st["path"][1:]:
        if tp is not None and pnl >= tp:
            return pnl - st["fee_in"] - fee_out
        if sl is not None and pnl <= sl:
            return pnl - st["fee_in"] - fee_out
    return st["hold"]


def stats(vals):
    n = len(vals)
    if not n:
        return "n=0"
    mean, win = sum(vals) / n, sum(1 for v in vals if v > 0) / n
    peak = cum = mdd = 0.0
    for v in vals:
        cum += v
        peak = max(peak, cum)
        mdd = min(mdd, cum - peak)
    return f"n={n:4d} mean={mean:+7.2f} total={sum(vals):+8.0f} win={100 * win:3.0f}% worst={min(vals):+8.1f} maxDD={mdd:8.0f}"


EXITS = [("hold to settlement", None, None), ("target 10%", 10, None), ("target 10% + stop 50%", 10, 50), ("target 30%", 30, None),
         ("target 50%", 50, None), ("target 50% + stop 50%", 50, 50), ("target 75%", 75, None)]

days = sorted(e for e in os.listdir(CACHE) if os.path.isdir(os.path.join(CACHE, e)))
hourly = defaultdict(list)  # name -> entries at every hour
ladders = defaultdict(list)  # (name, distance) -> per-day ladder
used = 0
for exp in days:
    spot, opts = load_day(exp)
    if not spot:
        continue
    y, m, d = map(int, exp.split("-"))
    settle = dt.datetime(y, m, d, 12, tzinfo=U)
    last_b = settle - dt.timedelta(minutes=5)
    if last_b not in spot:
        continue
    used += 1
    settle_spot = spot[last_b]
    for h in range(24, 0, -1):
        t0 = settle - dt.timedelta(hours=h)
        if t0 not in spot:
            continue
        atm = int(round(spot[t0] / STEP) * STEP)
        for name in STRUCTS:
            st = open_struct(name, atm, t0, spot, opts)
            if st is None:
                continue
            run(st, spot, opts, last_b, settle_spot)
            if len(st["path"]) < 6:
                continue
            st["exp"], st["h"], st["ist"] = exp, h, t0.astimezone(IST).hour
            hourly[name].append(st)
    # C. the ladder, from the evening entry
    t0 = settle - dt.timedelta(hours=EVENING_H)
    if t0 not in spot:
        continue
    for name in ("iron butterfly 600 (sell ATM straddle, buy wings)", "iron condor 400/800", "short strangle 600 (naked)", "long call butterfly 400", "long call butterfly 800"):
        for dist in (400, 600, 1000):
            first = open_struct(name, int(round(spot[t0] / STEP) * STEP), t0, spot, opts)
            if first is None:
                continue
            held = [run(first, spot, opts, last_b, settle_spot)]
            t = t0 + dt.timedelta(minutes=5)
            while t <= settle - dt.timedelta(hours=2) and len(held) < 4:  # no new trade in the last two hours
                if t in spot and all(abs(spot[t] - s["centre"]) >= dist for s in held):
                    c = int(round(spot[t] / STEP) * STEP)
                    nxt = open_struct(name, c, t, spot, opts) if all(c != s["centre"] for s in held) else None
                    if nxt is not None:
                        held.append(run(nxt, spot, opts, last_b, settle_spot))
                t += dt.timedelta(minutes=5)
            ladders[(name, dist)].append({"exp": exp, "held": held})

print(f"expiries used: {used} of {len(days)} ({days[0]} .. {days[-1]}); slippage {SLIP * 100:.1f}% of premium per fill; 100 lots (0.1 BTC) per leg; net of fees\n")

print("=" * 110)
print("A. REWARD TO RISK AT ENTRY (maximum profit / maximum loss at settlement, before fees), all entry hours")
print("=" * 110)
for name, rs in hourly.items():
    if name in NAKED:
        print(f"\n{name}: no maximum loss (naked). Mean credit {sum(r['credit'] for r in rs) / len(rs):+.2f}, fees in {sum(r['fee_in'] for r in rs) / len(rs):.2f}")
        print("   all entries          | " + " | ".join(f"{lab}: {stats([outcome(r, tp, sl) for r in rs])}" for lab, tp, sl in (("hold", None, None), ("each option stopped at 2x its price", "leg", 2), ("each option stopped at 3x", "leg", 3), ("target 50% of credit", 50, None), ("stop 200% of credit, no target", None, 200), ("target 50% + stop 200%", 50, 200))))
        continue
    ok = [r for r in rs if r["maxl"] > 0 and r["maxp"] > 0]
    rr = sorted(r["maxp"] / r["maxl"] for r in ok)
    if not rr:
        continue
    q = lambda p: rr[min(len(rr) - 1, int(p * len(rr)))]
    share3 = sum(1 for x in rr if x >= 3) / len(rr)
    print(f"\n{name}: reward/risk median {q(0.5):.2f} (10th pct {q(0.1):.2f}, 90th pct {q(0.9):.2f}); entries with at least 3 to 1: {100 * share3:.0f}%; mean max profit {sum(r['maxp'] for r in ok) / len(ok):.1f}, mean max loss {sum(r['maxl'] for r in ok) / len(ok):.1f}, fees in {sum(r['fee_in'] for r in ok) / len(ok):.2f}")
    for label, sub in (("all entries", ok), ("only >= 3 to 1", [r for r in ok if r["maxp"] / r["maxl"] >= 3]), ("only < 3 to 1", [r for r in ok if r["maxp"] / r["maxl"] < 3])):
        if len(sub) < 20:
            print(f"   {label:20s} | n={len(sub)} (too few to read)")
            continue
        print(f"   {label:20s} | " + " | ".join(f"{lab}: {stats([outcome(r, tp, sl) for r in sub])}" for lab, tp, sl in (EXITS[0], EXITS[2], EXITS[5])))

print("\n" + "=" * 110)
print("B. ENTRY HOUR (IST hour of the bar; :30 past, because settlement is 17:30 IST). Mean net per entry / win%")
print("=" * 110)
for name, rs in hourly.items():
    print(f"\n{name}")
    byh = defaultdict(list)
    for r in rs:
        byh[r["ist"]].append(r)
    exits = [("hold", None, None), ("each option stop 2x", "leg", 2), ("each option stop 3x", "leg", 3), ("stop 2x + take half", "legtp", 2), ("stop 3x + take half", "legtp", 3)] if name in LEGSTOP else [("hold", None, None), ("tgt10%+stop50%", 10, 50), ("tgt50%+stop50%", 50, 50)]
    print("   IST   n   | " + " | ".join(f"{lab:>22s}" for lab, _, _ in exits))
    order = [(18 + i) % 24 for i in range(24)]  # from just after one settlement to just before the next
    for hh in order:
        v = byh.get(hh, [])
        if not v:
            continue
        cells = []
        for _, tp, sl in exits:
            vals = [outcome(r, tp, sl) for r in v]
            cells.append(f"{sum(vals) / len(vals):+8.2f} / {100 * sum(1 for x in vals if x > 0) / len(vals):3.0f}% wst {min(vals):+7.0f}")
        print(f"   {hh:02d}:30 {len(v):3d} | " + " | ".join(cells))

print("\n" + "=" * 110)
print("C. LADDER from the 21:30 IST entry: add the same structure on the new ATM strike when the price is `dist` away from")
print("   every centre held (up to 4 in all, none in the last two hours). Per expiry day, net of fees.")
print("=" * 110)
for (name, dist), ds in ladders.items():
    moved = [x for x in ds if len(x["held"]) > 1]
    print(f"\n{name}, dist {dist}: days {len(ds)}, days the ladder added {len(moved)} ({100 * len(moved) / max(1, len(ds)):.0f}%), mean trades per day {sum(len(x['held']) for x in ds) / max(1, len(ds)):.2f}")
    exits = [("hold", None, None), ("each option stop 2x", "leg", 2), ("tgt50%+stop200%", 50, 200)] if name in NAKED else [("hold", None, None), ("tgt10%+stop50%", 10, 50), ("tgt50%+stop50%", 50, 50)]
    for lab, tp, sl in exits:
        single = [outcome(x["held"][0], tp, sl) for x in ds]
        ladder = [sum(outcome(s, tp, sl) for s in x["held"]) for x in ds]
        print(f"   {lab:18s} single: {stats(single)}")
        print(f"   {'':18s} ladder: {stats(ladder)}")
        if moved:
            s2 = [outcome(x["held"][0], tp, sl) for x in moved]
            a2 = [sum(outcome(s, tp, sl) for s in x["held"][1:]) for x in moved]
            both = sum(1 for x in moved if sum(1 for s in x["held"] if outcome(s, tp, sl) > 0) >= 2)
            print(f"   {'':18s} on days it added -> first trade: mean {sum(s2) / len(s2):+.2f}; the added trades together: mean {sum(a2) / len(a2):+.2f}, positive on {100 * sum(1 for v in a2 if v > 0) / len(a2):.0f}% of those days; two or more trades of the day positive on {100 * both / len(moved):.0f}%")

# month by month, for the evening entry held to settlement (does any result survive a bad month?)
print("\n" + "=" * 110)
print("D. MONTH BY MONTH, 21:30 IST entry: total net per month, hold | alt = each option stopped at 2x (strangles), target 50% + stop 50% (the rest) | half = stop 2x + take half the premium | stop3x, half3x = the same at 3x")
print("=" * 110)
for name, rs in hourly.items():
    ev = [r for r in rs if r["h"] == EVENING_H]
    bym = defaultdict(list)
    for r in ev:
        bym[r["exp"][:7]].append(r)
    alt = ("leg", 2) if name in LEGSTOP else (50, 50)
    print(f"{name:52s} " + " | ".join(f"{mth} n={len(v):2d} hold {sum(outcome(r) for r in v):+7.0f} alt {sum(outcome(r, *alt) for r in v):+7.0f}" + (f" half {sum(outcome(r, 'legtp', 2) for r in v):+7.0f} stop3x {sum(outcome(r, 'leg', 3) for r in v):+7.0f} half3x {sum(outcome(r, 'legtp', 3) for r in v):+7.0f}" if name in LEGSTOP else "") for mth, v in sorted(bym.items())))

# what to do with the other side once one sold option has been stopped (21:30 IST entry)
print("\n" + "=" * 110)
print("E. AFTER THE FIRST STOP, 21:30 IST entry: keep the other side to settlement (with its own stop), trail its profit, or close it at once")
print("=" * 110)
for name in sorted(NAKED):
    ev = [r for r in hourly[name] if r["h"] == EVENING_H]
    if not ev:
        continue
    print(f"\n{name}")
    for mult in (2, 3):
        hit = [r for r in ev if abs(r["legstop"][mult] - r["hold"]) > 1e-9]
        print(f"   stop at {mult}x: a stop was hit on {len(hit)} of {len(ev)} days")
        print(f"      keep the other side         all days: {stats([r['legstop'][mult] for r in ev])} | stop days only: {stats([r['legstop'][mult] for r in hit])}")
        for give, lab in ((0.1, "trail, give back 10 %"), (0.3, "trail, give back 30 %"), (0.5, "trail, give back 50 %"), (1.0, "close it at once")):
            print(f"      {lab:27s} all days: {stats([r['legtrail'][(mult, give)] for r in ev])} | stop days only: {stats([r['legtrail'][(mult, give)] for r in hit])}")
        both = sum(1 for r in ev if r["legstop"][mult] < -0.9 * r["credit"])
        print(f"      days that lost about the whole premium or more with 'keep' (both sides stopped, or one stopped far beyond): {both}")
