"""The BTC Friday weekly strangle WITH WINGS under the "one day" exit (asked by the build thread at the owner's word,
28 Nov 2026), beside the same winged strangle held to settlement and the naked one-day version, on the same weeks.

The data, the entry bar, the fee and the strikes of study_weekly.py (the source of the built-in winged card): Delta
India 1-hour MARK candles; the entry is the close of the bar starting 15:00 UTC on the Friday seven days before the
settlement (21:30 IST); a put and a call SOLD 3 % of the spot away and a put and a call BOUGHT 7 % away; 100 lots
(0.1 BTC) a leg; fee 0.01 % of notional a fill capped at 3.5 % of the premium, plus 18 % GST, the same on a leg open
at settlement. A week is left out, and counted by its reason, when a leg has no mark at the entry bar or there is no
net credit.

Strikes, two readings:
  card     each strike is the percentage away rounded to the 500 ladder, as study_weekly.py does (the card's 26 weeks).
  nearest  each strike is the listed strike with a mark at the entry bar nearest the percentage away; a wing must be
           further out than its sold option. More weeks, not the card's strikes.

Exits:
  held     every leg to settlement.
  one day  every leg open is closed together at the mark 20 hours after the entry (the close of the bar starting
           11:00 UTC on Saturday, 17:30 IST). A leg with no mark at that bar is closed at its last mark ("carried").
With "slip" every market fill (the entry and the one-day close, wings included) is worse than the mark by the share
measured on real fills (study_stack.py); a leg left to settlement pays its fee and no fill cost.

Columns: weeks, mean per week, share of weeks positive, total, worst week, worst three, largest drawdown, the totals
by month (the month of the expiry), and the legs closed at a carried mark.
"cap" is the four-leg largest loss of a week: the wider of the two widths (wing strike to sold strike) times 0.1,
less the net premium, plus the entry costs. For the winged one-day row the script prints the worst week beside that
week's cap and counts the weeks whose loss was larger than their own cap, before and after the costs of the close.

Usage: python -I study_weekly_wings_oneday.py <weekly cache_dir> [slip or ""] [hours held, 20]"""
import json, os, sys, datetime as dt
from collections import defaultdict

CACHE = sys.argv[1]
SLIP = len(sys.argv) > 2 and sys.argv[2] == "slip"
U = dt.timezone.utc
Q, STEP = 0.1, 500
FEE_RATE, FEE_CAP, GST = 0.0001, 0.035, 0.18
H = dt.timedelta(hours=1)
SOLD, WING = 0.03, 0.07
HOLD = int(sys.argv[3]) if len(sys.argv) > 3 else 20


def fee(spot, price):
    return min(FEE_RATE * spot * Q, FEE_CAP * price * Q) * (1 + GST)


def slip(p, sp):
    if not SLIP:
        return 0.0
    r = p / sp
    return p * Q * (0.01 if r >= 0.004 else 0.025 if r >= 0.0007 else 0.065)


def intrinsic(kind, k, sp):
    return max(0.0, sp - k) if kind == "C" else max(0.0, k - sp)


def load(exp):
    d = os.path.join(CACHE, exp)
    spot, opts = {}, defaultdict(dict)
    for f in os.listdir(d):
        rows = json.load(open(os.path.join(d, f)))
        if not rows:
            continue
        sym = f[:-5].replace("_", ":")
        series = {dt.datetime.fromtimestamp(r["time"], U): float(r["close"]) for r in rows}
        if sym == "MARK:BTCUSD":
            spot = series
        else:
            body = sym.split(":")[1].split("-")
            opts[(body[0], int(body[2]))] = series
    return spot, opts


def strikes(opts, t0, s0, mode, wings):
    """[(kind, strike, sign)] or a reason string."""
    if mode == "card":
        near = lambda x: int(round(x / STEP) * STEP)
        legs = [("P", near(s0 * (1 - SOLD)), -1), ("C", near(s0 * (1 + SOLD)), -1)]
        if wings:
            legs += [("P", near(s0 * (1 - WING)), 1), ("C", near(s0 * (1 + WING)), 1)]
    else:
        def nearest(kind, pct, beyond=None):
            want = s0 * (1 + pct if kind == "C" else 1 - pct)
            ks = [k for (kd, k), s in opts.items() if kd == kind and t0 in s and (k > s0 if kind == "C" else k < s0)
                  and (beyond is None or (k > beyond if kind == "C" else k < beyond))]
            return min(ks, key=lambda k: abs(k - want)) if ks else None
        p, c = nearest("P", SOLD), nearest("C", SOLD)
        if p is None or c is None:
            return "no sold price"
        legs = [("P", p, -1), ("C", c, -1)]
        if wings:
            wp, wc = nearest("P", WING, p), nearest("C", WING, c)
            if wp is None or wc is None:
                return "no wing price"
            legs += [("P", wp, 1), ("C", wc, 1)]
    for kind, k, sg in legs:
        if (kind, k) not in opts or t0 not in opts[(kind, k)]:
            return "no sold price" if sg < 0 else "no wing price"
    if legs[0][1] >= legs[1][1]:
        return "strikes cross"
    if sum(-sg * opts[(kind, k)][t0] for kind, k, sg in legs) <= 0:
        return "no net credit"
    return legs


def result(spot, opts, t0, last_b, legs, one_day):
    """(result, carried legs, cap, result before the costs of the close)."""
    s0, settle_spot = spot[t0], spot[last_b]
    entry = [opts[(kind, k)][t0] for kind, k, _ in legs]
    costs_in = sum(fee(s0, e) + slip(e, s0) for e in entry)
    net = sum(-sg * e for (_, _, sg), e in zip(legs, entry)) * Q
    width = max([abs(w[1] - s[1]) for s in legs[:2] for w in legs[2:] if w[0] == s[0]] or [0.0])
    cap = width * Q - net + costs_in if len(legs) == 4 else None
    if not one_day:
        v = [intrinsic(kind, k, settle_spot) for kind, k, _ in legs]
        return sum(sg * (x - e) * Q - fee(settle_spot, x) for (_, _, sg), x, e in zip(legs, v, entry)) - costs_in, 0, cap, None
    tx = t0 + HOLD * H
    sp = spot.get(tx, settle_spot)
    gross, costs_out, carried = -costs_in, 0.0, 0
    for (kind, k, sg), e in zip(legs, entry):
        series, t = opts[(kind, k)], tx
        if t not in series:
            carried += 1
            while t not in series:
                t -= H
        px = series[t]
        gross += sg * (px - e) * Q
        costs_out += fee(sp, px) + slip(px, sp)
    return gross - costs_out, carried, cap, gross


def stats(rows):
    v = [r[0] for _, r in rows]
    n = len(v)
    cum = peak = dd = 0.0
    for x in v:
        cum += x
        peak = max(peak, cum)
        dd = max(dd, peak - cum)
    by = defaultdict(float)
    for e, r in rows:
        by[e[:7]] += r[0]
    return (f"{n:3d} {sum(v) / n:+8.2f} {100 * sum(1 for x in v if x > 0) / n:3.0f}% {sum(v):+7.0f} {min(v):+8.1f} {sum(sorted(v)[:3]):+8.1f} {-dd:+8.1f} "
            f"{sum(r[1] for _, r in rows):3d}", by)


exps = sorted(e for e in os.listdir(CACHE) if os.path.isdir(os.path.join(CACHE, e)))
weeks = []
for exp in exps:
    spot, opts = load(exp)
    y, m, d = map(int, exp.split("-"))
    settle = dt.datetime(y, m, d, 12, tzinfo=U)
    t0 = settle - dt.timedelta(days=7) + dt.timedelta(hours=3)
    if settle - H in spot and t0 in spot:
        weeks.append((exp, spot, opts, t0, settle - H))

rows_tried = 0
print(f"## BTC Friday weekly{' WITH SLIPPAGE' if SLIP else ''}: {len(weeks)} weeks with an entry bar ({weeks[0][0]} .. {weeks[-1][0]}); sold {SOLD * 100:g} % away, wings {WING * 100:g} % away; one day = closed {HOLD} h after the entry; hourly marks; 100 lots a leg")
for mode in ("card", "nearest"):
    built = {w: {e: strikes(opts, t0, spot[t0], mode, w) for e, spot, opts, t0, _ in weeks} for w in (True, False)}
    ok = [e for e, *_ in weeks if not isinstance(built[True][e], str)]
    why = defaultdict(int)
    for e, *_ in weeks:
        if isinstance(built[True][e], str):
            why[built[True][e]] += 1
    print(f"\n-- strikes: {mode}; {len(ok)} weeks traded with wings, left out: {dict(why) or 'none'}")
    print(f"   {'':44s} {'wks':>3s} {'mean':>8s} {'win':>4s} {'total':>7s} {'worst':>8s} {'worst 3':>8s} {'drawdown':>8s} {'car':>3s}")
    months = {}
    for name, wings, one_day, same in (("wings, one day", True, True, True), ("wings, held to settlement", True, False, True),
                                       ("naked, one day, the same weeks", False, True, True), ("naked, held, the same weeks", False, False, True),
                                       ("naked, one day, every week with a price", False, True, False)):
        rows = [(e, result(spot, opts, t0, lb, built[wings][e], one_day)) for e, spot, opts, t0, lb in weeks
                if not isinstance(built[wings][e], str) and (not same or e in ok)]
        rows_tried += 1
        line, by = stats(rows)
        months[name] = by
        print(f"   {name:44s} {line}")
        if wings and one_day:
            worst = min(rows, key=lambda x: x[1][0])
            over = [e for e, r in rows if -r[0] > r[2]]
            over_gross = [e for e, r in rows if -r[3] > r[2]]
            caps = [r[2] for _, r in rows]
            print(f"      cap (four-leg largest loss): mean {sum(caps) / len(caps):.1f}, largest {max(caps):.1f}; worst week {worst[0]} {worst[1][0]:+.1f} against its cap {worst[1][2]:.1f}; "
                  f"weeks beyond their cap: {len(over)} after the costs of the close, {len(over_gross)} before them")
    keys = sorted({k for by in months.values() for k in by})
    print(f"   by month of expiry {'':25s} " + " ".join(f"{k[2:]:>6s}" for k in keys))
    for name, by in months.items():
        print(f"   {name:44s} " + " ".join(f"{by[k]:+6.0f}" if k in by else f"{'':6s}" for k in keys))
print(f"\nrows tried in this file: {rows_tried} (5 rows on 2 strike readings); one sold distance, one wing distance, one holding time.")
