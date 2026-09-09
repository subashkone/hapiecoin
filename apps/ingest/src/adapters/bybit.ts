/**
 * Bybit v5 public market endpoints (bybit-exchange.github.io/docs/v5, verified 09 Sep 2026), category=linear.
 *   GET /v5/market/tickers?category=linear&symbol=      lastPrice, fundingRate, nextFundingTime, openInterest, openInterestValue
 *   GET /v5/market/funding/history?category=linear&symbol=&limit=
 *   GET /v5/market/open-interest?category=linear&symbol=&intervalTime=5min&limit=   (openInterest in base units)
 *   GET /v5/market/account-ratio?category=linear&symbol=&period=1h&limit=           buyRatio / sellRatio
 *   GET /v5/market/kline?category=&symbol=&interval=&limit=  [startTime, open, high, low, close, volume, turnover] newest first (limit ≤ 1000)
 * Responses wrap data in { retCode, retMsg, result: { list } }; retCode 0 = ok.
 */
import type { SeriesPoint } from "@hapiecoin/schema";
import { z } from "zod";
import type { JsonClient } from "../http.js";
import { perpSymbol } from "./binance.js";
import type { RatioPoint } from "./binance.js";

const num = z.coerce.number();
const envelope = <T extends z.ZodType>(list: T) => z.looseObject({ retCode: num, retMsg: z.string().optional(), result: z.looseObject({ list: z.array(list) }) });
const Ticker = z.looseObject({ symbol: z.string(), lastPrice: num, fundingRate: num, nextFundingTime: num, openInterest: num, openInterestValue: num });
const FundingRow = z.looseObject({ fundingRate: num, fundingRateTimestamp: num });
const OiRow = z.looseObject({ openInterest: num, timestamp: num });
const RatioRow = z.looseObject({ buyRatio: num, sellRatio: num, timestamp: num });
const KlineRow = z.tuple([num, num, num, num, num]).rest(z.unknown());
export type BybitInterval = "1" | "3" | "5" | "15" | "30" | "60" | "120" | "240" | "360" | "720" | "D" | "W" | "M";

export class BybitError extends Error {
  constructor(
    readonly code: number,
    message: string,
  ) {
    super(message);
    this.name = "BybitError";
  }
}

export interface BybitTicker {
  lastPrice: number;
  rate: number;
  nextFundingAt: number;
  oiBase: number;
  oiUsd: number;
}

export class BybitAdapter {
  constructor(
    private readonly http: JsonClient,
    private readonly baseUrl: string,
  ) {}

  private async list<T extends z.ZodType>(path: string, row: T, query: Record<string, string | number>): Promise<z.infer<T>[]> {
    const res = await this.http.get(`${this.baseUrl}${path}`, envelope(row), query);
    if (res.retCode !== 0) throw new BybitError(res.retCode, res.retMsg ?? `Bybit retCode ${res.retCode}`);
    return res.result.list;
  }

  async ticker(symbol: string): Promise<BybitTicker> {
    const [t] = await this.list("/v5/market/tickers", Ticker, { category: "linear", symbol: perpSymbol(symbol) });
    if (!t) throw new BybitError(-1, `Bybit: no ticker for ${perpSymbol(symbol)}`);
    return { lastPrice: t.lastPrice, rate: t.fundingRate, nextFundingAt: t.nextFundingTime, oiBase: t.openInterest, oiUsd: t.openInterestValue };
  }

  async fundingHistory(symbol: string, limit = 90): Promise<SeriesPoint[]> {
    const rows = await this.list("/v5/market/funding/history", FundingRow, { category: "linear", symbol: perpSymbol(symbol), limit });
    return rows.map((r) => ({ t: r.fundingRateTimestamp, v: r.fundingRate })).sort((a, b) => a.t - b.t);
  }

  /** OI history in base units; the caller converts to USD with the last price. */
  async openInterestHistory(symbol: string, intervalTime: "5min" | "15min" | "30min" | "1h" | "4h" | "1d" = "5min", limit = 200): Promise<SeriesPoint[]> {
    const rows = await this.list("/v5/market/open-interest", OiRow, { category: "linear", symbol: perpSymbol(symbol), intervalTime, limit });
    return rows.map((r) => ({ t: r.timestamp, v: r.openInterest })).sort((a, b) => a.t - b.t);
  }

  /** Closes oldest first. */
  async klines(symbol: string, interval: BybitInterval, limit = 200, category: "spot" | "linear" = "linear"): Promise<{ t: number; close: number }[]> {
    const rows = await this.list("/v5/market/kline", KlineRow, { category, symbol: perpSymbol(symbol), interval, limit });
    return rows.map((r) => ({ t: r[0], close: r[4] })).sort((a, b) => a.t - b.t);
  }

  async accountRatio(symbol: string, period: "5min" | "15min" | "30min" | "1h" | "4h" | "1d" = "1h", limit = 168): Promise<RatioPoint[]> {
    const rows = await this.list("/v5/market/account-ratio", RatioRow, { category: "linear", symbol: perpSymbol(symbol), period, limit });
    return rows.map((r) => ({ t: r.timestamp, long: r.buyRatio, short: r.sellRatio, ratio: r.sellRatio > 0 ? r.buyRatio / r.sellRatio : 0 })).sort((a, b) => a.t - b.t);
  }
}
