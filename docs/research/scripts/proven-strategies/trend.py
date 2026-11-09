"""Part A: trend-following rules on daily closes. Signal on close t, position held over t -> t+1.
Costs: FEE per side (taker 0.05 %) + SLIP per side (0.02 %) on each unit of position change; funding from the actual 8-hour
rate series (percent per 8 h, three payments a day; long pays when positive, short receives).
Usage: python -I trend.py <closes_1d.json> <funding_4h.json> <eval_from YYYY-MM-DD> <label> [sweep]"""
import json, sys, math, datetime as dt
from collections import defaultdict
U=dt.timezone.utc
FEE, SLIP = 0.0005, 0.0002
COST = FEE + SLIP   # per side, per unit of position
rows=sorted(json.load(open(sys.argv[1])),key=lambda r:r["time"])
fund=json.load(open(sys.argv[2])) if sys.argv[2]!="-" else []
FROM=int(dt.datetime.fromisoformat(sys.argv[3]).replace(tzinfo=U).timestamp()); LABEL=sys.argv[4]; SWEEP=len(sys.argv)>5
T=[r["time"] for r in rows]; C=[float(r["close"]) for r in rows]; H=[float(r["high"]) for r in rows]; L=[float(r["low"]) for r in rows]
N=len(C)
# funding per day (sum of the three 8h rates, in fraction): take the value at 00:00, 08:00, 16:00 UTC of each day
fd=defaultdict(float)
for r in fund:
    t=dt.datetime.fromtimestamp(r["time"],U)
    if t.hour in (0,8,16):
        day=int(dt.datetime(t.year,t.month,t.day,tzinfo=U).timestamp()); fd[day]+=float(r["close"])/100
def sma(n):
    out=[None]*N; s=0.0
    for i in range(N):
        s+=C[i]
        if i>=n: s-=C[i-n]
        if i>=n-1: out[i]=s/n
    return out
def pos_ma(n, ls):
    m=sma(n); return [None if m[i] is None else (1 if C[i]>m[i] else (-1 if ls else 0)) for i in range(N)]
def pos_tsmom(ls):
    out=[None]*N
    for i in range(N):
        if i>=252:
            r=C[i-21]/C[i-252]-1; out[i]=1 if r>0 else (-1 if ls else 0)
    return out
def pos_donchian(n, ls):
    out=[None]*N; p=0
    for i in range(N):
        if i<n: continue
        hi=max(C[i-n:i]); lo=min(C[i-n:i])   # prior n closes
        if C[i]>hi: p=1
        elif C[i]<lo: p=-1 if ls else 0
        out[i]=p
    return out
def evaluate(pos, with_fees, with_funding):
    """Daily strategy returns from FROM onward. pos[i] is the position held from close i to close i+1."""
    rets=[]; days=[]; trades=0; inmkt=0; prev=0.0; first=True
    for i in range(N-1):
        if T[i]<FROM or pos[i] is None: continue
        p=pos[i]
        if first: prev=0.0; first=False
        r=p*(C[i+1]/C[i]-1)
        if with_fees: r-=COST*abs(p-prev)
        if with_funding: r-=p*fd.get(T[i+1],0.0)   # funding paid during the holding day
        if p!=prev: trades+=1 if (p!=0 or prev!=0) else 0
        if p!=0: inmkt+=1
        prev=p; rets.append(r); days.append(T[i+1])
    return rets, days, trades, inmkt
def stats(rets, days):
    n=len(rets); eq=1.0; peak=1.0; mdd=0.0; yr=defaultdict(lambda:1.0)
    for r,t in zip(rets,days):
        eq*=1+r; peak=max(peak,eq); mdd=min(mdd,eq/peak-1); yr[dt.datetime.fromtimestamp(t,U).year]*=1+r
    years=n/365.25; cagr=eq**(1/years)-1 if eq>0 else -1.0
    mu=sum(rets)/n; sd=math.sqrt(sum((r-mu)**2 for r in rets)/(n-1)); vol=sd*math.sqrt(365); sharpe=mu/sd*math.sqrt(365) if sd>0 else float('nan')
    return dict(total=eq-1,cagr=cagr,vol=vol,sharpe=sharpe,mdd=mdd,yearly={y:v-1 for y,v in sorted(yr.items())},n=n)
RULES={"Buy & hold":lambda ls:[1]*N,"SMA 20":lambda ls:pos_ma(20,ls),"SMA 50":lambda ls:pos_ma(50,ls),"SMA 200":lambda ls:pos_ma(200,ls),
       "TSMOM 12-1":pos_tsmom,"Donchian 20":lambda ls:pos_donchian(20,ls)}
print(f"## {LABEL}: {dt.datetime.fromtimestamp(T[0],U).date()} .. {dt.datetime.fromtimestamp(T[-1],U).date()} ({N} daily candles), evaluated from {sys.argv[3]}; funding days with data {len(fd)}")
if not SWEEP:
    print("| Rule | Mode | Variant | Total | CAGR | Vol | Sharpe | MaxDD | Trades | Time in mkt | " + " | ".join(str(y) for y in range(2019,2027)) + " |")
    print("|"+"---|"*(10+8))
    for name,fn in RULES.items():
        for ls in ([False] if name=="Buy & hold" else [False,True]):
            pos=fn(ls)
            for var,ff,fu in (("gross",False,False),("fees+slip",True,False),("fees+slip+funding",True,True)):
                rets,days,tr,im=evaluate(pos,ff,fu); s=stats(rets,days)
                ys=" | ".join(f"{100*s['yearly'][y]:+.0f}%" if y in s['yearly'] else "" for y in range(2019,2027))
                print(f"| {name} | {'long/short' if ls else 'long/flat'} | {var} | {100*s['total']:+.0f}% | {100*s['cagr']:+.1f}% | {100*s['vol']:.0f}% | {s['sharpe']:.2f} | {100*s['mdd']:.0f}% | {tr} | {100*im/s['n']:.0f}% | {ys} |")
else:
    print("| MA length | L/F Sharpe | L/F CAGR | L/F MaxDD | L/S Sharpe | L/S CAGR | L/S MaxDD |"); print("|---|---|---|---|---|---|---|")
    for n in range(10,301,10):
        out=[]
        for ls in (False,True):
            rets,days,tr,im=evaluate(pos_ma(n,ls),True,True); s=stats(rets,days); out.append(f"{s['sharpe']:.2f} | {100*s['cagr']:+.1f}% | {100*s['mdd']:.0f}%")
        print(f"| {n} | {out[0]} | {out[1]} |")
