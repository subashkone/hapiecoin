"use client";
// Markets Hub (HC-MA-012..029, 105..107): stat tiles from the overview snapshot, the main table (Derivatives /
// Spot / Categories / Memes / L1L2 with Stock and Token Unlock as coming-soon), gainers & losers, heatmap and the
// ETF inflow panel (coming soon, GAPS #55). Every panel prints its source line.
import type { MarketRow, OverviewSymbol } from "@hapiecoin/schema";
import { useMemo, useState } from "react";
import { useMarkets, useOverview } from "@/lib/api/analytics";
import { pct, price, toneClass, usdCompact } from "@/lib/analytics/format";
import { useUiStore } from "@/lib/store";
import { Chips } from "./Chips";
import { type Column, DataTable } from "./DataTable";
import { Coin, ComingSoon, Gauge, Heat, Panel, SourceLine, Split, Tile, Treemap, ViewAll } from "./bits";

const TABS = ["Derivatives", "Spot", "Stock", "Categories", "Token Unlock", "Memes", "L1L2"] as const;
type Tab = (typeof TABS)[number];
const SECTORS: Record<string, "layer-1" | "layer-2" | "defi" | "memes"> = { BTC: "layer-1", ETH: "layer-1", SOL: "layer-1", ADA: "layer-1", AVAX: "layer-1", BNB: "layer-1", LTC: "layer-1", XRP: "layer-1", DOGE: "memes", SHIB: "memes", PEPE: "memes", LINK: "defi", UNI: "defi", AAVE: "defi", ARB: "layer-2", OP: "layer-2", MATIC: "layer-2", POL: "layer-2" };
export const sectorOf = (symbol: string): string => SECTORS[symbol] ?? "other";

export type HubRow = MarketRow & Partial<Pick<OverviewSymbol, "funding" | "oiChange1h" | "oiChange24h" | "liq24hUsd" | "oiUsd">>;
export function mergeRows(markets: MarketRow[], symbols: OverviewSymbol[]): HubRow[] {
  const by = new Map(symbols.map((s) => [s.symbol, s]));
  return markets.map((m) => {
    const s = by.get(m.symbol);
    return s ? { ...m, funding: s.funding, oiChange1h: s.oiChange1h, oiChange24h: s.oiChange24h, liq24hUsd: s.liq24hUsd, oiUsd: s.oiUsd } : m;
  });
}

const assetCol: Column<HubRow> = { key: "rank", label: "Assets", sortVal: (r) => -r.rank, render: (r) => <Coin symbol={r.symbol} name={r.name} rank={r.rank} /> };
export const derivCols: Column<HubRow>[] = [
  assetCol,
  { key: "price", label: "Price", align: "r", render: (r) => price(r.price) },
  { key: "change24h", label: "Price 24h%", align: "r", render: (r) => <Heat v={r.change24h} /> },
  { key: "funding", label: "Funding", align: "r", sortVal: (r) => r.funding ?? null, render: (r) => <span className={toneClass(r.funding)}>{pct(r.funding, 4, true)}</span> },
  { key: "volume24h", label: "Volume 24h", align: "r", render: (r) => usdCompact(r.volume24h) },
  { key: "marketCap", label: "Market Cap", align: "r", render: (r) => usdCompact(r.marketCap) },
  { key: "oiChange1h", label: "OI 1h%", align: "r", sortVal: (r) => r.oiChange1h ?? null, render: (r) => <Heat v={r.oiChange1h} max={2} fraction /> },
  { key: "oiChange24h", label: "OI 24h%", align: "r", sortVal: (r) => r.oiChange24h ?? null, render: (r) => <Heat v={r.oiChange24h} fraction /> },
  { key: "liq24hUsd", label: "Liquidation 24h", align: "r", sortVal: (r) => r.liq24hUsd ?? null, render: (r) => usdCompact(r.liq24hUsd) },
];
export const spotCols: Column<HubRow>[] = [
  assetCol,
  { key: "price", label: "Price", align: "r", render: (r) => price(r.price) },
  { key: "change24h", label: "Price 24h%", align: "r", render: (r) => <Heat v={r.change24h} /> },
  { key: "volume24h", label: "Volume 24h", align: "r", render: (r) => usdCompact(r.volume24h) },
  { key: "marketCap", label: "Market Cap", align: "r", render: (r) => usdCompact(r.marketCap) },
  { key: "change1h", label: "1h%", align: "r", render: (r) => <Heat v={r.change1h} max={1.5} /> },
  { key: "change7d", label: "7d%", align: "r", render: (r) => <Heat v={r.change7d} max={15} /> },
];
interface CategoryRow { key: string; name: string; coins: number; marketCap: number; volume24h: number; openInterest: number; avgChange: number | null; top: string }
export function categories(rows: HubRow[]): CategoryRow[] {
  const names: Record<string, string> = { "layer-1": "Layer 1", "layer-2": "Layer 2", defi: "DeFi", memes: "Memes", other: "Other" };
  const by = new Map<string, CategoryRow & { changes: number[] }>();
  for (const r of rows) {
    const k = sectorOf(r.symbol);
    const g = by.get(k) ?? { key: k, name: names[k] ?? k, coins: 0, marketCap: 0, volume24h: 0, openInterest: 0, avgChange: null, top: r.symbol, changes: [] };
    g.coins += 1;
    g.marketCap += r.marketCap ?? 0;
    g.volume24h += r.volume24h ?? 0;
    g.openInterest += r.oiUsd ?? 0;
    if (r.change24h !== null) g.changes.push(r.change24h);
    if ((r.marketCap ?? 0) > (rows.find((x) => x.symbol === g.top)?.marketCap ?? 0)) g.top = r.symbol;
    by.set(k, g);
  }
  return [...by.values()].map(({ changes, ...g }) => ({ ...g, avgChange: changes.length ? changes.reduce((s, c) => s + c, 0) / changes.length : null })).sort((a, b) => b.marketCap - a.marketCap);
}
const catCols: Column<CategoryRow>[] = [
  { key: "name", label: "Category", render: (r) => <b>{r.name}</b> },
  { key: "coins", label: "Coins", align: "r" },
  { key: "marketCap", label: "Market Cap", align: "r", render: (r) => usdCompact(r.marketCap) },
  { key: "volume24h", label: "Volume 24h", align: "r", render: (r) => usdCompact(r.volume24h) },
  { key: "openInterest", label: "Open Interest", align: "r", render: (r) => usdCompact(r.openInterest) },
  { key: "avgChange", label: "Avg 24h%", align: "r", render: (r) => <Heat v={r.avgChange} /> },
  { key: "top", label: "Top coin", sort: false, render: (r) => <Coin symbol={r.top} /> },
];

export function HubPage() {
  const overview = useOverview();
  const markets = useMarkets();
  const [tab, setTab] = useState<Tab>("Derivatives");
  const [gl, setGl] = useState<"gainers" | "losers">("gainers");
  const watch = useUiStore((s) => s.watchlist);
  const o = overview.data?.data;
  const rows = useMemo(() => mergeRows(markets.data?.data.rows ?? [], o?.symbols ?? []), [markets.data, o]);
  const tableRows = tab === "Memes" ? rows.filter((r) => sectorOf(r.symbol) === "memes") : tab === "L1L2" ? rows.filter((r) => ["layer-1", "layer-2"].includes(sectorOf(r.symbol))) : rows;
  const ls = o?.btcLongShort;
  const longPct = ls ? (ls.long / (ls.long + ls.short || 1)) * 100 : null;
  const liq = o?.liquidations24h;
  const glRows = o?.markets ? (gl === "gainers" ? o.markets.gainers : o.markets.losers) : [];
  const watched = rows.filter((r) => watch.includes(r.symbol));
  const unavailable = overview.isError && !overview.data;
  return (
    <div className="space-y-4" data-testid="hub-page" data-state={overview.isPending ? "loading" : unavailable ? "unavailable" : "ready"}>
      <h2 className="sr-only">Markets Hub</h2>
      {unavailable ? (
        <div className="rounded border border-dashed border-border p-4 text-xs text-muted-foreground" data-testid="hub-unavailable">Market data has not been ingested yet. The ingest service writes the first snapshots within a minute of starting.</div>
      ) : null}
      <div className="grid grid-cols-2 gap-2 md:grid-cols-3 lg:grid-cols-5" data-testid="hub-tiles">
        <Tile label="Open Interest" value={usdCompact(o?.totalOiUsd)} sub={<span>OI Change 24h <b className={toneClass(o?.oiChange24h)}>{pct(o?.oiChange24h, 2, true)}</b></span>} testId="tile-oi" />
        <Tile label="Liquidation (24h)" value={usdCompact(liq ? liq.longUsd + liq.shortUsd : null)} sub={<><span className="text-profit num">L {usdCompact(liq?.longUsd)}</span><span className="text-loss num">S {usdCompact(liq?.shortUsd)}</span></>} extra={liq ? <Split long={liq.longUsd} short={liq.shortUsd} /> : null} testId="tile-liq" />
        <Tile label="Fear & Greed Index" value={o?.fearGreed ? <Gauge value={o.fearGreed.value} label="Fear & Greed" testId="tile-fg-gauge" /> : "—"} sub={o?.fearGreed?.label ?? "waiting for alternative.me"} testId="tile-fg" />
        <Tile label="Bitcoin Dominance" value={o?.markets?.btcDominance !== null && o?.markets?.btcDominance !== undefined ? `${o.markets.btcDominance.toFixed(1)}%` : "—"} sub={o?.markets ? `ETH ${o.markets.ethDominance?.toFixed(1) ?? "—"}% · Total cap ${usdCompact(o.markets.totalMarketCap)}` : "needs CoinGecko"} testId="tile-dominance" />
        <Tile label="Long/Short · BTC · Global accounts" value={ls ? ls.ratio.toFixed(2) : "—"} sub={longPct !== null ? <><span className="text-profit num">Long {longPct.toFixed(1)}%</span><span className="text-loss num">Short {(100 - longPct).toFixed(1)}%</span></> : "waiting for Binance"} extra={longPct !== null ? <Split long={longPct} short={100 - longPct} /> : null} testId="tile-ls" />
        <Tile label="AVG RSI" value="—" sub="arrives with the coin pages" tone="muted" testId="tile-rsi" />
        <Tile label="Altcoin Season Index" value="—" sub="coming soon · GAPS #55" tone="muted" testId="tile-alt" />
        <Tile label="Bitcoin Exchange Balance" value="—" sub="coming soon · needs on-chain data · GAPS #55" tone="muted" testId="tile-exbal" />
        <Tile label="Gold Futures" value="—" sub="GC=F · coming soon · GAPS #55" tone="muted" testId="tile-gold" />
        <Tile label="U.S. Dollar Index" value="—" sub="DX-Y.NYB · coming soon · GAPS #55" tone="muted" testId="tile-dxy" />
      </div>
      <SourceLine snapshot={overview.data} />
      {watched.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2 rounded border border-border bg-card px-3 py-2 text-xs" data-testid="watch-strip">
          <span className="micro">Watchlist</span>
          {watched.map((r) => (
            <span key={r.symbol} className="inline-flex items-center gap-1.5 rounded border border-border px-2 py-0.5">
              <b>{r.symbol}</b>
              <span className="num">{price(r.price)}</span>
              <span className={`num ${toneClass(r.change24h)}`}>{pct(r.change24h)}</span>
            </span>
          ))}
        </div>
      ) : null}
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
        <Panel title={<Chips items={TABS} value={tab} onChange={setTab} testId="hub-tabs" />} tools={<span className="micro" data-testid="hub-count">{tab === "Categories" ? `${categories(rows).length} categories` : tab === "Stock" || tab === "Token Unlock" ? "" : `${tableRows.length} assets`}</span>} testId="hub-main">
          {tab === "Stock" || tab === "Token Unlock" ? (
            <ComingSoon title="Cryptocurrency Data Analysis" why={tab === "Stock" ? "Equity and stock-index data needs a market-data provider outside crypto." : "Token unlock schedules are a paid dataset (DefiLlama Pro)."} />
          ) : tab === "Categories" ? (
            <DataTable id="categories" rows={categories(rows)} cols={catCols} rowKey={(r) => r.key} sortKey="marketCap" csv="categories" />
          ) : markets.data ? (
            <DataTable id={`hub-${tab.toLowerCase()}`} rows={tableRows} cols={tab === "Spot" ? spotCols : derivCols} rowKey={(r) => r.symbol} sortKey="marketCap" search searchText={(r) => `${r.symbol} ${r.name}`} searchPlaceholder="Search coin…" columns csv={`markets-hub-${tab.toLowerCase()}`} star={(r) => r.symbol} rowHref={(r) => `/analytics/coin/${r.symbol}`} maxH={640} />
          ) : (
            <ComingSoon title="Spot markets need CoinGecko" why="Set COINGECKO_API_KEY (free Demo plan) on the ingest service to fill this table with prices, caps and volumes." gap={56} />
          )}
          <SourceLine snapshot={markets.data} />
        </Panel>
        <div className="space-y-4">
          <Panel title="Gainers & Losers" sub="24h" tools={<Chips items={["gainers", "losers"] as const} value={gl} onChange={setGl} labels={{ gainers: "Top Gainers", losers: "Top Losers" }} testId="gl-tabs" />} testId="hub-gl">
            {glRows.length ? (
              <div className="divide-y divide-border text-xs" data-testid="gl-list">
                {glRows.map((r) => (
                  <div key={r.symbol} className="grid grid-cols-[1fr_84px_76px] items-center gap-2 py-1.5">
                    <Coin symbol={r.symbol} />
                    <span className="num text-right">{price(r.price)}</span>
                    <span className={`num text-right ${toneClass(r.change24h)}`}>{pct(r.change24h)}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-xs text-muted-foreground">Needs the markets dataset (CoinGecko).</div>
            )}
          </Panel>
          <Panel title="Heatmap (24h)" sub="market cap · 24h change" testId="hub-heat">
            {o?.markets?.heatmap.length ? <Treemap items={o.markets.heatmap} h={260} /> : <div className="text-xs text-muted-foreground">Needs the markets dataset (CoinGecko).</div>}
          </Panel>
          <Panel title="Total Bitcoin Spot ETF Net Inflow" sub="daily · USD" tools={<ViewAll href="/analytics/etf">View all →</ViewAll>} testId="hub-etf">
            <ComingSoon title="ETF flows" why="Daily spot-ETF flows come from a paid or terms-restricted source; this panel fills in once a provider is chosen." />
          </Panel>
        </div>
      </div>
    </div>
  );
}
