"""Download full daily history for the perps, marks and funding series from Delta India (one request each; <4000 rows).
Usage: python -I fetch_daily.py <cache_dir>"""
import json, os, sys, time, urllib.request, urllib.parse, datetime as dt
CACHE=sys.argv[1]; os.makedirs(CACHE,exist_ok=True)
B="https://api.india.delta.exchange/v2/history/candles"; U=dt.timezone.utc
MIN_GAP=0.26; last=[0.0]
def candles(sym,res,s,e):
    w=MIN_GAP-(time.monotonic()-last[0]); 
    if w>0: time.sleep(w)
    q=urllib.parse.urlencode({"symbol":sym,"resolution":res,"start":s,"end":e})
    for a in range(4):
        try:
            with urllib.request.urlopen(urllib.request.Request(B+"?"+q,headers={"User-Agent":"hapiecoin-research"}),timeout=30) as r:
                last[0]=time.monotonic(); return json.loads(r.read()).get("result") or []
        except Exception:
            last[0]=time.monotonic()
            if a==3: raise
            time.sleep(2*(a+1))
end=int(dt.datetime(2026,11,8,0,0,tzinfo=U).timestamp())  # through the 7 Nov 2026 daily candle (time 2026-11-07 00:00)
for sym in ["BTCUSD","ETHUSD","MARK:BTCUSD","MARK:ETHUSD","FUNDING:BTCUSD","FUNDING:ETHUSD"]:
    p=os.path.join(CACHE,sym.replace(":","_")+"_1d.json")
    if os.path.exists(p): rows=json.load(open(p))
    else:
        rows=candles(sym,"1d",1500000000,end-1)
        rows=sorted(rows,key=lambda r:r["time"]); json.dump(rows,open(p,"w"))
    ts=[r["time"] for r in rows]
    gaps=sum(1 for a,b in zip(ts,ts[1:]) if b-a!=86400)
    print(sym,"rows",len(rows),"first",dt.datetime.fromtimestamp(ts[0],U).date(),"last",dt.datetime.fromtimestamp(ts[-1],U).date(),"non-daily gaps",gaps)
