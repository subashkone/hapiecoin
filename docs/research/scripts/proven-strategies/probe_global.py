import json, urllib.request, urllib.parse, time, datetime as dt
U=dt.timezone.utc
def get(base,sym,res,s,e):
    q=urllib.parse.urlencode({"symbol":sym,"resolution":res,"start":s,"end":e})
    try:
        with urllib.request.urlopen(urllib.request.Request(base+"?"+q,headers={"User-Agent":"hapiecoin-research"}),timeout=30) as r:
            return json.loads(r.read()).get("result") or []
    except Exception as ex:
        return "ERR "+str(ex)[:120]
now=int(time.time())
for base in ["https://api.delta.exchange/v2/history/candles","https://cdn.india.deltaex.org/v2/history/candles"]:
    for sym in ["BTCUSD","ETHUSD","MARK:BTCUSD"]:
        rows=get(base,sym,"1d",1400000000,now)
        if isinstance(rows,str) or not rows: print(base,sym,rows if rows else "EMPTY"); time.sleep(0.3); continue
        ts=sorted(r["time"] for r in rows)
        print(base,sym,"n",len(rows),"first",dt.datetime.fromtimestamp(ts[0],U),"last",dt.datetime.fromtimestamp(ts[-1],U))
        time.sleep(0.3)
# funding units
rows=get("https://api.india.delta.exchange/v2/history/candles","FUNDING:BTCUSD","1d",1400000000,now)
vals=sorted(float(r["close"]) for r in rows)
n=len(vals)
print("FUNDING:BTCUSD daily closes n",n,"min",vals[0],"p10",vals[n//10],"median",vals[n//2],"p90",vals[9*n//10],"max",vals[-1],"mean",sum(vals)/n)
rows=get("https://api.india.delta.exchange/v2/history/candles","FUNDING:BTCUSD","1h",now-3*86400,now)
print("FUNDING 1h last 3 days:",[(dt.datetime.fromtimestamp(r["time"],U).strftime("%d %H:%M"),r["close"]) for r in sorted(rows,key=lambda r:r["time"])][-12:])
