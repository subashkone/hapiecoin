"""Download Delta India 5-minute MARK candles for BTC daily options around the money, one expiry per day, plus the
BTCUSD mark. Public endpoint, read-only, throttled, cached to disk as cache/<expiry>/<symbol>.json.
Usage: python -I fetch.py <cache_dir> <first_expiry YYYY-MM-DD> <last_expiry YYYY-MM-DD>"""
import json, os, sys, time, urllib.request, urllib.parse, datetime as dt

CACHE, FIRST, LAST = sys.argv[1], dt.date.fromisoformat(sys.argv[2]), dt.date.fromisoformat(sys.argv[3])
B = "https://api.india.delta.exchange/v2/history/candles"
U = dt.timezone.utc
STEP = 200
PAD = 2400  # strikes this far either side of the window's spot range
MIN_GAP = 0.26  # seconds between requests (under 4 a second)
last_call = [0.0]

def candles(sym, start, end):
    wait = MIN_GAP - (time.monotonic() - last_call[0])
    if wait > 0: time.sleep(wait)
    q = urllib.parse.urlencode({"symbol": sym, "resolution": "5m", "start": int(start.timestamp()), "end": int(end.timestamp())})
    for attempt in range(4):
        try:
            with urllib.request.urlopen(urllib.request.Request(B + "?" + q, headers={"User-Agent": "hapiecoin-research"}), timeout=30) as r:
                last_call[0] = time.monotonic()
                return json.loads(r.read()).get("result") or []
        except Exception as e:  # noqa: BLE001
            last_call[0] = time.monotonic()
            if attempt == 3: raise
            time.sleep(2 * (attempt + 1))

def load(exp, sym, start, end):
    d = os.path.join(CACHE, exp.isoformat()); os.makedirs(d, exist_ok=True)
    p = os.path.join(d, sym.replace(":", "_") + ".json")
    if os.path.exists(p):
        return json.load(open(p))
    c = candles(sym, start, end)
    json.dump(c, open(p, "w"))
    return c

exp = FIRST
n_req = 0
while exp <= LAST:
    start = dt.datetime(exp.year, exp.month, exp.day, 12, tzinfo=U) - dt.timedelta(hours=24)
    end = dt.datetime(exp.year, exp.month, exp.day, 12, tzinfo=U)
    spot = load(exp, "MARK:BTCUSD", start, end)
    if not spot:
        print(exp, "no spot candles"); exp += dt.timedelta(days=1); continue
    lo = min(float(c["low"]) for c in spot) - PAD
    hi = max(float(c["high"]) for c in spot) + PAD
    ks = list(range(int(lo // STEP) * STEP, int(hi // STEP + 1) * STEP + 1, STEP))
    got = 0
    for k in ks:
        for kind in "CP":
            c = load(exp, f"MARK:{kind}-BTC-{k}-{exp:%d%m%y}", start, end)
            got += 1 if c else 0
    print(f"{exp} spot {float(spot[-1]['close']):.0f}..{float(spot[0]['close']):.0f} strikes {ks[0]}-{ks[-1]} ({len(ks)}) symbols with data {got}/{2*len(ks)}", flush=True)
    exp += dt.timedelta(days=1)
print("done")
