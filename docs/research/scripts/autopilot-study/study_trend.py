"""Trend filter on the sold strangle (strategy lab backlog 10): is one side safer after the price has moved?
Each expiry: the put and the call of the evening strangle are judged separately (stop at a multiple on each, held to
settlement, so the strangle is exactly the sum of its two sides), and grouped by how far the spot moved over the hours
before the entry. The spot history is stitched from the neighbouring expiry folders. Same fees and fills as
study_exits.py (imported; run without -I from this folder).

Usage: python study_trend.py <cache_dir> <lot_size> <bar_minutes> <entry_hours_before> <percent_away> "" "" <label> <stop multiple>"""
import os, sys, datetime as dt
import study_exits as X

LABEL, MULT = sys.argv[8], int(sys.argv[9])
LOOKS = (4, 12, 24, 72)          # hours of spot history before the entry
THRESH = (0.5, 1.0, 2.0)         # per cent: a move beyond this is "up" or "down"

spot_all = {}
for e in sorted(os.listdir(X.CACHE)):
    if os.path.isdir(os.path.join(X.CACHE, e)):
        spot_all.update(X.load(e)[0])

rows = []  # (expiry, entry time, put result, call result)
for exp, tr in X.trades:
    side = {}
    for i, (kind, k) in enumerate(tr.legs):
        one = X.Trade.__new__(X.Trade)
        one.__dict__.update(tr.__dict__)
        one.legs, one.series, one.entry = [tr.legs[i]], [tr.series[i]], [tr.entry[i]]
        one.fee_in, one.credit = X.fee(tr.spot[tr.t0], tr.entry[i]), tr.entry[i] * X.Q
        side[kind] = one.run(mult=MULT)
    rows.append((exp, tr.t0, side["P"], side["C"]))


def st(vals):
    if not vals:
        return f"{'n=  0':40s}"
    return f"n={len(vals):3d} mean={sum(vals) / len(vals):+7.2f} pos={100 * sum(1 for v in vals if v > 0) / len(vals):3.0f}% worst={min(vals):+7.1f}"


def halves(pairs):
    mid = sorted(e for e, _ in rows_e)[len(rows_e) // 2]
    return f"{sum(v for e, v in pairs if e < mid):+.0f} / {sum(v for e, v in pairs if e >= mid):+.0f}"


rows_e = [(e, 0) for e, *_ in rows]
print(f"## {LABEL}: {len(rows)} expiries, each side {X.PCT * 100:g} % away, entered {X.ENTRY:g} h before settlement, stop {MULT}x on each side, held to settlement")
print(f"   both sides, every day:        {st([p + c for _, _, p, c in rows])}  halves {halves([(e, p + c) for e, _, p, c in rows])}")
print(f"   put side alone, every day:    {st([p for _, _, p, c in rows])}")
print(f"   call side alone, every day:   {st([c for _, _, p, c in rows])}")
for look in LOOKS:
    for th in THRESH:
        g = {"up": [], "down": [], "flat": [], "none": []}
        for e, t0, p, c in rows:
            past = spot_all.get(t0 - dt.timedelta(hours=look))
            if past is None:
                g["none"].append((e, p, c))
                continue
            r = 100 * (spot_all[t0] / past - 1)
            g["up" if r > th else "down" if r < -th else "flat"].append((e, p, c))
        print(f"\n   spot move over the {look} h before the entry, beyond {th:g} %  (no history: {len(g['none'])})")
        for name in ("up", "flat", "down"):
            print(f"      after {name:4s}  put  {st([p for _, p, c in g[name]])}   call {st([c for _, p, c in g[name]])}")
        known = g["up"] + g["flat"] + g["down"]
        both = [(e, p + c) for e, p, c in known]
        with_t = [(e, p) for e, p, c in g["up"]] + [(e, c) for e, p, c in g["down"]] + [(e, p + c) for e, p, c in g["flat"]]
        against = [(e, c) for e, p, c in g["up"]] + [(e, p) for e, p, c in g["down"]] + [(e, p + c) for e, p, c in g["flat"]]
        skip = [(e, 0.0) for e, p, c in g["up"] + g["down"]] + [(e, p + c) for e, p, c in g["flat"]]
        for name, pairs in (("both sides always", both), ("only the side behind the move (up: put, down: call)", with_t), ("only the side ahead of the move (up: call, down: put)", against), ("trade only after a flat spell", skip)):
            print(f"      {name:52s} {st([v for _, v in pairs])} total={sum(v for _, v in pairs):+6.0f}  halves {halves(pairs)}")
print()
