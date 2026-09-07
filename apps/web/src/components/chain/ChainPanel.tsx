"use client";
// Live chain panel (Phase 1 pipe proof): expiry chips from the gateway / env, subscribe to
// chain:delta_india:<asset>:<expiry>, render snap + q frames with designed empty, stale and error states.
import { Button, EmptyState, cn } from "@hapiecoin/ui";
import { chainTopic } from "@hapiecoin/schema";
import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { discoverExpiries, nearestExpiry } from "@/lib/chain/expiries";
import { publicEnv } from "@/lib/env";
import { daysToExpiry, fmtExpiry } from "@/lib/format";
import { useConnectionStatus, useGateway, useSpot, useTopic } from "@/lib/gateway/hooks";
import { useUiStore } from "@/lib/store";
import { ChainTable } from "./ChainTable";

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
  const topic = expiry ? chainTopic("delta_india", asset, expiry) : null;
  const chain = useTopic(topic);
  const spot = useSpot(asset);
  const status = useConnectionStatus();
  const gw = useGateway();
  const feedPaused = useUiStore((s) => s.feedPaused);

  useEffect(() => {
    if (chain?.stale && topic) gw.refresh(topic);
  }, [chain?.stale, topic, gw]);

  return (
    <section className="flex h-full flex-col" data-testid="chain-panel" data-topic={topic ?? ""}>
      <div className="flex items-center gap-1 overflow-x-auto border-b border-border px-2 py-1.5" role="tablist" aria-label="Expiry">
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
              <span className="text-xs font-medium">{fmtExpiry(e)}</span>
              <span className="font-mono text-3xs">{daysToExpiry(e)}d</span>
            </button>
          );
        })}
        {expiries.isLoading ? <span className="px-2 text-2xs text-muted-foreground">Loading expiries…</span> : null}
        {!expiries.isLoading && list.length === 0 ? <span className="px-2 text-2xs text-muted-foreground">No expiries available</span> : null}
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
          <ChainTable chain={chain} spot={spot?.price} height={height} />
        )}
      </div>
    </section>
  );
}
