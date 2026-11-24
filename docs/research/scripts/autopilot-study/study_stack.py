"""Candidate set-ups for going live (the owner, 24 Nov 2026: "come up with the best trade setup so that we are not
loosing the money"): whole stacks of the exits already studied, on the same evening strangle, ranked by what they
lose as well as by what they earn. Every row is one complete set of rules:
  stop      a sold option is bought back at this multiple of its entry price;
  buy-back  a sold option is bought back alone once its mark is at or under a fixed price (nearly worthless);
  lock      once the whole trade is up 50 % of the premium, closed if it falls back to 25 %;
  trail     from a share of the premium, closed when the profit gives back a share of its best;
  take      the whole trade closed at a share of the premium;
  after     once a stop has fired, the other sold option is bought back when its mark is at or under a share of
            its entry price (the owner's case: one leg stopped, the other nearly worthless and still open);
  skip      no trade when the spot moved more than a share over the 24 hours before the entry.
Columns: mean per day (a skipped day counts as zero), share of days positive, total, worst day, the worst three,
the largest drawdown, how many days lost more than a quarter of the premium, and the result on named expiries.
Same trades, fees and fills as study_exits.py (imported; run without -I from this folder).

Usage: python study_stack.py <cache_dir> <lot_size> <bar_minutes> <entry_hours_before> <percent_away> "" "" <label> <buy-back mark> [expiries to show, comma] [slip]
       (with "slip" every market fill, the entry included, is worse than the mark by the share measured on real fills;
       a leg left to settlement pays none)"""
import os, sys, datetime as dt
import study_exits as X

LABEL, MARK = sys.argv[8], float(sys.argv[9])
SHOW = [x for x in sys.argv[10].split(",") if x] if len(sys.argv) > 10 else []
SLIP = len(sys.argv) > 11 and sys.argv[11] == "slip"


def slip(p, sp):
    """What a market order loses against the mark, in money, from the owner's own fills (check_fills.py, daily BTC
    options): 1 % of the price for an option worth 0.4 % of the spot or more, 2.5 % down to 0.07 %, 6.5 % under that."""
    if not SLIP:
        return 0.0
    r = p / sp
    return p * X.Q * (0.01 if r >= 0.004 else 0.025 if r >= 0.0007 else 0.065)

spot_all = {}
for e in sorted(os.listdir(X.CACHE)):
    if os.path.isdir(os.path.join(X.CACHE, e)):
        spot_all.update(X.load(e)[0])


def move24(tr):
    past = spot_all.get(tr.t0 - dt.timedelta(hours=24))
    return None if past is None else tr.spot[tr.t0] / past - 1


def run(tr, mult=3, mark=None, lock=None, trail=None, take=None, skip=None, after=None):
    if skip is not None:
        mv = move24(tr)
        if mv is not None and abs(mv) > skip:
            return 0.0
    live, realised, t, floor, best, stopped = list(range(len(tr.legs))), -tr.fee_in - sum(slip(e, tr.spot[tr.t0]) for e in tr.entry), tr.t0 + X.BAR, None, None, False
    while t <= tr.last_b and live:
        sp = tr.spot.get(t, tr.settle_spot)
        px = {i: tr.series[i].get(t) for i in live}
        for i in list(live):
            if px[i] is None:
                continue
            hit = px[i] >= mult * tr.entry[i]
            if hit or (mark is not None and px[i] <= mark) or (after is not None and stopped and px[i] <= after * tr.entry[i]):
                realised += -(px[i] - tr.entry[i]) * X.Q - X.fee(sp, px[i]) - slip(px[i], sp)
                live.remove(i)
                stopped = stopped or hit
        if live and all(px[i] is not None for i in live):
            rest = sum(-(px[i] - tr.entry[i]) * X.Q for i in live)
            total = (realised + tr.fee_in + rest) / tr.credit
            close = take is not None and total >= take
            if lock is not None:
                if total >= lock[0]:
                    floor = lock[1]
                close = close or (floor is not None and total <= floor)
            if trail is not None and (best is not None or total >= trail[0]):
                best = total if best is None else max(best, total)
                close = close or total <= best * (1 - trail[1])
            if close:
                return realised + rest - sum(X.fee(sp, px[i]) + slip(px[i], sp) for i in live)
        t += X.BAR
    return realised + sum(tr.settle_leg(i) for i in live)


STACKS = [
    ("stop 3x", dict()),
    ("stop 2x", dict(mult=2)),
    ("stop 3x, buy-back", dict(mark=MARK)),
    ("stop 2x, buy-back", dict(mult=2, mark=MARK)),
    ("stop 3x, buy-back, lock 50>25", dict(mark=MARK, lock=(0.5, 0.25))),
    ("stop 2x, buy-back, lock 50>25", dict(mult=2, mark=MARK, lock=(0.5, 0.25))),
    ("stop 3x, buy-back, trail from 90 give 5", dict(mark=MARK, trail=(0.9, 0.05))),
    ("stop 2x, buy-back, trail from 90 give 5", dict(mult=2, mark=MARK, trail=(0.9, 0.05))),
    ("stop 3x, buy-back, lock, take 90", dict(mark=MARK, lock=(0.5, 0.25), take=0.9)),
    ("stop 2x, buy-back, lock, take 90", dict(mult=2, mark=MARK, lock=(0.5, 0.25), take=0.9)),
    ("stop 3x, trail from 50 give 20", dict(trail=(0.5, 0.2))),
    ("stop 2x, trail from 50 give 20", dict(mult=2, trail=(0.5, 0.2))),
    ("stop 3x, trail from 25 give 30", dict(trail=(0.25, 0.3))),
    ("stop 2x, trail from 25 give 30", dict(mult=2, trail=(0.25, 0.3))),
    ("stop 3x, trail from 15 give 30", dict(trail=(0.15, 0.3))),
    ("stop 2x, trail from 15 give 30", dict(mult=2, trail=(0.15, 0.3))),
    ("stop 2x, buy-back, trail from 50 give 20", dict(mult=2, mark=MARK, trail=(0.5, 0.2))),
    ("stop 2x, buy-back, trail from 25 give 30", dict(mult=2, mark=MARK, trail=(0.25, 0.3))),
    ("stop 2x; after a stop the other bought back at 20 %", dict(mult=2, after=0.2)),
    ("stop 2x; after a stop the other bought back at 10 %", dict(mult=2, after=0.1)),
    ("stop 3x; after a stop the other bought back at 20 %", dict(after=0.2)),
    ("stop 3x; after a stop the other bought back at 10 %", dict(after=0.1)),
    ("stop 2x, trail 25 give 30; after a stop other at 20 %", dict(mult=2, trail=(0.25, 0.3), after=0.2)),
    ("stop 3x, buy-back, lock; skip after a 3 % day", dict(mark=MARK, lock=(0.5, 0.25), skip=0.03)),
    ("stop 2x, buy-back, lock; skip after a 3 % day", dict(mult=2, mark=MARK, lock=(0.5, 0.25), skip=0.03)),
    ("stop 3x, buy-back, lock; skip after a 2 % day", dict(mark=MARK, lock=(0.5, 0.25), skip=0.02)),
    ("stop 2x, trail from 15 give 30; skip after a 3 % day", dict(mult=2, trail=(0.15, 0.3), skip=0.03)),
]

trades = sorted(X.trades, key=lambda x: x[0])
prem = sum(tr.credit for _, tr in trades) / len(trades)
big = sum(1 for _, tr in trades if (move24(tr) is not None and abs(move24(tr)) > 0.03))
print(f"## {LABEL}{' WITH SLIPPAGE' if SLIP else ''}: {len(trades)} trades ({trades[0][0]} .. {trades[-1][0]}), each side {X.PCT * 100:g} % away, entered {X.ENTRY:g} h before settlement; mean premium {prem:.1f}; buy-back mark {MARK:g}; {big} days followed a move of more than 3 % in 24 h")
print(f"   {'':50s} {'mean':>7s} {'win':>4s} {'total':>7s} {'worst':>7s} {'worst 3':>8s} {'drawdown':>8s} {'bad days':>8s} {'halves':>13s}  " + "  ".join(f"{e[5:]:>7s}" for e in SHOW))
for name, kw in STACKS:
    rows = [(e, run(tr, **kw), tr.credit) for e, tr in trades]
    vals = [v for _, v, _ in rows]
    n = len(vals)
    mid = sorted(e for e, *_ in rows)[n // 2]
    cum = peak = dd = 0.0
    for v in vals:
        cum += v
        peak = max(peak, cum)
        dd = max(dd, peak - cum)
    bad = sum(1 for _, v, c in rows if v < -0.25 * c)
    h = f"{sum(v for e, v, _ in rows if e < mid):+.0f}/{sum(v for e, v, _ in rows if e >= mid):+.0f}"
    by = dict((e, v) for e, v, _ in rows)
    print(f"   {name:50s} {sum(vals) / n:+7.2f} {100 * sum(1 for v in vals if v > 0) / n:3.0f}% {sum(vals):+7.0f} {min(vals):+7.1f} {sum(sorted(vals)[:3]):+8.1f} {-dd:+8.1f} {bad:8d} {h:>13s}  " + "  ".join(f"{by[e]:+7.1f}" if e in by else f"{'':>7s}" for e in SHOW))
print()
