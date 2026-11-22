"""Review every Autopilot PAPER trade that collected a premium (the owner's request of 22 Nov 2026: "see how best we
can convert them to best strategies"): what the trade did as it ran, against what it would have done with a tighter
exit laid over its own history. The overlays, each judged on the 1-minute MARK closes of fetch_paper.py:
  - buy back each sold option alone once its mark is at or under a fixed price (BTC 10 and 5, ETH 0.5 and 0.25);
  - buy back each sold option alone once its mark is at or under 5 % of the price it was sold at (any coin);
  - close the whole trade once 90 % or 95 % of the premium is in hand.
An overlay only acts on a leg that the trade itself still held at that minute; whatever the trade really closed
(a stop, a take, the settlement) stays as it happened. Results are before fees (the fee on buying an option back at
5 USD is about 0.02 USD for 100 lots). One day of paper trades proves nothing: a pattern found here is a question for
the backtest (study_cheap.py, study_exits.py), not a result.

Usage: python -I review_paper.py <paper-positions.json> <candles_dir>"""
import json, os, sys, datetime as dt
from collections import defaultdict

SRC, CAND = sys.argv[1], sys.argv[2]
IST = dt.timezone(dt.timedelta(hours=5, minutes=30))
LOT = {"BTC": 0.001, "ETH": 0.01, "XAUT": 0.001}
FIXED = {"BTC": (10.0, 5.0), "ETH": (0.5, 0.25)}
ts = lambda s: None if not s else dt.datetime.fromisoformat(s.replace("Z", "+00:00")).timestamp()
f_ist = lambda m: dt.datetime.fromtimestamp(m, IST).strftime("%d %b %H:%M")
cache = {}


def series(sym):
    if sym not in cache:
        p = os.path.join(CAND, f"MARK_{sym}.json")
        cache[sym] = {r["time"]: float(r["close"]) for r in json.load(open(p))} if os.path.exists(p) else {}
    return cache[sym]


def replay(legs, end, credit, leg_at=None, leg_share=None, take=None):
    """The trade's own history minute by minute with one overlay. Returns (result, best, best minute, what the overlay
    did). A leg is valued at its real exit once the trade closed it, at the overlay's price once the overlay did."""
    over, did, last, best, whole = {}, [], {}, None, None
    m = int(min(l["opened"] for l in legs)) // 60 * 60 + 60
    total = 0.0
    while m <= end:
        total, ok = 0.0, True
        for i, l in enumerate(legs):
            if m < l["opened"]:
                continue
            if i in over:
                px = over[i]
            elif l["closed"] is not None and l["exit"] is not None and m >= l["closed"]:
                px = l["exit"]
            else:
                px = l["marks"].get(m, last.get(i))
                if px is None:
                    ok = False
                    break
                last[i] = px
                level = leg_at if leg_at is not None else (leg_share * l["entry"] if leg_share is not None else None)
                if level is not None and l["sign"] < 0 and px <= level:
                    over[i] = px
                    did.append(f"{l['sym']} at {px:.2f} {f_ist(m)}")
            total += l["sign"] * (px - l["entry"]) * l["q"]
        if ok:
            if best is None or total > best[0]:
                best = (total, m)
            if take is not None and credit > 0 and total >= take * credit:
                whole = (total, m)
                break
        m += 60
    if whole:
        return whole[0], best, [f"all at {f_ist(whole[1])}"]
    return total, best, did


src = json.load(open(SRC))
rows, by_name = [], defaultdict(list)
for t in src["trades"]:
    lot = LOT[t["coin"]]
    legs = [dict(sym=l["symbol"], sign=1 if l["side"] == "buy" else -1, q=float(l["lots"]) * lot, entry=float(l["entry_price"]), opened=ts(l["opened_at"]), closed=ts(l["closed_at"]),
                 exit=float(l["exit_price"]) if l["exit_price"] not in (None, "") else None, marks=series(l["symbol"])) for l in t["legs"]]
    credit = sum(-l["sign"] * l["entry"] * l["q"] for l in legs)
    if credit <= 0 or not any(l["marks"] for l in legs):
        continue
    end = max(max(l["marks"]) for l in legs if l["marks"])
    if t["closed_at"]:
        end = min(end, ts(t["closed_at"]) + 60)
    actual, best, _ = replay(legs, end, credit)
    if best is None:
        continue
    name = t["name"].split(" Â")[0].split(" ·")[0]
    r = dict(coin=t["coin"], name=name, state="closed" if t["closed_at"] else "open", entry=f_ist(min(l["opened"] for l in legs)), credit=credit, actual=actual, best=best[0], best_t=f_ist(best[1]), alt={})
    fixed = FIXED.get(t["coin"], ())
    for label, kw in [(f"leg<={x:g}", dict(leg_at=x)) for x in fixed] + [("leg<=5%", dict(leg_share=0.05)), ("take 90%", dict(take=0.90)), ("take 95%", dict(take=0.95))]:
        res, _, did = replay(legs, end, credit, **kw)
        r["alt"][label] = (res, did)
    rows.append(r)
    by_name[(t["coin"], name)].append(r)

LABELS = ["leg<=10/0.5", "leg<=5/0.25", "leg<=5%", "take 90%", "take 95%"]


def alt(r, k):
    """The two fixed prices differ by coin: column k is the higher or the lower of the coin's pair."""
    keys = list(r["alt"])
    fixed = [x for x in keys if x.startswith("leg<=") and not x.endswith("%")]
    if k < 2:
        return r["alt"][fixed[k]] if len(fixed) == 2 else None
    return r["alt"][LABELS[k]]


print(f"export of {src['exported_at_utc']}; {len(rows)} paper trades that collected a premium; USD before fees; times IST")
print("kept = the share of the premium the trade has (or ended with); every other column is the result with that overlay\n")
print(f"{'coin':4s} {'strategy':44s} {'state':6s} {'entered':12s} {'premium':>8s} {'result':>8s} {'kept':>5s} {'best':>8s} {'best at':12s} " + " ".join(f"{x:>11s}" for x in LABELS))
tot = defaultdict(float)
for r in sorted(rows, key=lambda r: (r["coin"], r["name"], r["entry"])):
    cells = []
    for k, lb in enumerate(LABELS):
        a = alt(r, k)
        cells.append(f"{'':>11s}" if a is None else f"{a[0]:+11.2f}")
        if a is not None:
            tot[lb] += a[0] - r["actual"]
    print(f"{r['coin']:4s} {r['name'][:44]:44s} {r['state']:6s} {r['entry']:12s} {r['credit']:8.2f} {r['actual']:+8.2f} {100 * r['actual'] / r['credit']:4.0f}% {r['best']:+8.2f} {r['best_t']:12s} " + " ".join(cells))
print(f"\nall {len(rows)}: result {sum(r['actual'] for r in rows):+.2f} of {sum(r['credit'] for r in rows):.2f} premium; sum of own best moments {sum(r['best'] for r in rows):+.2f} (a ceiling no rule reaches)")
print("change against the real result, all trades together: " + ", ".join(f"{lb} {tot[lb]:+.2f}" for lb in LABELS))

print("\nwhere an overlay changed a trade by more than 1 USD (what it did):")
for r in rows:
    for lb, (res, did) in r["alt"].items():
        if abs(res - r["actual"]) > 1 and did:
            print(f"  {r['coin']} {r['name'][:40]} ({r['entry']}): {lb} {res:+.2f} against {r['actual']:+.2f}: " + "; ".join(did[:3]))

print("\nby strategy over every tracked day (n = trades):")
for (coin, name), rs in sorted(by_name.items()):
    c = sum(r["credit"] for r in rs)
    print(f"  {coin:4s} {name[:44]:44s} n={len(rs):2d} premium {c:8.2f} result {sum(r['actual'] for r in rs):+8.2f} kept {100 * sum(r['actual'] for r in rs) / c:4.0f}% best moments {sum(r['best'] for r in rs):+8.2f}")
