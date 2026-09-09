"use client";
// Whales (HC-MA-067..072, 117): tracked Hyperliquid whale longs/shorts, large resting orders on Bybit, the Whale
// Index gauge, the alerts feed, the index chart, the open-positions table, the large-orders table and the exchange
// reserves panel (coming soon, GAPS #55). Everything comes from the `whales` snapshot (ADR-043).
import type { LargeOrder, WhaleAlert, WhalePosition } from "@hapiecoin/schema";
import { whaleIndexLabel } from "@hapiecoin/schema";
import { useEffect, useMemo, useRef, useState } from "react";
import { useWhales } from "@/lib/api/analytics";
import { ago, price, sliceSeries, usdCompact } from "@/lib/analytics/format";
import { Chart } from "./Chart";
import { type Column, DataTable } from "./DataTable";
import { Coin, ComingSoon, Gauge, Panel, SourceLine, Tile } from "./bits";

const shortWallet = (w: string) => `${w.slice(0, 6)}…${w.slice(-4)}`;
const hms = (t: number) => new Date(t).toLocaleTimeString("en-GB", { hour12: false });
const hm = (t: number) => `${String(new Date(t).getHours()).padStart(2, "0")}:${String(new Date(t).getMinutes()).padStart(2, "0")}`;
const alertKey = (a: WhaleAlert) => `${a.t}:${a.wallet}:${a.coin}:${a.action}`;
const signedUsd = (v: number) => `${v >= 0 ? "+" : "-"}${usdCompact(Math.abs(v))}`;
const ACTION_LABEL: Record<WhaleAlert["action"], string> = { opened: "opened", closed: "closed", increased: "added to", reduced: "trimmed", flipped: "flipped to" };

export const positionCols: Column<WhalePosition>[] = [
  { key: "wallet", label: "Wallet", render: (r) => <span className="font-mono text-2xs" title={r.wallet}>{shortWallet(r.wallet)}</span> },
  { key: "coin", label: "Coin", render: (r) => <Coin symbol={r.coin} /> },
  { key: "side", label: "Side", align: "c", sortVal: (r) => (r.side === "long" ? 1 : 0), render: (r) => <span className={`rounded px-1 text-2xs ${r.side === "long" ? "bg-buy-bg text-buy" : "bg-sell-bg text-sell"}`}>{r.side === "long" ? "Long" : "Short"} {r.leverage}×</span> },
  { key: "notionalUsd", label: "Position", align: "r", render: (r) => usdCompact(r.notionalUsd) },
  { key: "entryPx", label: "Entry", align: "r", render: (r) => price(r.entryPx) },
  { key: "markPx", label: "Mark", align: "r", render: (r) => price(r.markPx) },
  { key: "liquidationPx", label: "Liq Price", align: "r", render: (r) => <span className="text-warning">{price(r.liquidationPx)}</span> },
  { key: "unrealizedPnl", label: "uPnL", align: "r", render: (r) => <span className={r.unrealizedPnl >= 0 ? "text-profit" : "text-loss"}>{signedUsd(r.unrealizedPnl)}</span> },
  { key: "marginUsed", label: "Margin", align: "r", hidden: true, render: (r) => usdCompact(r.marginUsed) },
];
export function orderCols(now: number): Column<LargeOrder>[] {
  return [
    { key: "firstSeen", label: "Seen", align: "r", render: (r) => <span className="num text-muted-foreground">{hm(r.firstSeen)}</span> },
    { key: "venue", label: "Exchange", render: () => "Bybit" },
    { key: "symbol", label: "Symbol", render: (r) => <b className="font-mono">{r.symbol}USDT</b> },
    { key: "side", label: "Side", align: "c", sortVal: (r) => (r.side === "bid" ? 1 : 0), render: (r) => <span className={`rounded px-1 text-2xs ${r.side === "bid" ? "bg-buy-bg text-buy" : "bg-sell-bg text-sell"}`}>{r.side === "bid" ? "Buy wall" : "Sell wall"}</span> },
    { key: "price", label: "Limit Price", align: "r", render: (r) => price(r.price) },
    { key: "usd", label: "Value", align: "r", render: (r) => usdCompact(r.usd) },
    { key: "resting", label: "Placed", align: "r", sortVal: (r) => (r.resting ? 1 : 0), render: (r) => <><span className="text-muted-foreground">{ago(r.firstSeen, now)}</span> <span className={`ml-1 rounded px-1 text-2xs ${r.resting ? "bg-muted text-foreground" : "text-muted-foreground"}`}>{r.resting ? "resting" : "gone"}</span></> },
  ];
}

export function WhalesPage() {
  const whales = useWhales();
  const [tf, setTf] = useState<"1D" | "7D">("1D");
  const seen = useRef<Set<string>>(new Set());
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const now = Date.now();
  const d = whales.data?.data;
  useEffect(() => {
    if (!d) return;
    const next = new Set<string>();
    for (const a of d.alerts) {
      const k = alertKey(a);
      if (seen.current.size > 0 && !seen.current.has(k)) next.add(k);
      seen.current.add(k);
    }
    setFresh(next);
  }, [d]);
  const longs = useMemo(() => (d?.positions ?? []).filter((p) => p.side === "long"), [d]);
  const shorts = useMemo(() => (d?.positions ?? []).filter((p) => p.side === "short"), [d]);
  const resting = (d?.largeOrders ?? []).filter((o) => o.resting);
  const idx = sliceSeries(d?.activity ?? [], tf, now);
  const unavailable = whales.isError && !whales.data;
  const index = d?.index ?? 0;
  return (
    <div className="space-y-4" data-testid="whales-page" data-state={whales.isPending ? "loading" : unavailable ? "unavailable" : "ready"}>
      <h2 className="sr-only">Whales</h2>
      {unavailable ? <div className="rounded border border-dashed border-border p-4 text-xs text-muted-foreground" data-testid="whales-unavailable">No whale snapshot yet: the ingest scans the Hyperliquid leaderboard for wallets with open positions every minute.</div> : null}
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4" data-testid="whales-tiles">
        <Tile label="Tracked whale longs" value={usdCompact(longs.reduce((s, p) => s + p.notionalUsd, 0))} tone="profit" sub={`${longs.length} positions · uPnL ${signedUsd(longs.reduce((s, p) => s + p.unrealizedPnl, 0))}`} testId="tile-longs" />
        <Tile label="Tracked whale shorts" value={usdCompact(shorts.reduce((s, p) => s + p.notionalUsd, 0))} tone="loss" sub={`${shorts.length} positions · uPnL ${signedUsd(shorts.reduce((s, p) => s + p.unrealizedPnl, 0))}`} testId="tile-shorts" />
        <Tile label="Large limit orders" value={String(resting.length)} sub={`${usdCompact(resting.reduce((s, o) => s + o.usd, 0))} resting · Bybit perpetuals · ≥ ${usdCompact(d?.wallMinUsd ?? 1e6, 0)}`} testId="tile-orders" />
        <Tile label="Whale Index" value={<Gauge value={index} label="Whale Index" segs={[[0, 30, "hsl(var(--muted-foreground) / 0.35)"], [30, 70, "hsl(var(--curve) / 0.6)"], [70, 100, "hsl(var(--curve))"]]} testId="whale-gauge" />} sub={`${whaleIndexLabel(index)} · large-trader activity this hour`} testId="tile-index" />
      </div>
      <SourceLine snapshot={whales.data} />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <Panel title="Hyperliquid Whale Alerts" sub={`position opens / closes / changes ≥ ${usdCompact(d?.alertMinUsd ?? 1e6, 0)} between polls`} tools={<><span className="inline-block h-2 w-2 animate-pulse rounded-full bg-profit" aria-hidden="true" /><span className="text-2xs text-muted-foreground">every {Math.round((whales.data?.ttlMs ?? 60_000) / 1000)}s</span></>} testId="panel-alerts">
          <div className="max-h-[420px] overflow-y-auto" data-testid="whale-feed" data-rows={(d?.alerts ?? []).length}>
            {(d?.alerts ?? []).length === 0 ? (
              <div className="py-6 text-center text-xs text-muted-foreground" data-testid="whale-feed-empty">{d ? `Waiting for the first change above ${usdCompact(d.alertMinUsd, 0)}…` : "No alerts yet."}</div>
            ) : (
              d!.alerts.map((a) => {
                const k = alertKey(a);
                return (
                  <div key={k} className={`grid grid-cols-[64px_96px_minmax(0,1fr)_72px_minmax(0,1.4fr)_80px] items-center gap-2 border-b border-border py-1 text-xs ${fresh.has(k) ? "bg-muted/60" : ""}`} data-testid="whale-row" data-action={a.action}>
                    <span className="num text-muted-foreground">{hms(a.t)}</span>
                    <span className="font-mono text-2xs" title={a.wallet}>{shortWallet(a.wallet)}</span>
                    <Coin symbol={a.coin} />
                    <span className={`rounded px-1 text-center text-2xs ${a.side === "long" ? "bg-buy-bg text-buy" : "bg-sell-bg text-sell"}`}>{a.side === "long" ? "Long" : "Short"}</span>
                    <span className="truncate text-muted-foreground">{ACTION_LABEL[a.action]} {a.leverage ? `${a.leverage}× ` : ""}· now {usdCompact(a.positionUsd)}{a.entryPx ? ` · entry ${price(a.entryPx)}` : ""}</span>
                    <span className="num text-right font-medium">{usdCompact(a.changeUsd)}</span>
                  </div>
                );
              })
            )}
          </div>
        </Panel>
        <Panel title="Whale Index" sub="alert notional per hour against the busiest hour kept (7 days) · our composite" testId="panel-index">
          <Chart h={220} min={0} zero x={idx.x} xTip={idx.xTip} series={[{ label: "Alert notional", type: "area", data: idx.values, color: "hsl(var(--curve))", fmt: (v) => usdCompact(v) }]} yFmt={(v) => usdCompact(v, 0)} loading={whales.isPending} empty="The hourly series fills as alerts arrive" tf={{ options: ["1D", "7D"], value: tf, onChange: (t) => setTf(t === "7D" ? "7D" : "1D") }} testId="chart-index" />
          <p className="mt-1 text-2xs text-muted-foreground" data-testid="index-note">Index {index} · {whaleIndexLabel(index)}. Wallets: {d?.wallets.withPositions ?? 0} with positions of {d?.wallets.polled ?? 0} polled ({d?.wallets.source ?? "—"}).</p>
        </Panel>
      </div>
      <Panel title="Open Whale Positions" sub="largest open positions across the tracked Hyperliquid wallets" testId="panel-positions">
        <DataTable id="whale-positions" rows={d?.positions ?? []} cols={positionCols} rowKey={(r) => `${r.wallet}:${r.coin}`} sortKey="notionalUsd" search searchText={(r) => `${r.wallet} ${r.coin}`} searchPlaceholder="Wallet or coin…" columns csv="whale-positions" rowHref={(r) => `/analytics/coin/${r.coin}`} maxH={480} empty="No tracked wallet holds a position right now" compact />
      </Panel>
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Large limit orders" sub="resting buy/sell walls on Bybit perpetual books (Binance is unreachable from our ingest)" testId="panel-orders">
          <DataTable id="large-orders" rows={d?.largeOrders ?? []} cols={orderCols(now)} rowKey={(r) => `${r.venue}:${r.symbol}:${r.side}:${r.price}`} sortKey="usd" csv="large-orders" empty="No wall above the threshold right now" search={false} compact maxH={420} />
        </Panel>
        <Panel title="Exchange BTC Reserves" sub="on-chain balances · falling reserves = supply leaving exchanges" testId="panel-reserves">
          <ComingSoon title="Exchange reserves" why="Exchange wallet balances come from on-chain providers (CryptoQuant, Glassnode) that are paid or terms-restricted." />
        </Panel>
      </div>
    </div>
  );
}
