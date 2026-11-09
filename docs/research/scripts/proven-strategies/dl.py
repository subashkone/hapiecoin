"""Paged, throttled, cached downloader for Delta candle history (public, read-only).
Usage: python -I dl.py <india|global> <symbol> <resolution> <start YYYY-MM-DD> <end YYYY-MM-DD> <out.json>
Pages backwards from end in windows sized so one request returns <4000 rows; stops when a window comes back empty twice."""
import json, os, sys, time, urllib.request, urllib.parse, datetime as dt
HOST={"india":"https://api.india.delta.exchange","global":"https://api.delta.exchange"}[sys.argv[1]]
SYM,RES=sys.argv[2],sys.argv[3]; U=dt.timezone.utc
S=int(dt.datetime.fromisoformat(sys.argv[4]).replace(tzinfo=U).timestamp()); E=int(dt.datetime.fromisoformat(sys.argv[5]).replace(tzinfo=U).timestamp())
OUT=sys.argv[6]
SEC={"1m":60,"5m":300,"15m":900,"1h":3600,"4h":14400,"1d":86400}[RES]
WIN=3900*SEC
MIN_GAP=0.26; last=[0.0]; nreq=[0]
def candles(s,e):
    w=MIN_GAP-(time.monotonic()-last[0])
    if w>0: time.sleep(w)
    q=urllib.parse.urlencode({"symbol":SYM,"resolution":RES,"start":s,"end":e})
    for a in range(4):
        try:
            with urllib.request.urlopen(urllib.request.Request(HOST+"/v2/history/candles?"+q,headers={"User-Agent":"hapiecoin-research"}),timeout=30) as r:
                last[0]=time.monotonic(); nreq[0]+=1; return json.loads(r.read()).get("result") or []
        except Exception:
            last[0]=time.monotonic()
            if a==3: raise
            time.sleep(2*(a+1))
rows={}
if os.path.exists(OUT):
    for r in json.load(open(OUT)): rows[r["time"]]=r
    print("cache",OUT,len(rows),"rows")
else:
    e=E; empty=0
    while e>S and empty<2:
        s=max(S,e-WIN)
        got=candles(s,e-1)
        for r in got: rows[r["time"]]=r
        empty = empty+1 if not got else 0
        e=s
    json.dump([rows[t] for t in sorted(rows)],open(OUT,"w"))
ts=sorted(rows)
gaps=[(a,b) for a,b in zip(ts,ts[1:]) if b-a!=SEC]
print(f"{sys.argv[1]} {SYM} {RES} rows {len(ts)} first {dt.datetime.fromtimestamp(ts[0],U)} last {dt.datetime.fromtimestamp(ts[-1],U)} requests {nreq[0]} gaps {len(gaps)}" + (f" biggest gap {max(b-a for a,b in gaps)/SEC:.0f} bars at {dt.datetime.fromtimestamp(max(gaps,key=lambda g:g[1]-g[0])[0],U)}" if gaps else ""))
