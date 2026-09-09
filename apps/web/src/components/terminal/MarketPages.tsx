"use client";
// Terminal market screens (HC-MT-040..067, 102..113, 156..166): the dashboard (tiles, watchlist strip, aggregated OI
// and long/short charts, gainers / losers, the markets table), Spot Markets (sortable screener with OI share, compare
// and the watchlist chip), the sector pages and the exchange overview. Every row links into the terminal's own coin
// and exchange pages; every panel prints its source line. Rows are the markets snapshot merged with the overview
// symbols (the same merge the hub uses), so the two apps never disagree on a number.
import type { MarketRow } from "@hapiecoin/schema";
import { cn } from "@hapiecoin/ui";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { useAnalyticsMany, useMarkets, useOverview } from "@/lib/api/analytics";
import { venueLabel } from "@/lib/analytics/derive";
import { type Timeframe, ago, pct, price, sliceSeries, toneClass, usdCompact } from "@/lib/analytics/format";
import { useUiStore } from "@/lib/store";
import { venueCoins, venueTotals } from "@/lib/terminal/derive";
import { EXCHANGES, SECTORS, isExchange, isSector, sectorName } from "@/lib/terminal/nav";
import { Chart } from "@/components/analytics/Chart";
import { Chips } from "@/components/analytics/Chips";
import { type Column, DataTable } from "@/components/analytics/DataTable";
import { type HubRow, mergeRows, sectorOf } from "@/components/analytics/HubPage";
import { ComparePanel, MAX_COMPARE, parseCompare } from "@/components/analytics/MarketsPage";
import { Coin, ComingSoon, Heat, Panel, SourceLine, Tile } from "@/components/analytics/bits";
import { PageTitle } from "./TerminalShell";

const coinHref = (r: { symbol: string }) => `/terminal/coin/${r.symbol}`;
const lsCell = (v: number | null | undefined) => (v === null || v === undefined ? <span className="text-muted-foreground">—</span> : <span className={v >= 1 ? "text-profit" : "text-loss"}>{v.toFixed(2)}</span>);

/** Markets rows with the overview's derivatives columns, plus the aggregated open interest for shares. */
function useTerminalRows() {
  const markets = useMarkets();
  const overview = useOverview();
  const rows = useMemo(() => mergeRows(markets.data?.data.rows ?? [], overview.data?.data.symbols ?? []), [markets.data, overview.data]);
  const totalOi = overview.data?.data.totalOiUsd ?? null;
  return { markets, overview, rows, totalOi, pending: markets.isPending || overview.isPending, unavailable: markets.isError && !markets.data };
}

type ShareRow = HubRow & { oiShare: number | null };
const withShare = (rows: HubRow[], totalOi: number | null): ShareRow[] => rows.map((r) => ({ ...r, oiShare: r.oiUsd !== undefined && totalOi ? r.oiUsd / totalOi : null }));

/** Spot Markets / sector columns (HC-MT-054..060, 161): the hidden ones sit behind Columns ▾. */
export const spotCols: Column<ShareRow>[] = [
  { key: "rank", label: "Coin", sortVal: (r) => -r.rank, render: (r) => <Coin symbol={r.symbol} name={r.name} rank={r.rank} /> },
  { key: "price", label: "Price", align: "r", render: (r) => price(r.price) },
  { key: "change24h", label: "24h %", align: "r", render: (r) => <Heat v={r.change24h} /> },
  { key: "change7d", label: "7d %", align: "r", hidden: true, render: (r) => <Heat v={r.change7d} max={15} /> },
  { key: "marketCap", label: "Market Cap", align: "r", render: (r) => usdCompact(r.marketCap) },
  { key: "volume24h", label: "24h Volume", align: "r", render: (r) => usdCompact(r.volume24h) },
  { key: "oiUsd", label: "Open Interest", align: "r", sortVal: (r) => r.oiUsd ?? null, render: (r) => usdCompact(r.oiUsd) },
  { key: "oiShare", label: "OI Share", align: "r", sortVal: (r) => r.oiShare, render: (r) => (r.oiShare === null ? "—" : <span className="inline-flex w-[96px] items-center justify-end gap-2"><span className="h-1.5 max-w-[48px] flex-1 overflow-hidden rounded bg-muted"><i className="block h-full rounded bg-[hsl(var(--curve))]" style={{ width: `${Math.min(100, r.oiShare * 100).toFixed(1)}%` }} /></span><span className="num">{(r.oiShare * 100).toFixed(1)}%</span></span>) },
  { key: "funding", label: "Funding", align: "r", hidden: true, sortVal: (r) => r.funding ?? null, render: (r) => <span className={toneClass(r.funding)}>{pct(r.funding, 4, true)}</span> },
  { key: "lsRatio", label: "L/S", align: "r", hidden: true, sortVal: (r) => r.lsRatio ?? null, render: (r) => lsCell(r.lsRatio) },
];
/** Dashboard markets table (HC-MT-051, 158): OI first, Funding hidden. */
export const dashCols: Column<ShareRow>[] = [
  { key: "rank", label: "Coin", sortVal: (r) => -r.rank, render: (r) => <Coin symbol={r.symbol} name={r.name} rank={r.rank} /> },
  { key: "price", label: "Price", align: "r", render: (r) => price(r.price) },
  { key: "change24h", label: "24h %", align: "r", render: (r) => <Heat v={r.change24h} /> },
  { key: "oiUsd", label: "Open Interest", align: "r", sortVal: (r) => r.oiUsd ?? null, render: (r) => usdCompact(r.oiUsd) },
  { key: "volume24h", label: "24h Vol", align: "r", render: (r) => usdCompact(r.volume24h) },
  { key: "funding", label: "Funding", align: "r", hidden: true, sortVal: (r) => r.funding ?? null, render: (r) => <span className={toneClass(r.funding)}>{pct(r.funding, 4, true)}</span> },
];
const glCols: Column<MarketRow>[] = [
  { key: "symbol", label: "Coin", render: (r) => <Coin symbol={r.symbol} name={r.name} /> },
  { key: "price", label: "Price", align: "r", render: (r) => price(r.price) },
  { key: "change24h", label: "24h %", align: "r", render: (r) => <Heat v={r.change24h} /> },
];

/** 7-day sparkline for a watchlist card (HC-MT-156). */
function Spark({ values, up }: { values: readonly number[]; up: boolean }) {
  if (values.length < 2) return <span className="block h-7 w-full" />;
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const span = hi - lo || 1;
  const d = values.map((v, i) => `${((i / (values.length - 1)) * 100).toFixed(1)},${(28 - ((v - lo) / span) * 26 - 1).toFixed(1)}`).join(" ");
  return (
    <svg viewBox="0 0 100 28" preserveAspectRatio="none" className="block h-7 w-full" aria-hidden="true">
      <polyline points={d} fill="none" stroke={up ? "hsl(var(--profit))" : "hsl(var(--loss))"} strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/** Watchlist strip (HC-MT-156): cards open the terminal coin page; ★ removes; empty state points at Spot Markets. */
export function WatchStrip({ rows }: { rows: HubRow[] }) {
  const watch = useUiStore((s) => s.watchlist);
  const toggleWatch = useUiStore((s) => s.toggleWatch);
  const cards = watch.map((s) => rows.find((r) => r.symbol === s)).filter((r): r is HubRow => r !== undefined);
  return (
    <div className="space-y-2" data-testid="watch-strip" data-count={cards.length}>
      <div className="flex flex-wrap items-center gap-2 text-2xs text-muted-foreground">
        <span className="micro">Watchlist</span>
        <span>{cards.length} coins · 7D sparkline · click a card to open the coin</span>
        <Link href="/terminal/spot" className="ml-auto text-accent underline-offset-2 hover:underline" data-testid="watch-manage">Manage in Spot Markets →</Link>
      </div>
      {cards.length === 0 ? (
        <div className="rounded border border-dashed border-border px-3 py-2 text-2xs text-muted-foreground" data-testid="watch-empty">No coins starred yet — ★ a row in any table to pin it here.</div>
      ) : (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
          {cards.map((r) => (
            <div key={r.symbol} className="relative rounded-md border border-border bg-card p-2" data-testid="watch-card" data-symbol={r.symbol}>
              <Link href={coinHref(r)} className="block" aria-label={`Open ${r.symbol}`}>
                <div className="flex items-center gap-1.5 text-xs">
                  <b>{r.symbol}</b>
                  <span className="truncate text-muted-foreground">{r.name}</span>
                </div>
                <div className="mt-0.5 flex items-center justify-between gap-2">
                  <span className="num text-[13px]">{price(r.price)}</span>
                  <Heat v={r.change24h} />
                </div>
                <Spark values={r.sparkline7d} up={(r.change7d ?? r.change24h ?? 0) >= 0} />
              </Link>
              <button type="button" onClick={() => toggleWatch(r.symbol)} className="absolute right-1.5 top-1.5 text-accent" aria-label={`Remove ${r.symbol} from the watchlist`} title="Remove from watchlist" data-testid="watch-remove">★</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function DashboardPage() {
  const { markets, overview, rows, totalOi, pending, unavailable } = useTerminalRows();
  const [tfOi, setTfOi] = useState<Timeframe>("1D");
  const [tfLs, setTfLs] = useState<Timeframe>("1D");
  const o = overview.data?.data;
  const btc = o?.symbols.find((s) => s.symbol === "BTC");
  const dominance = btc && totalOi ? (btc.oiUsd / totalOi) * 100 : null;
  const now = Date.now();
  const oi = sliceSeries(o?.oiHistory ?? [], tfOi, now);
  const ls = sliceSeries(o?.lsHistory ?? [], tfLs, now);
  const shareRows = useMemo(() => withShare(rows, totalOi), [rows, totalOi]);
  const fg = o?.fearGreed ?? null;
  return (
    <div className="space-y-4" data-testid="dashboard-page" data-state={pending ? "loading" : unavailable && !overview.data ? "unavailable" : "ready"}>
      <PageTitle title="Dashboard" sub="Derivatives market overview" tools={<span className="text-2xs text-muted-foreground">Updated <b className="num text-foreground">{overview.data ? ago(overview.data.asOf, now) : "—"}</b></span>} />
      <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6" data-testid="dashboard-tiles">
        <Tile label="Fear & Greed" value={fg?.value ?? "—"} sub={fg ? `${fg.label} · sentiment index · daily` : "waiting for alternative.me"} tone={fg ? (fg.value < 45 ? "loss" : fg.value > 55 ? "profit" : "muted") : "muted"} testId="tile-fg" />
        <Tile label="Total Open Interest" value={usdCompact(totalOi)} sub={<>All tracked coins · <b className={toneClass(o?.oiChange24h)}>{pct(o?.oiChange24h, 2, true)}</b> 24h</>} testId="tile-oi" />
        <Tile label="24h Volume" value={usdCompact(markets.data?.data.global.volume24h)} sub={markets.data ? "Spot · all coins · CoinGecko" : "needs CoinGecko"} testId="tile-vol" />
        <Tile label="BTC Dominance" value={dominance === null ? "—" : `${dominance.toFixed(1)}%`} sub="OI share of tracked coins" testId="tile-dom" />
        <Tile label="BTC ETF Net Inflow" value="—" sub="coming soon · GAPS #55" tone="muted" testId="tile-etf" />
        <Tile label="Long / Short Ratio" value={o?.btcLongShort ? o.btcLongShort.ratio.toFixed(2) : "—"} sub="BTC · global accounts" tone={o?.btcLongShort ? (o.btcLongShort.ratio >= 1 ? "profit" : "loss") : "muted"} testId="tile-ls" />
      </div>
      <SourceLine snapshot={overview.data} />
      <WatchStrip rows={rows} />
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Aggregated Open Interest" sub="OI USD · tracked coins · every venue reporting" testId="panel-oi">
          <Chart h={220} x={oi.x} xTip={oi.xTip} series={[{ label: "Open Interest", type: "area", data: oi.values, color: "hsl(var(--curve))", fmt: (v) => usdCompact(v) }]} yFmt={(v) => usdCompact(v, 1)} loading={overview.isPending} empty={oi.covered ? "Nothing to plot" : "Provider history covers less than this range"} tf={{ value: tfOi, onChange: setTfOi }} testId="chart-oi" />
          <SourceLine snapshot={overview.data} />
        </Panel>
        <Panel title="Long / Short Ratio" sub="L/S · BTC · global accounts" testId="panel-ls">
          <Chart h={220} x={ls.x} xTip={ls.xTip} series={[{ label: "Long / Short Ratio", type: "line", data: ls.values, color: "hsl(var(--warning))", fmt: (v) => v.toFixed(2) }]} hlines={[{ y: 1, label: "L/S = 1" }]} yFmt={(v) => v.toFixed(2)} loading={overview.isPending} empty={ls.covered ? "Nothing to plot" : "Provider history covers less than this range"} tf={{ value: tfLs, onChange: setTfLs }} testId="chart-ls" />
          <SourceLine snapshot={overview.data} />
        </Panel>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Top Gainers (24h)" sub="best 24h performers" testId="panel-gainers">
          <DataTable id="gainers" rows={(o?.markets?.gainers ?? []).slice(0, 6)} cols={glCols} rowKey={(r) => r.symbol} sortKey="change24h" search={false} rowHref={coinHref} compact empty={o?.markets ? "Nothing to rank" : "Needs CoinGecko"} />
        </Panel>
        <Panel title="Top Losers (24h)" sub="worst 24h performers" testId="panel-losers">
          <DataTable id="losers" rows={(o?.markets?.losers ?? []).slice(0, 6)} cols={glCols} rowKey={(r) => r.symbol} sortKey="change24h" sortDir="asc" search={false} rowHref={coinHref} compact empty={o?.markets ? "Nothing to rank" : "Needs CoinGecko"} />
        </Panel>
      </div>
      <Panel title="Markets" sub={`${rows.length} tracked coins · click a row to open the coin · ★ pins it to the watchlist`} testId="panel-markets">
        {unavailable ? (
          <ComingSoon title="Needs CoinGecko" why="The markets dataset has not been written yet: set COINGECKO_API_KEY on the ingest service and wait for its first run." gap={56} />
        ) : (
          <DataTable id="dash-markets" rows={shareRows} cols={dashCols} rowKey={(r) => r.symbol} sortKey="oiUsd" search searchText={(r) => `${r.symbol} ${r.name}`} searchPlaceholder="Search coin…" columns csv="terminal-markets" star={(r) => r.symbol} rowHref={coinHref} maxH={560} empty="No coins tracked yet" />
        )}
        <SourceLine snapshot={markets.data} />
      </Panel>
    </div>
  );
}

/** The screener shared by Spot Markets and the sector pages (HC-MT-053..062, 065, 159..162). */
function Screener({ id, rows, title, sub, csv, compare, toggleCompare, watchOnly, setWatchOnly, unavailable, snapshot, empty }: { id: string; rows: ShareRow[]; title: string; sub: string; csv: string; compare?: string[]; toggleCompare?: (s: string) => void; watchOnly: boolean; setWatchOnly: (f: (w: boolean) => boolean) => void; unavailable: boolean; snapshot: Parameters<typeof SourceLine>[0]["snapshot"]; empty: string }) {
  const watch = useUiStore((s) => s.watchlist);
  const shown = watchOnly ? rows.filter((r) => watch.includes(r.symbol)) : rows;
  return (
    <Panel
      title={title}
      sub={sub}
      tools={
        <button type="button" onClick={() => setWatchOnly((w) => !w)} aria-pressed={watchOnly} className={cn("rounded border border-border px-2 py-0.5 font-mono text-2xs", watchOnly ? "bg-muted text-accent" : "text-muted-foreground hover:text-foreground")} data-testid="watch-only">
          ★ Watchlist
        </button>
      }
      testId={`panel-${id}`}
    >
      {unavailable ? (
        <ComingSoon title="Needs CoinGecko" why="The markets dataset has not been written yet: set COINGECKO_API_KEY on the ingest service and wait for its first run." gap={56} />
      ) : (
        <DataTable
          id={id}
          rows={shown}
          cols={spotCols}
          rowKey={(r) => r.symbol}
          sortKey="marketCap"
          search
          searchText={(r) => `${r.symbol} ${r.name}`}
          searchPlaceholder="Filter by symbol or name…"
          columns
          csv={csv}
          star={(r) => r.symbol}
          {...(compare && toggleCompare ? { select: { get: (r: ShareRow) => r.symbol, selected: compare, onToggle: toggleCompare, max: MAX_COMPARE } } : {})}
          rowHref={coinHref}
          maxH={720}
          empty={watchOnly ? "Your watchlist is empty — star coins to pin them here" : empty}
          foot={<div className="micro mt-2" data-testid={`${id}-count`}>{shown.length} markets · hidden columns: 7d %, Funding, L/S (Columns ▾)</div>}
        />
      )}
      <SourceLine snapshot={snapshot} />
    </Panel>
  );
}

export function SpotPage() {
  const params = useSearchParams();
  const { markets, rows, totalOi, pending, unavailable } = useTerminalRows();
  const [watchOnly, setWatchOnly] = useState(false);
  const [compare, setCompare] = useState<string[]>(() => parseCompare(params.get("compare")));
  const shareRows = useMemo(() => withShare(rows, totalOi), [rows, totalOi]);
  const toggleCompare = (sym: string) => setCompare((list) => (list.includes(sym) ? list.filter((x) => x !== sym) : list.length >= MAX_COMPARE ? list : [...list, sym]));
  const cmpRows = compare.map((s) => rows.find((r) => r.symbol === s)).filter((r): r is HubRow => r !== undefined);
  const missing = rows.length ? compare.filter((s) => !rows.some((r) => r.symbol === s)) : [];
  return (
    <div className="space-y-4" data-testid="spot-page" data-state={pending ? "loading" : unavailable ? "unavailable" : "ready"}>
      <PageTitle title="Spot Markets" sub="Sortable list of all tracked markets · spot from CoinGecko, open interest from the perpetual venues" tools={<span className="rounded border border-border px-2 py-0.5 font-mono text-2xs text-muted-foreground" data-testid="spot-counter">{rows.length} markets</span>} />
      {compare.length ? <ComparePanel rows={cmpRows} missing={missing} onRemove={toggleCompare} onClear={() => setCompare([])} /> : null}
      <Screener id="spot" rows={shareRows} title="Markets" sub="tick Cmp to compare up to 3 coins · ★ to pin on the dashboard" csv="spot-markets" compare={compare} toggleCompare={toggleCompare} watchOnly={watchOnly} setWatchOnly={setWatchOnly} unavailable={unavailable} snapshot={markets.data} empty="No markets match" />
    </div>
  );
}

export function SectorPage({ slug }: { slug: string }) {
  const router = useRouter();
  const { markets, rows, totalOi, pending, unavailable } = useTerminalRows();
  const [watchOnly, setWatchOnly] = useState(false);
  const known = isSector(slug);
  const sectorRows = useMemo(() => withShare(rows.filter((r) => sectorOf(r.symbol) === slug), totalOi), [rows, slug, totalOi]);
  const chips = (
    <Chips items={SECTORS.map((s) => s.slug)} labels={Object.fromEntries(SECTORS.map((s) => [s.slug, s.name]))} value={known ? slug : SECTORS[0].slug} onChange={(s) => router.push(`/terminal/sectors/${s}`)} testId="sector-chips" />
  );
  if (!known) {
    return (
      <div className="space-y-4" data-testid="sector-page" data-slug={slug} data-state="unknown">
        <PageTitle title={`Unknown sector: ${slug}`} sub="Pick a known sector" tools={chips} />
        <div className="rounded border border-dashed border-border p-6 text-center text-xs text-muted-foreground" data-testid="sector-unknown">Unknown sector: {slug}. The terminal groups coins into Layer-1, Layer-2, DeFi and Memes.</div>
      </div>
    );
  }
  return (
    <div className="space-y-4" data-testid="sector-page" data-slug={slug} data-state={pending ? "loading" : unavailable ? "unavailable" : "ready"}>
      <PageTitle title={`${sectorName(slug)} Sector`} sub={`${sectorRows.length} symbols · tracked coins in this sector`} tools={chips} />
      <Screener id="sector" rows={sectorRows} title={`${sectorName(slug)} markets`} sub="same columns as Spot Markets · ★ pins to the watchlist" csv={`sector-${slug}`} watchOnly={watchOnly} setWatchOnly={setWatchOnly} unavailable={unavailable} snapshot={markets.data} empty="No tracked coin in this sector" />
    </div>
  );
}

interface ExRow { symbol: string; name: string | undefined; oiUsd: number | null; change24h: number | null; rate: number | null; apr: number | null }
export const exchangeCols: Column<ExRow>[] = [
  { key: "symbol", label: "Coin", render: (r) => <Coin symbol={r.symbol} name={r.name} /> },
  { key: "oiUsd", label: "Open Interest", align: "r", render: (r) => usdCompact(r.oiUsd) },
  { key: "change24h", label: "OI 24h %", align: "r", render: (r) => <Heat v={r.change24h} fraction /> },
  { key: "rate", label: "Funding", align: "r", render: (r) => <span className={toneClass(r.rate)}>{pct(r.rate, 4, true)}</span> },
  { key: "apr", label: "Annualised", align: "r", hidden: true, render: (r) => pct(r.apr, 1, true) },
];

/** Exchange overview (HC-MT-102..113, 166): venue totals over the per-symbol OI snapshots, its coins with funding. */
export function ExchangePage({ exchange }: { exchange: string }) {
  const router = useRouter();
  const venue = exchange.toLowerCase();
  const { markets, overview, rows, totalOi } = useTerminalRows();
  const symbols = useMemo(() => (overview.data?.data.symbols ?? []).map((s) => s.symbol), [overview.data]);
  const oi = useAnalyticsMany("open-interest", symbols);
  const fund = useAnalyticsMany("funding", symbols);
  const totals = useMemo(() => venueTotals(oi.data.map((d) => d.data)), [oi.data]);
  const chipsList = useMemo(() => [...new Set<string>([...EXCHANGES, ...totals.map((t) => t.venue)])], [totals]);
  const known = isExchange(venue) || totals.some((t) => t.venue === venue);
  const mine = totals.find((t) => t.venue === venue);
  const coins = useMemo<ExRow[]>(() => {
    const names = new Map(rows.map((r) => [r.symbol, r.name]));
    return venueCoins(venue, oi.data.map((d) => d.data), fund.data.map((d) => d.data)).map((r) => ({ symbol: r.symbol, name: names.get(r.symbol), oiUsd: r.oiUsd, change24h: r.change24h, rate: r.rate, apr: r.apr }));
  }, [venue, oi.data, fund.data, rows]);
  const chips = <Chips items={chipsList} labels={Object.fromEntries(chipsList.map((v) => [v, venueLabel(v)]))} value={known ? venue : chipsList[0]!} onChange={(v) => router.push(`/terminal/exchanges/${v}`)} testId="exchange-chips" />;
  const state = overview.isPending || (symbols.length > 0 && !oi.settled) ? "loading" : known ? "ready" : "unknown";
  return (
    <div className="space-y-4" data-testid="exchange-page" data-exchange={venue} data-state={state}>
      <PageTitle title={known ? venueLabel(venue) : `Unknown exchange: ${exchange}`} sub={known ? "Exchange overview · perpetual futures" : "Pick a venue the ingest reports"} tools={chips} />
      {state === "unknown" ? (
        <div className="rounded border border-dashed border-border p-6 text-center text-xs text-muted-foreground" data-testid="exchange-unknown">No data · the ingest reports {chipsList.map(venueLabel).join(", ")}.</div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2 lg:grid-cols-4" data-testid="exchange-tiles">
            <Tile label="Tracked Coins" value={mine ? mine.coins : "—"} sub="perpetual markets reporting OI" testId="tile-coins" />
            <Tile label="Total OI" value={usdCompact(mine?.oiUsd)} sub={mine ? `${(mine.share * 100).toFixed(1)}% of aggregated OI${totalOi ? ` · tracked total ${usdCompact(totalOi)}` : ""}` : "no open interest reported"} testId="tile-oi" />
            <Tile label="24h Volume" value="—" sub="needs venue tickers · GAPS #63" tone="muted" testId="tile-vol" />
            <Tile label="BTC Balance" value="—" sub="coming soon · needs on-chain data · GAPS #55" tone="muted" testId="tile-btc" />
          </div>
          <Panel title={`Coins on ${venueLabel(venue)}`} sub={`${coins.length} markets · sortable · click a row to open the coin`} testId="panel-exchange-coins">
            <DataTable id="exchange-coins" rows={coins} cols={exchangeCols} rowKey={(r) => r.symbol} sortKey="oiUsd" search searchText={(r) => `${r.symbol} ${r.name ?? ""}`} searchPlaceholder="Search…" columns csv={`${venue}-coins`} star={(r) => r.symbol} rowHref={coinHref} maxH={640} empty={oi.settled ? "This venue has not reported any tracked coin yet" : "Waiting for the venue snapshots…"} />
            <SourceLine snapshot={oi.data[0]} />
          </Panel>
          <SourceLine snapshot={markets.data} />
        </>
      )}
    </div>
  );
}
