"""Splice global (api.delta.exchange) history before the India launch with India history after it; check anomalies.
Writes cache/spliced/*.json. Usage: python -I splice.py <cache_root>"""
import json, os, sys, datetime as dt
R=sys.argv[1]; U=dt.timezone.utc; os.makedirs(os.path.join(R,"spliced"),exist_ok=True)
def load(p): return sorted(json.load(open(p)),key=lambda r:r["time"])
def anomalies(rows,label):
    flat=[r for r in rows if r["open"]==r["high"]==r["low"]==r["close"]]
    zv=[r for r in rows if not r.get("volume")]
    # first time of a run of >=3 consecutive flat candles
    run=0; first=None
    for r in rows:
        run = run+1 if r["open"]==r["high"]==r["low"]==r["close"] else 0
        if run>=3 and first is None: first=rows[rows.index(r)-2]["time"]
    print(f"{label}: rows {len(rows)} flat {len(flat)} zero-volume {len(zv)} first run of 3 flat candles: {dt.datetime.fromtimestamp(first,U) if first else None}")
def splice(gp,ip,out,label):
    g=load(gp); i=load(ip); cut=i[0]["time"]
    gpre=[r for r in g if r["time"]<cut]
    anomalies(gpre,label+" global part"); anomalies(i,label+" india part")
    s=gpre+i; json.dump(s,open(os.path.join(R,"spliced",out),"w"))
    sec=s[1]["time"]-s[0]["time"]; gaps=sum(1 for a,b in zip(s,s[1:]) if b["time"]-a["time"]!=sec)
    # junction continuity
    print(f"  -> {out}: {len(s)} rows {dt.datetime.fromtimestamp(s[0]['time'],U)} .. {dt.datetime.fromtimestamp(s[-1]['time'],U)} gaps {gaps}; junction global close {gpre[-1]['close']} -> india first open {i[0]['open']} ({100*(float(i[0]['open'])/float(gpre[-1]['close'])-1):+.2f}%)")
splice(f"{R}/daily_global/BTCUSD_1d.json",f"{R}/daily/BTCUSD_1d.json","BTCUSD_1d.json","BTCUSD 1d")
splice(f"{R}/daily_global/ETHUSD_1d.json",f"{R}/daily/ETHUSD_1d.json","ETHUSD_1d.json","ETHUSD 1d")
splice(f"{R}/funding/global_FUNDING_BTCUSD_4h.json",f"{R}/funding/india_FUNDING_BTCUSD_4h.json","FUNDING_BTCUSD_4h.json","FUNDING BTC 4h")
splice(f"{R}/funding/global_FUNDING_ETHUSD_4h.json",f"{R}/funding/india_FUNDING_ETHUSD_4h.json","FUNDING_ETHUSD_4h.json","FUNDING ETH 4h")
splice(f"{R}/hourly/global_BTCUSD_1h.json",f"{R}/hourly/india_BTCUSD_1h.json","BTCUSD_1h.json","BTCUSD 1h")
# where did the global feed freeze?
anomalies(load(f"{R}/daily_global/BTCUSD_1d.json"),"global BTCUSD 1d full")
print("--- mark-price splices ---")
splice(f"{R}/daily_global/MARK_BTCUSD_1d.json",f"{R}/daily/MARK_BTCUSD_1d.json","MARK_BTCUSD_1d.json","MARK BTCUSD 1d")
splice(f"{R}/daily_global/MARK_ETHUSD_1d.json",f"{R}/daily/MARK_ETHUSD_1d.json","MARK_ETHUSD_1d.json","MARK ETHUSD 1d")
splice(f"{R}/hourly/global_MARK_BTCUSD_1h.json",f"{R}/hourly/india_MARK_BTCUSD_1h.json","MARK_BTCUSD_1h.json","MARK BTCUSD 1h")
