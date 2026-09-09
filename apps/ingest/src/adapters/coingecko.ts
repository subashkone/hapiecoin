/**
 * CoinGecko (Demo plan: free key, 10,000 calls/month; verified 09 Sep 2026). Two calls per refresh:
 *   GET /coins/markets?vs_currency=usd&order=market_cap_desc&per_page=&page=1&sparkline=true&price_change_percentage=1h,24h,7d
 *   GET /global
 * The key travels in the `x-cg-demo-api-key` header. Attribution ("Data by CoinGecko") is shown by the UI.
 */
import type { MarketRow, MarketsData } from "@hapiecoin/schema";
import { z } from "zod";
import type { JsonClient } from "../http.js";

const nnum = z.number().nullable();
const Coin = z.looseObject({
  symbol: z.string(),
  name: z.string(),
  current_price: nnum,
  market_cap: nnum,
  market_cap_rank: nnum,
  total_volume: nnum,
  price_change_percentage_1h_in_currency: nnum.optional(),
  price_change_percentage_24h_in_currency: nnum.optional(),
  price_change_percentage_7d_in_currency: nnum.optional(),
  sparkline_in_7d: z.looseObject({ price: z.array(z.number().nullable()) }).nullable().optional(),
});
const Global = z.looseObject({ data: z.looseObject({ total_market_cap: z.record(z.string(), z.number()).optional(), total_volume: z.record(z.string(), z.number()).optional(), market_cap_percentage: z.record(z.string(), z.number()).optional() }) });

export const SYMBOL_RE = /^[A-Z0-9]{2,12}$/;
/** Thin the 7-day hourly sparkline to at most `n` points so a row stays small. */
export function thin(values: readonly (number | null)[], n = 40): number[] {
  const clean = values.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  if (clean.length <= n) return clean;
  const step = (clean.length - 1) / (n - 1);
  return Array.from({ length: n }, (_, i) => clean[Math.round(i * step)]!);
}

export class CoinGeckoAdapter {
  constructor(
    private readonly http: JsonClient,
    private readonly baseUrl: string,
    private readonly apiKey: string,
  ) {}

  private headers(): Record<string, string> {
    return { "x-cg-demo-api-key": this.apiKey };
  }

  async markets(perPage = 100): Promise<MarketsData> {
    const [coins, global] = await Promise.all([
      this.http.get(`${this.baseUrl}/coins/markets`, z.array(Coin), { vs_currency: "usd", order: "market_cap_desc", per_page: perPage, page: 1, sparkline: "true", price_change_percentage: "1h,24h,7d" }, this.headers()),
      this.http.get(`${this.baseUrl}/global`, Global, {}, this.headers()),
    ]);
    const rows: MarketRow[] = [];
    let rank = 0;
    for (const c of coins) {
      const symbol = c.symbol.toUpperCase();
      if (!SYMBOL_RE.test(symbol) || c.current_price === null) continue;
      rank += 1;
      rows.push({
        rank: c.market_cap_rank ?? rank,
        symbol,
        name: c.name,
        price: c.current_price,
        change1h: c.price_change_percentage_1h_in_currency ?? null,
        change24h: c.price_change_percentage_24h_in_currency ?? null,
        change7d: c.price_change_percentage_7d_in_currency ?? null,
        marketCap: c.market_cap,
        volume24h: c.total_volume,
        sparkline7d: thin(c.sparkline_in_7d?.price ?? []),
      });
    }
    const g = global.data;
    return {
      rows,
      global: { totalMarketCap: g.total_market_cap?.["usd"] ?? null, volume24h: g.total_volume?.["usd"] ?? null, btcDominance: g.market_cap_percentage?.["btc"] ?? null, ethDominance: g.market_cap_percentage?.["eth"] ?? null },
    };
  }
}
