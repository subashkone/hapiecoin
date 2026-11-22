"""Scheduled US events and the evening strangle (strategy lab backlog 9, the announcement half). events-2026.csv holds
the dates (official pages). For each event: which daily trade, if any, was OPEN at the release (entered at or before
it, settling after it), the trade that settled just before it and the trade entered just after it, with their results
against all other days. Same trades as study_exits.py (imported; run without -I from this folder).

Usage: python study_events.py <cache_dir> <lot_size> <bar_minutes> <entry_hours_before> <percent_away> "" "" <label>"""
import csv, os, sys, datetime as dt
import study_exits as X

LABEL = sys.argv[8]
events = []
for r in csv.DictReader(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "events-2026.csv"))):
    h, m = map(int, r["time_utc"].split(":"))
    y, mo, d = map(int, r["date"].split("-"))
    events.append((dt.datetime(y, mo, d, h, m, tzinfo=X.U), r["event"]))
res = {e: (tr, tr.run(mult=3), tr.run(mult=3, take=0.5)) for e, tr in X.trades}
tag = {}
print(f"## {LABEL}: {len(res)} expiries, {X.PCT * 100:g} % away, entered {X.ENTRY:g} h before the {X.SETTLE_H}:00 UTC settlement; results: stop 3x / stop 3x with take half")
for when, name in events:
    line = f"   {when:%Y-%m-%d %H:%M} UTC {name:5s}"
    for e, (tr, a, b) in sorted(res.items()):
        if tr.t0 <= when < tr.settle:
            tag[e] = "open at the release"
            line += f" | OPEN at the release: expiry {e} {a:+7.1f} / {b:+7.1f}"
        elif dt.timedelta(0) <= when - tr.settle < dt.timedelta(hours=6):
            tag.setdefault(e, "settled just before")
            line += f" | settled before it: expiry {e} {a:+7.1f} / {b:+7.1f}"
        elif dt.timedelta(0) < tr.t0 - when <= dt.timedelta(hours=8):
            tag.setdefault(e, "entered just after")
            line += f" | entered after it: expiry {e} {a:+7.1f} / {b:+7.1f}"
    print(line)
print()
for group in ("open at the release", "settled just before", "entered just after", None):
    vals = [a for e, (tr, a, b) in res.items() if tag.get(e) == group]
    if vals:
        print(f"   {group or 'all other days':22s} n={len(vals):3d} mean={sum(vals) / len(vals):+7.2f} pos={100 * sum(1 for v in vals if v > 0) / len(vals):3.0f}% worst={min(vals):+7.1f}   (stop 3x)")
print()
