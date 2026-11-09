import json, urllib.request, urllib.parse, time, datetime as dt
B="https://api.india.delta.exchange/v2/history/candles"
def get(sym,res,s,e):
    q=urllib.parse.urlencode({"symbol":sym,"resolution":res,"start":s,"end":e})
    with urllib.request.urlopen(urllib.request.Request(B+"?"+q,headers={"User-Agent":"hapiecoin-research"}),timeout=30) as r:
        return json.loads(r.read()).get("result") or []
now=int(time.time())
for sym in ["BTCUSD","ETHUSD","MARK:BTCUSD","MARK:ETHUSD","FUNDING:BTCUSD","FUNDING:ETHUSD",".DEXBTUSD"]:
    for res in ["1d","1h"]:
        # ask for a wide span; see what comes back
        rows=get(sym,res,1500000000,now)
        if rows:
            ts=sorted(r["time"] for r in rows)
            print(sym,res,"n",len(rows),"first",dt.datetime.utcfromtimestamp(ts[0]),"last",dt.datetime.utcfromtimestamp(ts[-1]), "sample",rows[0])
        else:
            print(sym,res,"EMPTY")
        time.sleep(0.3)
