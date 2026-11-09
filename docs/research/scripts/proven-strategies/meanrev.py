"""Part C: short-horizon mean reversion on hourly closes. Rule 1: 24 h return < -3 % -> long 24 h; > +3 % -> short 24 h.
Rule 2: z-score of the close against the trailing 48 h mean / sd (2-day Bollinger) < -2 -> long 24 h; > +2 -> short.
Trades are non-overlapping (no new entry while a position is open); the overlapping signal count is also shown.
Costs: 0.05 % taker + 0.02 % slippage per side (0.14 % round trip) and actual funding over the holding day (3 x 8 h rates).
Sharpe: per-trade mean / sd x sqrt(trades per year), zero risk-free. Usage: python -I meanrev.py <closes_1h.json> <funding_4h.json> <label>"""
import json, sys, math, datetime as dt, statistics as st
from collections import defaultdict
U=dt.timezone.utc; COST=0.0007
rows=sorted(json.load(open(sys.argv[1])),key=lambda r:r["time"]); T=[r["time"] for r in rows]; C=[float(r["close"]) for r in rows]; N=len(C)
fund={}
for r in json.load(open(sys.argv[2])):
    t=dt.datetime.fromtimestamp(r["time"],U)
    if t.hour in (0,8,16): fund[r["time"]]=float(r["close"])/100
def funding_between(t0,t1,side):
    return side*sum(v for t,v in fund.items() if t0<t<=t1)
years=(T[-1]-T[0])/(365.25*86400)
print(f"## {sys.argv[3]}: {dt.datetime.fromtimestamp(T[0],U)} .. {dt.datetime.fromtimestamp(T[-1],U)} ({N} hourly candles, {years:.2f} years)")
def run(name, sig):
    out=[]; signals=0; i=0; last_exit=-1
    for i in range(N-24):
        s=sig(i)
        if s==0: continue
        signals+=1
        if i<last_exit: continue
        r=s*(C[i+24]/C[i]-1); f=funding_between(T[i],T[i+24],s)
        out.append(dict(t=T[i],side=s,gross=r,net=r-2*COST-f)); last_exit=i+24
    for side,lab in ((1,"long after drop"),(-1,"short after rise"),(0,"both")):
        v=[x for x in out if side==0 or x["side"]==side]; n=len(v)
        if n<2: print(f"| {name} | {lab} | {n} | | | | | | | |"); continue
        g=[x["gross"] for x in v]; nt=[x["net"] for x in v]; sd=st.stdev(nt); tpy=n/years
        yr=defaultdict(float)
        for x in v: yr[dt.datetime.fromtimestamp(x["t"],U).year]+=x["net"]
        print(f"| {name} | {lab} | {n}{' (signals '+str(signals)+')' if side==0 else ''} | {100*sum(x>0 for x in g)/n:.0f}% | {100*st.mean(g):+.3f}% | {100*st.mean(nt):+.3f}% | {100*sum(nt):+.1f}% | {st.mean(nt)/sd*math.sqrt(tpy) if sd>0 else float('nan'):.2f} | {100*min(nt):+.1f}% / {100*max(nt):+.1f}% | {' '.join(f'{y}:{100*s:+.0f}%' for y,s in sorted(yr.items()))} |")
print("| Rule | Side | Trades | Hit rate (gross) | Mean gross / trade | Mean net / trade | Sum net | Sharpe (annualised) | Worst / best trade (net) | Net by year |"); print("|"+"---|"*10)
def r24(i): 
    if i<24: return 0
    r=C[i]/C[i-24]-1; return 1 if r<-0.03 else (-1 if r>0.03 else 0)
def z48(i):
    if i<48: return 0
    w=C[i-48:i]; m=st.mean(w); sd=st.pstdev(w)
    if sd==0: return 0
    z=(C[i]-m)/sd; return 1 if z<-2 else (-1 if z>2 else 0)
run("24 h return +/-3 %",r24); run("48 h z-score +/-2",z48)
# control: the unconditional 24h return distribution
allr=[C[i+24]/C[i]-1 for i in range(0,N-24,24)]
print(f"\nUnconditional non-overlapping 24 h returns: n {len(allr)}, mean {100*st.mean(allr):+.3f}%, share > 0 {100*sum(x>0 for x in allr)/len(allr):.0f}%, sd {100*st.stdev(allr):.2f}%")
