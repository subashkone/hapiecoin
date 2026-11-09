"""Robustness: Part B totals with the single best buyer day removed; one worked example. Usage: python -I hero_check.py <hero-result.json>"""
import json, sys, statistics as st
R=json.load(open(sys.argv[1]))
allx=[x for v in R.values() for x in v]
days=sorted({x["exp"] for x in allx})
best_day=max(days,key=lambda d:sum(x["buyer"] for x in allx if x["exp"]==d))
print("best buyer day:",best_day,"buyer total that day %+.0f over %d positions"%(sum(x["buyer"] for x in allx if x["exp"]==best_day),sum(1 for x in allx if x["exp"]==best_day)))
for lab,sel in (("all",allx),("excluding "+best_day,[x for x in allx if x["exp"]!=best_day])):
    calls=[x for x in sel if x["k"]>x["s0"]]; puts=[x for x in sel if x["k"]<x["s0"]]
    print(f"{lab}: positions {len(sel)}; buyer total {sum(x['buyer'] for x in sel):+.0f} (calls {sum(x['buyer'] for x in calls):+.0f}, puts {sum(x['buyer'] for x in puts):+.0f}); seller total {sum(x['seller'] for x in sel):+.0f}; buyer mean per position {st.mean(x['buyer'] for x in sel):+.2f}; premium paid total {sum(x['prem'] for x in sel):.0f}; buyer hit rate {100*sum(x['itm'] for x in sel)/len(sel):.1f}%")
# days where the buyer made money across 1% calls at 02:00
v=R["2_0.01_C"]; wins=[x for x in v if x["buyer"]>0]
print("02:00 1% call buyer winning days:",[(x["exp"],round(x["buyer"])) for x in wins])
v=R["2_0.01_P"]; wins=[x for x in v if x["buyer"]>0]
print("02:00 1% put buyer winning days:",[(x["exp"],round(x["buyer"])) for x in wins])
# worked example
x=next(x for x in R["2_0.01_C"] if x["exp"]==best_day)
print("worked example 02:00 UTC 1% call on",best_day,":",{k:(round(v,4) if isinstance(v,float) else v) for k,v in x.items()})
# seller worst days overall
w=sorted(allx,key=lambda x:x["seller"])[:3]
print("seller worst 3 positions:",[(x["exp"],x["k"],"C" if x["k"]>x["s0"] else "P",round(x["prem"],2),round(x["seller"])) for x in w])
