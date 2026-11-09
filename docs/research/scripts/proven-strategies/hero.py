"""Part B: hero-or-zero on BTC daily options. Buy (and separately sell) 100 lots (0.1 BTC) of the call and the put nearest
1 / 2 / 3 % out of the money at 02:00, 06:00, 09:00 UTC on expiry day; hold to settlement = intrinsic at the last 5-minute
mark before 12:00 UTC. Fees: taker 0.01 % of notional per fill capped at 3.5 % of premium, plus 18 % GST; taker fee again
on the open leg at settlement (zero when it settles worthless, because the cap is on a zero premium).
Usage: python -I hero.py <options_cache_dir>"""
import json, os, sys, datetime as dt, statistics as st
from collections import defaultdict
CACHE=sys.argv[1]; U=dt.timezone.utc; STEP=200; LOT=0.001; LOTS=100; Q=LOT*LOTS
FEE_RATE,FEE_CAP,GST=0.0001,0.035,0.18
ENTRY=[2,6,9]; MONEY=[0.01,0.02,0.03]
def fee(spot,price,qty): return min(FEE_RATE*spot*qty, FEE_CAP*price*qty)*(1+GST)
res=defaultdict(list); moves=defaultdict(list); missing=defaultdict(int); days=0
for exp in sorted(os.listdir(CACHE)):
    d=os.path.join(CACHE,exp)
    if not os.path.isdir(d): continue
    spot={r["time"]:float(r["close"]) for r in json.load(open(os.path.join(d,"MARK_BTCUSD.json")))}
    y,m,dd=map(int,exp.split("-")); settle=int(dt.datetime(y,m,dd,12,tzinfo=U).timestamp()); last=settle-300
    if last not in spot: print(exp,"no settlement mark"); continue
    days+=1; ss=spot[last]
    for h in ENTRY:
        t0=int(dt.datetime(y,m,dd,h,tzinfo=U).timestamp())
        if t0 not in spot: missing[(h,"spot")]+=1; continue
        s0=spot[t0]; atm=int(round(s0/STEP)*STEP); moves[h].append(ss/s0-1)
        for mny in MONEY:
            off=int(round(s0*mny/STEP)*STEP)
            for kind,k in (("C",atm+off),("P",atm-off)):
                p=os.path.join(d,f"MARK_{kind}-BTC-{k}-{dd:02d}{m:02d}{y%100:02d}.json")
                rows=json.load(open(p)) if os.path.exists(p) else []
                ser={r["time"]:float(r["close"]) for r in rows}
                if t0 not in ser: missing[(h,mny,kind)]+=1; continue
                px=ser[t0]; intr=max(0.0, ss-k) if kind=="C" else max(0.0, k-ss)
                prem=px*Q; fin=fee(s0,px,Q); fs=fee(ss,intr,Q)
                gross=(intr-px)*Q
                res[(h,mny,kind)].append(dict(exp=exp,s0=s0,k=k,px=px,prem=prem,prem_pct=100*px/s0,itm=intr>0,buyer=gross-fin-fs,seller=-gross-fin-fs,fees=fin+fs,mult=(gross-fin-fs)/prem if prem>0 else float('nan')))
print(f"expiries with a settlement mark: {days}; missing entries (hour, moneyness, kind): {dict(missing) if missing else 'none'}")
print("\n### Realised move from entry to settlement (last mark before 12:00 UTC)")
print("| Entry UTC (IST) | n | mean abs move | median abs move | >1 % | >2 % | >3 % | up >1 % | down >1 % | biggest up | biggest down |"); print("|"+"---|"*11)
for h in ENTRY:
    mv=moves[h]; n=len(mv); a=[abs(x) for x in mv]
    print(f"| {h:02d}:00 ({(h+5)%24:02d}:30) | {n} | {100*st.mean(a):.2f}% | {100*st.median(a):.2f}% | {100*sum(x>0.01 for x in a)/n:.0f}% | {100*sum(x>0.02 for x in a)/n:.0f}% | {100*sum(x>0.03 for x in a)/n:.0f}% | {100*sum(x>0.01 for x in mv)/n:.0f}% | {100*sum(x<-0.01 for x in mv)/n:.0f}% | {100*max(mv):+.2f}% | {100*min(mv):+.2f}% |")
print("\n### Buyer, 100 lots (0.1 BTC), net of fees, hold to settlement")
print("| Entry UTC | OTM | Kind | n | avg premium $ | premium % spot | avg fees $ | hit rate | mean P&L $ | median P&L $ | mean multiple of premium | best day $ | worst day $ | total $ | share of days > 0 |"); print("|"+"---|"*15)
tot=defaultdict(float)
for h in ENTRY:
    for mny in MONEY:
        for kind in "CP":
            v=res[(h,mny,kind)]; n=len(v)
            if not n: continue
            b=[x["buyer"] for x in v]
            print(f"| {h:02d}:00 | {int(mny*100)} % | {kind} | {n} | {st.mean(x['prem'] for x in v):.2f} | {st.mean(x['prem_pct'] for x in v):.3f}% | {st.mean(x['fees'] for x in v):.2f} | {100*sum(x['itm'] for x in v)/n:.0f}% | {st.mean(b):+.2f} | {st.median(b):+.2f} | {st.mean(x['mult'] for x in v):+.2f}x | {max(b):+.0f} | {min(b):+.0f} | {sum(b):+.0f} | {100*sum(x>0 for x in b)/n:.0f}% |")
            tot[("buyer",h)]+=sum(b); tot[("buyer","all")]+=sum(b)
print("\n### Seller (mirror), 100 lots, net of fees, hold to settlement (margin not modelled)")
print("| Entry UTC | OTM | Kind | n | avg credit $ | win rate (expired worthless) | mean P&L $ | median P&L $ | best day $ | worst day $ | total $ | max drawdown of running total $ | worst day / avg credit |"); print("|"+"---|"*13)
for h in ENTRY:
    for mny in MONEY:
        for kind in "CP":
            v=res[(h,mny,kind)]; n=len(v)
            if not n: continue
            s=[x["seller"] for x in v]; cum=peak=0.0; mdd=0.0
            for x in s: cum+=x; peak=max(peak,cum); mdd=min(mdd,cum-peak)
            cr=st.mean(x['prem'] for x in v)
            print(f"| {h:02d}:00 | {int(mny*100)} % | {kind} | {n} | {cr:.2f} | {100*sum(not x['itm'] for x in v)/n:.0f}% | {st.mean(s):+.2f} | {st.median(s):+.2f} | {max(s):+.0f} | {min(s):+.0f} | {sum(s):+.0f} | {mdd:.0f} | {min(s)/cr:.1f}x |")
            tot[("seller",h)]+=sum(s); tot[("seller","all")]+=sum(s)
print("\n### Totals across all 18 option cells (3 moneyness x 2 kinds), $")
for side in ("buyer","seller"):
    print(f"- {side}: " + ", ".join(f"{h:02d}:00 UTC {tot[(side,h)]:+.0f}" for h in ENTRY) + f"; all {tot[(side,'all')]:+.0f}")
# by month for the pooled buyer and seller
print("\n### By month, pooled over all cells (mean net P&L per option position, $)")
bym=defaultdict(list)
for key,v in res.items():
    for x in v: bym[x["exp"][:7]].append(x)
print("| Month | positions | buyer mean | buyer total | seller mean | seller total | buyer hit rate |"); print("|"+"---|"*7)
for mth in sorted(bym):
    v=bym[mth]; print(f"| {mth} | {len(v)} | {st.mean(x['buyer'] for x in v):+.2f} | {sum(x['buyer'] for x in v):+.0f} | {st.mean(x['seller'] for x in v):+.2f} | {sum(x['seller'] for x in v):+.0f} | {100*sum(x['itm'] for x in v)/len(v):.0f}% |")
# biggest payoffs for the buyer
allb=sorted((x for v in res.values() for x in v),key=lambda x:-x["buyer"])[:5]
print("\nTop 5 buyer days: "+"; ".join(f"{x['exp']} {x['k']}{'C' if x['k']>x['s0'] else 'P'} prem {x['prem']:.2f} -> net {x['buyer']:+.0f} ({x['mult']:+.1f}x)" for x in allb))
json.dump({f"{k[0]}_{k[1]}_{k[2]}":v for k,v in res.items()},open(os.path.join(CACHE,"..","hero-result.json"),"w"))
