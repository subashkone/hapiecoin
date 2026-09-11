"use client";
// Live chain panel (HC-WS-107): expiry chips from the gateway / env, subscribe to
// chain:delta_india:<asset>:<expiry>, render snap + q frames with designed empty, stale and error states.
// The table itself (layout, range, keyboard) is ChainTable; this panel owns expiry selection and the states.
import { Button, EmptyState, cn, toast, useDensity } from "@hapiecoin/ui";
import { type Quote, chainTopic } from "@hapiecoin/schema";
import { CURRENT_VENUE } from "@/lib/venue";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo } from "react";
import { useSettings } from "@/lib/api/queries";
import { discoverExpiries, nearestExpiry } from "@/lib/chain/expiries";
import { publicEnv } from "@/lib/env";
import { daysToExpiry, fmtExpiry, fmtPrice } from "@/lib/format";
import { useConnectionStatus, useGateway, useSpot, useTopic } from "@/lib/gateway/hooks";
import { useUiStore } from "@/lib/store";
import { type LegKind, type LegSide, MAX_ACTIVE_LEGS, legsForChain, stepLots } from "@/lib/strategy/legs";
import { ChainTable } from "./ChainTable";
import type { FeedState } from "./ChainTools";
import { ExpiryStrip } from "./ExpiryStrip";

export function ChainPanel({ height = 520 }: { height?: number }) {
  const asset = useUiStore((s) => s.asset);
  const selected = useUiStore((s) => s.expiry[s.asset] ?? null);
  const setExpiry = useUiStore((s) => s.setExpiry);
  const env = publicEnv();
  const expiries = useQuery({
    queryKey: ["expiries", asset],
    queryFn: () => discoverExpiries(asset, { gatewayWsUrl: env.NEXT_PUBLIC_GATEWAY_URL, defaultsCsv: env.NEXT_PUBLIC_DEFAULT_EXPIRIES }),
    staleTime: 5 * 60_000,
  });
  const list = expiries.data?.expiries ?? [];
  const expiry = selected && list.includes(selected) ? selected : nearestExpiry(list);
  const topic = expiry ? chainTopic(CURRENT_VENUE, asset, expiry) : null;
  const chain = useTopic(topic);
  const spot = useSpot(asset);
  const status = useConnectionStatus();
  const gw = useGateway();
  const feedPaused = useUiStore((s) => s.feedPaused);
  const range = useUiStore((s) => s.chainRange);
  const setChainRange = useUiStore((s) => s.setChainRange);
  const recentreSignal = useUiStore((s) => s.chainRecentre);
  const layout = useUiStore((s) => s.chainColumns);
  const openDialog = useUiStore((s) => s.openDialog);
  const openColumns = useCallback(() => openDialog("columns"), [openDialog]);
  // Legs (HC-WS-024..027, HC-TR-017/018): per-asset list in the store; this chain shows its expiry's legs.
  const assetLegs = useUiStore((s) => s.legs[s.asset]);
  const legExpiries = useMemo(() => new Set(assetLegs.filter((l) => l.status === "open" && l.kind !== "future").map((l) => l.expiry)), [assetLegs]);
  const chainLots = useUiStore((s) => s.chainLots);
  const setChainLots = useUiStore((s) => s.setChainLots);
  const addLeg = useUiStore((s) => s.addLeg);
  const openOptionDetail = useUiStore((s) => s.openOptionDetail);
  const { data: settings } = useSettings();
  const lotSize = settings?.lotSizes[asset];
  const { density } = useDensity(); // HC-WS-066: 36 px rows comfortable, 28 px compact
  const rowHeight = density === "compact" ? 28 : 36;

  useEffect(() => {
    if (chain?.stale && topic) gw.refresh(topic);
  }, [chain?.stale, topic, gw]);

  const stepExpiry = useCallback(
    (delta: 1 | -1) => {
      if (!expiry) return;
      const i = list.indexOf(expiry);
      const next = list[i + delta];
      if (next) setExpiry(asset, next);
    },
    [asset, expiry, list, setExpiry],
  );
  const chainLegs = useMemo(() => (expiry ? legsForChain(assetLegs, asset, expiry) : []), [assetLegs, asset, expiry]);
  const atLimit = assetLegs.filter((l) => l.status === "open").length >= MAX_ACTIVE_LEGS;
  const onAddLeg = useCallback(
    (kind: LegKind, side: LegSide, strike: string, quote: Quote | undefined) => {
      if (!expiry) return;
      if (!quote) {
        toast.error("No quote for this option yet");
        return;
      }
      const r = addLeg({ asset, kind, side, strike, expiry, lots: chainLots, price: quote.mark, iv: quote.markIv });
      if (r.ok) {
        toast("Leg added", { description: `${side.toUpperCase()} ${r.leg.lots} × ${r.leg.symbol} @ ${fmtPrice(r.leg.price)}` });
      } else if (r.reason === "limit") {
        toast.error("Limit reached", { description: `Maximum ${MAX_ACTIVE_LEGS} active legs per strategy` });
      } else {
        toast.error("Lots must be a whole number above zero");
      }
    },
    [addLeg, asset, chainLots, expiry],
  );
  const onLots = useCallback((delta: 1 | -1) => setChainLots(stepLots(chainLots, delta)), [chainLots, setChainLots]);
  const onInfo = useCallback(
    (kind: LegKind, strike: string) => {
      if (expiry) openOptionDetail({ asset, expiry, strike, kind });
    },
    [asset, expiry, openOptionDetail],
  );
  const live = status === "open" && !feedPaused && !(chain?.stale ?? false);
  const feed: FeedState = feedPaused ? "paused" : status !== "open" ? "connecting" : (chain?.stale ?? false) ? "stale" : "live";
  const asOf = chain?.stale && chain.updatedAt > 0 ? new Date(chain.updatedAt).toLocaleTimeString("en-GB") : null;

  return (
    <section className="flex h-full flex-col" data-testid="chain-panel" data-topic={topic ?? ""}>
      <div className="flex items-center gap-1 border-b border-border px-2 py-1.5">
        <ExpiryStrip>
        {list.map((e) => {
          const on = e === expiry;
          return (
            <button
              key={e}
              role="tab"
              type="button"
              aria-selected={on}
              data-testid="expiry-chip"
              data-expiry={e}
              onClick={() => setExpiry(asset, e)}
              className={cn(
                "flex shrink-0 flex-col items-center rounded px-2.5 py-1 leading-tight",
                on ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground",
              )}
            >
              <span className="text-xs font-medium">
                {fmtExpiry(e)}
                {legExpiries.has(e) ? <span className="ml-1 inline-block h-1.5 w-1.5 rounded-full bg-spot align-middle" title="This expiry holds strategy legs" data-testid="expiry-dot" /> : null}
              </span>
              <span className="font-mono text-3xs">{daysToExpiry(e)}d</span>
            </button>
          );
        })}
        {expiries.isLoading ? <span className="px-2 text-2xs text-muted-foreground">Loading expiries…</span> : null}
        {!expiries.isLoading && list.length === 0 ? <span className="px-2 text-2xs text-muted-foreground">No expiries available</span> : null}
        </ExpiryStrip>
        <span className="ml-auto shrink-0 font-mono text-3xs uppercase tracking-[0.1em] text-muted-foreground">
          {expiries.data ? (expiries.data.source === "gateway" ? "expiries · gateway" : "expiries · default list") : ""}
          {chain && chain.seq >= 0 ? ` · seq ${chain.seq}` : ""}
        </span>
      </div>
      <div className="min-h-0 flex-1">
        {!topic ? (
          <EmptyState title="No expiry selected" description="Pick an expiry above to load its chain." />
        ) : feedPaused ? (
          <EmptyState title="Feed paused" description="Reconnect the feed from the header to stream this chain." action={<Button size="sm" variant="outline" onClick={() => { useUiStore.getState().setFeedPaused(false); gw.reopen(); }}>Reconnect</Button>} />
        ) : !chain || chain.seq < 0 ? (
          <EmptyState
            title={status === "open" ? "Waiting for the chain snapshot…" : "Connecting to the market-data gateway…"}
            description={`${topic} · strikes come from the venue instrument list`}
          />
        ) : chain.rows.length === 0 ? (
          <EmptyState title="No strikes listed for this expiry" description="The venue returned an empty instrument list." />
        ) : (
          <ChainTable
            chain={chain}
            spot={spot?.price}
            rowHeight={rowHeight}
            height={height}
            range={range}
            onRange={setChainRange}
            layout={layout}
            onOpenColumns={openColumns}
            recentreSignal={recentreSignal}
            onExpiryStep={stepExpiry}
            expiryLabel={expiry ? fmtExpiry(expiry) : ""}
            daysLeft={expiry ? daysToExpiry(expiry) : null}
            lotLabel={`Lot ${lotSize ?? "…"} ${asset} · prices USD per ${asset}`}
            live={live}
            feed={feed}
            asOf={asOf}
            legs={chainLegs}
            lots={chainLots}
            lotsTitle={`Lots × ${lotSize ?? "…"} ${asset}`}
            atLimit={atLimit}
            onAddLeg={onAddLeg}
            onLots={onLots}
            onInfo={onInfo}
          />
        )}
      </div>
    </section>
  );
}
