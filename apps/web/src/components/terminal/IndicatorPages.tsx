"use client";
// Terminal indicator and on-chain screens (HC-MT-135..150, 171..174): Fear & Greed (gauge, history with the extreme
// lines, Now / Yesterday / Last week / Last month tiles), BTC Cycle (Pi Cycle from the cycle dataset; AHR999 and Puell
// as honest placeholders, GAPS #59), Exchange Balance (coming soon, GAPS #55) and the Token Unlock notice.
import { useMemo, useState } from "react";
import { useCycle, useFearGreed } from "@/lib/api/analytics";
import { type Timeframe, fearGreedTone, price, sliceSeries, usdCompact } from "@/lib/analytics/format";
import { fgAt, rainbowBandName } from "@/lib/terminal/derive";
import { Chart } from "@/components/analytics/Chart";
import { Chips } from "@/components/analytics/Chips";
import { ComingSoon, Gauge, Panel, SourceLine, Tile } from "@/components/analytics/bits";
import { PageTitle } from "./TerminalShell";

const FG_TFS: readonly Timeframe[] = ["7D", "30D", "90D", "1Y"];
const CYCLE_TFS = ["30D", "90D", "180D"] as const;
type CycleTf = (typeof CYCLE_TFS)[number];
const CYCLE_DAYS: Record<CycleTf, number> = { "30D": 30, "90D": 90, "180D": 180 };
const md = (t: number) => new Date(t).toLocaleDateString("en-US", { month: "short", day: "2-digit" });
const mdy = (t: number) => new Date(t).toLocaleDateString("en-US", { month: "short", day: "2-digit", year: "2-digit" });
const fmtPx = (v: number) => (v >= 1000 ? usdCompact(v, 1) : price(v));

export function FearGreedPage() {
  const fg = useFearGreed();
  const [tf, setTf] = useState<Timeframe>("90D");
  const now = Date.now();
  const points = fg.data?.data.points ?? [];
  const latest = fg.data?.data.latest ?? null;
  const hist = sliceSeries(points, tf, now);
  const tiles = [
    { label: "Now", r: fgAt(points, 0), id: "now" },
    { label: "Yesterday", r: fgAt(points, 1), id: "yesterday" },
    { label: "Last Week", r: fgAt(points, 7), id: "week" },
    { label: "Last Month", r: fgAt(points, 30), id: "month" },
  ];
  return (
    <div className="space-y-4" data-testid="fg-page" data-state={fg.isPending ? "loading" : fg.data ? "ready" : "unavailable"}>
      <PageTitle title="Fear & Greed Index" sub="Crypto market sentiment · updated daily · alternative.me" />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
        <Panel title="Fear & Greed Index" sub={latest ? `Now · ${latest.label}` : "waiting for alternative.me"} testId="panel-gauge">
          <div className="flex flex-col items-center py-2">
            {latest ? <Gauge value={latest.value} size={220} thick={14} label="Fear & Greed" testId="fg-gauge" /> : <div className="skeleton h-[120px] w-[220px] rounded" />}
            <div className={`mt-1 text-sm font-medium text-${latest ? fearGreedTone(latest.value) : "muted"}`} data-testid="fg-label">{latest?.label ?? "—"}</div>
            <div className="micro mt-1 flex w-[220px] justify-between"><span>extreme fear</span><span>extreme greed</span></div>
          </div>
          <SourceLine snapshot={fg.data} />
        </Panel>
        <Panel title="History" sub="F&G · daily · Extreme Fear below 25, Extreme Greed above 75" testId="panel-history">
          <Chart h={220} tight min={0} max={100} x={hist.x} xTip={hist.xTip} series={[{ label: "F&G", type: "area", data: hist.values, color: "hsl(var(--curve))", fmt: (v) => v.toFixed(0) }]} hlines={[{ y: 25, label: "Extreme Fear" }, { y: 75, label: "Extreme Greed" }]} yFmt={(v) => v.toFixed(0)} loading={fg.isPending} empty={hist.covered ? "No history yet" : "Provider history covers less than this range"} tf={{ options: FG_TFS, value: tf, onChange: setTf }} testId="chart-fg" />
          <SourceLine snapshot={fg.data} />
        </Panel>
      </div>
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4" data-testid="fg-tiles">
        {tiles.map((t) => (
          <Tile key={t.id} label={t.label} value={t.r ? t.r.value : "—"} sub={t.r ? <><span className={`text-${fearGreedTone(t.r.value)}`}>{t.r.label}</span> · {md(t.r.t)}</> : "not enough history"} testId={`tile-${t.id}`} />
        ))}
      </div>
    </div>
  );
}

export function CyclePage() {
  const cycle = useCycle();
  const [tf, setTf] = useState<CycleTf>("90D");
  const c = cycle.data?.data;
  const last = c?.points.at(-1);
  const band = c && last ? rainbowBandName(last.close, last.fit, c.rainbowMultipliers, c.rainbowNames) : null;
  const pts = useMemo(() => (c?.points ?? []).slice(-CYCLE_DAYS[tf]), [c, tf]);
  const x = pts.map((p) => (tf === "30D" ? md(p.t) : mdy(p.t)));
  const xTip = pts.map((p) => mdy(p.t));
  const crossed = last && last.ma111 !== null && last.ma350x2 !== null ? last.ma111 >= last.ma350x2 : null;
  const chips = <Chips items={CYCLE_TFS} value={tf} onChange={setTf} testId="cycle-tf" />;
  return (
    <div className="space-y-4" data-testid="cycle-page" data-state={cycle.isPending ? "loading" : cycle.data ? "ready" : "unavailable"}>
      <PageTitle title="BTC Cycle Indicators" sub={c ? `daily closes · ${c.windowDays}-day window · Bybit spot` : "waiting for the cycle dataset"} tools={chips} />
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4" data-testid="cycle-tiles">
        <Tile label="AHR999" value="n/a" sub="needs verified constants · GAPS #59" tone="muted" testId="tile-ahr" />
        <Tile label="Puell Multiple" value="n/a" sub="needs miner revenue · GAPS #59" tone="muted" testId="tile-puell" />
        <Tile label="Pi Cycle · 111DMA / 350DMA×2" value={last && last.ma111 !== null && last.ma350x2 !== null ? `${fmtPx(last.ma111)} / ${fmtPx(last.ma350x2)}` : "—"} sub={crossed === null ? "needs 350 daily closes" : crossed ? "111DMA above 2×350DMA · top signal" : "111DMA below 2×350DMA"} tone={crossed === null ? "muted" : crossed ? "loss" : "profit"} testId="tile-pi" />
        <Tile label="Rainbow Band" value={band ?? "—"} sub={last ? `close ${fmtPx(last.close)} · fit over the window` : "waiting for the fit"} testId="tile-rainbow" />
      </div>
      <SourceLine snapshot={cycle.data} />
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="AHR999" sub="< 0.45 bottom zone · > 1.2 top zone" testId="panel-ahr">
          <ComingSoon title="AHR999" why="Needs the published 200-day cost basis and age-curve constants; we do not ship a formula we could not verify." gap={59} />
        </Panel>
        <Panel title="Puell Multiple" sub="miner revenue vs its 365-day average · undervalued below 0.5" testId="panel-puell">
          <ComingSoon title="Puell Multiple" why="Needs daily miner revenue from an on-chain provider (paid or terms-restricted)." gap={59} />
        </Panel>
      </div>
      <Panel title="Pi Cycle" sub="price with the 111-day MA and 2× the 350-day MA · log axis" testId="panel-pi">
        <Chart h={260} logY x={x} xTip={xTip} series={[{ label: "Price", type: "line", data: pts.map((p) => p.close), color: "hsl(var(--foreground))", width: 1.2, fmt: fmtPx }, { label: "111DMA", type: "line", data: pts.map((p) => p.ma111), color: "hsl(var(--warning))", fmt: fmtPx }, { label: "350DMA×2", type: "line", data: pts.map((p) => p.ma350x2), color: "hsl(var(--curve))", fmt: fmtPx }]} yFmt={fmtPx} loading={cycle.isPending} empty="No daily closes yet" testId="chart-pi" />
        <SourceLine snapshot={cycle.data} />
      </Panel>
    </div>
  );
}

export function BalancePage() {
  return (
    <div className="space-y-4" data-testid="balance-page" data-state="soon">
      <PageTitle title="Exchange Balance" sub="Bitcoin held on exchanges" />
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4" data-testid="balance-tiles">
        <Tile label="Total BTC Balance" value="—" sub="coming soon · GAPS #55" tone="muted" />
        <Tile label="24h Change" value="—" sub="coming soon" tone="muted" />
        <Tile label="7d Change" value="—" sub="coming soon" tone="muted" />
        <Tile label="30d Change" value="—" sub="coming soon" tone="muted" />
      </div>
      <Panel title="BTC Balance" sub="90 days · per-exchange table below" testId="panel-balance">
        <ComingSoon title="Exchange reserves need an on-chain source" why="Bitcoin held per exchange comes from paid or terms-restricted on-chain providers (research §2D). The chart and the per-exchange table with 24h / 7d / 30d changes light up when one is chosen." gap={55} />
      </Panel>
    </div>
  );
}

export function UnlocksPage() {
  return (
    <div className="space-y-4" data-testid="unlocks-page" data-state="unavailable">
      <PageTitle title="Token Unlock Schedule" sub="Upcoming vesting events" />
      <Panel title="Token unlock data unavailable" testId="panel-unlocks">
        <p className="text-xs text-muted-foreground" data-testid="unlocks-note">This data source is not enabled on the current plan. Enable a token-unlock endpoint in the proxy to populate this view — no mock data shown.</p>
        <p className="micro mt-2">Token unlock schedules are a paid dataset (DefiLlama Pro) · GAPS #55</p>
      </Panel>
    </div>
  );
}
