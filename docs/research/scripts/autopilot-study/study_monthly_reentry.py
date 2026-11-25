"""A second entry on a monthly expiry (the owner, 25 Nov 2026: "Why don't we run the monthly strategies again ...
the range may change by now"; "test monthly re-entry"). Autopilot sells a monthly strangle once per expiry, on the
first evening the expiry is 44 days out. Here on the monthly cache (Delta India 1-hour MARK candles, the cache of
fetch_monthly.py), fees as study_monthly.py, 100 lots a leg an entry, fills at the hourly mark close:

  single     one strangle sold on the evening N days before the settlement day, at the close of the 15:00 UTC bar
             (21:30 IST; the settlement itself is at 12:00 UTC, 16:00 for Gold), strikes a percentage away from
             the spot of THAT evening; shows what a later entry alone earns.
  ladder     several of those singles on the same expiry, each its own 100 lots (more size on one expiry); the
             "an entry" column divides by the number of entries so that it compares with a single.
  roll       the strangle of 44 days closed at the mark N days before and a new one sold around the spot then.
  re-sell    the strangle of 44 days; when the stop takes a sold option, a new option of the same kind is sold the
             percentage away from the spot of that hour (at most 3 times a side, not in the last 7 days).
  re-centre  the strangle of 44 days; once the spot is X % away from where the last strangle was centred, what is
             open is closed at the mark and a new strangle sold around the spot (not in the last 7 days).

Every sold option has the stop of the block (bought back at 2 or 3 times its own entry price); "no stop" is shown
for the singles only. Distance: the same percentage at every entry, or with "scaled" the percentage times the
square root of (days left / 44), the distance that keeps about the same odds as the days run down.
A strike is the listed one nearest the target with a mark at that hour; an entry whose nearest strike is more than
3 % of the spot off the target is not taken. With "slip" every market fill is worse than the mark by the share
measured on real daily fills (study_stack.py; not measured on monthly options, whose spreads are likely wider);
settlement pays its fee and no fill cost. An expiry whose files were written before its settlement is left out (the
candle endpoint pads a series with its last price).

Columns: expiries, mean per expiry, expiries positive, total, worst and best expiry, mean premium sold per expiry,
mean number of entries (strangles or single options sold) per expiry, mean per entry.

Usage: python -I study_monthly_reentry.py <cache_dir> <lot_size> <label> <percent away> [scaled] [slip]"""
import json, math, os, sys, datetime as dt
from collections import defaultdict

CACHE, LOT, LABEL, PCT = sys.argv[1], float(sys.argv[2]), sys.argv[3], float(sys.argv[4]) / 100
SCALED, SLIP = "scaled" in sys.argv[5:], "slip" in sys.argv[5:]
U = dt.timezone.utc
LOTS, BASE, LAST_DAYS = 100, 44, 7
FEE_RATE, FEE_CAP, GST = 0.0001, 0.035, 0.18
H = dt.timedelta(hours=1)
Q = LOTS * LOT


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
        if sym.endswith("USD"):
            spot = series
        else:
            body = sym.split(":")[1].split("-")
            opts[(body[0], int(body[2]))] = series
    return spot, opts


class Expiry:
    def __init__(self, exp, spot, opts, settle):
        self.exp, self.spot, self.opts, self.settle = exp, spot, opts, settle
        self.last_b = settle - H
        self.settle_spot = spot[self.last_b]

    def at(self, days):
        return self.settle.replace(hour=15) - dt.timedelta(days=days)

    def left(self, t):
        return (self.settle - t).total_seconds() / 86400

    def sell(self, kind, t):
        """(kind, strike, entry price, cost of the entry) for the option the distance away at t, or None."""
        s = self.spot.get(t)
        if s is None:
            return None
        pct = PCT * (math.sqrt(max(self.left(t), 0.0) / BASE) if SCALED else 1.0)
        target = s * (1 + pct if kind == "C" else 1 - pct)
        best = None
        for (kd, k), series in self.opts.items():
            if kd != kind or t not in series or (k <= s if kind == "C" else k >= s):
                continue
            if best is None or abs(k - target) < abs(best - target):
                best = k
        if best is None or abs(best - target) > 0.03 * s:
            return None
        e = self.opts[(kind, best)][t]
        return [kind, best, e, fee(s, e) + slip(e, s)]

    def strangle(self, t):
        legs = [self.sell("P", t), self.sell("C", t)]
        return None if None in legs else legs

    def mark(self, leg, t):
        return self.opts[(leg[0], leg[1])].get(t)

    def buy_back(self, leg, t, p):
        sp = self.spot.get(t, self.settle_spot)
        return -(p - leg[2]) * Q - fee(sp, p) - slip(p, sp)

    def settle_leg(self, leg):
        v = intrinsic(leg[0], leg[1], self.settle_spot)
        return -(v - leg[2]) * Q - fee(self.settle_spot, v)

    def run(self, legs, t0, mult, until=None):
        """The legs from t0 under the stop. Returns (result without the entry costs, legs still open, [(leg, stop time)]).
        With `until` the run halts there with the open legs returned; otherwise they are settled."""
        live, res, stopped, t = list(legs), 0.0, [], t0 + H
        end = self.last_b if until is None else until
        while t <= end and live:
            for leg in list(live):
                p = self.mark(leg, t)
                if mult is not None and p is not None and p >= mult * leg[2]:
                    res += self.buy_back(leg, t, p)
                    live.remove(leg)
                    stopped.append((leg, t))
            t += H
        if until is None:
            res += sum(self.settle_leg(leg) for leg in live)
            live = []
        return res, live, stopped

    def close_all(self, live, t):
        """Buys the open legs back at the first bar from t at which each has a mark (at most 6 bars on); None if one has none."""
        res = 0.0
        for leg in live:
            for i in range(7):
                p = self.mark(leg, t + H * i)
                if p is not None:
                    res += self.buy_back(leg, t + H * i, p)
                    break
            else:
                return None
        return res


def cost(legs):
    return sum(leg[3] for leg in legs)


def credit(legs):
    return sum(leg[2] * Q for leg in legs)


# every scheme returns (result, premium sold, entries) or None when its first entry cannot be priced
def single(x, mult, days):
    legs = x.strangle(x.at(days))
    if legs is None:
        return None
    return x.run(legs, x.at(days), mult)[0] - cost(legs), credit(legs), 1


def ladder(x, mult, rungs):
    got = [r for r in (single(x, mult, d) for d in rungs) if r is not None]
    if not got or single(x, mult, rungs[0]) is None:
        return None
    return sum(r[0] for r in got), sum(r[1] for r in got), len(got)


def roll(x, mult, days):
    t0, t1 = x.at(BASE), x.at(days)
    legs = x.strangle(t0)
    if legs is None:
        return None
    res, live, _ = x.run(legs, t0, mult, until=t1)
    res -= cost(legs)
    new = x.strangle(t1)
    closed = x.close_all(live, t1) if new is not None else None
    if closed is None:      # no new strangle or no mark to close at: the first one runs on
        return res + x.run(live, t1, mult)[0], credit(legs), 1
    return res + closed + x.run(new, t1, mult)[0] - cost(new), credit(legs) + credit(new), 2


def resell(x, mult):
    t0 = x.at(BASE)
    legs = x.strangle(t0)
    if legs is None:
        return None
    res, prem, n = -cost(legs), credit(legs), 1.0
    queue, again = [(leg, t0) for leg in legs], {"P": 0, "C": 0}
    while queue:
        leg, t = queue.pop()
        r, _, stopped = x.run([leg], t, mult)
        res += r
        for old, ts in stopped:
            if again[old[0]] < 3 and x.left(ts) >= LAST_DAYS:
                new = x.sell(old[0], ts)
                if new is not None:
                    again[old[0]] += 1
                    res, prem, n = res - new[3], prem + new[2] * Q, n + 0.5
                    queue.append((new, ts))
    return res, prem, n


def recentre(x, mult, move):
    t0 = x.at(BASE)
    legs = x.strangle(t0)
    if legs is None:
        return None
    res, prem, n = -cost(legs), credit(legs), 1
    live, ref, t = list(legs), x.spot[t0], t0 + H
    while t <= x.last_b:
        for leg in list(live):
            p = x.mark(leg, t)
            if mult is not None and p is not None and p >= mult * leg[2]:
                res += x.buy_back(leg, t, p)
                live.remove(leg)
        sp = x.spot.get(t)
        if sp is not None and abs(sp / ref - 1) >= move and x.left(t) >= LAST_DAYS and all(x.mark(leg, t) is not None for leg in live):
            new = x.strangle(t)
            if new is not None:
                res += sum(x.buy_back(leg, t, x.mark(leg, t)) for leg in live) - cost(new)
                prem, n, live, ref = prem + credit(new), n + 1, list(new), sp
        t += H
    return res + sum(x.settle_leg(leg) for leg in live), prem, n


exps = sorted(e for e in os.listdir(CACHE) if os.path.isdir(os.path.join(CACHE, e)))
settle_h = 16 if "XAUT" in CACHE.upper() else 12
data, skipped = [], []
for exp in exps:
    spot, opts = load(exp)
    y, m, d = map(int, exp.split("-"))
    settle = dt.datetime(y, m, d, settle_h, tzinfo=U)
    fetched = max(os.path.getmtime(os.path.join(CACHE, exp, f)) for f in os.listdir(os.path.join(CACHE, exp)))
    if settle - H not in spot or settle.timestamp() > fetched:
        skipped.append(exp)
        continue
    data.append(Expiry(exp, spot, opts, settle))


def line(name, fn):
    rows = [(x.exp, fn(x)) for x in data]
    got = [(e, r) for e, r in rows if r is not None]
    if not got:
        print(f"   {name:46s}   no entry could be priced")
        return
    v = [r[0] for _, r in got]
    n, ents = len(v), sum(r[2] for _, r in got)
    print(f"   {name:46s} {n:3d} {sum(v) / n:+8.1f} {sum(1 for a in v if a > 0):3d} {sum(v):+8.0f} {min(v):+8.0f} {max(v):+8.0f} {sum(r[1] for _, r in got) / n:8.1f} {ents / n:5.1f} {sum(v) / ents:+8.1f}")


dist = f"{PCT * 100:g} % x sqrt(days left / {BASE})" if SCALED else f"{PCT * 100:g} % at every entry"
print(f"## {LABEL}{' WITH SLIPPAGE' if SLIP else ''}: {len(data)} settled monthly expiries ({data[0].exp} .. {data[-1].exp}); distance {dist}; {LOTS} lots x {LOT:g} a leg an entry; net of fees; hourly marks")
if skipped:
    print(f"   left out, fetched before the settlement or without a last bar: {', '.join(skipped)}")
HEAD = f"   {'':46s} {'exp':>3s} {'mean':>8s} {'pos':>3s} {'total':>8s} {'worst':>8s} {'best':>8s} {'premium':>8s} {'entr.':>5s} {'an entry':>8s}"
print("\n-- no stop, held to settlement")
print(HEAD)
for d in (44, 37, 30, 23, 16, 9):
    line(f"single, {d} days before", lambda x, d=d: single(x, None, d))
for mult in (3, 2):
    print(f"\n-- stop {mult}x on every sold option")
    print(HEAD)
    for d in (44, 37, 30, 23, 16, 9):
        line(f"single, {d} days before", lambda x, d=d: single(x, mult, d))
    for rungs in ((44, 30), (44, 23), (44, 30, 16), (44, 37, 30, 23)):
        line("ladder, " + " + ".join(map(str, rungs)) + " days before", lambda x, r=rungs: ladder(x, mult, r))
    for d in (30, 23, 16):
        line(f"roll: the 44-day strangle moved at {d} days", lambda x, d=d: roll(x, mult, d))
    line("re-sell the side the stop took", lambda x: resell(x, mult))
    for mv in (0.04, 0.06, 0.08):
        line(f"re-centre once the spot is {mv * 100:g} % away", lambda x, mv=mv: recentre(x, mult, mv))
print()
