import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SectionSoon } from "@/components/analytics/AnalyticsShell";

/** Sections that arrive in later PRs (5.3 / 5.4) keep a real page inside the shell (HC-SH-016). */
export const SOON: Record<string, { title: string; release: string; blurb: string }> = {
  markets: { title: "Futures Markets Screener", release: "the next analytics release (PR 5.3)", blurb: "Coin, price, market cap, volume, open interest, OI 24h % and long/short ratio with category chips, compare and watchlist filters." },
  derivatives: { title: "Derivatives", release: "the next analytics release (PR 5.3)", blurb: "Open interest by exchange, OI-weighted funding, global long/short, basis and the funding-rate arbitrage table." },
  liquidations: { title: "Liquidations", release: "the next analytics release (PR 5.3)", blurb: "Long and short liquidations over time, by exchange and by coin, with the live feed." },
  options: { title: "Options", release: "PR 5.4", blurb: "Call/put open interest per expiry with max pain, and open interest by exchange including Delta." },
  etf: { title: "ETF", release: "PR 5.4", blurb: "Spot ETF flows, AUM and per-fund holdings, once a flows provider is chosen (GAPS #55)." },
  whales: { title: "Whales", release: "PR 5.4", blurb: "Hyperliquid whale positions, large resting orders and exchange reserves." },
  sentiment: { title: "Sentiment", release: "PR 5.4", blurb: "Fear & Greed history, cycle indicators, Coinbase premium and the RSI screener." },
};

export async function generateMetadata({ params }: { params: Promise<{ section: string }> }): Promise<Metadata> {
  const { section } = await params;
  return { title: `${SOON[section]?.title ?? "Market Analytics"} · Market Analytics` };
}

export default async function Page({ params }: { params: Promise<{ section: string }> }) {
  const { section } = await params;
  const s = SOON[section];
  if (!s) notFound();
  return <SectionSoon title={s.title} release={s.release} blurb={s.blurb} />;
}
