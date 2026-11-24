"""Record the live bid, ask and mark of the options the Friday one-day weekly strangle would trade (strategy lab
backlog 17), to see whether the mark the backtest fills at can really be sold. Read-only, the exchange's public
ticker, User-Agent research-script, one request a symbol and under 4 a second. The owner allowed this on 24 Nov 2026
for the Friday of the entry ("You may read the public bid and ask on Friday"); it is not a general permission.

UNVERIFIED until its first run: the ticker's path and field names below are from the exchange's public API as I
remember it (GET /v2/tickers/<symbol>, result.mark_price, result.spot_price, result.quotes.best_bid / best_ask). The
raw answer of every call is kept in the output file, so nothing is lost if a field is named differently.

Each pass: the spot from the underlying's ticker, then for the expiry given every strike in the list on both sides.
Usage: python -I snap_quotes.py <coin BTC|ETH> <expiry ddmmyy> <strikes, comma> <out.jsonl> [passes] [seconds between passes]
Then:  python -I snap_quotes.py --read <out.jsonl>     (a table: time, symbol, bid, mark, ask, the bid under the mark in per cent)"""
import json, sys, time, datetime as dt, urllib.request

BASE = "https://api.india.delta.exchange/v2/tickers/"
IST = dt.timezone(dt.timedelta(hours=5, minutes=30))


def get(symbol):
    req = urllib.request.Request(BASE + symbol, headers={"User-Agent": "research-script", "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=20) as r:
        return json.load(r)


def num(x):
    try:
        return float(x)
    except (TypeError, ValueError):
        return None


if sys.argv[1] == "--read":
    print(f"{'time IST':17s} {'symbol':24s} {'spot':>10s} {'bid':>9s} {'mark':>9s} {'ask':>9s} {'bid under mark':>15s} {'ask over mark':>14s}")
    for ln in open(sys.argv[2], encoding="utf-8"):
        r = json.loads(ln)
        res = (r.get("raw") or {}).get("result") or {}
        q = res.get("quotes") or {}
        bid, ask, mark, spot = num(q.get("best_bid")), num(q.get("best_ask")), num(res.get("mark_price")), num(res.get("spot_price"))
        f = lambda v: "" if v is None else f"{v:.2f}"
        under = "" if not (bid and mark) else f"{100 * (mark - bid) / mark:.1f} %"
        over = "" if not (ask and mark) else f"{100 * (ask - mark) / mark:.1f} %"
        print(f"{r['at_ist']:17s} {r['symbol']:24s} {f(spot):>10s} {f(bid):>9s} {f(mark):>9s} {f(ask):>9s} {under:>15s} {over:>14s}")
    sys.exit(0)

COIN, EXP, STRIKES, OUT = sys.argv[1], sys.argv[2], [x for x in sys.argv[3].split(",") if x], sys.argv[4]
PASSES = int(sys.argv[5]) if len(sys.argv) > 5 else 1
EVERY = float(sys.argv[6]) if len(sys.argv) > 6 else 300
symbols = [f"{COIN}USD"] + [f"{kind}-{COIN}-{k}-{EXP}" for k in STRIKES for kind in ("P", "C")]
for n in range(PASSES):
    started = time.time()
    with open(OUT, "a", encoding="utf-8") as f:
        for s in symbols:
            now = dt.datetime.now(dt.timezone.utc)
            try:
                raw = get(s)
            except Exception as e:  # keep the pass going; the failure is recorded, never guessed around
                raw = {"error": repr(e)}
            f.write(json.dumps({"at_utc": now.strftime("%Y-%m-%dT%H:%M:%SZ"), "at_ist": now.astimezone(IST).strftime("%d %b %H:%M:%S"), "symbol": s, "raw": raw}) + "\n")
            time.sleep(0.3)
    print(f"pass {n + 1} of {PASSES}: {len(symbols)} symbols at {dt.datetime.now(IST).strftime('%H:%M:%S')} IST", flush=True)
    if n + 1 < PASSES:
        time.sleep(max(0.0, EVERY - (time.time() - started)))
