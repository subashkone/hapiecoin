"use client";
// Liquidations (HC-MA-060..066, 116): long/short/ratio tiles, the stacked bars for 1h / 4h / 12h / 24h, by-exchange
// bars, the top-coins table with search + CSV, and the feed of the newest events with a Min USD filter. Everything
// comes from the single `liquidations` snapshot (24 h window, hourly buckets, newest 100 events; ADR-038).
import type { LiquidationEvent, LiquidationsData } from "@hapiecoin/schema";
import { useEffect, useMemo, useRef, useState } from "react";
import { useLiquidations } from "@/lib/api/analytics";
import { LIQ_WINDOWS, type LiqWindow, liqWindow, venueLabel } from "@/lib/analytics/derive";
import { price, usdCompact } from "@/lib/analytics/format";
import { Chart } from "./Chart";
import { Chips } from "./Chips";
import { type Column, DataTable } from "./DataTable";
import { Coin, HBars, Panel, SourceLine, Split, Tile, ViewAll } from "./bits";

export const MIN_USD = [0, 1_000, 10_000, 50_000, 100_000, 500_000] as const;
const minLabel = (v: number) => (v === 0 ? "All" : `$${v >= 1000 ? `${v / 1000}K` : v}`);
type CoinLiq = LiquidationsData["bySymbol"][number];
export const topCols: Column<CoinLiq>[] = [
  { key: "symbol", label: "Coin", render: (r) => <Coin symbol={r.symbol} /> },
  { key: "total", label: "Total", align: "r", sortVal: (r) => r.longUsd + r.shortUsd, render: (r) => usdCompact(r.longUsd + r.shortUsd) },
  { key: "longUsd", label: "Long", align: "r", render: (r) => <span className="text-profit">{usdCompact(r.longUsd)}</span> },
  { key: "shortUsd", label: "Short", align: "r", render: (r) => <span className="text-loss">{usdCompact(r.shortUsd)}</span> },
  { key: "bias", label: "L/S Bias", sortVal: (r) => r.longUsd / (r.longUsd + r.shortUsd || 1), render: (r) => <span className="flex w-[120px] items-center gap-2"><span className="flex-1"><Split long={r.longUsd} short={r.shortUsd} /></span><span className="num w-9 text-right text-2xs">{((r.longUsd / (r.longUsd + r.shortUsd || 1)) * 100).toFixed(0)}%</span></span> },
];
const WINDOW_KEYS = LIQ_WINDOWS.map((w) => `${w}h`);
const hms = (t: number) => new Date(t).toLocaleTimeString("en-GB", { hour12: false });
const eventKey = (e: LiquidationEvent) => `${e.venue}:${e.t}:${e.symbol}:${e.price}:${e.qty}`;
const binLabel = (t: number, binMs: number) => (binMs >= 3600e3 ? `${String(new Date(t).getHours()).padStart(2, "0")}:00` : `${String(new Date(t).getHours()).padStart(2, "0")}:${String(new Date(t).getMinutes()).padStart(2, "0")}`);

export function LiquidationsPage() {
  const liq = useLiquidations();
  const [win, setWin] = useState<LiqWindow>(24);
  const [minUsd, setMinUsd] = useState<number>(0);
  const seen = useRef<Set<string>>(new Set());
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const d = liq.data?.data;
  const total = d ? d.total.longUsd + d.total.shortUsd : null;
  const ratio = d && d.total.shortUsd > 0 ? d.total.longUsd / d.total.shortUsd : null;
  const bars = useMemo(() => (d ? liqWindow(d, win) : null), [d, win]);
  const feed = useMemo(() => (d?.recent ?? []).filter((e) => e.usd >= minUsd).slice(0, 40), [d, minUsd]);
  useEffect(() => {
    if (!d) return;
    const next = new Set<string>();
    for (const e of d.recent) {
      const k = eventKey(e);
      if (seen.current.size > 0 && !seen.current.has(k)) next.add(k);
      seen.current.add(k);
    }
    setFresh(next);
  }, [d]);
  const unavailable = liq.isError && !liq.data;
  return (
    <div className="space-y-4" data-testid="liquidations-page" data-state={liq.isPending ? "loading" : unavailable ? "unavailable" : "ready"}>
      <h2 className="sr-only">Liquidations</h2>
      {unavailable ? <div className="rounded border border-dashed border-border p-4 text-xs text-muted-foreground" data-testid="liquidations-unavailable">No liquidation snapshot yet: the ingest writes one every few seconds once a venue stream is connected.</div> : null}
      <div className="grid grid-cols-1 gap-2 md:grid-cols-3" data-testid="liquidations-tiles">
        <Tile label="Long Liquidations" value={usdCompact(d?.total.longUsd)} tone="profit" sub={`24h · ${total ? (((d?.total.longUsd ?? 0) / total) * 100).toFixed(1) : "—"}% of total`} extra={d ? <Split long={d.total.longUsd} short={0} /> : null} testId="tile-long" />
        <Tile label="Short Liquidations" value={usdCompact(d?.total.shortUsd)} tone="loss" sub={`24h · ${total ? (((d?.total.shortUsd ?? 0) / total) * 100).toFixed(1) : "—"}% of total`} extra={d ? <Split long={0} short={d.total.shortUsd} /> : null} testId="tile-short" />
        <Tile label="Long / Short Ratio" value={ratio === null ? "—" : ratio.toFixed(2)} sub={`Total 24h ${usdCompact(total)} · top coin ${d?.bySymbol[0]?.symbol ?? "—"}`} extra={d ? <Split long={d.total.longUsd} short={d.total.shortUsd} /> : null} testId="tile-ratio" />
      </div>
      <SourceLine snapshot={liq.data} />
      <Panel title={`${win}h Liquidations Over Time`} sub={`aggregated across ${liq.data?.source ?? "the connected venues"}${bars?.fromEvents ? " · from the newest events" : ""}`} tools={<Chips items={WINDOW_KEYS} value={`${win}h`} onChange={(k) => setWin(Number(k.slice(0, -1)) as LiqWindow)} testId="liq-window" />} testId="panel-liq">
        <Chart
          h={230}
          stack
          zero
          x={(bars?.points ?? []).map((p) => binLabel(p.t, bars?.binMs ?? 3600e3))}
          xTip={(bars?.points ?? []).map((p) => new Date(p.t).toLocaleString("en-US", { month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }))}
          series={[
            { label: "Long Liq", type: "bar", data: (bars?.points ?? []).map((p) => p.longUsd), color: "hsl(var(--profit))", fmt: (v) => usdCompact(v) },
            { label: "Short Liq", type: "bar", data: (bars?.points ?? []).map((p) => p.shortUsd), color: "hsl(var(--loss))", fmt: (v) => usdCompact(v) },
          ]}
          yFmt={(v) => usdCompact(v, 1)}
          loading={liq.isPending}
          empty="No liquidations captured in this window"
          testId="chart-liq"
        />
        {bars?.capped ? <p className="mt-1 text-2xs text-muted-foreground" data-testid="liq-capped">The event buffer keeps the newest {d?.recent.length ?? 0} liquidations, which do not reach back the full {win}h.</p> : null}
      </Panel>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
        <Panel title="Liquidations by Exchange" sub="24h window" testId="panel-exchange">
          <HBars items={(d?.byVenue ?? []).map((v) => ({ label: venueLabel(v.venue), value: v.longUsd + v.shortUsd }))} testId="liq-exchanges" />
        </Panel>
        <Panel title="Top Coins by Liquidation" sub="24h window · click a row for full coin analytics" tools={<ViewAll href="/analytics/markets">View all markets →</ViewAll>} testId="panel-top">
          <DataTable id="liq-top" rows={d?.bySymbol ?? []} cols={topCols} rowKey={(r) => r.symbol} sortKey="total" limit={12} maxH={360} search searchText={(r) => r.symbol} searchPlaceholder="Filter coins…" csv="liquidations-by-coin" rowHref={(r) => `/analytics/coin/${r.symbol}`} empty="No coins" compact />
        </Panel>
      </div>
      <Panel
        title="Live Liquidation Feed"
        sub={`${liq.data?.source ?? "connected venues"} · refreshes every ${Math.round((liq.data?.ttlMs ?? 15_000) / 1000)}s`}
        tools={
          <>
            <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-profit" aria-hidden="true" />
            <span className="text-2xs text-muted-foreground">live</span>
            <label className="text-2xs text-muted-foreground" htmlFor="liq-min">Min USD</label>
            <select id="liq-min" value={minUsd} onChange={(e) => setMinUsd(Number(e.target.value))} className="h-7 rounded border border-border bg-card px-2 font-mono text-xs" aria-label="Minimum liquidation size" data-testid="liq-min">
              {MIN_USD.map((v) => (
                <option key={v} value={v}>{minLabel(v)}</option>
              ))}
            </select>
          </>
        }
        testId="panel-feed"
      >
        <div className="max-h-[420px] overflow-y-auto" data-testid="liq-feed" data-rows={feed.length}>
          {feed.length === 0 ? (
            <div className="py-6 text-center text-xs text-muted-foreground" data-testid="liq-feed-empty">{d?.recent.length ? `No liquidations above ${minLabel(minUsd)}` : "No liquidations captured yet."}</div>
          ) : (
            feed.map((e) => {
              const k = eventKey(e);
              return (
                <div key={k} className={`grid grid-cols-[64px_72px_minmax(0,1fr)_120px_120px_80px] items-center gap-2 border-b border-border py-1 text-xs ${fresh.has(k) ? "bg-muted/60" : ""}`} data-testid="liq-row" data-side={e.side}>
                  <span className="num text-muted-foreground">{hms(e.t)}</span>
                  <span>{venueLabel(e.venue)}</span>
                  <Coin symbol={e.symbol} />
                  <span className={`rounded px-1 text-2xs ${e.side === "long" ? "bg-buy-bg text-buy" : "bg-sell-bg text-sell"}`}>{e.side === "long" ? "Long Liquidated" : "Short Liquidated"}</span>
                  <span className="num text-muted-foreground">@ {price(e.price)}</span>
                  <span className="num text-right font-medium">{usdCompact(e.usd)}</span>
                </div>
              );
            })
          )}
        </div>
      </Panel>
    </div>
  );
}
