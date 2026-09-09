"use client";
// Options (HC-MA-049..053, 114): one underlying at a time with an exchange toggle (Deribit / Delta India), four tiles,
// call/put open interest per expiry with the max-pain line in amber, the OI-by-exchange donut and the exchanges
// table. OI is in underlying units (BTC), as both venues report it (ADR-042).
import { OPTIONS_VENUE_LABELS, type OptionsVenue, type OptionsVenueData } from "@hapiecoin/schema";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { useOptions } from "@/lib/api/analytics";
import { price, usdCompact } from "@/lib/analytics/format";
import { Chart } from "./Chart";
import { Chips } from "./Chips";
import { type Column, DataTable } from "./DataTable";
import { CoinSelect, Donut, Heat, Panel, SourceLine, Tile } from "./bits";

const VENUE_COLORS: Record<OptionsVenue, string> = { deribit: "hsl(var(--curve))", delta: "hsl(var(--primary))" };
const OPTION_SYMBOLS = ["BTC", "ETH"] as const;
const compact = (v: number) => (v >= 1e6 ? `${(v / 1e6).toFixed(2)}M` : v >= 1e3 ? `${(v / 1e3).toFixed(1)}K` : v.toFixed(v >= 100 ? 0 : 2));
const expiryTip = (t: number) => new Date(t).toLocaleString("en-US", { month: "short", day: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "UTC" });

export function exchangeCols(total: number): Column<OptionsVenueData>[] {
  return [
    { key: "venue", label: "Exchange", render: (r) => <span className="inline-flex items-center gap-2"><i className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: VENUE_COLORS[r.venue] }} aria-hidden="true" /><b>{OPTIONS_VENUE_LABELS[r.venue]}</b></span> },
    { key: "oiUsd", label: "OI (USD)", align: "r", render: (r) => usdCompact(r.oiUsd) },
    { key: "share", label: "Share", align: "r", sortVal: (r) => (total > 0 ? r.oiUsd / total : null), render: (r) => (total > 0 ? `${((r.oiUsd / total) * 100).toFixed(1)}%` : "—") },
    { key: "oiBase", label: "OI (units)", align: "r", render: (r) => compact(r.oiBase) },
    { key: "putCallOi", label: "Put/Call", align: "r", render: (r) => (r.putCallOi === null ? "—" : <span className={r.putCallOi > 1 ? "text-loss" : "text-profit"}>{r.putCallOi.toFixed(2)}</span>) },
    { key: "volume24hUsd", label: "24h Volume", align: "r", render: (r) => usdCompact(r.volume24hUsd) },
    { key: "expiries", label: "Expiries", align: "r", sortVal: (r) => r.expiries.length, render: (r) => String(r.expiries.length) },
  ];
}

export function OptionsPage() {
  const router = useRouter();
  const params = useSearchParams();
  const [sym, setSym] = useState(() => (OPTION_SYMBOLS as readonly string[]).includes((params.get("symbol") ?? "").toUpperCase()) ? params.get("symbol")!.toUpperCase() : "BTC");
  const [venue, setVenue] = useState<OptionsVenue>(() => (params.get("exchange") === "delta" ? "delta" : "deribit"));
  const options = useOptions(sym);
  const venues = options.data?.data.venues ?? [];
  const ex = venues.find((v) => v.venue === venue) ?? venues[0];
  const total = venues.reduce((s, v) => s + v.oiUsd, 0);
  const expiries = ex?.expiries ?? [];
  const nearest = expiries[0];
  const unavailable = options.isError && !options.data;
  const select = (next: { symbol?: string; exchange?: OptionsVenue }) => {
    const s = next.symbol ?? sym;
    const e = next.exchange ?? venue;
    setSym(s);
    setVenue(e);
    router.replace(`/analytics/options?symbol=${s}&exchange=${e}`);
  };
  const mx = expiries.map((e) => Math.max(e.callOi, e.putOi));
  return (
    <div className="space-y-4" data-testid="options-page" data-symbol={sym} data-exchange={ex?.venue ?? venue} data-state={options.isPending ? "loading" : unavailable ? "unavailable" : "ready"}>
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-[14px] font-medium">{ex ? OPTIONS_VENUE_LABELS[ex.venue] : "Options"} · Options</h2>
        <span className="text-2xs text-muted-foreground">{sym} options · open interest, volume &amp; max pain</span>
        <div className="ml-auto flex items-center gap-2">
          <CoinSelect value={sym} symbols={OPTION_SYMBOLS} onChange={(s) => select({ symbol: s })} testId="options-symbol" />
          <Chips items={venues.length ? venues.map((v) => v.venue) : (["deribit", "delta"] as const)} labels={OPTIONS_VENUE_LABELS} value={ex?.venue ?? venue} onChange={(v) => select({ exchange: v })} testId="options-exchange" />
        </div>
      </div>
      {unavailable ? <div className="rounded border border-dashed border-border p-4 text-xs text-muted-foreground" data-testid="options-unavailable">No options snapshot for {sym} yet. The ingest polls Deribit and Delta India every few minutes; check OPTIONS_SYMBOLS and that the venues are reachable.</div> : null}
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4" data-testid="options-tiles">
        <Tile label="Total open interest" value={usdCompact(ex?.oiUsd)} sub={ex ? `share ${total > 0 ? ((ex.oiUsd / total) * 100).toFixed(1) : "—"}% of the venues we track` : "waiting for a venue"} testId="tile-oi" />
        <Tile label={`OI (${sym})`} value={ex ? compact(ex.oiBase) : "—"} sub={<>Put/Call ratio <b className={ex?.putCallOi !== null && ex?.putCallOi !== undefined && ex.putCallOi > 1 ? "text-loss num" : "text-profit num"}>{ex?.putCallOi?.toFixed(2) ?? "—"}</b></>} testId="tile-contracts" />
        <Tile label="24h volume" value={usdCompact(ex?.volume24hUsd)} sub={ex ? `${ex.instruments} listed options` : ""} testId="tile-vol" />
        <Tile label="Nearest expiry max pain" value={nearest?.maxPain !== null && nearest?.maxPain !== undefined ? price(nearest.maxPain) : "—"} sub={nearest ? `${nearest.label} · underlying ${price(ex?.underlyingPrice)}` : "no live expiry"} tone="warning" testId="tile-maxpain" />
      </div>
      <SourceLine snapshot={options.data} />
      <Panel title="Open Interest by Expiry" sub={`Call/put OI per expiry (${sym}) with max pain price · ${ex ? OPTIONS_VENUE_LABELS[ex.venue] : ""}`} testId="panel-expiry">
        <Chart
          h={260}
          rightAxis
          x={expiries.map((e) => e.label)}
          xTip={expiries.map((e) => `${e.label} · ${expiryTip(e.expiry)} · ${e.strikes} strikes`)}
          series={[
            { label: "Call OI", type: "bar", data: expiries.map((e) => e.callOi), color: "hsl(var(--profit) / 0.75)", fmt: (v) => `${compact(v)} ${sym}` },
            { label: "Put OI", type: "bar", data: expiries.map((e) => e.putOi), color: "hsl(var(--loss) / 0.75)", fmt: (v) => `${compact(v)} ${sym}` },
            { label: "Max Pain", type: "line", axis: "r", data: expiries.map((e) => e.maxPain), color: "hsl(var(--primary))", width: 1.4, dash: "4 3", fmt: (v) => price(v) },
          ]}
          labels={expiries.map((e, i) => ({ i, y: mx[i] ?? 0, text: e.maxPain === null ? "" : `$${compact(e.maxPain)}` }))}
          yFmt={(v) => compact(v)}
          y2Fmt={(v) => `$${compact(v)}`}
          loading={options.isPending}
          empty={ex ? "No live expiry" : "Waiting for Deribit or Delta India"}
          testId="chart-expiry"
        />
      </Panel>
      <div className="grid gap-4 lg:grid-cols-[360px_minmax(0,1fr)]">
        <Panel title="Open Interest by Exchange" sub="share of options OI" testId="panel-donut">
          <Donut items={venues.map((v) => ({ label: OPTIONS_VENUE_LABELS[v.venue], value: v.oiUsd, color: VENUE_COLORS[v.venue] }))} center={usdCompact(total, 1)} />
          <p className="mt-2 text-2xs text-muted-foreground">OKX, Bybit and Binance option books arrive once their tickers are verified (GAPS #59).</p>
        </Panel>
        <Panel title="Options Markets by Exchange" sub="OI, market share and volume" testId="panel-exchanges">
          <DataTable id="options-exchanges" rows={venues} cols={exchangeCols(total)} rowKey={(r) => r.venue} sortKey="oiUsd" csv="options-exchanges" search={false} compact empty="No venue has reported yet" />
          {ex ? <p className="mt-2 text-2xs text-muted-foreground">Underlying {price(ex.underlyingPrice)} · <Heat v={ex.putCallOi === null ? null : (ex.putCallOi - 1) * 100} max={50} digits={0} /> put/call vs parity</p> : null}
        </Panel>
      </div>
      <p className="micro text-center" data-testid="options-footer">Data via {options.data?.source ?? "the ingest service"} · auto-refreshing every {Math.round((options.data?.ttlMs ?? 300_000) / 1000)}s · Deribit OI counts every listed option in {sym}; Delta OI in underlying units</p>
    </div>
  );
}
