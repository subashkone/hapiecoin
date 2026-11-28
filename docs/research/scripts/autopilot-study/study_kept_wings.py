"""Wings bought once in a later expiry and KEPT while a fresh daily strangle is sold inside them every evening (the
owner, 28 Nov 2026: "Is there any possibility to take wings in the next weeks or months? ... we paid a lot of premium
and it is lost. But some point of time they may be used").

The daily strangle is the one of study_exits.py (imported; run without -I from this folder, on a daily cache: each
side a percentage of the spot away, entered 20 h before the 12:00 UTC settlement, 100 lots a leg), held, or with a
stop on each sold option at two or three times its sale price.

The wings are a put and a call of a weekly or a monthly expiry (the hourly caches of fetch_weekly.py and
fetch_monthly.py), 100 lots each, on the listed strike with a mark nearest a percentage of the spot away at the
purchase. They are bought at 16:00 UTC (21:30 IST, the close of the hourly bar starting 15:00) on the day the cycle
before settles, at the hour the daily strangle is sold:
  week, this expiry    bought each Friday for the Friday a week out and left to settle.
  week, next expiry    bought each Friday for the Friday two weeks out and sold the next Friday at 16:00 UTC.
  month, this expiry   bought on a month-end expiry day for the next month-end and left to settle.
  month, next expiry   bought on a month-end expiry day for the month-end after next and sold on the next one.
A wing is never moved during its cycle, whatever the spot does.

The result of a day is the daily strangle of that expiry plus what the two wings made between 16:00 UTC the evening
before and 16:00 UTC that day, at the hourly mark (a missing mark is the last one, counted in "carried"); the purchase
with its costs falls on the first day of a cycle, the settlement or the sale on its last. So a day's figure is the
real change in the account that day, and the sum over a cycle is what the wings cost or paid.

Fee as study_exits.py. With "slip" every market fill (the strangle's entry and stops, a wing's purchase and sale) is
worse than the mark by the share measured on real fills (study_stack.py); a settlement pays its fee and no fill cost.

Columns: mean per day, share of days positive, total, worst day, worst three, worst seven days in a row, largest
drawdown, the totals by month, then the wings alone: their mean per day (what the cover cost or paid), what they
made on the ten worst days of the naked row (the sum; and the naked sum of those days), and carried marks.

Usage: python study_kept_wings.py <daily cache> <lot> 5 20 <percent away> "" "" <label> <weekly cache> <monthly cache> <last daily expiry> [slip]"""
import json, os, sys, datetime as dt
from collections import defaultdict
import study_exits as X

LABEL, WEEKLY, MONTHLY, LAST = sys.argv[8], sys.argv[9], sys.argv[10], sys.argv[11]
SLIP = len(sys.argv) > 12 and sys.argv[12] == "slip"
Q, U, H, D = X.Q, dt.timezone.utc, dt.timedelta(hours=1), dt.timedelta(days=1)
_cache = {}


def slip(p, sp):
    if not SLIP:
        return 0.0
    r = p / sp
    return p * Q * (0.01 if r >= 0.004 else 0.025 if r >= 0.0007 else 0.065)


def load(exp, monthly_first=False):
    """(spot, opts) of a weekly or monthly expiry, hourly, keyed by the bar's start. A month-end expiry is in both
    caches; the monthly one reaches further back."""
    key = (exp, monthly_first)
    if key not in _cache:
        order = (MONTHLY, WEEKLY) if monthly_first else (WEEKLY, MONTHLY)
        d = next((os.path.join(c, exp) for c in order if os.path.isdir(os.path.join(c, exp))), None)
        if d is None:
            _cache[key] = None
        else:
            spot, opts = {}, {}
            for f in os.listdir(d):
                rows = json.load(open(os.path.join(d, f)))
                if not rows:
                    continue
                sym = f[:-5].replace("_", ":")
                series = {dt.datetime.fromtimestamp(r["time"], U): float(r["close"]) for r in rows}
                if sym.endswith("USD"):
                    spot = series
                else:
                    body = sym.split(":")[1].split("-")
                    opts[(body[0], int(body[2]))] = series
            _cache[key] = (spot, opts)
    return _cache[key]


def at16(day):
    return dt.datetime(day.year, day.month, day.day, 15, tzinfo=U)  # the bar closing 16:00 UTC


def daily(tr, mult):
    sp0 = tr.spot[tr.t0]
    live = list(range(len(tr.legs)))
    realised = -tr.fee_in - sum(slip(e, sp0) for e in tr.entry)
    t = tr.t0 + X.BAR
    while mult is not None and t <= tr.last_b and live:
        sp = tr.spot.get(t, tr.settle_spot)
        for i in list(live):
            m = tr.series[i].get(t)
            if m is not None and m >= mult * tr.entry[i]:
                realised += -(m - tr.entry[i]) * Q - X.fee(sp, m) - slip(m, sp)
                live.remove(i)
        t += X.BAR
    return realised + sum(tr.settle_leg(i) for i in live)


trades = sorted((e, tr) for e, tr in X.trades if e <= LAST)
days = [dt.date.fromisoformat(e) for e, _ in trades]
monthlies = sorted(dt.date.fromisoformat(e) for e in os.listdir(MONTHLY) if os.path.isdir(os.path.join(MONTHLY, e)))


def cycles(kind, first, last):
    """[(buy day, last day, wing expiry, settles)] covering the days first .. last."""
    out = []
    if kind.startswith("week"):
        f = first - D
        while f.weekday() != 4:
            f -= D
        while f < last:
            out.append((f, f + 7 * D, f + (7 if kind == "week" else 14) * D, kind == "week"))
            f += 7 * D
    else:
        for i in range(len(monthlies) - 1):
            a, b = monthlies[i], monthlies[i + 1]
            if b < first or a >= last:
                continue
            if kind == "month":
                out.append((a, b, b, True))
            elif i + 2 < len(monthlies):
                out.append((a, b, monthlies[i + 2], False))
    return out


def wings(kind, pct, first=None, end=None):
    """{day: wing result of that day}, carried marks, or None when a cycle cannot be priced."""
    first, end = first or days[0], end or days[-1]
    pnl, carried = defaultdict(float), 0
    for buy, last, exp, settles in cycles(kind, first, end):
        got = load(exp.isoformat(), kind.startswith("month"))
        if got is None:
            return None, f"no cache for the expiry {exp}"
        spot, opts = got
        tb = at16(buy)
        if tb not in spot:
            return None, f"no spot at the purchase {buy} in {exp}"
        s0 = spot[tb]
        for kd in ("P", "C"):
            ks = [k for (c, k), s in opts.items() if c == kd and tb in s and (k < s0 if kd == "P" else k > s0)]
            if not ks:
                return None, f"no wing price at {buy} in {exp}"
            k = min(ks, key=lambda x: abs(x - s0 * (1 - pct if kd == "P" else 1 + pct)))
            series = opts[(kd, k)]
            prev = series[tb] + (X.fee(s0, series[tb]) + slip(series[tb], s0)) / Q  # what a unit cost, all in
            mark = series[tb]
            day = buy + D
            while day <= last:
                if day == last and settles:
                    sp = spot[dt.datetime(exp.year, exp.month, exp.day, 11, tzinfo=U)]
                    v = X.intrinsic(kd, k, sp)
                    val = v - X.fee(sp, v) / Q
                else:
                    t = at16(day)
                    if t in series:
                        mark = series[t]
                    else:
                        carried += 1
                    val = mark
                    if day == last:
                        sp = spot.get(t, s0)
                        val = mark - (X.fee(sp, mark) + slip(mark, sp)) / Q
                if first <= day <= end:
                    pnl[day] += (val - prev) * Q
                prev = val
                day += D
    return pnl, carried


MONTHS = sorted({d.strftime("%y-%m") for d in days})
print(f"## {LABEL}{' WITH SLIPPAGE' if SLIP else ''}: {len(days)} daily expiries ({days[0]} .. {days[-1]}), each side {X.PCT * 100:g} % away, entered {X.ENTRY:g} h before settlement; wings 100 lots, kept for their cycle")
print(f"   {'':46s} {'mean':>7s} {'win':>4s} {'total':>7s} {'worst':>7s} {'worst 3':>8s} {'worst 7d':>8s} {'drawdown':>8s}  " + " ".join(f"{m:>6s}" for m in MONTHS) + f"  {'wings/d':>7s} {'on 10 worst':>17s} {'car':>4s}")
ROWS = 0
for name, mult in (("held", None), ("stop 2x", 2), ("stop 3x", 3)):
    base = {d: daily(tr, mult) for d, (_, tr) in zip(days, trades)}
    worst10 = sorted(days, key=lambda d: base[d])[:10]

    def line(label, w=None, carried=0):
        global ROWS
        ROWS += 1
        v = [base[d] + (w[d] if w else 0.0) for d in days]
        n = len(v)
        cum = peak = dd = 0.0
        for x in v:
            cum += x
            peak = max(peak, cum)
            dd = max(dd, peak - cum)
        w7 = min(sum(v[i:i + 7]) for i in range(n - 6))
        months = " ".join(f"{sum(x for d, x in zip(days, v) if d.strftime('%y-%m') == m):+6.0f}" for m in MONTHS)
        tail = f"  {sum(w.values()) / n:+7.2f} {sum(w[d] for d in worst10):+8.0f}/{sum(base[d] for d in worst10):+8.0f} {carried:4d}" if w else ""
        print(f"   {label:46s} {sum(v) / n:+7.2f} {100 * sum(1 for x in v if x > 0) / n:3.0f}% {sum(v):+7.0f} {min(v):+7.1f} {sum(sorted(v)[:3]):+8.1f} {w7:+8.1f} {-dd:+8.1f}  {months}{tail}")

    print(f"   -- daily strangle {name}")
    line("no wings")
    for kind, what, pcts in (("week", "week, this expiry", (0.03, 0.05)), ("week+", "week, next expiry", (0.05, 0.08)),
                             ("month", "month, this expiry", (0.08, 0.12)), ("month+", "month, next expiry", (0.12, 0.16))):
        for pct in pcts:
            w, c = wings(kind, pct)
            if w is None:
                print(f"   {what + f', wings {pct * 100:g} % away':46s} not priced: {c}")
                continue
            line(f"{what}, wings {pct * 100:g} % away", w, c)
print(f"   rows: {ROWS}")

# the wings alone, on every cycle the weekly and monthly caches can price: is the cover a cost or a gain over the year?
weeklies = sorted(dt.date.fromisoformat(e) for e in os.listdir(WEEKLY) if os.path.isdir(os.path.join(WEEKLY, e)))
print(f"   -- the wings ALONE, no strangle, on every cycle the caches price (weekly expiries {weeklies[0]} .. {weeklies[-1]}, monthly {monthlies[0]} .. {monthlies[-1]}); per cycle")
print(f"   {'':46s} {'cycles':>6s} {'mean':>8s} {'win':>4s} {'total':>7s} {'worst':>8s} {'best':>8s} {'per day':>8s}  first / second half of the cycles")
for kind, what, pcts, a, b in (("week", "week, this expiry", (0.03, 0.05), weeklies[0], weeklies[-1]), ("month", "month, this expiry", (0.08, 0.12), monthlies[0] + D, monthlies[-1])):
    for pct in pcts:
        cyc = [c for c in cycles(kind, a, b) if c[0] >= a - 7 * D and c[1] <= b and load(c[2].isoformat(), kind == "month") and at16(c[0]) in load(c[2].isoformat(), kind == "month")[0]]
        w, c = wings(kind, pct, cyc[0][0] + D, cyc[-1][1]) if cyc else (None, "no cycle")
        if w is None:
            print(f"   {what + f', wings {pct * 100:g} % away':46s} not priced: {c}")
            continue
        v = [sum(x for d, x in w.items() if buy < d <= last) for buy, last, _, _ in cyc]
        n, nd = len(v), (cyc[-1][1] - cyc[0][0]).days
        print(f"   {what + f', wings {pct * 100:g} % away':46s} {n:6d} {sum(v) / n:+8.1f} {100 * sum(1 for x in v if x > 0) / n:3.0f}% {sum(v):+7.0f} {min(v):+8.1f} {max(v):+8.1f} {sum(v) / nd:+8.2f}  {sum(v[:n // 2]):+.0f} / {sum(v[n // 2:]):+.0f}")
print()
