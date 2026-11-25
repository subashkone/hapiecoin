"""The strategies held together as one book (the owner, 25 Nov 2026: "test the book"): the BTC and the ETH evening
strangle every day and the BTC Friday weekly strangle, each with a size, added up day by day, to see the worst day,
the worst week and the largest drawdown of the whole account and not of one strategy.

Parts (all with the measured fill costs of study_stack.py on the entry and on every market exit; settlement pays its fee
but no fill cost):
  daily    the evening strangle of study_exits.py for a coin (1 % away, entered 20 h before settlement), each sold
           option closed at the stop multiple, the rest held; the whole result is booked on the expiry date.
  weekly   BTC, sold 7 days before the Friday settlement at 16:00 UTC, 3 % away on the 500 ladder, hourly marks, the
           same stop; the entry costs are booked on the entry date, a stop on its own date, the rest at settlement.
           Only what is realised is booked: an open weekly's swings do not show, so its bad days read smaller here
           than on a marked account.
A last block mixes the stops: BTC daily at 2x with ETH daily and the weekly at 3x.
Sizes are lots a leg; a result scales with the lots. "equal value" gives ETH the lots that make its coin value equal
to 100 lots of BTC at the first day of the period (a size known in advance, not fitted to the results).
The book is judged on the days the daily history covers; weekly events outside it are left out.

Columns: mean per day, share of days positive, total, worst day, worst 7 days in a row, worst 30 days in a row,
largest drawdown, days of mean income the worst day costs, the two halves.

Usage: python study_book.py <history_dir with daily-BTC, daily-ETH, weekly-BTC> [slip]
       (run without -I from this folder; it calls itself once a coin to read the daily trades)"""
import json, math, os, subprocess, sys, datetime as dt
from collections import defaultdict

U = dt.timezone.utc
GST = 0.18


def slip_share(p, sp):
    r = p / sp
    return 0.01 if r >= 0.004 else 0.025 if r >= 0.0007 else 0.065


if sys.argv[1] == "--daily":
    # child: python study_book.py --daily <cache> <lot> <slip 0/1>; prints {mult: {expiry: result}} and the first spot
    cache, lot, use_slip = sys.argv[2], sys.argv[3], sys.argv[4] == "1"
    sys.argv = [sys.argv[0], cache, lot, "5", "20", "1", "", "", "x"]
    import study_exits as X
    Q = X.Q
    sl = lambda p, sp: p * Q * slip_share(p, sp) if use_slip else 0.0
    out = {}
    for mult in (2, 3):
        res = {}
        for e, tr in X.trades:
            sp0 = tr.spot[tr.t0]
            live = list(range(len(tr.legs)))
            r, t = -tr.fee_in - sum(sl(x, sp0) for x in tr.entry), tr.t0 + X.BAR
            while t <= tr.last_b and live:
                sp = tr.spot.get(t, tr.settle_spot)
                for i in list(live):
                    p = tr.series[i].get(t)
                    if p is not None and p >= mult * tr.entry[i]:
                        r += -(p - tr.entry[i]) * Q - X.fee(sp, p) - sl(p, sp)
                        live.remove(i)
                t += X.BAR
            res[e] = r + sum(tr.settle_leg(i) for i in live)
        out[str(mult)] = res
    first = min(X.trades, key=lambda x: x[0])[1]
    sys.stdout.write("\n@@" + json.dumps({"res": out, "spot0": first.spot[first.t0]}))
    sys.exit(0)

ROOT = sys.argv[1]
SLIP = len(sys.argv) > 2 and sys.argv[2] == "slip"


def daily(coin, lot):
    p = subprocess.run([sys.executable, os.path.abspath(__file__), "--daily", os.path.join(ROOT, f"daily-{coin}"), str(lot), "1" if SLIP else "0"],
                       capture_output=True, text=True, cwd=os.path.dirname(os.path.abspath(__file__)))
    if "@@" not in p.stdout:
        sys.exit(f"daily {coin} failed: {p.stderr[-400:]}")
    return json.loads(p.stdout.split("@@")[-1])


def weekly(mult):
    """{date: realised} for the BTC Friday strangle, 100 lots."""
    cache, lot, step, H = os.path.join(ROOT, "weekly-BTC"), 0.001, 500, dt.timedelta(hours=1)
    q = 100 * lot
    fee = lambda sp, p: min(0.0001 * sp * q, 0.035 * p * q) * (1 + GST)
    sl = lambda p, sp: p * q * slip_share(p, sp) if SLIP else 0.0
    book, n = defaultdict(float), 0
    for exp in sorted(e for e in os.listdir(cache) if os.path.isdir(os.path.join(cache, e))):
        spot, opts = {}, {}
        for f in os.listdir(os.path.join(cache, exp)):
            rows = json.load(open(os.path.join(cache, exp, f)))
            if not rows:
                continue
            sym = f[:-5].replace("_", ":")
            series = {dt.datetime.fromtimestamp(r["time"], U): float(r["close"]) for r in rows}
            if sym == "MARK:BTCUSD":
                spot = series
            else:
                body = sym.split(":")[1].split("-")
                opts[(body[0], int(body[2]))] = series
        y, m, d = map(int, exp.split("-"))
        settle = dt.datetime(y, m, d, 12, tzinfo=U)
        last_b, t0 = settle - H, settle - dt.timedelta(days=7) + dt.timedelta(hours=3)
        if last_b not in spot or t0 not in spot:
            continue
        s0 = spot[t0]
        near = lambda x: int(round(x / step) * step)
        legs = [("P", near(s0 * 0.97)), ("C", near(s0 * 1.03))]
        if any(leg not in opts or t0 not in opts[leg] for leg in legs):
            continue
        n += 1
        entry = [opts[leg][t0] for leg in legs]
        book[(t0 + H).date().isoformat()] -= sum(fee(s0, e) + sl(e, s0) for e in entry)
        live, t = [0, 1], t0 + H
        while t <= last_b and live:
            sp = spot.get(t, spot[last_b])
            for i in list(live):
                p = opts[legs[i]].get(t)
                if p is not None and p >= mult * entry[i]:
                    book[(t + H).date().isoformat()] += -(p - entry[i]) * q - fee(sp, p) - sl(p, sp)
                    live.remove(i)
            t += H
        ss = spot[last_b]
        for i in live:
            v = max(0.0, ss - legs[i][1]) if legs[i][0] == "C" else max(0.0, legs[i][1] - ss)
            book[exp] += -(v - entry[i]) * q - fee(ss, v)
    return book, n


btc, eth = daily("BTC", 0.001), daily("ETH", 0.01)
days = sorted(set(btc["res"]["3"]) & set(eth["res"]["3"]))
d0, d1 = dt.date.fromisoformat(days[0]), dt.date.fromisoformat(days[-1])
cal = [(d0 + dt.timedelta(days=i)).isoformat() for i in range((d1 - d0).days + 1)]
eq = round(100 * btc["spot0"] * 0.001 / (eth["spot0"] * 0.01))
wk = {m: weekly(m) for m in (2, 3)}


def series(mult, b=0, e=0, w=0, me=None, mw=None):
    """Lots a leg of BTC daily, ETH daily, BTC weekly; `me` and `mw` give ETH and the weekly their own stop multiple."""
    me, mw = me or mult, mw or mult
    out = []
    for d in cal:
        out.append(b / 100 * btc["res"][str(mult)].get(d, 0.0) + e / 100 * eth["res"][str(me)].get(d, 0.0) + w / 100 * wk[mw][0].get(d, 0.0))
    return out


def roll(v, k):
    return min(sum(v[i:i + k]) for i in range(max(1, len(v) - k + 1)))


def line(name, v):
    n = len(v)
    mean = sum(v) / n
    cum = peak = dd = 0.0
    for x in v:
        cum += x
        peak = max(peak, cum)
        dd = max(dd, peak - cum)
    worst = min(v)
    cost = f"{-worst / mean:5.1f}" if mean > 0 else "    -"
    print(f"   {name:50s} {mean:+8.2f} {100 * sum(1 for x in v if x > 0) / n:3.0f}% {sum(v):+7.0f} {worst:+8.1f} {roll(v, 7):+8.1f} {roll(v, 30):+8.1f} {-dd:+8.1f} {cost} {sum(v[:n // 2]):+6.0f}/{sum(v[n // 2:]):+.0f}")


def corr(a, b):
    n = len(a)
    ma, mb = sum(a) / n, sum(b) / n
    return sum((x - ma) * (y - mb) for x, y in zip(a, b)) / math.sqrt(sum((x - ma) ** 2 for x in a) * sum((y - mb) ** 2 for y in b))


n_wk = sum(1 for d in wk[3][0] if cal[0] <= d <= cal[-1])
print(f"## The book{' WITH SLIPPAGE' if SLIP else ''}: {len(cal)} calendar days ({cal[0]} .. {cal[-1]}), {len(days)} daily expiries on both coins; the BTC weekly booked on {n_wk} dates in the period ({wk[3][1]} weeks in its cache)")
print(f"   100 lots: BTC 0.1 coin (spot {btc['spot0']:.0f} at the start), ETH 1 coin (spot {eth['spot0']:.0f}); equal value = {eq} lots of ETH for 100 of BTC")
for mult in (3, 2):
    b, e = series(mult, b=100), series(mult, e=100)
    worst_b = sorted(range(len(cal)), key=lambda i: b[i])[:10]
    worst_e = set(sorted(range(len(cal)), key=lambda i: e[i])[:10])
    both = sum(1 for x, y in zip(b, e) if x < 0 and y < 0)
    print(f"\n-- stop {mult}x on every sold option")
    print(f"   BTC and ETH daily results: correlation {corr(b, e):+.2f}; both lose on {both} days (BTC loses on {sum(1 for x in b if x < 0)}, ETH on {sum(1 for x in e if x < 0)}); of BTC's 10 worst days {sum(1 for i in worst_b if i in worst_e)} are among ETH's 10 worst")
    print(f"   {'':50s} {'mean':>8s} {'win':>4s} {'total':>7s} {'worst':>8s} {'worst 7':>8s} {'worst 30':>8s} {'drawdown':>8s} {'days':>5s} halves")
    line("BTC daily 100", b)
    line("ETH daily 100", e)
    line(f"ETH daily {eq} (equal value to BTC 100)", series(mult, e=eq))
    line("BTC weekly 100 (realised only)", series(mult, w=100))
    line("book: BTC 100 + ETH 100", series(mult, b=100, e=100))
    line(f"book: BTC 100 + ETH {eq}", series(mult, b=100, e=eq))
    line(f"book: BTC 50 + ETH {eq // 2} (half of each)", series(mult, b=50, e=eq // 2))
    line("book: BTC 100 + ETH 100 + weekly 100", series(mult, b=100, e=100, w=100))
    line(f"book: BTC 100 + ETH {eq} + weekly 100", series(mult, b=100, e=eq, w=100))
    line(f"book: BTC 50 + ETH {eq // 2} + weekly 50", series(mult, b=50, e=eq // 2, w=50))
print()
print("-- mixed: BTC daily with the stop at 2x, ETH daily and the BTC weekly with the stop at 3x")
print(f"   {'':50s} {'mean':>8s} {'win':>4s} {'total':>7s} {'worst':>8s} {'worst 7':>8s} {'worst 30':>8s} {'drawdown':>8s} {'days':>5s} halves")
line("book: BTC 100 (2x) + ETH 100 (3x)", series(2, b=100, e=100, me=3))
line("book: BTC 100 (2x) + ETH 100 (3x) + weekly 100 (3x)", series(2, b=100, e=100, w=100, me=3, mw=3))
line("book: BTC 100 (2x) + ETH 100 (3x) + weekly 50 (3x)", series(2, b=100, e=100, w=50, me=3, mw=3))
print()
