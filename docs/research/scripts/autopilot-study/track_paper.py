"""Track every Autopilot PAPER trade minute by minute (the owner's request of 22 Nov 2026): from the build thread's
export and the 1-minute MARK candles of fetch_paper.py, the mark-to-market result of each trade at every minute since
its entry, its best and worst moments with their times, and where it stands now. Results are before fees. One CSV per
trade (time IST, spot, each leg's mark, result) goes to <out_dir>; the summary is printed (ASCII).

Usage: python -I track_paper.py <paper-positions.json> <candles_dir> <out_dir>"""
import csv, json, os, re, sys, datetime as dt

SRC, CAND, OUT = sys.argv[1], sys.argv[2], sys.argv[3]
U, IST = dt.timezone.utc, dt.timezone(dt.timedelta(hours=5, minutes=30))
LOT = {"BTC": 0.001, "ETH": 0.01, "XAUT": 0.001}
ts = lambda s: None if not s else dt.datetime.fromisoformat(s.replace("Z", "+00:00"))
cache = {}


def series(sym):
    if sym not in cache:
        p = os.path.join(CAND, f"MARK_{sym}.json")
        cache[sym] = {r["time"]: float(r["close"]) for r in json.load(open(p))} if os.path.exists(p) else {}
    return cache[sym]


src = json.load(open(SRC))
os.makedirs(OUT, exist_ok=True)
rows_out = []
for n, t in enumerate(src["trades"], 1):
    lot, spot = LOT[t["coin"]], series(t["coin"] + "USD")
    legs = []
    for l in t["legs"]:
        legs.append(dict(sym=l["symbol"], sign=1 if l["side"] == "buy" else -1, q=float(l["lots"]) * lot, entry=float(l["entry_price"]), opened=ts(l["opened_at"]),
                         closed=ts(l["closed_at"]), exit=float(l["exit_price"]) if l["exit_price"] not in (None, "") else None, marks=series(l["symbol"])))
    start = min(l["opened"] for l in legs)
    credit = sum(-l["sign"] * l["entry"] * l["q"] for l in legs)
    end_all = max((max(l["marks"]) for l in legs if l["marks"]), default=0)
    stop_at = ts(t["closed_at"])
    m = int(start.timestamp()) // 60 * 60 + 60
    track, lastpx = [], {}
    while m <= end_all and (stop_at is None or m <= stop_at.timestamp() + 60):
        total, ok, marks = 0.0, True, []
        for i, l in enumerate(legs):
            if m < l["opened"].timestamp():
                marks.append("")
                continue
            if l["closed"] is not None and l["exit"] is not None and m >= l["closed"].timestamp():
                total += l["sign"] * (l["exit"] - l["entry"]) * l["q"]
                marks.append(f"closed {l['exit']:.2f}")
                continue
            px = l["marks"].get(m, lastpx.get(i))
            if px is None:
                ok = False
                break
            lastpx[i] = px
            total += l["sign"] * (px - l["entry"]) * l["q"]
            marks.append(f"{px:.2f}")
        if ok:
            track.append((m, spot.get(m), marks, total))
        m += 60
    name = re.sub(r"[^A-Za-z0-9]+", "-", t["name"].split("Autopilot")[0]).strip("-")
    with open(os.path.join(OUT, f"{n:02d}-{t['coin']}-{name}.csv"), "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["time_ist", "spot"] + [f"{'buy' if l['sign'] > 0 else 'sell'} {l['sym']} (entry {l['entry']:.2f})" for l in legs] + ["result_usd"])
        for m, sp, marks, total in track:
            w.writerow([dt.datetime.fromtimestamp(m, IST).strftime("%Y-%m-%d %H:%M"), "" if sp is None else f"{sp:.1f}"] + marks + [f"{total:.2f}"])
    if not track:
        continue
    f_ist = lambda m: dt.datetime.fromtimestamp(m, IST).strftime("%d %b %H:%M")
    best, worst, now = max(track, key=lambda x: x[3]), min(track, key=lambda x: x[3]), track[-1]
    rows_out.append(dict(n=n, coin=t["coin"], name=t["name"].split(" \u00c2")[0].split(" \u00b7")[0][:46], status="closed" if t["status"] == "archived" else "open", entry=f_ist(start.timestamp()), credit=credit,
                         now=now[3], best=best[3], best_t=f_ist(best[0]), worst=worst[3], worst_t=f_ist(worst[0]), mins=len(track), expiry=sorted(l["sym"].split("-")[-1] for l in legs)[0], realised=float(t["realized_pnl_usd"] or 0)))

print(f"export of {src['exported_at_utc']}; {len(rows_out)} paper trades tracked at 1-minute marks; results in USD before fees; times IST")
print(f"{'#':>2s} {'coin':4s} {'strategy':46s} {'state':6s} {'entered':12s} {'premium':>8s} {'last':>8s} {'best':>8s} {'best at':12s} {'worst':>8s} {'worst at':12s} {'given back':>10s}")
for r in rows_out:
    print(f"{r['n']:2d} {r['coin']:4s} {r['name']:46s} {r['status']:6s} {r['entry']:12s} {r['credit']:+8.2f} {r['now']:+8.2f} {r['best']:+8.2f} {r['best_t']:12s} {r['worst']:+8.2f} {r['worst_t']:12s} {r['best'] - r['now']:10.2f}")
print(f"\nall {len(rows_out)} trades: last {sum(r['now'] for r in rows_out):+.2f}; sum of each trade's own best moment {sum(r['best'] for r in rows_out):+.2f}; sum of each trade's worst moment {sum(r['worst'] for r in rows_out):+.2f}")
print("(premium: + is collected, - is paid. 'last' is the last tracked minute, or the close for a closed trade. The bests are at different times, so their sum is a ceiling no rule could reach.)")
