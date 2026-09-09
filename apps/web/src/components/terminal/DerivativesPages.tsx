"use client";
// Terminal derivatives screens (HC-MT-114..134, 167..170): Open Interest (aggregated OI with the BTC price on the
// right axis, per-exchange table with share bars), Funding Rates (OI-weighted bars, per-exchange current / predicted /
// annualised), Long / Short (three ratios, the hourly readings) and Liquidations (window chips, by-coin table). The
// funding and long/short pages carry a coin selector; everything derives from the snapshots the ingest already writes.
import { useMemo, useState } from "react";
import { useAnalytics, useAnalyticsMany, useLiquidations, useMarkets, useOverview } from "@/lib/api/analytics";
import { LIQ_WINDOWS, type LiqWindow, alignTo, liqWindow, sparklineSeries, venueLabel } from "@/lib/analytics/derive";
import { type Timeframe, pct, price, sliceSeries, toneClass, usdCompact } from "@/lib/analytics/format";
import { annualised, avgFunding, hourlyReadings, largestCoin, venueTotals } from "@/lib/terminal/derive";
import { Chart } from "@/components/analytics/Chart";
import { Chips } from "@/components/analytics/Chips";
import { type Column, DataTable } from "@/components/analytics/DataTable";
import { Coin, CoinSelect, Heat, Panel, SourceLine, Split, Tile } from "@/components/analytics/bits";
import { PageTitle } from "./TerminalShell";

const FUND_TFS: readonly Timeframe[] = ["7D", "30D", "90D", "1Y"];
const exHref = (r: { venue: string }) => `/terminal/exchanges/${r.venue}`;
const coinHref = (r: { symbol: string }) => `/terminal/coin/${r.symbol}`;
const hm = (t: number) => `${String(new Date(t).getHours()).padStart(2, "0")}:${String(new Date(t).getMinutes()).padStart(2, "0")}`;
const mdt = (t: number) => new Date(t).toLocaleString("en-US", { month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
const ratioTone = (v: number | null | undefined): "profit" | "loss" | "muted" => (v === null || v === undefined ? "muted" : v >= 1 ? "profit" : "loss");
const fmtPx = (v: number) => (v >= 1000 ? usdCompact(v, 1) : price(v));

function useSymbols() {
  const overview = useOverview();
  const symbols = useMemo(() => (overview.data?.data.symbols ?? []).map((s) => s.symbol), [overview.data]);
  return { overview, symbols };
}

interface VenueOi { venue: string; oiUsd: number; share: number; coins: number }
export const oiCols: Column<VenueOi>[] = [
  { key: "venue", label: "Exchange", render: (r) => <b>{venueLabel(r.venue)}</b> },
  { key: "oiUsd", label: "Open Interest", align: "r", render: (r) => usdCompact(r.oiUsd) },
  { key: "share", label: "Share", align: "r", render: (r) => <span className="inline-flex w-[120px] items-center justify-end gap-2"><span className="h-1.5 max-w-[64px] flex-1 overflow-hidden rounded bg-muted"><i className="block h-full rounded bg-[hsl(var(--curve))]" style={{ width: `${(r.share * 100).toFixed(1)}%` }} /></span><span className="num">{(r.share * 100).toFixed(1)}%</span></span> },
  { key: "coins", label: "Coins", align: "r", hidden: true, render: (r) => r.coins },
];

export function OpenInterestPage() {
  const { overview, symbols } = useSymbols();
  const markets = useMarkets();
  const oi = useAnalyticsMany("open-interest", symbols);
  const [tf, setTf] = useState<Timeframe>("1D");
  const now = Date.now();
  const o = overview.data?.data;
  const btc = o?.symbols.find((s) => s.symbol === "BTC");
  const totals = useMemo(() => venueTotals(oi.data.map((d) => d.data)), [oi.data]);
  const top = totals[0];
  const hist = o?.oiHistory ?? [];
  const btcRow = markets.data?.data.rows.find((r) => r.symbol === "BTC");
  const chart = useMemo(() => {
    const base = sliceSeries(hist, tf, now);
    const raw = hist.filter((p) => p.t >= now - (tf === "1D" ? 864e5 : 7 * 864e5));
    const picked = raw.length > 120 ? base.values.map((_, i) => raw[Math.round((i * (raw.length - 1)) / 119)]!) : raw;
    const px = btcRow && markets.data ? alignTo(picked, sparklineSeries(btcRow.sparkline7d, markets.data.asOf)) : [];
    return { ...base, px: tf === "1D" || tf === "7D" ? px : [] };
  }, [hist, tf, now, btcRow, markets.data]);
  return (
    <div className="space-y-4" data-testid="oi-page" data-state={overview.isPending ? "loading" : overview.data ? "ready" : "unavailable"}>
      <PageTitle title="Open Interest" sub="Aggregated perpetual open interest · every venue reporting" />
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-3" data-testid="oi-tiles">
        <Tile label="Aggregated OI" value={usdCompact(o?.totalOiUsd)} sub={<><b className={toneClass(o?.oiChange24h)}>{pct(o?.oiChange24h, 2, true)}</b> 24h · tracked coins</>} testId="tile-agg" />
        <Tile label="BTC OI" value={usdCompact(btc?.oiUsd)} sub={btc && o?.totalOiUsd ? `BTC dominance ${((btc.oiUsd / o.totalOiUsd) * 100).toFixed(1)}% of OI` : "waiting for the BTC snapshot"} testId="tile-btc" />
        <Tile label="Top Exchange" value={top ? venueLabel(top.venue) : "—"} sub={top ? `${(top.share * 100).toFixed(1)}% · ${usdCompact(top.oiUsd)}` : oi.settled ? "no venue reported" : "summing the venues…"} testId="tile-top" />
      </div>
      <Panel title="Aggregated Open Interest" sub="OI USD (area) · BTC price on the right axis from the CoinGecko sparkline (1D / 7D)" testId="panel-oi">
        <Chart h={260} rightAxis x={chart.x} xTip={chart.xTip} series={[{ label: "Open Interest", type: "area", data: chart.values, color: "hsl(var(--curve))", fmt: (v) => usdCompact(v) }, { label: "BTC price", type: "line", axis: "r", data: chart.px, color: "hsl(var(--foreground))", width: 1.2, fmt: fmtPx }]} yFmt={(v) => usdCompact(v, 1)} loading={overview.isPending} empty={chart.covered ? "Nothing to plot" : "Provider history covers less than this range"} tf={{ value: tf, onChange: setTf }} testId="chart-oi" />
        <SourceLine snapshot={overview.data} />
      </Panel>
      <Panel title="Open Interest by Exchange" sub="summed over the tracked coins · click a row to open the exchange" testId="panel-exchanges">
        <DataTable id="oi-exchanges" rows={totals} cols={oiCols} rowKey={(r) => r.venue} sortKey="oiUsd" search={false} columns csv="oi-by-exchange" rowHref={exHref} compact empty={oi.settled ? "No venue has reported open interest yet" : "Summing the venue snapshots…"} />
        <SourceLine snapshot={oi.data[0]} />
      </Panel>
    </div>
  );
}

interface FundRow { venue: string; rate: number; predicted: number | null; oiUsd: number | null; apr: number }
export const fundCols: Column<FundRow>[] = [
  { key: "venue", label: "Exchange", render: (r) => <b>{venueLabel(r.venue)}</b> },
  { key: "rate", label: "Funding", align: "r", render: (r) => <Heat v={r.rate} fraction max={0.03} digits={4} /> },
  { key: "predicted", label: "Predicted", align: "r", render: (r) => <span className={toneClass(r.predicted)}>{pct(r.predicted, 4, true)}</span> },
  { key: "oiUsd", label: "Open Interest", align: "r", render: (r) => usdCompact(r.oiUsd) },
  { key: "apr", label: "Annualised", align: "r", render: (r) => <span className={toneClass(r.apr)}>{pct(r.apr, 1, true)}</span> },
];

export function FundingPage() {
  const { symbols } = useSymbols();
  const [sym, setSym] = useState("BTC");
  const [tf, setTf] = useState<Timeframe>("30D");
  const funding = useAnalytics("funding", sym);
  const oi = useAnalytics("open-interest", sym);
  const now = Date.now();
  const f = funding.data?.data;
  const weighted = f?.oiWeighted.at(-1)?.v ?? null;
  const avg = f ? avgFunding(f.venues) : null;
  const series = sliceSeries(f?.oiWeighted ?? [], tf, now);
  const rows = useMemo<FundRow[]>(() => (f?.venues ?? []).map((v) => ({ venue: v.venue, rate: v.rate, predicted: v.predicted, oiUsd: v.oiUsd ?? oi.data?.data.venues.find((x) => x.venue === v.venue)?.oiUsd ?? null, apr: v.apr })), [f, oi.data]);
  return (
    <div className="space-y-4" data-testid="funding-page" data-symbol={sym} data-state={funding.isPending ? "loading" : funding.data ? "ready" : "unavailable"}>
      <PageTitle title="Funding Rates" sub={`${sym}USDT perpetual · 8h settlements · OI-weighted across the venues`} tools={<CoinSelect value={sym} symbols={symbols.length ? symbols : ["BTC"]} onChange={setSym} />} />
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-3" data-testid="funding-tiles">
        <Tile label="OI-Weighted Funding" value={pct(weighted, 4, true)} sub="per 8h · latest" tone={weighted === null ? "muted" : weighted >= 0 ? "profit" : "loss"} testId="tile-weighted" />
        <Tile label="Average Funding" value={pct(avg, 4, true)} sub={f ? `plain mean of ${f.venues.length} venues` : "waiting for the snapshot"} tone={avg === null ? "muted" : avg >= 0 ? "profit" : "loss"} testId="tile-avg" />
        <Tile label="Annualised" value={pct(annualised(weighted), 1, true)} sub="OI-weighted × 3 × 365" tone={weighted === null ? "muted" : weighted >= 0 ? "profit" : "loss"} testId="tile-apr" />
      </div>
      <Panel title="OI-Weighted Funding" sub="Funding % · 8h intervals · sign-coloured" testId="panel-funding">
        <Chart h={240} zero x={series.x} xTip={series.xTip} series={[{ label: "Funding", type: "bar", data: series.values.map((v) => Number((v * 100).toFixed(4))), color: "hsl(var(--profit))", colorNeg: "hsl(var(--loss))", fmt: (v) => `${v.toFixed(4)}%` }]} yFmt={(v) => `${v.toFixed(3)}%`} loading={funding.isPending} empty={series.covered ? "No funding history yet" : "Provider history covers less than this range"} tf={{ options: FUND_TFS, value: tf, onChange: setTf }} testId="chart-funding" />
        <SourceLine snapshot={funding.data} />
      </Panel>
      <Panel title="Per-exchange Funding" sub={`${sym} perpetual funding per venue · click a row to open the exchange`} testId="panel-venues">
        <DataTable id="funding-venues" rows={rows} cols={fundCols} rowKey={(r) => r.venue} sortKey="rate" search={false} csv={`${sym}-funding-by-exchange`} rowHref={exHref} compact empty="No venue has reported funding for this coin yet" />
        <SourceLine snapshot={funding.data} />
      </Panel>
    </div>
  );
}

interface LsRow { t: number; global: number | null; topAccounts: number | null; topPositions: number | null }
const ratioCell = (v: number | null) => (v === null ? <span className="text-muted-foreground">—</span> : <span className={v >= 1 ? "text-profit" : "text-loss"}>{v.toFixed(3)}</span>);
export const lsCols: Column<LsRow>[] = [
  { key: "t", label: "Time", render: (r) => <span className="num text-muted-foreground">{mdt(r.t)}</span>, csv: (r) => new Date(r.t).toISOString() },
  { key: "global", label: "Global Accounts", align: "r", render: (r) => ratioCell(r.global) },
  { key: "topAccounts", label: "Top Trader (Accounts)", align: "r", render: (r) => ratioCell(r.topAccounts) },
  { key: "topPositions", label: "Top Trader (Positions)", align: "r", render: (r) => ratioCell(r.topPositions) },
];

export function LongShortPage() {
  const { symbols } = useSymbols();
  const [sym, setSym] = useState("BTC");
  const [tf, setTf] = useState<Timeframe>("7D");
  const ls = useAnalytics("long-short", sym);
  const now = Date.now();
  const d = ls.data?.data;
  const g = sliceSeries(d?.global ?? [], tf, now);
  const ta = sliceSeries(d?.topAccounts ?? [], tf, now);
  const tp = sliceSeries(d?.topPositions ?? [], tf, now);
  const readings = useMemo(() => (d ? hourlyReadings(d, 24) : []), [d]);
  const only = d && d.topAccounts.length === 0 && d.global.length > 0;
  return (
    <div className="space-y-4" data-testid="ls-page" data-symbol={sym} data-state={ls.isPending ? "loading" : ls.data ? "ready" : "unavailable"}>
      <PageTitle title="Long / Short" sub={`${sym}USDT perpetual · account and position ratios · ${ls.data?.source ?? "Binance"}`} tools={<CoinSelect value={sym} symbols={symbols.length ? symbols : ["BTC"]} onChange={setSym} />} />
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-3" data-testid="ls-tiles">
        <Tile label="Global Accounts" value={d ? d.latest.global.ratio.toFixed(3) : "—"} sub={d ? `long ${(d.latest.global.long * 100).toFixed(1)}% · short ${(d.latest.global.short * 100).toFixed(1)}%` : "waiting for the snapshot"} tone={ratioTone(d?.latest.global.ratio)} testId="tile-global" />
        <Tile label="Top Trader (Accounts)" value={d && d.topAccounts.length ? d.latest.topAccounts.ratio.toFixed(3) : "—"} sub={only ? "not published by Bybit (GAPS #57)" : "accounts of the top traders"} tone={d && d.topAccounts.length ? ratioTone(d.latest.topAccounts.ratio) : "muted"} testId="tile-top-accounts" />
        <Tile label="Top Trader (Positions)" value={d && d.topPositions.length ? d.latest.topPositions.ratio.toFixed(3) : "—"} sub={only ? "not published by Bybit (GAPS #57)" : "positions of the top traders"} tone={d && d.topPositions.length ? ratioTone(d.latest.topPositions.ratio) : "muted"} testId="tile-top-positions" />
      </div>
      <Panel title="Long / Short Ratio" sub="Global Accounts · Top Trader (Accounts) · Top Trader (Positions) · L/S = 1 is balanced" testId="panel-ls">
        <Chart h={260} x={g.x} xTip={g.xTip} series={[{ label: "Global Accounts", type: "line", data: g.values, color: "hsl(var(--foreground))", width: 1.4, fmt: (v) => v.toFixed(3) }, { label: "Top Trader (Accounts)", type: "line", data: ta.values, color: "hsl(var(--curve))", fmt: (v) => v.toFixed(3) }, { label: "Top Trader (Positions)", type: "line", data: tp.values, color: "hsl(var(--muted-foreground))", dash: "4 3", fmt: (v) => v.toFixed(3) }]} hlines={[{ y: 1, label: "L/S = 1" }]} yFmt={(v) => v.toFixed(2)} loading={ls.isPending} empty={g.covered ? "No readings yet" : "Provider history covers less than this range"} tf={{ value: tf, onChange: setTf }} testId="chart-ls" />
        <SourceLine snapshot={ls.data} />
      </Panel>
      <Panel title="Hourly Readings" sub="latest 24 readings · sortable" testId="panel-readings">
        <DataTable id="ls-readings" rows={readings} cols={lsCols} rowKey={(r) => String(r.t)} sortKey="t" search={false} csv={`${sym}-long-short`} compact maxH={520} empty="No readings yet" />
      </Panel>
    </div>
  );
}

type CoinLiq = { symbol: string; longUsd: number; shortUsd: number };
export const liqCols: Column<CoinLiq>[] = [
  { key: "symbol", label: "Coin", render: (r) => <Coin symbol={r.symbol} /> },
  { key: "total", label: "24h Total", align: "r", sortVal: (r) => r.longUsd + r.shortUsd, render: (r) => usdCompact(r.longUsd + r.shortUsd) },
  { key: "longUsd", label: "Long", align: "r", render: (r) => <span className="text-profit">{usdCompact(r.longUsd)}</span> },
  { key: "shortUsd", label: "Short", align: "r", render: (r) => <span className="text-loss">{usdCompact(r.shortUsd)}</span> },
  { key: "bias", label: "Split", sortVal: (r) => r.longUsd / (r.longUsd + r.shortUsd || 1), render: (r) => <span className="block w-[110px]"><Split long={r.longUsd} short={r.shortUsd} /></span> },
];
const WINDOW_KEYS = LIQ_WINDOWS.map((w) => `${w}h`);
const binLabel = (t: number, binMs: number) => (binMs >= 3600e3 ? `${String(new Date(t).getHours()).padStart(2, "0")}:00` : hm(t));

export function TerminalLiquidationsPage() {
  const liq = useLiquidations();
  const [win, setWin] = useState<LiqWindow>(24);
  const d = liq.data?.data;
  const total = d ? d.total.longUsd + d.total.shortUsd : null;
  const bars = useMemo(() => (d ? liqWindow(d, win) : null), [d, win]);
  const big = d ? largestCoin(d.bySymbol) : null;
  return (
    <div className="space-y-4" data-testid="liq-page" data-state={liq.isPending ? "loading" : liq.data ? "ready" : "unavailable"}>
      <PageTitle title="Liquidations" sub="forced closes across the venues the ingest listens to · 24h window" />
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4" data-testid="liq-tiles">
        <Tile label="24h Total" value={usdCompact(total)} sub={d ? `${d.byVenue.length} venues reporting` : "waiting for the feed"} testId="tile-total" />
        <Tile label="Long Liquidations" value={usdCompact(d?.total.longUsd)} sub="longs closed" tone="profit" testId="tile-long" />
        <Tile label="Short Liquidations" value={usdCompact(d?.total.shortUsd)} sub="shorts closed" tone="loss" testId="tile-short" />
        <Tile label="Largest Coin" value={big ? big.symbol : "—"} sub={big ? `${usdCompact(big.usd)} in 24h` : "nothing captured yet"} testId="tile-largest" />
      </div>
      <Panel title="Long Liq / Short Liq" sub={`stacked · ${bars?.fromEvents ? "re-binned from the newest events" : "hourly buckets"}${bars?.capped ? " · the event buffer does not reach the window start" : ""}`} tools={<Chips items={WINDOW_KEYS} value={`${win}h`} onChange={(k) => setWin(Number(k.replace("h", "")) as LiqWindow)} testId="liq-window" />} testId="panel-liq">
        <Chart h={240} stack zero x={(bars?.points ?? []).map((p) => binLabel(p.t, bars!.binMs))} xTip={(bars?.points ?? []).map((p) => mdt(p.t))} series={[{ label: "Long Liq", type: "bar", data: (bars?.points ?? []).map((p) => p.longUsd), color: "hsl(var(--profit))", fmt: (v) => usdCompact(v) }, { label: "Short Liq", type: "bar", data: (bars?.points ?? []).map((p) => p.shortUsd), color: "hsl(var(--loss))", fmt: (v) => usdCompact(v) }]} yFmt={(v) => usdCompact(v, 1)} loading={liq.isPending} empty="No liquidations captured in this window" testId="chart-liq" />
        <SourceLine snapshot={liq.data} />
      </Panel>
      <Panel title="By Coin (24h)" sub="long and short liquidations per coin · click a row to open the coin" testId="panel-by-coin">
        <DataTable id="liq-coins" rows={d?.bySymbol ?? []} cols={liqCols} rowKey={(r) => r.symbol} sortKey="total" search searchText={(r) => r.symbol} searchPlaceholder="Search coin…" columns csv="liquidations-by-coin" star={(r) => r.symbol} rowHref={coinHref} maxH={520} empty="No liquidations captured yet" />
      </Panel>
    </div>
  );
}
