"use client";
// Futures overview (HC-MA-030..037, 108, 109): tiles, BTC price & aggregated OI (dual axis), BTC long/short bars,
// Fear & Greed gauge with history, gainers/losers tables, heatmap and the ETF panel (coming soon). Timeframe chips on
// the two main charts read the series from the overview snapshot.
import type { MarketRow } from "@hapiecoin/schema";
import { useState } from "react";
import { useOverview } from "@/lib/api/analytics";
import { type Timeframe, pct, price, sliceSeries, toneClass, usdCompact } from "@/lib/analytics/format";
import { Chart } from "./Chart";
import { type Column, DataTable } from "./DataTable";
import { Coin, ComingSoon, Gauge, Heat, Panel, SourceLine, Split, Tile, Treemap, ViewAll } from "./bits";

const glCols: Column<MarketRow>[] = [
  { key: "symbol", label: "Coin", render: (r) => <Coin symbol={r.symbol} /> },
  { key: "price", label: "Price", align: "r", render: (r) => price(r.price) },
  { key: "change24h", label: "24h %", align: "r", render: (r) => <Heat v={r.change24h} /> },
  { key: "volume24h", label: "Volume", align: "r", render: (r) => usdCompact(r.volume24h) },
];

export function OverviewPage() {
  const overview = useOverview();
  const [tfOi, setTfOi] = useState<Timeframe>("1D");
  const [tfLs, setTfLs] = useState<Timeframe>("7D");
  const o = overview.data?.data;
  const liq = o?.liquidations24h;
  const ls = o?.btcLongShort;
  const longPct = ls ? (ls.long / (ls.long + ls.short || 1)) * 100 : null;
  const oi = sliceSeries(o?.oiHistory ?? [], tfOi);
  const lsS = sliceSeries(o?.lsHistory ?? [], tfLs);
  const lsLong = lsS.values.map((g) => Number(((g / (1 + g)) * 100).toFixed(1)));
  const fg = o?.fearGreedHistory ?? [];
  const fgAt = (daysBack: number) => fg[fg.length - 1 - daysBack]?.v;
  const fgSpark = sliceSeries(fg, "30D");
  const unavailable = overview.isError && !overview.data;
  return (
    <div className="space-y-4" data-testid="overview-page" data-state={overview.isPending ? "loading" : unavailable ? "unavailable" : "ready"}>
      <h2 className="sr-only">Futures overview</h2>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4" data-testid="overview-tiles">
        <Tile label="Open Interest" value={usdCompact(o?.totalOiUsd)} sub={<span>Tracked symbols · aggregated <b className={toneClass(o?.oiChange24h)}>{pct(o?.oiChange24h, 2, true)}</b></span>} testId="tile-oi" />
        <Tile label="24h Volume" value={usdCompact(o?.markets?.volume24h)} sub={o?.markets ? "Spot · all coins (CoinGecko)" : "needs CoinGecko"} testId="tile-vol" />
        <Tile label="Liquidations 24h" value={usdCompact(liq ? liq.longUsd + liq.shortUsd : null)} sub={<><span className="text-profit num">L {usdCompact(liq?.longUsd)}</span><span className="text-loss num">S {usdCompact(liq?.shortUsd)}</span></>} extra={liq ? <Split long={liq.longUsd} short={liq.shortUsd} /> : null} testId="tile-liq" />
        <Tile label="Fear & Greed" value={o?.fearGreed?.value ?? "—"} sub={o?.fearGreed?.label ?? "waiting for alternative.me"} tone={o?.fearGreed ? (o.fearGreed.value < 45 ? "loss" : o.fearGreed.value > 55 ? "profit" : "muted") : "muted"} testId="tile-fg" />
        <Tile label="BTC Price" value={price(o?.markets?.btcPrice)} sub={<><b className={toneClass(o?.markets?.btcChange24h)}>{pct(o?.markets?.btcChange24h)}</b> 24h</>} testId="tile-btc" />
        <Tile label="ETH Price" value={price(o?.markets?.ethPrice)} sub={<><b className={toneClass(o?.markets?.ethChange24h)}>{pct(o?.markets?.ethChange24h)}</b> 24h</>} testId="tile-eth" />
        <Tile label="BTC Dominance" value={o?.markets?.btcDominance !== null && o?.markets?.btcDominance !== undefined ? `${o.markets.btcDominance.toFixed(1)}%` : "—"} sub={`ETH ${o?.markets?.ethDominance?.toFixed(1) ?? "—"}%`} testId="tile-dominance" />
        <Tile label="Long/Short Ratio" value={ls ? ls.ratio.toFixed(2) : "—"} sub={longPct !== null ? <>BTC global · <span className="text-profit num">L {longPct.toFixed(1)}%</span> <span className="text-loss num">S {(100 - longPct).toFixed(1)}%</span></> : "waiting for Binance"} extra={longPct !== null ? <Split long={longPct} short={100 - longPct} /> : null} testId="tile-ls" />
      </div>
      <SourceLine snapshot={overview.data} />
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="BTC Price & Open Interest" sub="aggregated · tracked symbols" testId="panel-oi">
          <Chart
            h={230}
            rightAxis
            x={oi.x}
            xTip={oi.xTip}
            series={[{ label: "Open Interest", type: "area", data: oi.values, color: "hsl(var(--curve))", fmt: (v) => usdCompact(v) }]}
            yFmt={(v) => usdCompact(v, 1)}
            loading={overview.isPending}
            empty={oi.covered ? "Nothing to plot" : "Provider history covers less than this range"}
            tf={{ value: tfOi, onChange: setTfOi }}
            testId="chart-oi"
          />
          <p className="mt-1 text-2xs text-muted-foreground">Price overlay arrives with the coin pages; the venues' OI history covers up to 30 days (GAPS #56).</p>
        </Panel>
        <Panel title="BTC Long / Short Ratio" sub="global accounts · Binance" testId="panel-ls">
          <Chart
            h={230}
            stack
            tight
            x={lsS.x}
            xTip={lsS.xTip}
            series={[
              { label: "Long %", type: "bar", data: lsLong, color: "hsl(var(--profit))", fmt: (v) => `${v.toFixed(1)}%` },
              { label: "Short %", type: "bar", data: lsLong.map((l) => Number((100 - l).toFixed(1))), color: "hsl(var(--loss))", fmt: (v) => `${v.toFixed(1)}%` },
            ]}
            yFmt={(v) => `${v.toFixed(0)}%`}
            loading={overview.isPending}
            tf={{ value: tfLs, onChange: setTfLs }}
            testId="chart-ls"
          />
        </Panel>
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <Panel title="Fear & Greed Index" sub="daily" testId="panel-fg">
          {o?.fearGreed ? (
            <div className="flex flex-col items-center gap-2">
              <Gauge value={o.fearGreed.value} size={170} thick={11} label="Fear & Greed" testId="fg-gauge" />
              <div className="text-xs font-medium">{o.fearGreed.label}</div>
              <div className="flex gap-4 text-2xs text-muted-foreground" data-testid="fg-history">
                <span>Yesterday <b className="num text-foreground">{fgAt(1) ?? "—"}</b></span>
                <span>7d ago <b className="num text-foreground">{fgAt(7) ?? "—"}</b></span>
                <span>30d ago <b className="num text-foreground">{fgAt(30) ?? "—"}</b></span>
              </div>
              <div className="w-full">
                <Chart h={70} x={fgSpark.x} xTip={fgSpark.xTip} series={[{ label: "F&G", type: "area", data: fgSpark.values, color: "hsl(var(--primary))" }]} legend={false} min={0} max={100} tight yTicks={1} yFmt={(v) => v.toFixed(0)} testId="chart-fg" />
              </div>
            </div>
          ) : (
            <div className="text-xs text-muted-foreground">Waiting for alternative.me.</div>
          )}
        </Panel>
        <Panel title="Top Gainers (24h)" testId="panel-gainers">
          {o?.markets ? <DataTable id="gainers" rows={o.markets.gainers.slice(0, 7)} cols={glCols} rowKey={(r) => r.symbol} rowHref={(r) => `/analytics/coin/${r.symbol}`} compact search={false} /> : <ComingSoon title="Needs CoinGecko" why="Set COINGECKO_API_KEY on the ingest service." gap={56} />}
        </Panel>
        <Panel title="Top Losers (24h)" testId="panel-losers">
          {o?.markets ? <DataTable id="losers" rows={o.markets.losers.slice(0, 7)} cols={glCols} rowKey={(r) => r.symbol} rowHref={(r) => `/analytics/coin/${r.symbol}`} compact search={false} /> : <ComingSoon title="Needs CoinGecko" why="Set COINGECKO_API_KEY on the ingest service." gap={56} />}
        </Panel>
      </div>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_420px]">
        <Panel title="Heatmap (24h)" sub="top 24 by market cap" testId="panel-heat">
          {o?.markets?.heatmap.length ? <Treemap items={o.markets.heatmap} h={300} /> : <div className="text-xs text-muted-foreground">Needs the markets dataset (CoinGecko).</div>}
        </Panel>
        <Panel title="Total Bitcoin Spot ETF Net Inflow" sub="daily · USD" tools={<ViewAll href="/analytics/etf">View all →</ViewAll>} testId="panel-etf">
          <ComingSoon title="ETF flows" why="Daily spot-ETF flows come from a paid or terms-restricted source; this panel fills in once a provider is chosen." />
        </Panel>
      </div>
      <p className="micro text-center" data-testid="overview-footer">Data via {overview.data?.source ?? "the ingest service"} · auto-refreshing every {Math.round((overview.data?.ttlMs ?? 60_000) / 1000)}s</p>
    </div>
  );
}
