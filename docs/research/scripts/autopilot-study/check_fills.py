"""The owner's own order history against the lab's assumptions: fee rates, and real fills against the MARK candles.
It also prints the net result by product, the ten largest losing orders and a table by month; that output is the
owner's private record and is kept outside the repo. Read-only. Usage: python -I check_fills.py <order-history.csv> <option-history dir>"""
import csv, json, os, sys, datetime as dt, statistics as st

SRC, HIST = sys.argv[1], sys.argv[2]
U = dt.timezone.utc
IST = dt.timezone(dt.timedelta(hours=5, minutes=30))
LOT = {"BTC": 0.001, "ETH": 0.01, "XAUT": 0.001}
GST = 1.18


def f(x):
    try:
        return float(x)
    except (TypeError, ValueError):
        return None


rows = []
for r in csv.DictReader(open(SRC, encoding="utf-8-sig")):
    t = dt.datetime.strptime(r["Time"].split("+")[0][:26], "%Y-%m-%d %H:%M:%S.%f").replace(tzinfo=IST)
    filled = f(r["Filled/Remaining"].split("/")[0])
    px = f(r["Exec.Price"])
    if not filled or px is None:
        continue
    rows.append(dict(t=t, sym=r["Contract"], qty=filled, side=r["Side"], px=px, fee=f(r["Trading Fees"]) or 0.0,
                     value=f(r["Order Value"]), real=f(r["Realised P&L"]) or 0.0, net=f(r["Net P&L"]) or 0.0, kind=r["Order Type"]))
print(f"filled orders: {len(rows)}  ({min(r['t'] for r in rows):%d %b %Y} .. {max(r['t'] for r in rows):%d %b %Y})")

# ---- 1. net result by product
print("\n== 1. Net result by product (the sum of the Net P&L column: realised less fees)")
groups = {}
for r in rows:
    s = r["sym"]
    key = ("options " + s.split("-")[1]) if s[:2] in ("C-", "P-") else ("futures " + s)
    g = groups.setdefault(key, [0, 0.0, 0.0, 0.0])
    g[0] += 1
    g[1] += r["real"]
    g[2] += r["fee"]
    g[3] += r["net"]
print(f"   {'':16s} {'orders':>7s} {'realised':>12s} {'fees':>10s} {'net':>12s}")
for k in sorted(groups):
    g = groups[k]
    print(f"   {k:16s} {g[0]:7d} {g[1]:+12.1f} {g[2]:10.1f} {g[3]:+12.1f}")
tot = [sum(g[i] for g in groups.values()) for i in range(4)]
print(f"   {'all':16s} {tot[0]:7d} {tot[1]:+12.1f} {tot[2]:10.1f} {tot[3]:+12.1f}")

# worst single orders
print("   ten largest losing orders:")
for r in sorted(rows, key=lambda r: r["net"])[:10]:
    print(f"      {r['t']:%d %b %H:%M} {r['sym']:22s} {r['side']:4s} {r['qty']:6.0f} @ {r['px']:10.1f}  net {r['net']:+10.1f}")

# by month and product class
print("   by month:")
m = {}
for r in rows:
    cls = "options" if r["sym"][:2] in ("C-", "P-") else "futures"
    m.setdefault((r["t"].strftime("%Y-%m"), cls), [0.0])[0] += r["net"]
for k in sorted(m):
    print(f"      {k[0]} {k[1]:8s} {m[k][0]:+12.1f}")

# ---- 2. futures fee rate
print("\n== 2. Futures fee as a share of the order value (before GST), orders with a fee")
for kind in ("market_order", "limit_order"):
    v = [r["fee"] / GST / r["value"] * 100 for r in rows if r["sym"].endswith("USD") and r["kind"] == kind and r["fee"] > 0 and r["value"]]
    z = sum(1 for r in rows if r["sym"].endswith("USD") and r["kind"] == kind and r["fee"] == 0)
    if v:
        q = sorted(v)
        print(f"   {kind:13s} n={len(v):4d} median {st.median(v):.4f} %  10th..90th centile {q[len(q) // 10]:.4f} .. {q[9 * len(q) // 10]:.4f} %   (and {z} orders with no fee)")

# ---- spot and marks from the cache
cache = {}


def load(coin, exp):
    key = (coin, exp)
    if key not in cache:
        d = os.path.join(HIST, f"daily-{coin}", exp)
        out = {}
        if os.path.isdir(d):
            for fn in os.listdir(d):
                data = json.load(open(os.path.join(d, fn)))
                out[fn[5:-5]] = {int(x["time"]): float(x["close"]) for x in data}
        cache[key] = out
    return cache[key]


def expiry(sym):
    d = sym.split("-")[3]
    return f"20{d[4:6]}-{d[2:4]}-{d[0:2]}"


# ---- 3. option fee model
print("\n== 3. Option fee against the lab's model: min(0.01 % of notional, 3.5 % of premium) + 18 % GST")
ok = bad = nospot = 0
capped = 0
errs = []
for r in rows:
    if r["sym"][:2] not in ("C-", "P-") or r["fee"] <= 0:
        continue
    coin = r["sym"].split("-")[1]
    q = r["qty"] * LOT[coin]
    cap = 0.035 * r["px"] * q * GST
    if abs(r["fee"] - cap) <= max(0.002, 0.002 * cap):
        capped += 1
        ok += 1
        continue
    spot_implied = r["fee"] / GST / q / 0.0001
    marks = load(coin, expiry(r["sym"]))
    sp = marks.get(f"{coin}USD", {})
    ts = int(r["t"].timestamp()) // 300 * 300
    s = sp.get(ts) or sp.get(ts + 300)
    if s is None:
        nospot += 1
        continue
    e = spot_implied / s - 1
    errs.append(e)
    if abs(e) < 0.01:
        ok += 1
    else:
        bad += 1
print(f"   fits the model: {ok} orders ({capped} of them at the 3.5 % cap); does not fit: {bad}; no spot candle to check against: {nospot}")
if errs:
    print(f"   where not capped, the spot implied by the fee at 0.01 % against the spot candle: median {100 * st.median(errs):+.3f} %, largest gap {100 * max(abs(x) for x in errs):.2f} %")

# ---- 4. fills against the mark
print("\n== 4. Real option fills against the MARK candle (5-minute closes either side of the fill, interpolated in time)")
print("   cost = how much worse than the mark the fill was, as a share of the mark (buy: paid above; sell: received below)")
res = []
for r in rows:
    if r["sym"][:2] not in ("C-", "P-"):
        continue
    if r["t"].astimezone(IST).strftime("%H:%M") == "17:30" and r["kind"] == "limit_order":
        continue  # settlement
    coin = r["sym"].split("-")[1]
    mk = load(coin, expiry(r["sym"])).get(r["sym"])
    if not mk:
        continue
    ts = r["t"].timestamp()
    a = int(ts) // 300 * 300
    for align in (0, 300):  # the candle's time is the bar's end (0) or its start (300)
        p0, p1 = mk.get(a - 300 + (300 - align)), mk.get(a + (300 - align))
        if p0 is None or p1 is None:
            continue
        w = (ts - a) / 300
        mark = p0 + (p1 - p0) * w
        if mark <= 0:
            continue
        cost = (r["px"] - mark) / mark if r["side"] == "buy" else (mark - r["px"]) / mark
        res.append((align, r["kind"], r["side"], mark, cost, cost * mark * r["qty"] * LOT[coin], r["px"] * r["qty"] * LOT[coin]))
for align in (0, 300):
    print(f"   -- candle time read as the bar's {'end' if align == 0 else 'start'}")
    for kind in ("market_order", "limit_order"):
        for lo, hi, name in ((0, 1e9, "all marks"), (0, 50, "mark under 50"), (50, 300, "mark 50 to 300"), (300, 1e9, "mark over 300")):
            v = [x for x in res if x[0] == align and x[1] == kind and lo <= x[3] < hi]
            if len(v) < 5:
                continue
            c = sorted(x[4] for x in v)
            usd, prem = sum(x[5] for x in v), sum(x[6] for x in v)
            print(f"      {kind:13s} {name:15s} n={len(v):4d}  median cost {100 * st.median(c):+6.2f} %  mean {100 * st.mean(c):+6.2f} %  25th..75th {100 * c[len(c) // 4]:+6.2f} .. {100 * c[3 * len(c) // 4]:+6.2f} %   in money: {usd:+9.1f} on {prem:9.0f} of premium ({100 * usd / prem:+.2f} %)")
