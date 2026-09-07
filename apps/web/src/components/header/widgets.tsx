"use client";
// Analyse-header widgets: asset switch (HC-SH-003), futures price + 24h with flash (HC-SH-004, 005),
// feed status text (HC-SH-006), exchange chip (HC-SH-007), wallet placeholder (HC-SH-008).
import { Plug, Tooltip, Wallet, cn, toast } from "@hapiecoin/ui";
import { UNDERLYINGS, type Underlying } from "@hapiecoin/schema";
import { useCredential } from "@/lib/api/queries";
import { fmtPct, fmtPrice } from "@/lib/format";
import { useConnectionStatus, useFlash, useGateway, useLatency, useSpot } from "@/lib/gateway/hooks";
import { ASSET_META, useUiStore } from "@/lib/store";

export function AssetSwitch() {
  const asset = useUiStore((s) => s.asset);
  const setAsset = useUiStore((s) => s.setAsset);
  const pick = (a: Underlying) => {
    if (a === asset) return;
    setAsset(a);
    toast(`${ASSET_META[a].name} (${a})`, { description: "Chain switched." });
  };
  return (
    <div className="flex items-center gap-3">
      <div
        role="tablist"
        aria-label="Asset"
        data-tour="asset-select"
        className="inline-flex overflow-hidden rounded border border-border bg-muted p-0.5"
      >
        {UNDERLYINGS.map((a) => (
          <button
            key={a}
            role="tab"
            type="button"
            aria-selected={a === asset}
            data-testid={`asset-${a}`}
            title={ASSET_META[a].name}
            onClick={() => pick(a)}
            className={cn(
              "rounded-sm px-2.5 py-1 font-mono text-xs transition-colors",
              a === asset ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {a}
          </button>
        ))}
      </div>
      <div className="hidden flex-col leading-tight lg:flex">
        <span className="micro text-[9.5px]">Venue</span>
        <span className="text-xs">Delta India</span>
      </div>
    </div>
  );
}

export function FuturesPrice() {
  const asset = useUiStore((s) => s.asset);
  const spot = useSpot(asset);
  const flash = useFlash(spot?.dir ?? null, spot?.updatedAt);
  const c = spot?.c24;
  return (
    <div className="flex flex-col leading-tight" data-testid="futures-price" data-asset={asset}>
      <span className="micro text-[9.5px]">Futures · {ASSET_META[asset].symbol}</span>
      <span className="flex items-baseline gap-2">
        <span className={cn("num text-[17px] font-medium", flash)} data-testid="futures-price-value">
          {spot ? fmtPrice(spot.price) : "—"}
        </span>
        <span
          className={cn("num text-xs", c === undefined ? "text-muted-foreground" : c >= 0 ? "text-profit" : "text-loss")}
          data-testid="futures-change"
        >
          {fmtPct(c)}
        </span>
        <span className="text-3xs text-muted-foreground">24h</span>
      </span>
    </div>
  );
}

export function FeedStatus() {
  const status = useConnectionStatus();
  const latency = useLatency();
  const gw = useGateway();
  const paused = useUiStore((s) => s.feedPaused);
  const setPaused = useUiStore((s) => s.setFeedPaused);
  const connecting = !paused && (status === "connecting" || status === "reconnecting");
  const live = !paused && status === "open";
  const label = paused ? "Feed paused" : connecting ? "Connecting" : live ? "Feed live" : "Feed offline";
  const toggle = () => {
    if (paused) {
      setPaused(false);
      gw.reopen();
      toast.success("Feed live", { description: "Connecting to Delta Exchange live prices." });
    } else {
      setPaused(true);
      gw.close();
      toast("Feed paused", { description: "Futures prices will not update until you reconnect." });
    }
  };
  return (
    <button
      type="button"
      onClick={toggle}
      data-testid="feed-status"
      data-state={paused ? "paused" : connecting ? "connecting" : live ? "live" : "offline"}
      title={paused ? "Live feed paused · click to connect" : "Live futures prices from Delta Exchange · click to pause"}
      className="inline-flex items-center gap-1.5 rounded px-2 py-1 font-mono text-2xs uppercase tracking-[0.08em] hover:bg-muted"
    >
      <i
        className={cn(
          "size-1.5 rounded-full",
          live ? "live-dot" : connecting ? "bg-warning" : "bg-muted-foreground",
        )}
        aria-hidden="true"
      />
      <span className={live ? "text-profit" : "text-muted-foreground"}>{label}</span>
      {live ? <span className="text-muted-foreground">· {latency} ms</span> : null}
    </button>
  );
}

export function ExchangeChip() {
  const { data, isLoading } = useCredential();
  const openDialog = useUiStore((s) => s.openDialog);
  const connected = (data?.items.length ?? 0) > 0;
  return (
    <>
      <button
        type="button"
        onClick={() => openDialog("api")}
        data-testid="exchange-chip"
        data-state={isLoading ? "checking" : connected ? "connected" : "disconnected"}
        title={connected ? "Connected · Delta Exchange · click for API settings" : "Exchange not connected · click to connect"}
        className={cn(
          "inline-flex h-7 items-center gap-1.5 rounded border px-2 text-xs",
          connected ? "border-profit/40 text-profit" : "border-border text-muted-foreground hover:text-foreground",
        )}
      >
        <Plug className="size-3.5" aria-hidden="true" />
        <span>{isLoading ? "…" : connected ? "Connected" : "Not connected"}</span>
      </button>
      {connected ? (
        <Tooltip content="Wallet balance arrives with live trading (Phase 3).">
          <span
            data-testid="wallet-chip"
            className="inline-flex h-7 items-center gap-1.5 rounded border border-border px-2 font-mono text-xs text-muted-foreground"
          >
            <Wallet className="size-3.5" aria-hidden="true" />—
          </span>
        </Tooltip>
      ) : null}
    </>
  );
}
