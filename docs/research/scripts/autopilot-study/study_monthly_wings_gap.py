"""Why the monthly strangle sold 12 % away WITH WINGS reads so differently held and with a stop at triple (asked by
the build thread at the owner's word, 28 Nov 2026: -105.1 a trade held against +209.1 stopped on the BTC cards).

The trades of study_monthly.py (imported with its printing silenced; run without -I from this folder): the monthly
expiry, entered on every day 30 to 44 days before at the bar closing 16:00 UTC, a put and a call sold 12 % of the spot
away on the listed strikes, wings half as far again. Both rows come from the SAME entries and strikes: one call of
trade() gives every exit.

Here each entry is run again with its parts kept apart:
  held     every leg to settlement.
  stop 3x  a sold option is bought back at the mark of the first hourly bar at or above three times its sale price;
           its wing, and everything else, stays to settlement (the wing is KEPT).
For the stopped row: what the sold options made (stops and settlement), what the wings made, and the trade's
four-leg largest loss ("cap": the wider of the two widths times the quantity, less the net premium, plus the entry
fees), with the count of entries whose loss was larger than their own cap.

By expiry: the entries, the mean held, the mean stopped, the entries on which a stop fired, the mean of the sold
options and of the wings in the stopped row, the spot's change from the mean entry to the settlement, and the
largest move against a sold strike.

Usage: python study_monthly_wings_gap.py <monthly cache_dir> <lot_size>"""
import sys, io, contextlib, datetime as dt
from collections import defaultdict

sys.argv = [sys.argv[0], sys.argv[1], sys.argv[2], "1000"]
with contextlib.redirect_stdout(io.StringIO()):
    import study_monthly as M

Q, H = M.Q, M.H
PCT, LO, HI, MULT = 0.12, 30, 44, 3
rows = []
for exp in M.exps:
    spot, opts = M.load(exp)
    y, m, d = map(int, exp.split("-"))
    settle = dt.datetime(y, m, d, M.SETTLE_H, tzinfo=M.U)
    last_b = settle - H
    if last_b not in spot:
        continue
    ss = spot[last_b]
    for days in range(HI, LO - 1, -1):
        t0 = settle.replace(hour=15) - dt.timedelta(days=days)
        if t0 not in spot:
            continue
        s0 = spot[t0]
        pk, ck = M.pick(opts, t0, s0, "P", pct=PCT), M.pick(opts, t0, s0, "C", pct=PCT)
        if pk is None or ck is None:
            continue
        wp, wc = M.pick(opts, t0, s0, "P", pct=1.5 * (s0 - pk) / s0), M.pick(opts, t0, s0, "C", pct=1.5 * (ck - s0) / s0)
        if wp is None or wc is None or wp >= pk or wc <= ck:
            continue
        legs = [("P", pk, -1), ("C", ck, -1), ("P", wp, 1), ("C", wc, 1)]
        entry = [opts[(k, s)][t0] for k, s, _ in legs]
        credit = sum(-sg * e * Q for (_, _, sg), e in zip(legs, entry))
        if credit <= 0:
            continue
        fee_in = sum(M.fee(s0, e) for e in entry)
        cap = max(pk - wp, wc - ck) * Q - credit + fee_in
        settle_leg = lambda i: legs[i][2] * (M.intrinsic(legs[i][0], legs[i][1], ss) - entry[i]) * Q - M.fee(ss, M.intrinsic(legs[i][0], legs[i][1], ss))
        held = sum(settle_leg(i) for i in range(4)) - fee_in
        sold = wings = 0.0
        stops, live, t = 0, [0, 1], t0 + H
        while t <= last_b and live:
            for i in list(live):
                px = opts[legs[i][:2]].get(t)
                if px is not None and px >= MULT * entry[i]:
                    sold += -(px - entry[i]) * Q - M.fee(spot.get(t, ss), px)
                    live.remove(i)
                    stops += 1
            t += H
        sold += sum(settle_leg(i) for i in live)
        wings = settle_leg(2) + settle_leg(3)
        stopped = sold + wings - fee_in
        check = M.trade(spot, opts, t0, last_b, ss, legs)
        assert abs(check["hold"] - held) < 1e-6 and abs(check["stop3x"] - stopped) < 1e-6, (exp, days)
        path = [spot[x] for x in sorted(spot) if t0 <= x <= last_b]
        through = max(max(path) / ck - 1, 1 - min(path) / pk)
        rows.append(dict(exp=exp, held=held, stopped=stopped, stops=stops, sold=sold, wings=wings, fee_in=fee_in, cap=cap, s0=s0, ss=ss, through=through, credit=credit))

n = len(rows)
mean = lambda k, rs=rows: sum(r[k] for r in rs) / len(rs)
print(f"## {sys.argv[1].replace(chr(92), '/').rstrip('/').split('/')[-1]}: sold {PCT * 100:g} % away with wings half as far again, entered {LO} to {HI} days before; {n} entries on {len({r['exp'] for r in rows})} expiries; the same entries and strikes for both rows")
print(f"   held to settlement        mean {mean('held'):+8.1f}  win {100 * sum(1 for r in rows if r['held'] > 0) / n:3.0f}%  worst {min(r['held'] for r in rows):+8.1f}")
print(f"   stop {MULT}x, wing kept        mean {mean('stopped'):+8.1f}  win {100 * sum(1 for r in rows if r['stopped'] > 0) / n:3.0f}%  worst {min(r['stopped'] for r in rows):+8.1f}")
print(f"      of which: sold options {mean('sold'):+8.1f}, wings {mean('wings'):+8.1f}, entry fees {-mean('fee_in'):+6.1f}; mean net premium {mean('credit'):.1f}")
fired = [r for r in rows if r["stops"]]
quiet = [r for r in rows if not r["stops"]]
print(f"   entries with a stop: {len(fired)} of {n} (both sides stopped on {sum(1 for r in rows if r['stops'] == 2)})")
if fired:
    print(f"      on those: held {mean('held', fired):+8.1f}, stopped {mean('stopped', fired):+8.1f} (sold options {mean('sold', fired):+8.1f}, wings {mean('wings', fired):+8.1f})")
if quiet:
    print(f"      on the others: held {mean('held', quiet):+8.1f}, stopped {mean('stopped', quiet):+8.1f}")
over = [r for r in rows if -r["stopped"] > r["cap"]]
over_h = [r for r in rows if -r["held"] > r["cap"] + 1e-6]
print(f"   cap (four-leg largest loss): mean {mean('cap'):.1f}, largest {max(r['cap'] for r in rows):.1f}; entries losing more than their own cap: stopped {len(over)} of {n}, held {len(over_h)} of {n}")
print(f"      largest excess over the cap: held {max(-r['held'] - r['cap'] for r in rows):+.1f} (the settlement fees, which the cap leaves out), stopped {max(-r['stopped'] - r['cap'] for r in rows):+.1f}")
if over:
    w = max(over, key=lambda r: -r["stopped"] - r["cap"])
    print(f"      largest excess, stopped: expiry {w['exp']} lost {-w['stopped']:.1f} against its cap {w['cap']:.1f}; by expiry: {dict(sorted((e, sum(1 for r in over if r['exp'] == e)) for e in {r['exp'] for r in over}))}")
print(f"   {'expiry':10s} {'n':>3s} {'held':>8s} {'stopped':>8s} {'stops on':>8s} {'sold':>8s} {'wings':>8s} {'spot chg':>8s} {'max thru':>8s}")
by = defaultdict(list)
for r in rows:
    by[r["exp"]].append(r)
for exp in sorted(by):
    rs = by[exp]
    print(f"   {exp:10s} {len(rs):3d} {mean('held', rs):+8.1f} {mean('stopped', rs):+8.1f} {sum(1 for r in rs if r['stops']):8d} {mean('sold', rs):+8.1f} {mean('wings', rs):+8.1f} "
          f"{100 * (rs[0]['ss'] / mean('s0', rs) - 1):+7.1f}% {100 * max(r['through'] for r in rs):+7.1f}%")
print()
