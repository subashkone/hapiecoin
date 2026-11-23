"""What to do with the OTHER sold option once the first stop has fired on a sold strangle (the owner, 23 Nov 2026,
relayed by the build thread: "once it reverses ... the losses keep on increasing"). Every variant is identical until
the first stop fires; from that bar the other option, which keeps its own stop at the multiple in every variant, is:
  hold        left alone;
  close both  closed at once, at the same bar close;
  at sale     closed if its mark returns to the price it was sold at;
  keep half   closed if its mark rises to the middle between its mark when the first stop fired and its sale price;
  trail g     closed when its profit falls back by g of its best since the first stop (the built "trail the rest").
View A is every trade; view B only the trades where a stop fired. "over" is how far past its level the average
protective exit filled, in USD per trade that used it (the bar-close slip). Same trades, fees and fills as
study_exits.py (imported; run without -I from this folder).

Usage: python study_after_stop.py <cache_dir> <lot_size> <bar_minutes> <entry_hours_before> <percent_away> "" "" <label> <stop multiple>"""
import sys
import study_exits as X

LABEL, MULT = sys.argv[8], int(sys.argv[9])
VARIANTS = [("hold: the other keeps only its own stop", ("hold",)), ("close both at the first stop", ("close",)), ("other closed back at its sale price", ("level", 1.0)),
            ("other closed at half its profit given back", ("level", 0.5)), ("trail the rest, give back 50 %", ("trail", 0.50)), ("trail the rest, give back 25 %", ("trail", 0.25)),
            ("trail the rest, give back 10 %", ("trail", 0.10))]


def run(tr, how):
    """Returns dict: result, fired (a first stop), other (P&L of the other option incl. its fees, None if both stopped
    together or none), early (the variant closed the other before settlement, not by its own stop), worthless (that
    other option settled at zero), over (USD the protective exit filled past its level)."""
    live, realised, t = list(range(len(tr.legs))), -tr.fee_in, tr.t0 + X.BAR
    first, other_pl, early, over, level, best = None, None, False, 0.0, None, None
    while t <= tr.last_b and live:
        sp = tr.spot.get(t, tr.settle_spot)
        px = {i: tr.series[i].get(t) for i in live}
        hit = [i for i in live if px[i] is not None and px[i] >= MULT * tr.entry[i]]
        for i in hit:
            pl = -(px[i] - tr.entry[i]) * X.Q - X.fee(sp, px[i])
            realised += pl
            live.remove(i)
            if first is not None and i != first:
                other_pl = pl
        if hit and first is None:
            first = hit[0]
            if live:
                j = live[0]
                if px[j] is None:
                    pass
                elif how[0] == "close":
                    other_pl = -(px[j] - tr.entry[j]) * X.Q - X.fee(sp, px[j])
                    realised += other_pl
                    live.remove(j)
                    early = True
                elif how[0] == "level":
                    level = tr.entry[j] - how[1] * max(0.0, tr.entry[j] - px[j])
                elif how[0] == "trail":
                    best = max(0.0, tr.entry[j] - px[j])
        elif first is not None and live:
            j = live[0]
            if px[j] is not None:
                close = False
                if level is not None and px[j] >= level:
                    close, past = True, px[j] - level
                if best is not None:
                    prof = tr.entry[j] - px[j]
                    best = max(best, prof)
                    if best > 0 and prof <= best * (1 - how[1]):
                        close, past = True, best * (1 - how[1]) - prof
                if close:
                    other_pl = -(px[j] - tr.entry[j]) * X.Q - X.fee(sp, px[j])
                    realised += other_pl
                    live.remove(j)
                    early, over = True, past * X.Q
        t += X.BAR
    for i in live:
        pl = tr.settle_leg(i)
        realised += pl
        if first is not None:
            other_pl = pl
    j = None if first is None or len(tr.legs) < 2 else 1 - first
    worthless = j is not None and X.intrinsic(tr.legs[j][0], tr.legs[j][1], tr.settle_spot) == 0
    return dict(result=realised, fired=first is not None, other=other_pl, early=early, worthless=worthless, over=over)


rows_all = {}
print(f"## {LABEL}: {len(X.trades)} trades, each side {X.PCT * 100:g} % away, entered {X.ENTRY:g} h before settlement, stop {MULT}x on each sold option; bars of {int(X.BAR.total_seconds() // 60)} minutes; mean premium {sum(tr.credit for _, tr in X.trades) / len(X.trades):.1f}")
print(f"   A. every trade {'':43s} {'n':>4s} {'mean':>8s} {'win':>5s} {'total':>8s} {'worst':>8s} {'worst 3':>9s} {'drawdown':>9s} {'halves':>14s}")
for name, how in VARIANTS:
    rows = [(e, run(tr, how)) for e, tr in sorted(X.trades, key=lambda x: x[0])]
    rows_all[name] = rows
    vals = [r["result"] for _, r in rows]
    n = len(vals)
    mid = sorted(e for e, _ in rows)[n // 2]
    cum = peak = dd = 0.0
    for v in vals:
        cum += v
        peak = max(peak, cum)
        dd = max(dd, peak - cum)
    h = f"{sum(r['result'] for e, r in rows if e < mid):+.0f} / {sum(r['result'] for e, r in rows if e >= mid):+.0f}"
    print(f"   {name:58s} {n:4d} {sum(vals) / n:+8.2f} {100 * sum(1 for v in vals if v > 0) / n:4.0f}% {sum(vals):+8.0f} {min(vals):+8.1f} {sum(sorted(vals)[:3]):+9.1f} {-dd:+9.1f} {h:>14s}")

print(f"\n   B. only the trades where a stop fired {'':20s} {'n':>4s} {'mean':>8s} {'worst':>8s}   other option: lost on / mean of those losses / worst   closed early / of those would have settled worthless   over")
for name, _ in VARIANTS:
    f = [r for _, r in rows_all[name] if r["fired"]]
    vals = [r["result"] for r in f]
    lost = [r["other"] for r in f if r["other"] is not None and r["other"] < 0]
    early = [r for r in f if r["early"]]
    used = [r["over"] for r in early if r["over"]]
    print(f"   {name:58s} {len(f):4d} {sum(vals) / len(vals):+8.2f} {min(vals):+8.1f}   {len(lost):3d} / {sum(lost) / len(lost) if lost else 0:+8.2f} / {min(lost) if lost else 0:+8.1f}   {len(early):3d} / {sum(1 for r in early if r['worthless']):3d}" + (f"   {sum(used) / len(used):6.2f}" if used else ""))

hold = [r for _, r in rows_all[VARIANTS[0][0]] if r["fired"] and r["other"] is not None]
rev = [r["other"] for r in hold if r["other"] < 0]
print(f"\n   The reversal, when simply held: a stop fired on {len([r for _, r in rows_all[VARIANTS[0][0]] if r['fired']])} trades; on {len(rev)} of them the other option then also ended at a loss (mean {sum(rev) / len(rev) if rev else 0:+.2f}, worst {min(rev) if rev else 0:+.1f}); on {sum(1 for r in hold if r['other'] > 0)} it ended at a profit (mean {sum(r['other'] for r in hold if r['other'] > 0) / max(1, sum(1 for r in hold if r['other'] > 0)):+.2f}).")
print()
