/**
 * Binance USDⓈ-M futures public endpoints (developers.binance.com, verified 09 Sep 2026; see
 * docs/research/market-analytics-data-sources.md §2A). No key. Numbers arrive as strings and are coerced here.
 *   GET /fapi/v1/premiumIndex?symbol=            mark, index, lastFundingRate, nextFundingTime
 *   GET /fapi/v1/fundingRate?symbol=&limit=      funding history (8 h settlements)
 *   GET /fapi/v1/openInterest?symbol=            current OI in base units
 *   GET /futures/data/openInterestHist           OI history (sumOpenInterestValue in USD), last 30 days only
 *   GET /futures/data/globalLongShortAccountRatio | topLongShortAccountRatio | topLongShortPositionRatio
 *   GET /futures/data/takerlongshortRatio        taker buy/sell volume
 * The liquidation stream (`!forceOrder@arr`) is handled in liquidations.ts.
 */
import type { SeriesPoint } from "@hapiecoin/schema";
import { z } from "zod";
import type { JsonClient } from "../http.js";

const num = z.coerce.number();
export const perpSymbol = (symbol: string): string => `${symbol.toUpperCase()}USDT`;

const PremiumIndex = z.looseObject({ symbol: z.string(), markPrice: num, lastFundingRate: num, nextFundingTime: num });
const FundingRow = z.looseObject({ fundingTime: num, fundingRate: num });
const OpenInterest = z.looseObject({ openInterest: num, time: num.optional() });
const OiHistRow = z.looseObject({ sumOpenInterest: num, sumOpenInterestValue: num, timestamp: num });
const RatioRow = z.looseObject({ longShortRatio: num, longAccount: num.optional(), shortAccount: num.optional(), longPosition: num.optional(), shortPosition: num.optional(), timestamp: num });
const TakerRow = z.looseObject({ buySellRatio: num, buyVol: num, sellVol: num, timestamp: num });

export type StatPeriod = "5m" | "15m" | "30m" | "1h" | "2h" | "4h" | "6h" | "12h" | "1d";

export interface BinanceFunding {
  markPrice: number;
  rate: number;
  nextFundingAt: number;
  history: SeriesPoint[];
}
export interface BinanceOi {
  oiBase: number;
  oiUsd: number;
  history: SeriesPoint[];
}
export interface RatioPoint {
  t: number;
  ratio: number;
  long: number;
  short: number;
}

export class BinanceAdapter {
  constructor(
    private readonly http: JsonClient,
    private readonly baseUrl: string,
  ) {}

  async funding(symbol: string, limit = 90): Promise<BinanceFunding> {
    const s = perpSymbol(symbol);
    const [idx, hist] = await Promise.all([this.http.get(`${this.baseUrl}/fapi/v1/premiumIndex`, PremiumIndex, { symbol: s }), this.http.get(`${this.baseUrl}/fapi/v1/fundingRate`, z.array(FundingRow), { symbol: s, limit })]);
    return { markPrice: idx.markPrice, rate: idx.lastFundingRate, nextFundingAt: idx.nextFundingTime, history: hist.map((r) => ({ t: r.fundingTime, v: r.fundingRate })).sort((a, b) => a.t - b.t) };
  }

  async openInterest(symbol: string, period: StatPeriod = "5m", limit = 288): Promise<BinanceOi> {
    const s = perpSymbol(symbol);
    const [live, hist, idx] = await Promise.all([
      this.http.get(`${this.baseUrl}/fapi/v1/openInterest`, OpenInterest, { symbol: s }),
      this.http.get(`${this.baseUrl}/futures/data/openInterestHist`, z.array(OiHistRow), { symbol: s, period, limit }),
      this.http.get(`${this.baseUrl}/fapi/v1/premiumIndex`, PremiumIndex, { symbol: s }),
    ]);
    return { oiBase: live.openInterest, oiUsd: live.openInterest * idx.markPrice, history: hist.map((r) => ({ t: r.timestamp, v: r.sumOpenInterestValue })).sort((a, b) => a.t - b.t) };
  }

  private async ratio(path: string, symbol: string, period: StatPeriod, limit: number): Promise<RatioPoint[]> {
    const rows = await this.http.get(`${this.baseUrl}/futures/data/${path}`, z.array(RatioRow), { symbol: perpSymbol(symbol), period, limit });
    return rows.map((r) => ({ t: r.timestamp, ratio: r.longShortRatio, long: r.longAccount ?? r.longPosition ?? 0, short: r.shortAccount ?? r.shortPosition ?? 0 })).sort((a, b) => a.t - b.t);
  }
  globalLongShort(symbol: string, period: StatPeriod = "1h", limit = 168): Promise<RatioPoint[]> {
    return this.ratio("globalLongShortAccountRatio", symbol, period, limit);
  }
  topAccountsLongShort(symbol: string, period: StatPeriod = "1h", limit = 168): Promise<RatioPoint[]> {
    return this.ratio("topLongShortAccountRatio", symbol, period, limit);
  }
  topPositionsLongShort(symbol: string, period: StatPeriod = "1h", limit = 168): Promise<RatioPoint[]> {
    return this.ratio("topLongShortPositionRatio", symbol, period, limit);
  }

  async takerVolume(symbol: string, period: StatPeriod = "1h", limit = 168): Promise<{ t: number; buy: number; sell: number }[]> {
    const rows = await this.http.get(`${this.baseUrl}/futures/data/takerlongshortRatio`, z.array(TakerRow), { symbol: perpSymbol(symbol), period, limit });
    return rows.map((r) => ({ t: r.timestamp, buy: r.buyVol, sell: r.sellVol })).sort((a, b) => a.t - b.t);
  }
}
