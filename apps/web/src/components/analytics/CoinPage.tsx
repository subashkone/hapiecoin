"use client";
// Coin analytics (HC-MA-082..087, 120, 121): header with price and watch/compare, six tiles, Price & OI (dual axis),
// long/short, liquidations from the captured events, OI-weighted funding (± bars), taker buy/sell, the liquidation
// heatmap, and the per-exchange markets and funding tables. Charts carry timeframe chips; every panel prints its source.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { useAnalytics, useLiquidations, useMarkets, useOverview } from "@/lib/api/analytics";
import { alignTo, binEvents, liqHeatmap, longShare, nextFundingIn, sparklineSeries, venueLabel } from "@/lib/analytics/derive";
import { type Timeframe, pct, price, sliceSeries, toneClass, usdCompact } from "@/lib/analytics/format";
import { useUiStore } from "@/lib/store";
import { isSector, sectorName } from "@/lib/terminal/nav";
import { Chart } from "./Chart";
import { type Column, DataTable } from "./DataTable";
import { sectorOf } from "./HubPage";
import { Coin, Heat, LiqHeatmap, Panel, SourceLine, Split, Tile } from "./bits";

/** Where the page's links go: the analytics section or the terminal (HC-MT-080, 091, 164). */
export type CoinBase = "analytics" | "terminal";
export const coinLinks = (base: CoinBase) =>
  base === "terminal"
    ? { back: "/terminal", backLabel: "← Back", compare: (s: string) => `/terminal/spot?compare=${s}`, venue: (v: string) => `/terminal/exchanges/${v}` }
    : { back: "/analytics/markets", backLabel: "← Back to markets", compare: (s: string) => `/analytics/markets?compare=${s}`, venue: null };

const FUND_TFS: readonly Timeframe[] = ["7D", "30D", "90D", "1Y"];
interface VenueRow { venue: string; oiUsd: number | null; change24h: number | null; share: number | null; rate: number | null; predicted: number | null; apr: number | null; nextFundingAt: number | null }
export const marketCols: Column<VenueRow>[] = [
  { key: "venue", label: "Exchange", render: (r) => <b>{venueLabel(r.venue)}</b> },
  { key: "oiUsd", label: "Open Interest", align: "r", render: (r) => usdCompact(r.oiUsd) },
  { key: "change24h", label: "OI 24h %", align: "r", render: (r) => <Heat v={r.change24h} fraction /> },
  { key: "share", label: "OI Share", align: "r", render: (r) => (r.share === null ? "—" : <span className="inline-flex w-[110px] items-center justify-end gap-2"><span className="h-1.5 max-w-[60px] flex-1 overflow-hidden rounded bg-muted"><i className="block h-full rounded bg-curve" style={{ width: `${(r.share * 100).toFixed(1)}%` }} /></span><span className="num w-10 text-right text-2xs">{(r.share * 100).toFixed(1)}%</span></span>) },
  { key: "rate", label: "Funding", align: "r", render: (r) => <span className={toneClass(r.rate)}>{pct(r.rate, 4, true)}</span> },
];
export function fundingCols(now: number): Column<VenueRow>[] {
  return [
    { key: "venue", label: "Exchange", render: (r) => <b>{venueLabel(r.venue)}</b> },
    { key: "rate", label: "Funding rate", align: "r", render: (r) => <Heat v={r.rate} fraction max={0.03} digits={4} /> },
    { key: "predicted", label: "Predicted", align: "r", render: (r) => <span className={toneClass(r.predicted)}>{pct(r.predicted, 4, true)}</span> },
    { key: "apr", label: "APR", align: "r", render: (r) => pct(r.apr, 1, true) },
    { key: "nextFundingAt", label: "Next funding", align: "r", render: (r) => <span className="text-muted-foreground">{nextFundingIn(r.nextFundingAt, now)}</span> },
  ];
}

export function CoinPage({ symbol, base = "analytics" }: { symbol: string; base?: CoinBase }) {
  const sym = symbol.toUpperCase();
  const links = coinLinks(base);
  const venueHref = links.venue;
  const venueRow = venueHref ? { rowHref: (r: VenueRow) => venueHref(r.venue) } : {};
  const sector = sectorOf(sym);
  const router = useRouter();
  const overview = useOverview();
  const markets = useMarkets();
  const oi = useAnalytics("open-interest", sym);
  const funding = useAnalytics("funding", sym);
  const ls = useAnalytics("long-short", sym);
  const taker = useAnalytics("taker-volume", sym);
  const liq = useLiquidations();
  const watch = useUiStore((s) => s.watchlist);
  const toggleWatch = useUiStore((s) => s.toggleWatch);
  const [tfPx, setTfPx] = useState<Timeframe>("7D");
  const [tfLs, setTfLs] = useState<Timeframe>("7D");
  const [tfLiq, setTfLiq] = useState<"1D" | "7D">("1D");
  const [tfFund, setTfFund] = useState<Timeframe>("30D");
  const now = Date.now();
  const row = overview.data?.data.symbols.find((s) => s.symbol === sym);
  const m = markets.data?.data.rows.find((r) => r.symbol === sym);
  const known = !!row || !!m;
  const liqRow = liq.data?.data.bySymbol.find((s) => s.symbol === sym);
  const lsNow = ls.data?.data.latest.global.ratio ?? row?.lsRatio ?? null;
  const fundNow = funding.data?.data.oiWeighted.at(-1)?.v ?? row?.funding ?? null;
  const pxSeries = useMemo(() => (m && markets.data ? sparklineSeries(m.sparkline7d, markets.data.asOf) : []), [m, markets.data]);
  const oiAgg = oi.data?.data.aggregated ?? [];
  const pxOi = useMemo(() => {
    const base = sliceSeries(oiAgg, tfPx, now);
    const baseRaw = oiAgg.filter((p) => p.t >= now - (tfPx === "1D" ? 864e5 : 7 * 864e5));
    const picked = baseRaw.length > 120 ? base.values.map((_, i) => baseRaw[Math.round((i * (baseRaw.length - 1)) / 119)]!) : baseRaw;
    return { ...base, px: alignTo(picked, pxSeries) };
  }, [oiAgg, pxSeries, tfPx, now]);
  const lsS = sliceSeries(ls.data?.data.global ?? [], tfLs, now);
  const fundS = sliceSeries(funding.data?.data.oiWeighted ?? [], tfFund, now);
  const liqBins = useMemo(() => (liq.data ? binEvents(liq.data.data.recent, now - (tfLiq === "1D" ? 864e5 : 7 * 864e5), now, tfLiq === "1D" ? 3600e3 : 6 * 3600e3, sym) : []), [liq.data, tfLiq, sym, now]);
  const tk = (taker.data?.data.points ?? []).slice(-48);
  const heat = useMemo(() => liqHeatmap(liq.data?.data.recent ?? [], sym, m?.price ?? 0, now), [liq.data, sym, m?.price, now]);
  const venues = useMemo<VenueRow[]>(() => {
    const oiV = oi.data?.data.venues ?? [];
    const fV = funding.data?.data.venues ?? [];
    const names = [...new Set([...oiV.map((v) => v.venue), ...fV.map((v) => v.venue)])];
    const total = oiV.reduce((s, v) => s + v.oiUsd, 0);
    return names.map((venue) => {
      const o = oiV.find((v) => v.venue === venue);
      const f = fV.find((v) => v.venue === venue);
      return { venue, oiUsd: o?.oiUsd ?? null, change24h: o?.change24h ?? null, share: o && total > 0 ? o.oiUsd / total : null, rate: f?.rate ?? null, predicted: f?.predicted ?? null, apr: f?.apr ?? null, nextFundingAt: f?.nextFundingAt ?? null };
    });
  }, [oi.data, funding.data]);
  const fmtPx = (v: number) => (v >= 1000 ? usdCompact(v, 1) : price(v));
  const hm = (t: number) => `${String(new Date(t).getHours()).padStart(2, "0")}:${String(new Date(t).getMinutes()).padStart(2, "0")}`;
  const mdt = (t: number) => new Date(t).toLocaleString("en-US", { month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
  return (
    <div className="space-y-4" data-testid="coin-page" data-symbol={sym} data-base={base} data-state={overview.isPending ? "loading" : known ? "ready" : "unknown"}>
      <div className="flex flex-wrap items-center gap-3">
        <Link href={links.back} className="text-2xs text-muted-foreground hover:text-foreground" data-testid="coin-back">{links.backLabel}</Link>
        <h2 className="text-lg">
          <Coin symbol={sym} name={m?.name} rank={m?.rank} />
        </h2>
        {m ? (
          <>
            <span className="num text-lg" data-testid="coin-price">{price(m.price)}</span>
            <Heat v={m.change24h} />
            <span className="text-2xs text-muted-foreground">24h</span>
          </>
        ) : null}
        <span className="rounded border border-border px-1.5 py-0.5 font-mono text-2xs text-muted-foreground">{sym}USDT · perp</span>
        {base === "terminal" && m ? <span className="rounded border border-border px-1.5 py-0.5 font-mono text-2xs text-muted-foreground" data-testid="coin-rank">Rank #{m.rank}</span> : null}
        {base === "terminal" && isSector(sector) ? <Link href={`/terminal/sectors/${sector}`} className="rounded border border-border px-1.5 py-0.5 text-2xs text-muted-foreground hover:text-foreground" data-testid="coin-sector">{sectorName(sector)}</Link> : null}
        <button type="button" onClick={() => toggleWatch(sym)} aria-pressed={watch.includes(sym)} className="rounded border border-border px-2 py-0.5 text-2xs" data-testid="coin-watch">
          {watch.includes(sym) ? "★ Watching" : "☆ Watch"}
        </button>
        <button type="button" onClick={() => router.push(links.compare(sym))} className="rounded border border-border px-2 py-0.5 text-2xs text-muted-foreground hover:text-foreground" title="Add to compare and open the Markets screener" data-testid="coin-compare">
          ⇄ Compare
        </button>
      </div>
      {!overview.isPending && !known ? (
        <div className="rounded border border-dashed border-border p-4 text-xs text-muted-foreground" data-testid="coin-unknown">No data for {sym}. The ingest tracks {overview.data?.data.symbols.length ?? 0} symbols; add it to ANALYTICS_SYMBOLS to follow it.</div>
      ) : null}
      <div className="grid grid-cols-2 gap-2 md:grid-cols-3 lg:grid-cols-6">
        <Tile label="Open Interest" value={usdCompact(oi.data?.data.totalUsd ?? row?.oiUsd)} sub={<>Δ24h <b className={toneClass(row?.oiChange24h)}>{pct(row?.oiChange24h, 2, true)}</b> · Δ1h <b className={toneClass(row?.oiChange1h)}>{pct(row?.oiChange1h, 2, true)}</b></>} testId="coin-oi" />
        <Tile label="24h Volume" value={usdCompact(m?.volume24h)} sub={m && row?.oiUsd ? `Vol/OI ${((m.volume24h ?? 0) / row.oiUsd).toFixed(2)}× · spot` : "spot · CoinGecko"} testId="coin-vol" />
        <Tile label="Funding (OI-weighted)" value={pct(fundNow, 4, true)} sub="per 8h" tone={fundNow === null ? "muted" : fundNow >= 0 ? "profit" : "loss"} testId="coin-funding" />
        <Tile label="Long/Short" value={lsNow === null ? "—" : lsNow.toFixed(2)} tone={lsNow === null ? "muted" : lsNow >= 1 ? "profit" : "loss"} sub={lsNow === null ? "global accounts" : <><span className="text-profit num">L {longShare(lsNow).toFixed(1)}%</span> <span className="text-loss num">S {(100 - longShare(lsNow)).toFixed(1)}%</span></>} extra={lsNow === null ? null : <Split long={longShare(lsNow)} short={100 - longShare(lsNow)} />} testId="coin-ls" />
        <Tile label="Liquidations 24h" value={usdCompact(liqRow ? liqRow.longUsd + liqRow.shortUsd : row?.liq24hUsd)} sub={liqRow ? <><span className="text-profit num">L {usdCompact(liqRow.longUsd)}</span><span className="text-loss num">S {usdCompact(liqRow.shortUsd)}</span></> : `${row?.venues ?? 0} venues`} extra={liqRow ? <Split long={liqRow.longUsd} short={liqRow.shortUsd} /> : null} testId="coin-liq" />
        <Tile label="Market Cap" value={usdCompact(m?.marketCap)} sub={m && markets.data?.data.global.totalMarketCap ? `Dominance ${(((m.marketCap ?? 0) / markets.data.data.global.totalMarketCap) * 100).toFixed(2)}%` : m ? `rank #${m.rank}` : "needs CoinGecko"} testId="coin-cap" />
      </div>
      <SourceLine snapshot={overview.data} />
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Price & Open Interest" sub={`${sym}USDT · perp · price from the CoinGecko sparkline`} testId="panel-pxoi">
          <Chart h={220} rightAxis x={pxOi.x} xTip={pxOi.xTip} series={[{ label: "Open Interest", type: "area", data: pxOi.values, color: "hsl(var(--curve))", fmt: (v) => usdCompact(v) }, { label: "Price", type: "line", axis: "r", data: pxOi.px, color: "hsl(var(--foreground))", fmt: price }]} yFmt={(v) => usdCompact(v, 1)} y2Fmt={fmtPx} loading={oi.isPending} empty={oi.data ? "Nothing to plot for this range" : "Open interest has not been written for this coin yet"} tf={{ options: ["1D", "7D"], value: tfPx, onChange: setTfPx }} testId="chart-pxoi" />
          <SourceLine snapshot={oi.data} />
        </Panel>
        <Panel title="Long / Short Ratio" sub={`global accounts · ${ls.data?.source ?? "Binance"}`} testId="panel-ls">
          <Chart h={220} x={lsS.x} xTip={lsS.xTip} series={[{ label: "L/S Ratio", type: "line", data: lsS.values, color: "hsl(var(--curve))", fmt: (v) => v.toFixed(2) }]} hlines={[{ y: 1, label: "1.00" }]} yFmt={(v) => v.toFixed(2)} loading={ls.isPending} empty={ls.data ? "Nothing to plot for this range" : "Long/short needs a venue that serves account ratios (Binance or Bybit)"} tf={{ value: tfLs, onChange: setTfLs }} testId="chart-ls" />
          <SourceLine snapshot={ls.data} />
        </Panel>
        <Panel title="Liquidations" sub="Long Liq / Short Liq · from the captured events" testId="panel-liq">
          <Chart h={220} stack zero x={liqBins.map((p) => (tfLiq === "1D" ? hm(p.t) : mdt(p.t)))} xTip={liqBins.map((p) => mdt(p.t))} series={[{ label: "Long Liq", type: "bar", data: liqBins.map((p) => p.longUsd), color: "hsl(var(--profit))", fmt: (v) => usdCompact(v) }, { label: "Short Liq", type: "bar", data: liqBins.map((p) => p.shortUsd), color: "hsl(var(--loss))", fmt: (v) => usdCompact(v) }]} yFmt={(v) => usdCompact(v, 1)} loading={liq.isPending} empty={`No ${sym} liquidations captured in this range`} tf={{ options: ["1D", "7D"], value: tfLiq, onChange: (t) => setTfLiq(t === "7D" ? "7D" : "1D") }} testId="chart-liq" />
          <SourceLine snapshot={liq.data} />
        </Panel>
        <Panel title="OI-Weighted Funding" sub="8h · %" testId="panel-funding">
          <Chart h={220} zero x={fundS.x} xTip={fundS.xTip} series={[{ label: "Funding", type: "bar", data: fundS.values.map((v) => Number((v * 100).toFixed(4))), color: "hsl(var(--profit))", colorNeg: "hsl(var(--loss))", fmt: (v) => `${v.toFixed(4)}%` }]} yFmt={(v) => `${v.toFixed(3)}%`} loading={funding.isPending} empty={fundS.covered ? "Nothing to plot" : "Venue history covers less than this range (GAPS #56)"} tf={{ options: FUND_TFS, value: tfFund, onChange: setTfFund }} testId="chart-funding" />
          <SourceLine snapshot={funding.data} />
        </Panel>
      </div>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Panel title="Taker Buy / Sell Volume" sub={`hourly · ${taker.data?.source ?? "Binance"} · 48h`} testId="panel-taker">
          <Chart h={200} stack zero x={tk.map((p) => hm(p.t))} xTip={tk.map((p) => mdt(p.t))} series={[{ label: "Taker Buy", type: "bar", data: tk.map((p) => p.buy), color: "hsl(var(--profit) / 0.8)", fmt: (v) => usdCompact(v) }, { label: "Taker Sell", type: "bar", data: tk.map((p) => -p.sell), color: "hsl(var(--loss) / 0.8)", fmt: (v) => usdCompact(Math.abs(v)) }]} yFmt={(v) => usdCompact(v, 1)} loading={taker.isPending} empty={taker.data ? "Nothing to plot" : "Taker volume needs a venue that serves it (Binance)"} testId="chart-taker" />
          <SourceLine snapshot={taker.data} />
        </Panel>
        <Panel title="Liquidation Heatmap" sub="long vs short · price bands ±5% · last 12h" testId="panel-heat">
          {m ? <LiqHeatmap rows={heat.rows} hours={heat.hours} max={heat.max} count={heat.count} now={now} /> : <div className="text-xs text-muted-foreground">Needs the coin's price (CoinGecko) to place the bands.</div>}
        </Panel>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Markets by Exchange" sub={`${sym} perpetual · OI share`} testId="panel-markets">
          <DataTable id="coin-markets" rows={venues} cols={marketCols} rowKey={(r) => r.venue} sortKey="oiUsd" csv={`${sym}-markets`} empty="No venue has reported open interest for this coin yet" search={false} compact {...venueRow} />
        </Panel>
        <Panel title="Funding by Exchange" sub="current · predicted · next settlement" testId="panel-funding-ex">
          <DataTable id="coin-funding" rows={venues.filter((v) => v.rate !== null)} cols={fundingCols(now)} rowKey={(r) => r.venue} sortKey="rate" csv={`${sym}-funding`} empty="No venue has reported funding for this coin yet" search={false} compact {...venueRow} />
        </Panel>
      </div>
    </div>
  );
}
