"""Read-only analysis of the recently closed paper strategies against the stored 5-minute marks.
P&L arithmetic = the rules engine's: sum over legs of (mark - entry) * lots * lotSize * (+1 buy / -1 sell), plus nothing else
(no fees). Times are reported in IST (UTC+5:30). Output: JSON + a printed summary."""
import csv, json, sys
from collections import defaultdict
from datetime import datetime, timedelta, timezone

D = sys.argv[1]
LOT = {"BTC": 0.001, "ETH": 0.01, "XAUT": 0.001}
IST = timezone(timedelta(hours=5, minutes=30))

def ts(s):
    s = s.replace(" ", "T")
    if s.endswith("+00"): s = s + ":00"
    return datetime.fromisoformat(s).astimezone(timezone.utc)

def bucket(t):  # 5-minute bucket
    return t.replace(second=0, microsecond=0, minute=(t.minute // 5) * 5)

# legs
strats = {}
with open(f"{D}/legs.csv", newline="") as f:
    for r in csv.reader(f):
        sid, name, asset, tpl, reason, started, closed, realized, kind, side, strike, expiry, symbol, lots, entry, exitp, lopen, lclose, lreason, adj = r
        s = strats.setdefault(sid, {"id": sid, "name": name, "asset": asset, "template": tpl, "reason": reason, "started": ts(started), "closed": ts(closed) if closed else None, "realized": float(realized), "legs": []})
        s["legs"].append({"kind": kind, "side": side, "strike": float(strike) if strike else None, "expiry": expiry, "symbol": symbol, "lots": int(lots), "entry": float(entry) if entry else None, "exit": float(exitp) if exitp else None, "opened": ts(lopen) if lopen else None, "closed": ts(lclose) if lclose else None, "adj": adj == "t"})

# marks by symbol -> {bucket: mark}
marks = defaultdict(dict)
with open(f"{D}/legmarks.csv", newline="") as f:
    for sym, t, m in csv.reader(f):
        marks[sym][bucket(ts(t))] = float(m)

def payoff_extremes(s):
    """Max profit / max loss at expiry over a spot grid, per the entry prices, USD (options only)."""
    legs = [l for l in s["legs"] if l["kind"] != "future" and l["entry"] is not None]
    if not legs: return None, None, None
    strikes = sorted({l["strike"] for l in legs})
    lo, hi = strikes[0] * 0.5, strikes[-1] * 1.5
    grid = [lo + (hi - lo) * i / 4000 for i in range(4001)] + strikes
    lot = LOT[s["asset"]]
    best, worst = -1e18, 1e18
    credit = 0.0
    for l in legs:
        credit += (l["entry"] if l["side"] == "sell" else -l["entry"]) * l["lots"] * lot
    for sp in grid:
        p = 0.0
        for l in legs:
            intrinsic = max(0.0, sp - l["strike"]) if l["kind"] == "call" else max(0.0, l["strike"] - sp)
            sign = 1 if l["side"] == "buy" else -1
            p += (intrinsic - l["entry"]) * l["lots"] * lot * sign
        best, worst = max(best, p), min(worst, p)
    return best, worst, credit

out = []
for s in strats.values():
    legs = [l for l in s["legs"] if l["entry"] is not None and not l["adj"]]
    if not legs or s["closed"] is None: continue
    lot = LOT[s["asset"]]
    start, end = bucket(s["started"]), bucket(s["closed"])
    path = []
    t = start
    while t <= end:
        pnl, ok = 0.0, True
        for l in legs:
            # a leg squared off earlier is frozen at its exit
            if l["closed"] and t > bucket(l["closed"]) and l["exit"] is not None:
                m = l["exit"]
            else:
                m = marks[l["symbol"]].get(t)
                if m is None: ok = False; break
            pnl += (m - l["entry"]) * l["lots"] * lot * (1 if l["side"] == "buy" else -1)
        if ok: path.append((t, pnl))
        t += timedelta(minutes=5)
    maxp, minp, credit = payoff_extremes(s)
    rec = {"name": s["name"], "asset": s["asset"], "template": s["template"], "reason": s["reason"], "legs": len(legs),
           "entry_ist": s["started"].astimezone(IST).strftime("%d %b %H:%M"), "entry_hour_ist": s["started"].astimezone(IST).hour,
           "close_ist": s["closed"].astimezone(IST).strftime("%d %b %H:%M"), "held_h": round((s["closed"] - s["started"]).total_seconds() / 3600, 1),
           "realized": round(s["realized"], 2), "max_profit_struct": round(maxp, 2) if maxp is not None else None, "max_loss_struct": round(minp, 2) if minp is not None else None,
           "credit": round(credit, 2) if credit is not None else None, "points": len(path), "coverage": round(len(path) / max(1, ((end - start).total_seconds() / 300) + 1), 2)}
    if path:
        pk = max(path, key=lambda x: x[1]); tr = min(path, key=lambda x: x[1])
        rec.update({"peak": round(pk[1], 2), "peak_ist": pk[0].astimezone(IST).strftime("%d %b %H:%M"), "peak_hour_ist": pk[0].astimezone(IST).hour,
                    "peak_after_h": round((pk[0] - start).total_seconds() / 3600, 1),
                    "trough": round(tr[1], 2), "trough_ist": tr[0].astimezone(IST).strftime("%d %b %H:%M"), "trough_after_h": round((tr[0] - start).total_seconds() / 3600, 1),
                    "captured_of_peak": round(s["realized"] / pk[1], 2) if pk[1] > 0 else None,
                    "peak_of_struct_max": round(pk[1] / maxp, 2) if maxp else None,
                    "path": [(p[0].astimezone(IST).strftime("%d %H:%M"), round(p[1], 2)) for p in path]})
        # P&L at fixed holding times
        for h in (1, 2, 4, 8, 12):
            want = start + timedelta(hours=h)
            near = [p for p in path if abs((p[0] - want).total_seconds()) <= 600]
            rec[f"pnl_{h}h"] = round(near[0][1], 2) if near and want <= end else None
    out.append(rec)

out.sort(key=lambda r: r["entry_ist"])
json.dump(out, open(f"{D}/result.json", "w"), indent=1, default=str)

# ---- summaries
print(f"strategies analysed: {len(out)}; with a usable mark path: {sum(1 for r in out if r['points'])}")
print("\nname | tpl | entry IST | close IST | held h | reason | realized | peak (when, h after) | trough | struct max | peak/structmax | captured/peak | coverage")
for r in out:
    print(f"{r['name']} | {r['template']} | {r['entry_ist']} | {r['close_ist']} | {r['held_h']} | {r['reason']} | {r['realized']} | {r.get('peak')} ({r.get('peak_ist')}, +{r.get('peak_after_h')}h) | {r.get('trough')} | {r['max_profit_struct']} | {r.get('peak_of_struct_max')} | {r.get('captured_of_peak')} | {r['coverage']}")

# hour-of-day profile: mean P&L as a fraction of the structure's max profit, across strategies open at that IST hour
prof = defaultdict(list)
for r in out:
    if not r.get("path") or not r["max_profit_struct"]: continue
    for lbl, p in r["path"]:
        prof[int(lbl.split(" ")[1][:2])].append(p / r["max_profit_struct"])
print("\nIST hour | strategies open | mean P&L as % of structure max | share of points in profit")
for h in sorted(prof):
    v = prof[h]
    print(f"{h:02d} | {len(v)} | {100 * sum(v) / len(v):.1f}% | {100 * sum(1 for x in v if x > 0) / len(v):.0f}%")

# target sweep: for each target as % of structure max profit, what would have happened (hit -> take it; else realized as it was)
print("\ntarget % of struct max | hit | avg P&L if applied (USD) | vs actual avg")
usable = [r for r in out if r.get("path") and r["max_profit_struct"]]
actual = sum(r["realized"] for r in usable) / len(usable) if usable else 0
for pct in (10, 15, 20, 25, 30, 40, 50, 60, 75):
    tot, hit = 0.0, 0
    for r in usable:
        lvl = r["max_profit_struct"] * pct / 100
        h = next((p for p in r["path"] if p[1] >= lvl), None)
        if h: hit += 1; tot += lvl
        else: tot += r["realized"]
    print(f"{pct}% | {hit}/{len(usable)} | {tot / len(usable):.2f} | {actual:.2f}")

# credit-based sweep for credit structures
print("\ntarget % of credit | hit | avg P&L if applied | n")
cred = [r for r in usable if r["credit"] and r["credit"] > 0]
for pct in (10, 20, 30, 40, 50):
    tot, hit = 0.0, 0
    for r in cred:
        lvl = r["credit"] * pct / 100
        h = next((p for p in r["path"] if p[1] >= lvl), None)
        if h: hit += 1; tot += lvl
        else: tot += r["realized"]
    print(f"{pct}% | {hit}/{len(cred)} | {tot / max(1, len(cred)):.2f} | {len(cred)}")

# ---- clock-time exits: if every strategy still open at HH:00 IST on its close day had been closed then
print("\ncredit structures: name | credit | peak | peak/credit | realized/credit")
for r in usable:
    if r["credit"] and r["credit"] > 0:
        print(f"{r['name']} | {r['credit']} | {r['peak']} | {round(r['peak']/r['credit'],2)} | {round(r['realized']/r['credit'],2)}")
print("\nexit-at-clock rule (IST, on the close day; a strategy already closed earlier keeps its realized): hour | n open then | total P&L with the rule | actual total of the same n")
for hh in (6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17):
    tot, act, n = 0.0, 0.0, 0
    for r in usable:
        day = r["close_ist"][:6]
        pts = [p for p in r["path"] if p[0][:2] == day[:2] and int(p[0][3:5]) == hh and p[0][6:8] == "00"]
        if pts:
            n += 1; tot += pts[0][1]; act += r["realized"]
    print(f"{hh:02d}:00 | {n} | {tot:.2f} | {act:.2f}")

# ---- day-level, the older strategies (Sep-Oct) from the client's daily P&L points
rows = defaultdict(list); meta = {}
with open(f"{D}/daypnl.csv", newline="") as f:
    for sid, name, st, cl, reason, realized, day, pnl in csv.reader(f):
        rows[sid].append((day, float(pnl))); meta[sid] = (name, st, cl, reason, float(realized))
print("\nolder strategies, daily points: name | started | closed | reason | realized | best day P&L (day) | worst day | days with a point")
left, better = 0, 0
for sid, pts in rows.items():
    name, st, cl, reason, realized = meta[sid]
    if st >= "2026-11-03": continue
    pts.sort(); b = max(pts, key=lambda x: x[1]); w = min(pts, key=lambda x: x[1])
    if b[1] > realized + 0.01: better += 1; left += b[1] - realized
    print(f"{name} | {st} | {cl} | {reason} | {realized} | {b[1]} ({b[0]}) | {w[1]} | {len(pts)}")
print(f"older strategies where some day's P&L beat the final: {better}/{sum(1 for s in rows if meta[s][1] < '2026-11-03')}; profit left on the table in total: {left:.2f} USD")
