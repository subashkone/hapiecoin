"use client";
// Futures Markets Screener (HC-MA-038..040, 110..112): every tracked coin with its market and derivatives columns,
// category chips driven by ?category=, the watchlist-only chip, hidden columns behind Columns ▾, and compare mode
// (tick up to three coins → side-by-side panel, also reachable as ?compare=BTC,ETH).
import { useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { useMarkets, useOverview } from "@/lib/api/analytics";
import { pct, price, toneClass, usdCompact } from "@/lib/analytics/format";
import { useUiStore } from "@/lib/store";
import { Chips } from "./Chips";
import { type Column, DataTable } from "./DataTable";
import { type HubRow, mergeRows, sectorOf } from "./HubPage";
import { Coin, ComingSoon, Heat, Panel, SourceLine, ViewAll } from "./bits";

export const CATEGORIES = ["all", "layer-1", "layer-2", "defi", "memes"] as const;
export type Category = (typeof CATEGORIES)[number];
const CATEGORY_LABELS: Record<Category, string> = { all: "All", "layer-1": "Layer 1", "layer-2": "Layer 2", defi: "DeFi", memes: "Memes" };
export const MAX_COMPARE = 3;

const lsCell = (v: number | null | undefined) => (v === null || v === undefined ? <span className="text-muted-foreground">—</span> : <span className={v >= 1 ? "text-profit" : "text-loss"}>{v.toFixed(2)}</span>);
export const screenerCols: Column<HubRow>[] = [
  { key: "rank", label: "Coin", sortVal: (r) => -r.rank, render: (r) => <Coin symbol={r.symbol} name={r.name} rank={r.rank} /> },
  { key: "price", label: "Price", align: "r", render: (r) => price(r.price) },
  { key: "change24h", label: "24h %", align: "r", render: (r) => <Heat v={r.change24h} /> },
  { key: "change7d", label: "7d %", align: "r", hidden: true, render: (r) => <Heat v={r.change7d} max={15} /> },
  { key: "marketCap", label: "Market Cap", align: "r", render: (r) => usdCompact(r.marketCap) },
  { key: "volume24h", label: "24h Volume", align: "r", render: (r) => usdCompact(r.volume24h) },
  { key: "oiUsd", label: "Open Interest", align: "r", sortVal: (r) => r.oiUsd ?? null, render: (r) => usdCompact(r.oiUsd) },
  { key: "oiChange24h", label: "OI 24h %", align: "r", sortVal: (r) => r.oiChange24h ?? null, render: (r) => <Heat v={r.oiChange24h} fraction /> },
  { key: "funding", label: "Funding", align: "r", hidden: true, sortVal: (r) => r.funding ?? null, render: (r) => <span className={toneClass(r.funding)}>{pct(r.funding, 4, true)}</span> },
  { key: "lsRatio", label: "L/S Ratio", align: "r", sortVal: (r) => r.lsRatio ?? null, render: (r) => lsCell(r.lsRatio) },
  { key: "liq24hUsd", label: "Liq 24h", align: "r", hidden: true, sortVal: (r) => r.liq24hUsd ?? null, render: (r) => usdCompact(r.liq24hUsd) },
];

/** Parse "?compare=btc,eth" into upper-case symbols, capped at MAX_COMPARE. */
export function parseCompare(raw: string | null): string[] {
  const out: string[] = [];
  for (const s of (raw ?? "").split(",")) {
    const sym = s.trim().toUpperCase();
    if (sym && !out.includes(sym)) out.push(sym);
  }
  return out.slice(0, MAX_COMPARE);
}

const METRICS: { label: string; cell: (r: HubRow) => React.ReactNode }[] = [
  { label: "Price", cell: (r) => price(r.price) },
  { label: "24h %", cell: (r) => <Heat v={r.change24h} /> },
  { label: "7d %", cell: (r) => <Heat v={r.change7d} max={15} /> },
  { label: "Market cap", cell: (r) => usdCompact(r.marketCap) },
  { label: "24h volume", cell: (r) => usdCompact(r.volume24h) },
  { label: "Open interest", cell: (r) => usdCompact(r.oiUsd) },
  { label: "OI 24h %", cell: (r) => <Heat v={r.oiChange24h} fraction /> },
  { label: "Funding (8h)", cell: (r) => <span className={toneClass(r.funding)}>{pct(r.funding, 4, true)}</span> },
  { label: "L/S ratio", cell: (r) => lsCell(r.lsRatio) },
  { label: "Liquidations 24h", cell: (r) => usdCompact(r.liq24hUsd) },
];

export function ComparePanel({ rows, missing, onRemove, onClear }: { rows: HubRow[]; missing: string[]; onRemove: (s: string) => void; onClear: () => void }) {
  return (
    <Panel title="Compare" sub={`${rows.length} of ${MAX_COMPARE} coins · tick Cmp in the table to add`} tools={<button type="button" onClick={onClear} className="text-2xs text-muted-foreground hover:text-foreground" data-testid="compare-clear">Clear</button>} testId="compare-panel">
      <div className="overflow-x-auto" data-testid="compare-grid" data-count={rows.length}>
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left">
              <th className="micro py-1 pr-2 font-normal">Metric</th>
              {rows.map((r) => (
                <th key={r.symbol} className="py-1 pr-2 font-normal">
                  <span className="inline-flex items-center gap-2">
                    <Coin symbol={r.symbol} name={r.name} />
                    <button type="button" onClick={() => onRemove(r.symbol)} aria-label={`Remove ${r.symbol} from compare`} className="text-muted-foreground hover:text-foreground" data-testid="compare-remove">×</button>
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {METRICS.map((m) => (
              <tr key={m.label} className="border-t border-border">
                <td className="micro py-1 pr-2">{m.label}</td>
                {rows.map((r) => (
                  <td key={r.symbol} className="num py-1 pr-2">{m.cell(r)}</td>
                ))}
              </tr>
            ))}
            <tr className="border-t border-border">
              <td className="micro py-1 pr-2">Full analytics</td>
              {rows.map((r) => (
                <td key={r.symbol} className="py-1 pr-2"><ViewAll href={`/analytics/coin/${r.symbol}`}>{r.symbol} →</ViewAll></td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
      {missing.length ? <p className="mt-2 text-2xs text-muted-foreground" data-testid="compare-missing">Not tracked: {missing.join(", ")}</p> : null}
    </Panel>
  );
}

export function MarketsPage() {
  const router = useRouter();
  const params = useSearchParams();
  const rawCat = params.get("category");
  const cat: Category = (CATEGORIES as readonly string[]).includes(rawCat ?? "") ? (rawCat as Category) : "all";
  const [watchOnly, setWatchOnly] = useState(false);
  const [compare, setCompare] = useState<string[]>(() => parseCompare(params.get("compare")));
  const markets = useMarkets();
  const overview = useOverview();
  const watch = useUiStore((s) => s.watchlist);
  const all = useMemo(() => mergeRows(markets.data?.data.rows ?? [], overview.data?.data.symbols ?? []), [markets.data, overview.data]);
  let rows = all;
  if (cat !== "all") rows = rows.filter((r) => sectorOf(r.symbol) === cat);
  if (watchOnly) rows = rows.filter((r) => watch.includes(r.symbol));
  const unavailable = markets.isError && !markets.data;
  const toggleCompare = (sym: string) => setCompare((list) => (list.includes(sym) ? list.filter((x) => x !== sym) : list.length >= MAX_COMPARE ? list : [...list, sym]));
  const cmpRows = compare.map((s) => all.find((r) => r.symbol === s)).filter((r): r is HubRow => r !== undefined);
  const missing = all.length ? compare.filter((s) => !all.some((r) => r.symbol === s)) : [];
  return (
    <div className="space-y-4" data-testid="markets-page" data-state={markets.isPending ? "loading" : unavailable ? "unavailable" : "ready"} data-category={cat}>
      <h2 className="sr-only">Futures Markets Screener</h2>
      {compare.length ? <ComparePanel rows={cmpRows} missing={missing} onRemove={toggleCompare} onClear={() => setCompare([])} /> : null}
      <Panel
        title="Futures Markets Screener"
        sub="perpetual futures · aggregated · tick Cmp to compare up to 3 coins · ★ to pin on the hub"
        tools={
          <>
            <Chips items={CATEGORIES} labels={CATEGORY_LABELS} value={cat} onChange={(c) => router.push(c === "all" ? "/analytics/markets" : `/analytics/markets?category=${c}`)} testId="category-chips" />
            <button type="button" onClick={() => setWatchOnly((w) => !w)} aria-pressed={watchOnly} className={`rounded border border-border px-2 py-0.5 font-mono text-2xs ${watchOnly ? "bg-muted text-accent" : "text-muted-foreground hover:text-foreground"}`} title="Show only starred coins" data-testid="watch-only">
              ★ Watchlist
            </button>
          </>
        }
        testId="screener"
      >
        {unavailable ? (
          <ComingSoon title="Needs CoinGecko" why="The markets dataset has not been written yet: set COINGECKO_API_KEY on the ingest service and wait for its first run." gap={56} />
        ) : (
          <DataTable
            id="screener"
            rows={rows}
            cols={screenerCols}
            rowKey={(r) => r.symbol}
            sortKey="marketCap"
            search
            searchText={(r) => `${r.symbol} ${r.name}`}
            searchPlaceholder="Search coin…"
            columns
            csv="futures-markets"
            star={(r) => r.symbol}
            select={{ get: (r) => r.symbol, selected: compare, onToggle: toggleCompare, max: MAX_COMPARE }}
            rowHref={(r) => `/analytics/coin/${r.symbol}`}
            maxH={720}
            empty={watchOnly ? "Your watchlist is empty — star coins to pin them here" : "No coins in this category"}
            foot={<div className="micro mt-2" data-testid="screener-foot">{rows.length} markets · click a row for full coin analytics · hidden columns: 7d %, Funding, Liq 24h (Columns ▾)</div>}
          />
        )}
        <SourceLine snapshot={markets.data} />
      </Panel>
    </div>
  );
}
