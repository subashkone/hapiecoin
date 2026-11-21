"""Download Delta India 1-hour MARK candles for the monthly (last Friday) options of an underlying, over the 92 days
each is listed, plus the underlying's mark, for a study of strangles sold one to two months before expiry. Public
endpoint, read-only, throttled, cached to disk as cache/<expiry>/<symbol>.json.
Usage: python -I fetch_monthly.py <cache_dir> <BTC|ETH|XAUT> <strike_step> <first_expiry YYYY-MM-DD> <last_expiry YYYY-MM-DD>"""
import json, os, sys, time, urllib.request, urllib.parse, datetime as dt

CACHE, ASSET, STEP = sys.argv[1], sys.argv[2], int(sys.argv[3])
FIRST, LAST = dt.date.fromisoformat(sys.argv[4]), dt.date.fromisoformat(sys.argv[5])
B = "https://api.india.delta.exchange/v2/history/candles"
U = dt.timezone.utc
MIN_GAP = 0.26  # seconds between requests (under 4 a second)
last_call = [0.0]


def candles(sym, start, end):
    out = []
    # 92 days of hours is more than one response holds: two halves
    mid = start + (end - start) / 2
    for a, b in ((start, mid), (mid, end)):
        wait = MIN_GAP - (time.monotonic() - last_call[0])
        if wait > 0:
            time.sleep(wait)
        q = urllib.parse.urlencode({"symbol": sym, "resolution": "1h", "start": int(a.timestamp()), "end": int(b.timestamp())})
        for attempt in range(4):
            try:
                with urllib.request.urlopen(urllib.request.Request(B + "?" + q, headers={"User-Agent": "research-script"}), timeout=30) as r:
                    last_call[0] = time.monotonic()
                    out += json.loads(r.read()).get("result") or []
                    break
            except Exception:  # noqa: BLE001
                last_call[0] = time.monotonic()
                if attempt == 3:
                    raise
                time.sleep(2 * (attempt + 1))
    seen = {}
    for c in out:
        seen[c["time"]] = c
    return [seen[k] for k in sorted(seen)]


def load(exp, sym, start, end):
    d = os.path.join(CACHE, exp.isoformat())
    os.makedirs(d, exist_ok=True)
    p = os.path.join(d, sym.replace(":", "_") + ".json")
    if os.path.exists(p):
        return json.load(open(p))
    c = candles(sym, start, end)
    json.dump(c, open(p, "w"))
    return c


def last_friday(year, month):
    d = dt.date(year + (month == 12), month % 12 + 1, 1) - dt.timedelta(days=1)
    while d.weekday() != 4:
        d -= dt.timedelta(days=1)
    return d


y, m = FIRST.year, FIRST.month
while True:
    exp = last_friday(y, m)
    if exp > LAST:
        break
    if exp >= FIRST:
        end = dt.datetime(exp.year, exp.month, exp.day, 12, tzinfo=U)
        start = end - dt.timedelta(days=92)
        spot = load(exp, f"MARK:{ASSET}USD", start, end)
        if not spot:
            print(exp, "no spot candles", flush=True)
        else:
            lo = min(float(c["low"]) for c in spot) * 0.72
            hi = max(float(c["high"]) for c in spot) * 1.32
            ks = list(range(int(lo // STEP) * STEP, int(hi // STEP + 1) * STEP + 1, STEP))
            got = 0
            for k in ks:
                for kind in "CP":
                    got += 1 if load(exp, f"MARK:{kind}-{ASSET}-{k}-{exp:%d%m%y}", start, end) else 0
            print(f"{exp} {ASSET} strikes {ks[0]}-{ks[-1]} ({len(ks)}) symbols with data {got}/{2 * len(ks)}", flush=True)
    y, m = (y + (m == 12), m % 12 + 1)
print("done")
