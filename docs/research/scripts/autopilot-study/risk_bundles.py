"""Risk-profile bundles from results-risk-*.txt (strategy lab backlog 14). A bundle is a RULE, not a list:
  which exits qualify (share of positive trades, longest losing run, both halves positive, a stop on every sold option)
  and how much capital stands behind one unit of 100 lots a leg (the worst trade and the deepest drawdown of the
  backtest may each cost at most a set share of it). Among the qualifying exits the one with the most profit per unit
  of that capital is taken. Capital here is risk capital by this rule; the exchange's margin is NOT modelled.

Usage: python -I risk_bundles.py results-risk-2026-11-22.txt"""
import re, sys

BUNDLES = [  # name, min share positive, longest losing run allowed, worst trade cap, drawdown cap (shares of capital)
    ("Cautious", 70, 3, 0.01, 0.03),
    ("Balanced", 60, 5, 0.02, 0.06),
    ("Bold", 0, 99, 0.04, 0.12),
]
rx = re.compile(r"^   (.+?)\s+([+-][\d.]+)\s+(\d+)%\s+([+-][\d.]+)\s+(\d+)\s+([+-][\d.]+)\s+([+-][\d.]+)\s+([+-]\d+)\s+([+-]\d+) / ([+-]\d+)")
sets, cur = {}, None
for ln in open(sys.argv[1]):
    if ln.startswith("## "):
        cur = ln[3:].split(":")[0]
        sets[cur] = {"n": int(re.search(r": (\d+) trades", ln).group(1)), "rows": []}
    m = rx.match(ln)
    if m:
        g = m.groups()
        sets[cur]["rows"].append(dict(name=g[0], mean=float(g[1]), pos=int(g[2]), worst=-float(g[3]), run=int(g[4]), dd=-float(g[6]), total=float(g[7]), h1=float(g[8]), h2=float(g[9])))
for name, pos, run, a, b in BUNDLES:
    print(f"== {name}: at least {pos} % of trades positive, no losing run longer than {run}, both halves positive, a stop on every sold option;")
    print(f"   capital per unit so that the worst trade is at most {a * 100:g} % and the deepest drawdown at most {b * 100:g} % of it")
    for sname, s in sets.items():
        ok = [r for r in s["rows"] if r["name"] != "hold to settlement" and r["pos"] >= pos and r["run"] <= run and r["h1"] > 0 and r["h2"] > 0]
        if not ok:
            print(f"   {sname:20s} nothing qualifies")
            continue
        for r in ok:
            r["cap"] = max(r["worst"] / a, r["dd"] / b)
        ok.sort(key=lambda r: -r["total"] / r["cap"])
        r = ok[0]
        others = ", ".join(f"{o['name']} ({100 * o['total'] / o['cap']:.1f} %)" for o in ok[1:3])
        print(f"   {sname:20s} {r['name']:34s} capital/unit {r['cap']:7.0f}  return over the period {100 * r['total'] / r['cap']:5.1f} % in {s['n']} trades  (mean {r['mean']:+.2f}, {r['pos']} %, worst -{r['worst']:.1f}, run {r['run']}, drawdown -{r['dd']:.1f}; {len(ok)} qualify; next: {others})")
    print()
