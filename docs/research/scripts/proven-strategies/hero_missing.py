"""List (and optionally fetch) the option symbols Part B needs that are not in the cache.
Usage: python -I hero_missing.py <cache_dir> [fetch]"""
import json, os, sys, time, urllib.request, urllib.parse, datetime as dt
CACHE=sys.argv[1]; DO=len(sys.argv)>2
U=dt.timezone.utc; STEP=200
ENTRY=[2,6,9]; MONEY=[0.01,0.02,0.03]
B="https://api.india.delta.exchange/v2/history/candles"; MIN_GAP=0.26; last=[0.0]
def candles(sym,s,e):
    w=MIN_GAP-(time.monotonic()-last[0]);
    if w>0: time.sleep(w)
    q=urllib.parse.urlencode({"symbol":sym,"resolution":"5m","start":int(s.timestamp()),"end":int(e.timestamp())})
    for a in range(4):
        try:
            with urllib.request.urlopen(urllib.request.Request(B+"?"+q,headers={"User-Agent":"hapiecoin-research"}),timeout=30) as r:
                last[0]=time.monotonic(); return json.loads(r.read()).get("result") or []
        except Exception:
            last[0]=time.monotonic()
            if a==3: raise
            time.sleep(2*(a+1))
need=[]; have=0; empty_cached=0
for exp in sorted(os.listdir(CACHE)):
    d=os.path.join(CACHE,exp)
    if not os.path.isdir(d): continue
    spot={r["time"]:float(r["close"]) for r in json.load(open(os.path.join(d,"MARK_BTCUSD.json")))}
    y,m,dd=map(int,exp.split("-"))
    for h in ENTRY:
        t0=int(dt.datetime(y,m,dd,h,tzinfo=U).timestamp())
        if t0 not in spot: print(exp,h,"no spot at entry"); continue
        s0=spot[t0]; atm=int(round(s0/STEP)*STEP)
        for mny in MONEY:
            off=int(round(s0*mny/STEP)*STEP)
            for kind,k in (("C",atm+off),("P",atm-off)):
                sym=f"MARK:{kind}-BTC-{k}-{dd:02d}{m:02d}{y%100:02d}"
                p=os.path.join(d,sym.replace(":","_")+".json")
                if os.path.exists(p):
                    if os.path.getsize(p)<=3: empty_cached+=1
                    else: have+=1
                else: need.append((exp,sym))
need=sorted(set(need))
print("needed symbol-days present",have,"cached-empty",empty_cached,"missing",len(need))
if DO and need:
    n=0
    for exp,sym in need:
        y,m,dd=map(int,exp.split("-")); end=dt.datetime(y,m,dd,12,tzinfo=U); start=end-dt.timedelta(hours=24)
        c=candles(sym,start,end); n+=1
        json.dump(c,open(os.path.join(CACHE,exp,sym.replace(":","_")+".json"),"w"))
    print("fetched",n,"requests")
