"use client";
// Sentiment (HC-MA-073..081, 118, 119): Fear & Greed gauge with zone bands and history, the cycle-top checklist,
// Pi Cycle, the rainbow (log-regression fit over the ingest's daily window), the 2-year MA multiplier, Coinbase
// premium bars and the RSI screener. AHR999 and Puell stay "coming soon" (GAPS #59). Log axes on the price charts.
import type { RsiRow, RsiTimeframe } from "@hapiecoin/schema";
import { RSI_TIMEFRAMES } from "@hapiecoin/schema";
import { useMemo, useState } from "react";
import { useCycle, useFearGreed, useMarkets, usePremium, useRsi } from "@/lib/api/analytics";
import { FG_BANDS, cycleChecklist, rainbowRegions } from "@/lib/analytics/derive";
import { type Timeframe, fearGreedTone, price, sliceSeries, usdCompact } from "@/lib/analytics/format";
import { Chart } from "./Chart";
import { Chips } from "./Chips";
import { type Column, DataTable } from "./DataTable";
import { Checklist, Coin, ComingSoon, Gauge, Panel, RsiCell, SourceLine } from "./bits";

const FG_TFS: readonly Timeframe[] = ["7D", "30D", "90D", "1Y"];
const CYCLE_TFS = ["30D", "90D", "180D", "ALL"] as const;
type CycleTf = (typeof CYCLE_TFS)[number];
const CYCLE_DAYS: Record<CycleTf, number> = { "30D": 30, "90D": 90, "180D": 180, ALL: 100_000 };
const CP_TFS: readonly Timeframe[] = ["1D", "7D", "30D"];
const fmtPx = (v: number) => (v >= 1000 ? usdCompact(v, 1) : price(v));
const md = (t: number) => new Date(t).toLocaleDateString("en-US", { month: "short", day: "2-digit" });
const mdy = (t: number) => new Date(t).toLocaleDateString("en-US", { month: "short", day: "2-digit", year: "2-digit" });

export function rsiCols(): Column<RsiRow & { name?: string | undefined; rank?: number | undefined }>[] {
  const tf = (k: RsiTimeframe): Column<RsiRow> => ({ key: `rsi_${k}`, label: `RSI ${k}`, align: "c", sortVal: (r) => r.rsi[k] ?? null, csv: (r) => String(r.rsi[k] ?? ""), render: (r) => <RsiCell v={r.rsi[k]} /> });
  return [
    { key: "rank", label: "Coin", sortVal: (r) => (r.rank === undefined ? null : -r.rank), render: (r) => <Coin symbol={r.symbol} name={r.name} rank={r.rank} /> },
    { key: "price", label: "Price", align: "r", render: (r) => price(r.price) },
    ...RSI_TIMEFRAMES.map(tf),
  ];
}

export function SentimentPage() {
  const fg = useFearGreed();
  const cycle = useCycle();
  const premium = usePremium();
  const rsi = useRsi();
  const markets = useMarkets();
  const [tfFg, setTfFg] = useState<Timeframe>("90D");
  const [tfCycle, setTfCycle] = useState<CycleTf>("180D");
  const [tfCp, setTfCp] = useState<Timeframe>("1D");
  const now = Date.now();
  const fgLatest = fg.data?.data.latest ?? null;
  const fgS = sliceSeries(fg.data?.data.points ?? [], tfFg, now);
  const c = cycle.data?.data;
  const cyc = useMemo(() => {
    const pts = (c?.points ?? []).slice(-CYCLE_DAYS[tfCycle]);
    const fit = pts.map((p) => p.fit);
    return { pts, x: pts.map((p) => (tfCycle === "30D" ? md(p.t) : mdy(p.t))), xTip: pts.map((p) => mdy(p.t)), regions: c ? rainbowRegions(fit, c.rainbowMultipliers, c.rainbowNames) : [] };
  }, [c, tfCycle]);
  const cp = sliceSeries(premium.data?.data.points ?? [], tfCp, now);
  const premiumMax24h = premium.data ? Math.max(...premium.data.data.points.slice(-24).map((p) => p.v)) : null;
  const btcRsi = rsi.data?.data.rows.find((r) => r.symbol === "BTC");
  const checks = useMemo(() => cycleChecklist({ cycle: c, fearGreed: fgLatest?.value ?? null, rsiWeekly: btcRsi?.rsi["1w"] ?? null, premiumMax24h: premiumMax24h !== null && Number.isFinite(premiumMax24h) ? premiumMax24h : null }, fmtPx), [c, fgLatest, btcRsi, premiumMax24h]);
  const hits = checks.filter((k) => k.hit === true).length;
  const known = checks.filter((k) => k.hit !== null).length;
  const rsiRows = useMemo(() => {
    const names = new Map((markets.data?.data.rows ?? []).map((r) => [r.symbol, r]));
    return (rsi.data?.data.rows ?? []).map((r) => ({ ...r, name: names.get(r.symbol)?.name, rank: names.get(r.symbol)?.rank }));
  }, [rsi.data, markets.data]);
  const pending = fg.isPending || cycle.isPending;
  const unavailable = !pending && !fg.data && !cycle.data && !rsi.data;
  return (
    <div className="space-y-4" data-testid="sentiment-page" data-state={pending ? "loading" : unavailable ? "unavailable" : "ready"}>
      <h2 className="sr-only">Sentiment</h2>
      {unavailable ? <div className="rounded border border-dashed border-border p-4 text-xs text-muted-foreground" data-testid="sentiment-unavailable">No sentiment datasets yet: the ingest writes Fear &amp; Greed hourly and the cycle, RSI and premium sets on their own schedules.</div> : null}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <Panel title="Fear & Greed Index" sub="crypto market sentiment · daily · alternative.me" testId="panel-fg">
          <div className="grid items-center gap-3 md:grid-cols-[190px_minmax(0,1fr)]">
            <div className="flex flex-col items-center">
              {fgLatest ? <Gauge value={fgLatest.value} size={170} thick={11} label="Fear & Greed" testId="fg-gauge" /> : <div className="skeleton h-[95px] w-[170px] rounded" />}
              <div className={`text-xs font-medium text-${fgLatest ? fearGreedTone(fgLatest.value) : "muted"}`} data-testid="fg-label">{fgLatest?.label ?? "waiting for alternative.me"}</div>
              <div className="micro">extreme fear ← → extreme greed</div>
            </div>
            <Chart h={170} tight min={0} max={100} x={fgS.x} xTip={fgS.xTip} series={[{ label: "Index", type: "area", data: fgS.values, color: "hsl(var(--curve))", fmt: (v) => v.toFixed(0) }]} bands={FG_BANDS} yFmt={(v) => v.toFixed(0)} loading={fg.isPending} legend={false} tf={{ options: FG_TFS, value: tfFg, onChange: setTfFg }} testId="chart-fg" />
          </div>
          <SourceLine snapshot={fg.data} />
        </Panel>
        <Panel title="Bull Market Peak Indicators" sub="cycle-top signal checklist" tools={<span className={`rounded px-1.5 py-0.5 font-mono text-2xs ${hits ? "bg-sell-bg text-sell" : "bg-buy-bg text-buy"}`} data-testid="check-summary">{hits} / {known} triggered</span>} testId="panel-check">
          <Checklist rows={checks} />
          <p className="micro mt-2">AHR999 and Puell need sources we have not verified yet (GAPS #59); the rest come from our own maths on daily closes.</p>
        </Panel>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Pi Cycle Top Indicator" sub={`111DMA crossing 2×350DMA has marked cycle tops · ${c?.windowDays ?? 0}-day window`} tools={<Chips items={CYCLE_TFS} value={tfCycle} onChange={setTfCycle} testId="cycle-tf" />} testId="panel-pi">
          <Chart h={220} logY x={cyc.x} xTip={cyc.xTip} series={[{ label: "Price", type: "line", data: cyc.pts.map((p) => p.close), color: "hsl(var(--foreground))", width: 1.2, fmt: fmtPx }, { label: "111DMA", type: "line", data: cyc.pts.map((p) => p.ma111), color: "hsl(var(--curve))", fmt: fmtPx }, { label: "350DMA×2", type: "line", data: cyc.pts.map((p) => p.ma350x2), color: "hsl(var(--loss))", dash: "4 3", fmt: fmtPx }]} yFmt={fmtPx} loading={cycle.isPending} empty="Cycle indicators need the daily-close dataset" testId="chart-pi" />
          <SourceLine snapshot={cycle.data} />
        </Panel>
        <Panel title="Bitcoin Rainbow Chart" sub={`log-regression valuation bands · fitted over the ${c?.windowDays ?? 0}-day window, not since genesis`} testId="panel-rainbow">
          <Chart h={220} logY x={cyc.x} xTip={cyc.xTip} regions={cyc.regions} series={[{ label: "Price", type: "line", data: cyc.pts.map((p) => p.close), color: "hsl(var(--foreground))", width: 1.4, fmt: fmtPx }]} yFmt={fmtPx} loading={cycle.isPending} empty="Cycle indicators need the daily-close dataset" testId="chart-rainbow" />
          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-2xs text-muted-foreground" data-testid="rainbow-legend">
            {cyc.regions.map((r) => (
              <span key={r.label}><i className="mr-1 inline-block h-2 w-2 rounded-sm" style={{ background: r.color }} />{r.label}</span>
            ))}
          </div>
        </Panel>
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <Panel title="AHR999 Accumulation Index" sub="< 0.45 bottom zone · > 4 top zone" testId="panel-ahr">
          <ComingSoon title="AHR999" why="Needs the published 200-day cost basis and age-curve constants; we do not ship a formula we could not verify." gap={59} />
        </Panel>
        <Panel title="Puell Multiple" sub="miner revenue vs 365d average" testId="panel-puell">
          <ComingSoon title="Puell Multiple" why="Needs daily miner revenue from an on-chain provider (paid or terms-restricted)." gap={59} />
        </Panel>
        <Panel title="2-Year MA Multiplier" sub="buy below 2Y MA · sell above 2Y MA ×5" testId="panel-ma2">
          <Chart h={180} logY x={cyc.x} xTip={cyc.xTip} series={[{ label: "Price", type: "line", data: cyc.pts.map((p) => p.close), color: "hsl(var(--foreground))", width: 1.2, fmt: fmtPx }, { label: "2Y MA", type: "line", data: cyc.pts.map((p) => p.ma2y), color: "hsl(var(--profit))", fmt: fmtPx }, { label: "2Y MA ×5", type: "line", data: cyc.pts.map((p) => p.ma2yX5), color: "hsl(var(--loss))", fmt: fmtPx }]} yFmt={fmtPx} loading={cycle.isPending} empty="Cycle indicators need the daily-close dataset" testId="chart-ma2" />
          {c && c.points.at(-1)?.ma2y === null ? <p className="mt-1 text-2xs text-muted-foreground" data-testid="ma2-note">The 2-year average needs 730 daily closes; the window holds {c.windowDays}.</p> : null}
        </Panel>
      </div>
      <Panel title="Coinbase Premium" sub="Coinbase BTC-USD minus Binance BTC-USDT · US spot pressure · hourly" testId="panel-premium">
        <Chart h={180} zero x={cp.x} xTip={cp.xTip} series={[{ label: "Premium", type: "bar", data: cp.values, color: "hsl(var(--profit))", colorNeg: "hsl(var(--loss))", fmt: (v) => `${v >= 0 ? "+$" : "-$"}${Math.abs(v).toFixed(1)}` }]} yFmt={(v) => `${v >= 0 ? "$" : "-$"}${Math.abs(v).toFixed(0)}`} loading={premium.isPending} empty={premium.data ? "The premium history fills hourly from now on" : "Premium needs COINGECKO_API_KEY on the ingest"} tf={{ options: CP_TFS, value: tfCp, onChange: setTfCp }} testId="chart-premium" />
        <div className="mt-1 flex flex-wrap gap-4 text-2xs text-muted-foreground" data-testid="premium-now">
          <span>Now <b className={`num ${premium.data ? (premium.data.data.premiumUsd >= 0 ? "text-profit" : "text-loss") : ""}`}>{premium.data ? `${premium.data.data.premiumUsd >= 0 ? "+" : "-"}$${Math.abs(premium.data.data.premiumUsd).toFixed(2)}` : "—"}</b></span>
          <span>Coinbase <b className="num text-foreground">{price(premium.data?.data.coinbaseUsd)}</b></span>
          <span>Binance <b className="num text-foreground">{price(premium.data?.data.binanceUsd)}</b></span>
          <span>{premium.data ? `${premium.data.data.points.length} hourly points kept` : ""}</span>
        </div>
        <SourceLine snapshot={premium.data} />
      </Panel>
      <Panel title="RSI Screener" sub="multi-timeframe relative strength · green = oversold, red = overbought · Wilder RSI(14)" testId="panel-rsi">
        <DataTable id="rsi" rows={rsiRows} cols={rsiCols()} rowKey={(r) => r.symbol} sortKey="rank" sortDir="asc" maxH={520} search searchText={(r) => `${r.symbol} ${r.name ?? ""}`} searchPlaceholder="Search coin…" columns csv="rsi-screener" star={(r) => r.symbol} rowHref={(r) => `/analytics/coin/${r.symbol}`} empty="RSI needs Bybit candles for the tracked symbols" />
        <SourceLine snapshot={rsi.data} />
      </Panel>
    </div>
  );
}
