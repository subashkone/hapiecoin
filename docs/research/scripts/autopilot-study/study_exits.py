"""Exit rules for a sold strangle (strategy lab backlog 1 to 4, 22 Nov 2026): a profit lock, a timed exit, an exit
by distance to the sold strike, and step ladders. One entry per expiry, each side sold a percentage of the spot away.
Same data, fees, fills and conventions as study_premium.py: Delta India MARK candles, fills at the bar close, 0.01 % of
notional per fill capped at 3.5 % of the premium, plus 18 % GST, the same on every leg open at settlement; 100 lots a leg.

Usage: python -I study_exits.py <cache_dir> <lot_size> <bar_minutes> <entry_hours_before> <percent_away> <timed exits, hours before settlement, comma> <distances to the strike in per cent, comma>
       (ASCII output; "profit" is before the entry fee, as a share of the premium collected, as in study_premium.py)"""
import json, os, sys, datetime as dt

CACHE, LOT, BAR = sys.argv[1], float(sys.argv[2]), dt.timedelta(minutes=int(sys.argv[3]))
ENTRY, PCT = float(sys.argv[4]), float(sys.argv[5]) / 100
TIMED = [float(x) for x in sys.argv[6].split(",") if x]
NEAR = [float(x) for x in sys.argv[7].split(",") if x]
U = dt.timezone.utc
IST = dt.timezone(dt.timedelta(hours=5, minutes=30))
Q = 100 * LOT
FEE_RATE, FEE_CAP, GST = 0.0001, 0.035, 0.18
HOURLY = BAR >= dt.timedelta(hours=1)

LOCKS = [(x, y) for x in (25, 40, 50, 60, 75) for y in (0, 10, 25, 40, 50) if y < x and not (x == 25 and y == 25)]
RATCHETS = {"25>0, 50>25, 75>50": [(25, 0), (50, 25), (75, 50)], "20>0, 40>20, 60>40, 80>60": [(20, 0), (40, 20), (60, 40), (80, 60)],
            "50>25, 75>50": [(50, 25), (75, 50)]}
# step ladders: equal parts, each closed at its share of the premium; "exp" is a part kept to settlement (stops still on)
LADDERS = {
    "3 steps  25 / 50 / exp": [25, 50, None], "3 steps  33 / 66 / exp": [33, 66, None], "3 steps  50 / 75 / exp (late)": [50, 75, None],
    "3 steps  25 / 50 / 75 (all taken)": [25, 50, 75],
    "4 steps  25 / 50 / 75 / exp (tested before)": [25, 50, 75, None], "4 steps  20 / 40 / 60 / exp (early)": [20, 40, 60, None],
    "4 steps  40 / 60 / 80 / exp (late)": [40, 60, 80, None], "4 steps  20 / 40 / 60 / 80 (all taken)": [20, 40, 60, 80],
    "5 steps  20 / 40 / 60 / 80 / exp": [20, 40, 60, 80, None], "5 steps  10 / 25 / 40 / 55 / exp (early)": [10, 25, 40, 55, None],
    "5 steps  30 / 45 / 60 / 75 / exp": [30, 45, 60, 75, None], "5 steps  50 / 60 / 70 / 80 / exp (late)": [50, 60, 70, 80, None],
}


def settle_hour():
    for e in os.listdir(CACHE):
        d = os.path.join(CACHE, e)
        if os.path.isdir(d) and any(f.startswith("MARK_XAUTUSD") for f in os.listdir(d)):
            return 16
    return 12


SETTLE_H = settle_hour()


def fee(spot, price):
    return min(FEE_RATE * spot * Q, FEE_CAP * price * Q) * (1 + GST)


def intrinsic(kind, k, sp):
    return max(0.0, sp - k) if kind == "C" else max(0.0, k - sp)


def load(exp):
    d = os.path.join(CACHE, exp)
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
    return spot, opts


def pick(opts, t0, s0, kind):
    best = None
    for (kd, k), series in opts.items():
        if kd != kind or t0 not in series or (k <= s0 if kind == "C" else k >= s0):
            continue
        score = abs(k - s0 * (1 + PCT if kind == "C" else 1 - PCT))
        if best is None or score < best[0]:
            best = (score, k)
    return None if best is None else best[1]


class Trade:
    def __init__(self, spot, opts, t0, settle, legs):
        self.spot, self.t0, self.settle, self.legs = spot, t0, settle, legs
        self.last_b = settle - BAR
        self.settle_spot = spot[self.last_b]
        self.series = [opts[(kind, k)] for kind, k in legs]
        self.entry = [s[t0] for s in self.series]
        self.fee_in = sum(fee(spot[t0], e) for e in self.entry)
        self.credit = sum(e * Q for e in self.entry)

    def settle_leg(self, i):
        v = intrinsic(self.legs[i][0], self.legs[i][1], self.settle_spot)
        return -(v - self.entry[i]) * Q - fee(self.settle_spot, v)

    def hold(self):
        return sum(self.settle_leg(i) for i in range(len(self.legs))) - self.fee_in

    def run(self, mult=None, take=None, lock=None, ratchet=None, half_trail=None, t_exit=None, near=None):
        """mult: close a sold option at that multiple of its entry price. take: close all at that share of the premium.
        lock (x, y): once the profit has reached x, close all when it falls back to y. ratchet: several locks, the floor
        only rises. half_trail g: from half the premium, close when the profit gives back g of its best. t_exit: close
        all at that time. near z: close a side when the spot is within z of its strike (z = 0: at the strike)."""
        legs, entry = self.legs, self.entry
        live, realised, done, t, best, floor = list(range(len(legs))), -self.fee_in, None, self.t0 + BAR, None, None
        while t <= self.last_b and live:
            px = {i: self.series[i].get(t) for i in live}
            sp = self.spot.get(t, self.settle_spot)
            for i in list(live):
                if px[i] is None:
                    continue
                kind, k = legs[i]
                hit = mult is not None and px[i] >= mult * entry[i]
                if near is not None and (sp >= k * (1 - near) if kind == "C" else sp <= k * (1 + near)):
                    hit = True
                if hit:
                    realised += -(px[i] - entry[i]) * Q - fee(sp, px[i])
                    live.remove(i)
            if live and all(px[i] is not None for i in live):
                rest = sum(-(px[i] - entry[i]) * Q for i in live)
                total = (realised + self.fee_in + rest) / self.credit
                close = t_exit is not None and t >= t_exit
                if take is not None and total >= take:
                    close = True
                for x, y in ([lock] if lock else []) + (ratchet or []):
                    if total >= x and (floor is None or y > floor):
                        floor = y
                if floor is not None and total <= floor:
                    close = True
                if half_trail is not None and (best is not None or total >= 0.5):
                    best = total if best is None else max(best, total)
                    if total <= best * (1 - half_trail):
                        close = True
                if close:
                    done = realised + rest - sum(fee(sp, px[i]) for i in live)
                    break
            t += BAR
        if done is None:
            done = realised + sum(self.settle_leg(i) for i in live)
        return done

    def ladder_whole(self, mult, steps):
        """A ladder judged on the WHOLE trade: equal parts, one closed each time the trade's realised plus open profit
        reaches the next share of the whole premium (None = that part rides to settlement). A stop closes all that is
        left of that option."""
        legs, entry, n = self.legs, self.entry, len(steps)
        levels = [lv / 100 for lv in steps if lv is not None]
        live, realised, t, f, k = list(range(len(legs))), -self.fee_in, self.t0 + BAR, 1.0, 0
        while t <= self.last_b and live and f > 1e-9:
            px = {i: self.series[i].get(t) for i in live}
            sp = self.spot.get(t, self.settle_spot)
            for i in list(live):
                if px[i] is not None and px[i] >= mult * entry[i]:
                    realised += f * (-(px[i] - entry[i]) * Q - fee(sp, px[i]))
                    live.remove(i)
            if live and all(px[i] is not None for i in live):
                rest = sum(-(px[i] - entry[i]) * Q for i in live)
                while k < len(levels) and (realised + self.fee_in + f * rest) / self.credit >= levels[k]:
                    realised += (rest - sum(fee(sp, px[i]) for i in live)) / n
                    f -= 1 / n
                    k += 1
            t += BAR
        if f > 1e-9:
            realised += f * sum(self.settle_leg(i) for i in live)
        return realised


def stats(rows):
    vals = [p for _, p in rows]
    n = len(vals)
    mid = sorted(e for e, _ in rows)[n // 2]
    first, second = sum(p for e, p in rows if e < mid), sum(p for e, p in rows if e >= mid)
    return f"n={n:3d} mean={sum(vals) / n:+8.2f} win={100 * sum(1 for v in vals if v > 0) / n:3.0f}% worst={min(vals):+8.1f} total={sum(vals):+7.0f} | first half {first:+7.0f}, second half {second:+7.0f}"


def clock(hours_before):
    t = dt.datetime(2026, 1, 2, SETTLE_H, tzinfo=U) - dt.timedelta(hours=hours_before)
    return t.astimezone(IST).strftime("%H:%M IST")


trades = []
exps = sorted(e for e in os.listdir(CACHE) if os.path.isdir(os.path.join(CACHE, e)))
shift = BAR if HOURLY else dt.timedelta(0)  # an hourly bar closes at the time it stands for
for exp in exps:
    spot, opts = load(exp)
    y, m, d = map(int, exp.split("-"))
    settle = dt.datetime(y, m, d, SETTLE_H, tzinfo=U)
    t0 = settle - dt.timedelta(hours=ENTRY) - shift
    if settle - BAR not in spot or t0 not in spot:
        continue
    pk, ck = pick(opts, t0, spot[t0], "P"), pick(opts, t0, spot[t0], "C")
    if pk is None or ck is None:
        continue
    tr = Trade(spot, opts, t0, settle, [("P", pk), ("C", ck)])
    if tr.credit > 0:
        trades.append((exp, tr))

count = 0


def line(label, fn):
    global count
    count += 1
    print(f"      {label:44s} {stats([(e, fn(tr)) for e, tr in trades])}")


def main():
    S = (2, 3)
    print(f"expiries in the cache: {len(exps)} ({exps[0]} .. {exps[-1]}), traded {len(trades)}; 100 lots x {LOT:g} per leg; net of fees")
    print(f"sold strangle, each side {PCT * 100:g} % away, entered {ENTRY:g} hours before settlement ({clock(ENTRY)}); mean premium collected {sum(tr.credit for _, tr in trades) / len(trades):.1f}")
    print("\n== 0. What is known already (the yardsticks)")
    line("hold to settlement", lambda tr: tr.hold())
    for m in S:
        line(f"stop {m}x", lambda tr: tr.run(mult=m))
        line(f"stop {m}x, take half", lambda tr: tr.run(mult=m, take=0.5))
        line(f"stop {m}x, half then trail 20", lambda tr: tr.run(mult=m, half_trail=0.2))

    print("\n== 1. Profit lock: once the profit has reached X % of the premium, close if it falls back to Y % (else to settlement)")
    for m in S:
        for x, y in LOCKS:
            line(f"stop {m}x, lock at {x} > floor {y}", lambda tr: tr.run(mult=m, lock=(x / 100, y / 100)))
        for name, steps in RATCHETS.items():
            line(f"stop {m}x, rising floor {name}", lambda tr: tr.run(mult=m, ratchet=[(a / 100, b / 100) for a, b in steps]))
    print("   without a stop on the options, the lock alone:")
    for x, y in ((25, 0), (50, 25), (75, 50)):
        line(f"no stop, lock at {x} > floor {y}", lambda tr: tr.run(lock=(x / 100, y / 100)))

    print("\n== 2. Timed exit: close everything at a fixed time, whatever the profit")
    for m in (None,) + S:
        name = "no stop" if m is None else f"stop {m}x"
        for h in TIMED:
            te = None
            line(f"{name}, out {h:g} h before ({clock(h)})", lambda tr: tr.run(mult=m, t_exit=tr.settle - dt.timedelta(hours=h) - shift))
    for m in S:
        for h in TIMED:
            line(f"stop {m}x, take half, out {h:g} h before", lambda tr: tr.run(mult=m, take=0.5, t_exit=tr.settle - dt.timedelta(hours=h) - shift))

    print("\n== 3. Exit a side when the spot comes within Z % of its sold strike (0 = when the spot reaches the strike)")
    for m in (None,) + S:
        name = "no price stop" if m is None else f"stop {m}x"
        for z in NEAR:
            line(f"{name}, side out within {z:g} %", lambda tr: tr.run(mult=m, near=z / 100))
    for m in (None, 3):
        name = "no price stop" if m is None else f"stop {m}x"
        for z in NEAR:
            line(f"{name}, take half, side out within {z:g} %", lambda tr: tr.run(mult=m, take=0.5, near=z / 100))

    print("\n== 4. Step ladders: equal parts, each closed at its share of the premium; exp = that part kept to settlement")
    for m in S:
        cache = {}

        def part(tr, lv, m=m):
            key = (id(tr), lv)
            if key not in cache:
                cache[key] = tr.run(mult=m, take=None if lv is None else lv / 100)
            return cache[key]

        for name, steps in LADDERS.items():
            line(f"stop {m}x, {name}", lambda tr: sum(part(tr, lv) for lv in steps) / len(steps))

    print("\n== 5. The same ladders judged on the whole trade: a part closes when realised plus open profit reaches the step")
    for m in S:
        for name, steps in LADDERS.items():
            line(f"stop {m}x, whole, {name}", lambda tr: tr.ladder_whole(m, steps))

    print(f"\nvariants in this table: {count}")


if __name__ == "__main__":
    main()
