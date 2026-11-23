"""After a sold option has been bought back cheap (the owner's note of 23 Nov 2026): (a) "enter again this time as a
buy": buy the same option at that price, 100 lots, and hold it to settlement or sell it at a multiple of what was
paid, always or only while the spot is still near its strike; (b) "add any other strategy": sell a new option on the
same side nearer the spot (rolling the side that won), with the same stop, once. The other sold option keeps its stop
in every row. Same trades, fees and fills as study_exits.py (imported; run without -I from this folder).

Usage: python study_reenter.py <cache_dir> <lot_size> <bar_minutes> <entry_hours_before> <percent_away> "" "" <label> <stop multiple> <buy-back mark>"""
import sys, datetime as dt
import study_exits as X

LABEL, MULT, MARK = sys.argv[8], int(sys.argv[9]), float(sys.argv[10])
books = {}


def opts_of(exp):
    if exp not in books:
        books[exp] = X.load(exp)[1]
    return books[exp]


def run(exp, tr, buyback=True, flip=None, near=None, roll=None, min_hours=2.0):
    """flip: None, "hold" or a multiple of the price paid at which the bought option is sold. near: flip only while
    the spot is within this share of the strike. roll: sell a new same-side option this share of the spot away.
    Returns (result, result of the bought options alone, number bought, result of the rolled options alone, number rolled)."""
    pos = [dict(kind=k[0], k=k[1], series=tr.series[i], entry=tr.entry[i], sign=-1, rolled=False) for i, k in enumerate(tr.legs)]
    realised, t, long_pl, n_long, roll_pl, n_roll = -tr.fee_in, tr.t0 + X.BAR, 0.0, 0, 0.0, 0
    while t <= tr.last_b and pos:
        sp = tr.spot.get(t, tr.settle_spot)
        for p in list(pos):
            px = p["series"].get(t)
            if px is None:
                continue
            if p["sign"] < 0:
                stop, cheap = px >= MULT * p["entry"], buyback and px <= MARK
                if not (stop or cheap):
                    continue
                pl = -(px - p["entry"]) * X.Q - X.fee(sp, px)
                realised += pl
                if p["rolled"]:
                    roll_pl += pl
                pos.remove(p)
                if not cheap or p["rolled"]:
                    continue
                if flip is not None and (near is None or abs(p["k"] - sp) <= near * sp):
                    f = X.fee(sp, px)
                    realised -= f
                    long_pl -= f
                    n_long += 1
                    pos.append(dict(kind=p["kind"], k=p["k"], series=p["series"], entry=px, sign=1, rolled=False))
                if roll is not None and (tr.settle - t) >= dt.timedelta(hours=min_hours):
                    book, best = opts_of(exp), None
                    for (kd, k), s in book.items():
                        if kd != p["kind"] or t not in s or (k <= sp if kd == "C" else k >= sp) or s[t] <= 2 * MARK:
                            continue
                        score = abs(k - sp * (1 + roll if kd == "C" else 1 - roll))
                        if best is None or score < best[0]:
                            best = (score, k, s)
                    if best is not None and best[1] != p["k"]:
                        f = X.fee(sp, best[2][t])
                        realised -= f
                        roll_pl -= f
                        n_roll += 1
                        pos.append(dict(kind=p["kind"], k=best[1], series=best[2], entry=best[2][t], sign=-1, rolled=True))
            elif flip != "hold" and px >= flip * p["entry"]:
                pl = (px - p["entry"]) * X.Q - X.fee(sp, px)
                realised += pl
                long_pl += pl
                pos.remove(p)
        t += X.BAR
    for p in pos:
        v = X.intrinsic(p["kind"], p["k"], tr.settle_spot)
        pl = p["sign"] * (v - p["entry"]) * X.Q - X.fee(tr.settle_spot, v)
        realised += pl
        if p["sign"] > 0:
            long_pl += pl
        elif p["rolled"]:
            roll_pl += pl
    return realised, long_pl, n_long, roll_pl, n_roll


def line(name, **kw):
    rows = [(e, *run(e, tr, **kw)) for e, tr in sorted(X.trades, key=lambda x: x[0])]
    vals = [r[1] for r in rows]
    n = len(vals)
    mid = sorted(r[0] for r in rows)[n // 2]
    h = f"{sum(r[1] for r in rows if r[0] < mid):+.0f} / {sum(r[1] for r in rows if r[0] >= mid):+.0f}"
    extra = ""
    if sum(r[3] for r in rows):
        extra = f"   bought {sum(r[3] for r in rows):3d} options, their own result {sum(r[2] for r in rows):+8.2f}"
    if sum(r[5] for r in rows):
        extra = f"   rolled {sum(r[5] for r in rows):3d} options, their own result {sum(r[4] for r in rows):+8.2f}"
    print(f"   {name:64s} {n:4d} {sum(vals) / n:+8.2f} {100 * sum(1 for v in vals if v > 0) / n:4.0f}% {sum(vals):+8.0f} {min(vals):+8.1f} {sum(sorted(vals)[:3]):+9.1f} {h:>14s}{extra}")


print(f"## {LABEL}: {len(X.trades)} trades, each side {X.PCT * 100:g} % away, entered {X.ENTRY:g} h before settlement, stop {MULT}x on each sold option in every row; buy-back at a mark of {MARK:g}")
print(f"   {'':64s} {'n':>4s} {'mean':>8s} {'win':>5s} {'total':>8s} {'worst':>8s} {'worst 3':>9s} {'halves':>14s}")
line("the stop only, held to settlement", buyback=False)
line(f"buy a sold option back at {MARK:g}")
print("   (a) after the buy-back, buy the same option, 100 lots")
line("buy it, hold to settlement", flip="hold")
for m in (5, 10, 20):
    line(f"buy it, sell at {m} times the price paid", flip=m)
line("buy it only while the spot is within 1 % of the strike, hold", flip="hold", near=0.01)
line("buy it only within 1 % of the strike, sell at 10 times", flip=10, near=0.01)
line("buy it only within 0.5 % of the strike, hold", flip="hold", near=0.005)
print("   (b) after the buy-back, sell a new option on the same side nearer the spot (once, the same stop)")
line("new option 1 % from the spot, 2 h or more left", roll=0.01)
line("new option 1 % from the spot, 6 h or more left", roll=0.01, min_hours=6)
line("new option 0.5 % from the spot, 2 h or more left", roll=0.005)
line("new option 0.5 % from the spot, 6 h or more left", roll=0.005, min_hours=6)
print()
