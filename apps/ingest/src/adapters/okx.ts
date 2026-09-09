/**
 * OKX v5 public endpoints (www.okx.com/docs-v5, verified 09 Sep 2026). Instruments are `${symbol}-USDT-SWAP`.
 *   GET /api/v5/public/funding-rate?instId=                 fundingRate, nextFundingRate, nextFundingTime
 *   GET /api/v5/public/funding-rate-history?instId=&limit=
 *   GET /api/v5/public/open-interest?instType=SWAP&instId=  oi (contracts), oiCcy (base), oiUsd
 *   GET /api/v5/rubik/stat/contracts/open-interest-volume?ccy=&period=   [[ts, oiUsd, volUsd]]
 *   GET /api/v5/rubik/stat/contracts/long-short-account-ratio?ccy=&period=  [[ts, ratio]]
 *   GET /api/v5/public/liquidation-orders?instType=SWAP&state=filled&uly=  recent filled liquidations
 *   GET /api/v5/market/ticker?instId=                        last
 * Responses wrap data in { code: "0", msg, data }.
 */
import type { LiquidationEvent, SeriesPoint } from "@hapiecoin/schema";
import { z } from "zod";
import type { JsonClient } from "../http.js";
import type { RatioPoint } from "./binance.js";

const num = z.coerce.number();
const envelope = <T extends z.ZodType>(data: T) => z.looseObject({ code: z.string(), msg: z.string().optional(), data });
export const okxSwap = (symbol: string): string => `${symbol.toUpperCase()}-USDT-SWAP`;
export const okxUnderlying = (symbol: string): string => `${symbol.toUpperCase()}-USDT`;

const Funding = z.looseObject({ fundingRate: num, nextFundingRate: z.string().optional(), nextFundingTime: num });
const FundingHist = z.looseObject({ fundingRate: num, fundingTime: num });
const Oi = z.looseObject({ oiCcy: num, oiUsd: num, ts: num });
const Ticker = z.looseObject({ last: num });
const Pair = z.tuple([num, num]).rest(num);
const LiqDetail = z.looseObject({ side: z.string(), posSide: z.string().optional(), bkPx: num, sz: num, ts: num });
const LiqRow = z.looseObject({ instId: z.string(), details: z.array(LiqDetail) });

export class OkxError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "OkxError";
  }
}

export interface OkxFunding {
  rate: number;
  predicted: number | null;
  nextFundingAt: number;
  history: SeriesPoint[];
}
export interface OkxOi {
  oiBase: number;
  oiUsd: number;
  /** [ts, oiUsd] history from the rubik endpoint. */
  history: SeriesPoint[];
}

export class OkxAdapter {
  constructor(
    private readonly http: JsonClient,
    private readonly baseUrl: string,
  ) {}

  private async data<T extends z.ZodType>(path: string, schema: T, query: Record<string, string | number>): Promise<z.infer<T>> {
    const res = await this.http.get(`${this.baseUrl}${path}`, envelope(schema), query);
    if (res.code !== "0") throw new OkxError(res.code, res.msg ?? `OKX code ${res.code}`);
    return res.data as z.infer<T>;
  }

  async funding(symbol: string, limit = 90): Promise<OkxFunding> {
    const inst = okxSwap(symbol);
    const [cur, hist] = await Promise.all([this.data("/api/v5/public/funding-rate", z.array(Funding), { instId: inst }), this.data("/api/v5/public/funding-rate-history", z.array(FundingHist), { instId: inst, limit })]);
    const f = cur[0];
    if (!f) throw new OkxError("-1", `OKX: no funding for ${inst}`);
    const predicted = f.nextFundingRate !== undefined && f.nextFundingRate !== "" ? Number(f.nextFundingRate) : null;
    return { rate: f.fundingRate, predicted: Number.isFinite(predicted ?? NaN) ? predicted : null, nextFundingAt: f.nextFundingTime, history: hist.map((r) => ({ t: r.fundingTime, v: r.fundingRate })).sort((a, b) => a.t - b.t) };
  }

  async openInterest(symbol: string, period: "5m" | "1H" | "1D" = "5m"): Promise<OkxOi> {
    const [live, hist] = await Promise.all([this.data("/api/v5/public/open-interest", z.array(Oi), { instType: "SWAP", instId: okxSwap(symbol) }), this.data("/api/v5/rubik/stat/contracts/open-interest-volume", z.array(Pair), { ccy: symbol.toUpperCase(), period })]);
    const o = live[0];
    if (!o) throw new OkxError("-1", `OKX: no open interest for ${okxSwap(symbol)}`);
    return { oiBase: o.oiCcy, oiUsd: o.oiUsd, history: hist.map(([t, v]) => ({ t, v })).sort((a, b) => a.t - b.t) };
  }

  async longShortRatio(symbol: string, period: "5m" | "1H" | "1D" = "1H"): Promise<RatioPoint[]> {
    const rows = await this.data("/api/v5/rubik/stat/contracts/long-short-account-ratio", z.array(Pair), { ccy: symbol.toUpperCase(), period });
    return rows.map(([t, ratio]) => ({ t, ratio, long: ratio / (1 + ratio), short: 1 / (1 + ratio) })).sort((a, b) => a.t - b.t);
  }

  async lastPrice(symbol: string): Promise<number> {
    const rows = await this.data("/api/v5/market/ticker", z.array(Ticker), { instId: okxSwap(symbol) });
    const t = rows[0];
    if (!t) throw new OkxError("-1", `OKX: no ticker for ${okxSwap(symbol)}`);
    return t.last;
  }

  /** Recent filled liquidations for one underlying; OKX reports the position side on the closed side. */
  async liquidations(symbol: string): Promise<LiquidationEvent[]> {
    const rows = await this.data("/api/v5/public/liquidation-orders", z.array(LiqRow), { instType: "SWAP", state: "filled", uly: okxUnderlying(symbol) });
    const out: LiquidationEvent[] = [];
    for (const r of rows) {
      for (const d of r.details) {
        const side = (d.posSide ?? (d.side === "sell" ? "long" : "short")) === "long" ? "long" : "short";
        out.push({ t: d.ts, venue: "okx", symbol: symbol.toUpperCase(), side, price: d.bkPx, qty: d.sz, usd: d.bkPx * d.sz });
      }
    }
    return out.sort((a, b) => b.t - a.t);
  }
}
