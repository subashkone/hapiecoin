"""Exits that run as separate Autopilot strategies, combined in one (the owner's question of 22 Nov 2026, relayed by
the build thread): one side after a move, the leg buy-back (at a fixed mark and at 20 % of the entry price), the
profit lock 50 > 25, out 16 hours before settlement, the close at 90 % of the premium. Every combination is printed
beside the stop alone and beside each of its parts alone. Same trades, fees and fills as study_exits.py (imported; run
without -I from this folder). A day with no spot history 24 hours before the entry sells both sides.

Usage: python study_combo.py <cache_dir> <lot_size> <bar_minutes> <entry_hours_before> <percent_away> "" "" <label> <stop multiple> <buy-back mark> <daily|weekly>"""
import os, sys, datetime as dt
import study_exits as X

LABEL, MULT, MARK, CYCLE = sys.argv[8], int(sys.argv[9]), float(sys.argv[10]), sys.argv[11]
MOVE_H, MOVE_PCT, LOCK, OUT_H, TAKE, SHARE = 24, 1.0, (0.50, 0.25), 16, 0.90, 0.20

spot_all = {}
for e in sorted(os.listdir(X.CACHE)):
    if os.path.isdir(os.path.join(X.CACHE, e)):
        spot_all.update(X.load(e)[0])
no_history = 0


def sides(tr):
    """The legs to sell: only the put after a rise beyond the threshold, only the call after a fall, both otherwise."""
    past = spot_all.get(tr.t0 - dt.timedelta(hours=MOVE_H))
    if past is None:
        return list(range(len(tr.legs)))
    r = 100 * (spot_all[tr.t0] / past - 1)
    want = "P" if r > MOVE_PCT else "C" if r < -MOVE_PCT else None
    return [i for i, (kind, _) in enumerate(tr.legs) if want is None or kind == want]


def run(tr, one_side=False, mark=None, share=None, lock=None, take=None, out=None):
    live = sides(tr) if one_side else list(range(len(tr.legs)))
    fee_in = sum(X.fee(tr.spot[tr.t0], tr.entry[i]) for i in live)
    credit = sum(tr.entry[i] * X.Q for i in live)
    t_exit = None if out is None else tr.settle - dt.timedelta(hours=out)
    realised, t, floor = -fee_in, tr.t0 + X.BAR, None
    while t <= tr.last_b and live:
        sp = tr.spot.get(t, tr.settle_spot)
        px = {i: tr.series[i].get(t) for i in live}
        for i in list(live):
            if px[i] is None:
                continue
            if px[i] >= MULT * tr.entry[i] or (mark is not None and px[i] <= mark) or (share is not None and px[i] <= share * tr.entry[i]):
                realised += -(px[i] - tr.entry[i]) * X.Q - X.fee(sp, px[i])
                live.remove(i)
        if live and all(px[i] is not None for i in live):
            rest = sum(-(px[i] - tr.entry[i]) * X.Q for i in live)
            total = (realised + fee_in + rest) / credit
            if lock is not None and total >= lock[0]:
                floor = lock[1]
            if (t_exit is not None and t >= t_exit) or (take is not None and total >= take) or (floor is not None and total <= floor):
                return realised + rest - sum(X.fee(sp, px[i]) for i in live)
        t += X.BAR
    return realised + sum(tr.settle_leg(i) for i in live)


def st(rows):
    vals = [v for _, v in rows]
    n = len(vals)
    mid = sorted(e for e, _ in rows)[n // 2]
    return f"n={n:3d} mean={sum(vals) / n:+8.2f} pos={100 * sum(1 for v in vals if v > 0) / n:3.0f}% worst={min(vals):+8.1f} worst three={sum(sorted(vals)[:3]):+8.1f} total={sum(vals):+7.0f}  halves {sum(v for e, v in rows if e < mid):+.0f} / {sum(v for e, v in rows if e >= mid):+.0f}"


count = 0


def line(text, **kw):
    global count
    count += 1
    print(f"   {text:62s} {st([(e, run(tr, **kw)) for e, tr in X.trades])}")


bb, sh = f"buy-back at {MARK:g}", f"buy-back at {100 * SHARE:g} % of entry"
print(f"## {LABEL}: {len(X.trades)} trades, each side {X.PCT * 100:g} % away, entered {X.ENTRY:g} h before settlement, stop {MULT}x on each sold option in every row")
line("the stop only, held to settlement")
if CYCLE == "daily":
    one = sum(1 for _, tr in X.trades if len(sides(tr)) == 1)
    none = sum(1 for _, tr in X.trades if spot_all.get(tr.t0 - dt.timedelta(hours=MOVE_H)) is None)
    print(f"   (one side sold on {one} of {len(X.trades)} days; {none} days without the 24 h history sell both)")
    print("   the parts alone")
    line("one side after a move", one_side=True)
    line(bb, mark=MARK)
    line(sh, share=SHARE)
    line("profit lock 50 > 25", lock=LOCK)
    line(f"out {OUT_H} h before settlement", out=OUT_H)
    print("   1. one side after a move + the buy-back")
    line(f"one side + {bb}", one_side=True, mark=MARK)
    line(f"one side + {sh}", one_side=True, share=SHARE)
    print("   2. profit lock + the buy-back")
    line(f"lock 50 > 25 + {bb}", lock=LOCK, mark=MARK)
    line(f"lock 50 > 25 + {sh}", lock=LOCK, share=SHARE)
    print("   3. out early + one side after a move")
    line(f"out {OUT_H} h before + one side", out=OUT_H, one_side=True)
else:
    print("   the parts alone")
    line("close everything at 90 % of the premium", take=TAKE)
    line(bb, mark=MARK)
    line(sh, share=SHARE)
    print("   4. close at 90 % + the buy-back")
    line(f"close at 90 % + {bb}", take=TAKE, mark=MARK)
    line(f"close at 90 % + {sh}", take=TAKE, share=SHARE)
print(f"   rows in this set: {count}\n")
