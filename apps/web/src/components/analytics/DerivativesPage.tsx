"use client";
// Derivatives (HC-MA-041..048, 113): one coin at a time — tiles, close price (CoinGecko 7-day sparkline), aggregated
// open interest, OI-weighted funding (± bars), global long/short with the 1.00 line, the basis panel (coming soon
// until an index-price feed lands, GAPS #57) and the cross-venue funding-rate arbitrage table.
import { useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { useAnalytics, useAnalyticsMany, useMarkets, useOverview } from "@/lib/api/analytics";
import { type ArbRow, arbRows, longShare, sparklineSeries, takerVolume24h, venueLabel } from "@/lib/analytics/derive";
import { type Timeframe, pct, price, sliceSeries, toneClass, usdCompact } from "@/lib/analytics/format";
import { Chart } from "./Chart";
import { type Column, DataTable } from "./DataTable";
import { Coin, CoinSelect, ComingSoon, Heat, Panel, SourceLine, Split, Tile, ViewAll } from "./bits";

const FUND_TFS: readonly Timeframe[] = ["7D", "30D", "90D", "1Y"];
const PX_TFS: readonly Timeframe[] = ["1D", "7D"];
export const arbCols: Column<ArbRow>[] = [
  { key: "symbol", label: "Coin", render: (r) => <Coin symbol={r.symbol} /> },
  { key: "longLeg", label: "Long leg", render: (r) => <><span className="rounded bg-buy-bg px-1 text-2xs text-buy">Long</span> {venueLabel(r.longLeg)} <span className="num text-muted-foreground">{pct(r.longRate, 4, true)}</span></> },
  { key: "shortLeg", label: "Short leg", render: (r) => <><span className="rounded bg-sell-bg px-1 text-2xs text-sell">Short</span> {venueLabel(r.shortLeg)} <span className="num text-muted-foreground">{pct(r.shortRate, 4, true)}</span></> },
  { key: "spread", label: "Spread (8h)", align: "r", render: (r) => <b>{pct(r.spread, 4, true)}</b> },
  { key: "fdelta", label: "Funding Δ (day)", align: "r", sortVal: (r) => r.spread * 3, render: (r) => <Heat v={r.spread * 3} fraction max={0.2} digits={3} /> },
  { key: "estApr", label: "Est. APR", align: "r", render: (r) => <span className="text-profit">{pct(r.estApr, 1, true)}</span> },
  { key: "minOi", label: "Min OI", align: "r", sortVal: (r) => r.minOi, render: (r) => usdCompact(r.minOi) },
];

export function DerivativesPage() {
  const router = useRouter();
  const params = useSearchParams();
  const overview = useOverview();
  const markets = useMarkets();
  const symbols = useMemo(() => {
    const list = [...(overview.data?.data.symbols ?? [])].sort((a, b) => b.oiUsd - a.oiUsd).map((s) => s.symbol);
    return list.length ? list : ["BTC"];
  }, [overview.data]);
  const [sym, setSym] = useState(() => (params.get("symbol") ?? "BTC").toUpperCase());
  const [tfPx, setTfPx] = useState<Timeframe>("7D");
  const [tfOi, setTfOi] = useState<Timeframe>("1D");
  const [tfFund, setTfFund] = useState<Timeframe>("30D");
  const [tfLs, setTfLs] = useState<Timeframe>("7D");
  const oi = useAnalytics("open-interest", sym);
  const funding = useAnalytics("funding", sym);
  const ls = useAnalytics("long-short", sym);
  const taker = useAnalytics("taker-volume", sym);
  const fundAll = useAnalyticsMany("funding", symbols);
  const row = overview.data?.data.symbols.find((s) => s.symbol === sym);
  const m = markets.data?.data.rows.find((r) => r.symbol === sym);
  const names = useMemo(() => Object.fromEntries((markets.data?.data.rows ?? []).map((r) => [r.symbol, r.name])), [markets.data]);
  const fundNow = funding.data?.data.oiWeighted.at(-1)?.v ?? null;
  const lsNow = ls.data?.data.latest.global.ratio ?? null;
  const takerVol = takerVolume24h(taker.data?.data.points ?? []);
  const pxSeries = useMemo(() => (m && markets.data ? sparklineSeries(m.sparkline7d, markets.data.asOf) : []), [m, markets.data]);
  const px = sliceSeries(pxSeries, tfPx);
  const oiS = sliceSeries(oi.data?.data.aggregated ?? [], tfOi);
  const fundS = sliceSeries(funding.data?.data.oiWeighted ?? [], tfFund);
  const lsS = sliceSeries(ls.data?.data.global ?? [], tfLs);
  const arb = useMemo(() => arbRows(fundAll.data.map((s) => s.data)), [fundAll.data]);
  const pending = oi.isPending || funding.isPending;
  const unavailable = !pending && !oi.data && !funding.data && !ls.data;
  const select = (s: string) => {
    setSym(s);
    router.replace(`/analytics/derivatives?symbol=${s}`);
  };
  return (
    <div className="space-y-4" data-testid="derivatives-page" data-symbol={sym} data-state={pending ? "loading" : unavailable ? "unavailable" : "ready"}>
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-[14px] font-medium">Derivatives</h2>
        <span className="text-2xs text-muted-foreground">perpetual futures · aggregated across the connected venues</span>
        <div className="ml-auto flex items-center gap-2">
          <CoinSelect value={sym} symbols={symbols} names={names} onChange={select} />
          <ViewAll href={`/analytics/coin/${sym}`}>Full coin analytics →</ViewAll>
        </div>
      </div>
      {unavailable ? <div className="rounded border border-dashed border-border p-4 text-xs text-muted-foreground" data-testid="derivatives-unavailable">No derivatives snapshot for {sym} yet. The ingest writes funding, open interest and long/short per tracked symbol; check ANALYTICS_SYMBOLS and the venues it can reach.</div> : null}
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4" data-testid="derivatives-tiles">
        <Tile label="Open interest" value={usdCompact(oi.data?.data.totalUsd ?? row?.oiUsd)} sub={<><b className={toneClass(row?.oiChange24h)}>{pct(row?.oiChange24h, 2, true)}</b> 24h · {oi.data?.data.venues.length ?? row?.venues ?? 0} venues</>} testId="tile-oi" />
        <Tile label="24h volume" value={usdCompact(takerVol ?? m?.volume24h)} sub={takerVol !== null ? `Perp taker · ${taker.data?.source ?? ""}` : m ? "Spot · CoinGecko" : "waiting for taker volume"} testId="tile-vol" />
        <Tile label="Funding" value={pct(fundNow, 4, true)} tone={fundNow === null ? "muted" : fundNow >= 0 ? "profit" : "loss"} sub={`OI-weighted · 8h · APR ${pct(fundNow === null ? null : fundNow * 3 * 365, 1, true)}`} testId="tile-funding" />
        <Tile label="L/S ratio · 24h" value={lsNow === null ? "—" : lsNow.toFixed(2)} tone={lsNow === null ? "muted" : lsNow >= 1 ? "profit" : "loss"} sub={lsNow === null ? "waiting for a venue" : <>Global accounts · <span className="text-profit num">L {longShare(lsNow).toFixed(1)}%</span> <span className="text-loss num">S {(100 - longShare(lsNow)).toFixed(1)}%</span></>} extra={lsNow === null ? null : <Split long={longShare(lsNow)} short={100 - longShare(lsNow)} />} testId="tile-ls" />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Close price" sub={m ? `${sym} · spot · CoinGecko 7-day sparkline` : `${sym} · needs CoinGecko`} testId="panel-px">
          <Chart h={200} x={px.x} xTip={px.xTip} series={[{ label: "Close", type: "area", data: px.values, color: "hsl(var(--foreground))", fmt: price }]} yFmt={(v) => (v >= 1000 ? usdCompact(v, 1) : price(v))} loading={markets.isPending} empty={m ? "Nothing to plot" : "Price history needs the markets dataset (CoinGecko)"} tf={{ options: PX_TFS, value: tfPx, onChange: setTfPx }} testId="chart-px" />
        </Panel>
        <Panel title="Open Interest" sub={`aggregated · ${oi.data?.source ?? "connected venues"}`} testId="panel-oi">
          <Chart h={200} x={oiS.x} xTip={oiS.xTip} series={[{ label: "Open Interest", type: "area", data: oiS.values, color: "hsl(var(--curve))", fmt: (v) => usdCompact(v) }]} yFmt={(v) => usdCompact(v, 1)} loading={oi.isPending} empty={oiS.covered ? "Nothing to plot" : "Venue history covers less than this range (GAPS #56)"} tf={{ value: tfOi, onChange: setTfOi }} testId="chart-oi" />
          <SourceLine snapshot={oi.data} />
        </Panel>
        <Panel title="Funding" sub="OI-weighted · % · 8h" testId="panel-funding">
          <Chart h={200} zero x={fundS.x} xTip={fundS.xTip} series={[{ label: "Funding", type: "bar", data: fundS.values.map((v) => Number((v * 100).toFixed(4))), color: "hsl(var(--profit))", colorNeg: "hsl(var(--loss))", fmt: (v) => `${v.toFixed(4)}%` }]} yFmt={(v) => `${v.toFixed(3)}%`} loading={funding.isPending} empty={fundS.covered ? "Nothing to plot" : "Venue history covers less than this range (GAPS #56)"} tf={{ options: FUND_TFS, value: tfFund, onChange: setTfFund }} testId="chart-funding" />
          <SourceLine snapshot={funding.data} />
        </Panel>
        <Panel title="Global account ratio" sub={`L/S Ratio · ${ls.data?.source ?? "Binance"}`} testId="panel-ls">
          <Chart h={200} x={lsS.x} xTip={lsS.xTip} series={[{ label: "L/S Ratio", type: "line", data: lsS.values, color: "hsl(var(--curve))", fmt: (v) => v.toFixed(2) }]} yFmt={(v) => v.toFixed(2)} hlines={[{ y: 1, label: "1.00" }]} loading={ls.isPending} empty={ls.data ? "Nothing to plot for this range" : "Long/short needs a venue that serves account ratios (Binance or Bybit)"} tf={{ value: tfLs, onChange: setTfLs }} testId="chart-ls" />
          <SourceLine snapshot={ls.data} />
        </Panel>
      </div>
      <Panel title="Basis" sub="Perp/spot basis % · positive = contango" testId="panel-basis">
        <ComingSoon title="Basis" why="Needs each venue's mark and index price on the ingest; the tickers job is queued behind the free-feed work." gap={57} />
      </Panel>
      <Panel title="Funding Rate Arbitrage" sub="Cross-exchange funding spreads · long the negative leg, short the positive leg" tools={<span className="micro" data-testid="arb-count">{fundAll.pending ? "loading…" : `${arb.length} of ${symbols.length} coins`}</span>} testId="panel-arb">
        <DataTable id="arb" rows={arb} cols={arbCols} rowKey={(r) => r.symbol} sortKey="estApr" csv="funding-arbitrage" rowHref={(r) => `/analytics/coin/${r.symbol}`} empty={fundAll.pending ? "Loading funding for every tracked coin…" : "No coin has funding from two or more venues yet"} search={false} />
      </Panel>
    </div>
  );
}
