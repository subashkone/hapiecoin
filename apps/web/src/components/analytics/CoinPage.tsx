"use client";
// Coin analytics (HC-MA-082..087, 120, 121): in this release a compact header and the derivatives tiles from the
// overview row; the per-coin charts, heatmap and per-exchange tables arrive with PR 5.3.
import Link from "next/link";
import { useMarkets, useOverview } from "@/lib/api/analytics";
import { pct, price, toneClass, usdCompact } from "@/lib/analytics/format";
import { useUiStore } from "@/lib/store";
import { Coin, Heat, SourceLine, Tile } from "./bits";

export function CoinPage({ symbol }: { symbol: string }) {
  const sym = symbol.toUpperCase();
  const overview = useOverview();
  const markets = useMarkets();
  const watch = useUiStore((s) => s.watchlist);
  const toggleWatch = useUiStore((s) => s.toggleWatch);
  const row = overview.data?.data.symbols.find((s) => s.symbol === sym);
  const m = markets.data?.data.rows.find((r) => r.symbol === sym);
  const known = !!row || !!m;
  return (
    <div className="space-y-4" data-testid="coin-page" data-symbol={sym} data-state={overview.isPending ? "loading" : known ? "ready" : "unknown"}>
      <div className="flex flex-wrap items-center gap-3">
        <Link href="/analytics/hub" className="text-2xs text-muted-foreground hover:text-foreground" data-testid="coin-back">← Back</Link>
        <h2 className="text-lg">
          <Coin symbol={sym} name={m?.name} rank={m?.rank} />
        </h2>
        {m ? (
          <>
            <span className="num text-lg">{price(m.price)}</span>
            <Heat v={m.change24h} />
          </>
        ) : null}
        <button type="button" onClick={() => toggleWatch(sym)} aria-pressed={watch.includes(sym)} className="rounded border border-border px-2 py-0.5 text-2xs" data-testid="coin-watch">
          {watch.includes(sym) ? "★ Watching" : "☆ Watch"}
        </button>
      </div>
      {!overview.isPending && !known ? (
        <div className="rounded border border-dashed border-border p-4 text-xs text-muted-foreground" data-testid="coin-unknown">No data for {sym}. The ingest tracks {overview.data?.data.symbols.length ?? 0} symbols; add it to ANALYTICS_SYMBOLS to follow it.</div>
      ) : null}
      <div className="grid grid-cols-2 gap-2 md:grid-cols-3 lg:grid-cols-6">
        <Tile label="Open Interest" value={usdCompact(row?.oiUsd)} sub={<>Δ24h <b className={toneClass(row?.oiChange24h)}>{pct(row?.oiChange24h, 2, true)}</b> · Δ1h <b className={toneClass(row?.oiChange1h)}>{pct(row?.oiChange1h, 2, true)}</b></>} testId="coin-oi" />
        <Tile label="24h Volume" value={usdCompact(m?.volume24h)} sub="spot" testId="coin-vol" />
        <Tile label="Funding (OI-weighted)" value={pct(row?.funding, 4, true)} sub="per 8h" tone={row?.funding ? (row.funding > 0 ? "profit" : "loss") : "muted"} testId="coin-funding" />
        <Tile label="Long/Short" value={row?.lsRatio?.toFixed(2) ?? "—"} sub="global accounts · Binance" testId="coin-ls" />
        <Tile label="Liquidations 24h" value={usdCompact(row?.liq24hUsd)} sub={`${row?.venues ?? 0} venues`} testId="coin-liq" />
        <Tile label="Market Cap" value={usdCompact(m?.marketCap)} sub={m ? `rank #${m.rank}` : "needs CoinGecko"} testId="coin-cap" />
      </div>
      <SourceLine snapshot={overview.data} />
      <div className="rounded border border-dashed border-border p-4 text-center text-xs text-muted-foreground" data-testid="coin-more">Price & OI, long/short, liquidation and funding charts, the liquidation heatmap and the per-exchange tables arrive with the next analytics release (PR 5.3).</div>
    </div>
  );
}
