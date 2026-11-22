"""Download 1-minute MARK candles for every option in the build thread's export of the Autopilot PAPER trades, and
for the underlyings, from each symbol's first entry to now (or its settlement). Public endpoint, read-only, throttled
under 4 requests a second, User-Agent research-script. Overwrites its cache each run, so rerunning refreshes the track.

Usage: python -I fetch_paper.py <paper-positions.json> <out_dir>"""
import json, os, sys, time, datetime as dt, urllib.request, urllib.parse

SRC, OUT = sys.argv[1], sys.argv[2]
B = "https://api.india.delta.exchange/v2/history/candles"
U = dt.timezone.utc
last = [0.0]


def candles(sym, start, end):
    rows, a = {}, start
    while a < end:
        b = min(end, a + dt.timedelta(hours=24))
        wait = 0.3 - (time.time() - last[0])
        if wait > 0:
            time.sleep(wait)
        q = urllib.parse.urlencode({"symbol": sym, "resolution": "1m", "start": int(a.timestamp()), "end": int(b.timestamp())})
        for attempt in range(4):
            try:
                with urllib.request.urlopen(urllib.request.Request(B + "?" + q, headers={"User-Agent": "research-script"}), timeout=30) as r:
                    last[0] = time.time()
                    for c in json.load(r).get("result") or []:
                        rows[c["time"]] = c
                    break
            except Exception as ex:
                last[0] = time.time()
                if attempt == 3:
                    print("  failed", sym, a, repr(ex)[:120], flush=True)
                time.sleep(2 * (attempt + 1))
        a = b
    return [rows[k] for k in sorted(rows)]


def settle_of(symbol):
    d = symbol.split("-")[-1]
    coin = symbol.split("-")[1]
    return dt.datetime(2000 + int(d[4:6]), int(d[2:4]), int(d[0:2]), 16 if coin == "XAUT" else 12, tzinfo=U)


trades = json.load(open(SRC))["trades"]
first, coins = {}, {}
for t in trades:
    for l in t["legs"]:
        o = dt.datetime.fromisoformat(l["opened_at"].replace("Z", "+00:00"))
        first[l["symbol"]] = min(first.get(l["symbol"], o), o)
        coins[t["coin"]] = min(coins.get(t["coin"], o), o)
now = dt.datetime.now(U).replace(second=0, microsecond=0)
os.makedirs(OUT, exist_ok=True)
todo = [(f"{c}USD", s, now) for c, s in coins.items()] + [(s, o, min(now, settle_of(s))) for s, o in sorted(first.items())]
for sym, start, end in todo:
    rows = candles("MARK:" + sym, start - dt.timedelta(minutes=10), end)
    json.dump(rows, open(os.path.join(OUT, f"MARK_{sym}.json"), "w"))
    print(f"{sym:28s} {start:%m-%d %H:%M} .. {end:%m-%d %H:%M}  {len(rows)} candles", flush=True)
print("== done", now.isoformat())
