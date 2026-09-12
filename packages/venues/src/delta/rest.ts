/**
 * Delta Exchange India public REST client (market data only; no order endpoints live here).
 *
 * Endpoints (docs.delta.exchange, verified 07 Sep 2026):
 *   GET /v2/products?contract_types=&states=&page_size=&after=
 *   GET /v2/tickers?contract_types=call_options,put_options&underlying_asset_symbols=BTC
 *   GET /v2/tickers/{symbol}
 *   GET /v2/history/candles?symbol=&resolution=1m|3m|5m|15m|30m|1h|2h|4h|6h|1d|1w&start=&end=  (unix seconds, max 2000 candles)
 *
 * Every response is validated with Zod (delta/raw.ts). 429 and 5xx are retried with exponential
 * backoff (injectable sleep); transport failures too. Default timeout 5 s (trading-safety rule 4).
 */
import { numberToDecimal, canonDecimal } from "../decimal.js";
import { DeltaApiError, DeltaHttpError, DeltaSchemaError } from "../errors.js";
import { type FetchLike, JsonHttp } from "../http.js";
import type { Candle, Instrument, Quote } from "../types.js";
import { toInstrument, toQuote } from "./normalize.js";
import {
  RawCandlesResponse,
  RawErrorResponse,
  RawProductsResponse,
  RawTickerResponse,
  RawTickersResponse,
  formatIssues,
} from "./raw.js";
import type { z } from "zod";

export type { FetchLike };

export interface DeltaRestClientOptions {
  /** e.g. "https://api.india.delta.exchange" (no trailing slash needed). */
  baseUrl: string;
  /** Injectable fetch (tests pass a fake; defaults to globalThis.fetch). */
  fetch?: FetchLike | undefined;
  /** Injectable sleep for backoff (tests pass a recorder). */
  sleep?: ((ms: number) => Promise<void>) | undefined;
  /** Total attempts per request including the first (default 3). */
  maxAttempts?: number | undefined;
  /** First backoff delay; doubles per retry (default 250 ms). */
  backoffBaseMs?: number | undefined;
  /** Per-attempt timeout (default 5000 ms). */
  timeoutMs?: number | undefined;
  /** Clock used for `Quote.receivedAt` (default Date.now). */
  now?: (() => number) | undefined;
}

export type DeltaContractType =
  | "call_options"
  | "put_options"
  | "futures"
  | "perpetual_futures"
  | (string & Record<never, never>);

export interface GetProductsParams {
  contractTypes?: readonly DeltaContractType[];
  states?: readonly string[];
  /** Page size requested from the venue (default 2000, which returned all 972 products in one page). */
  pageSize?: number;
}

export interface GetTickersParams {
  contractTypes?: readonly DeltaContractType[];
  /** One underlying or several ("BTC" | ["BTC", "ETH"]). */
  underlying?: string | readonly string[];
}

export type CandleResolution = "1m" | "3m" | "5m" | "15m" | "30m" | "1h" | "2h" | "4h" | "6h" | "1d" | "1w";

export interface GetCandlesParams {
  symbol: string;
  resolution: CandleResolution;
  /** Unix seconds. */
  start: number;
  /** Unix seconds. */
  end: number;
}


export class DeltaRestClient {
  private readonly http: JsonHttp;
  private readonly now: () => number;

  constructor(options: DeltaRestClientOptions) {
    this.http = new JsonHttp({
      baseUrl: options.baseUrl,
      fetch: options.fetch,
      sleep: options.sleep,
      maxAttempts: options.maxAttempts,
      backoffBaseMs: options.backoffBaseMs,
      timeoutMs: options.timeoutMs,
      errors: { http: (opts) => new DeltaHttpError(opts), schema: (source, issues) => new DeltaSchemaError(source, issues) },
    });
    this.now = options.now ?? Date.now;
  }

  /** All products (follows the `after` cursor when the venue paginates), normalised to Instruments. */
  async getProducts(params: GetProductsParams = {}): Promise<Instrument[]> {
    const instruments: Instrument[] = [];
    let after: string | null = null;
    do {
      const query: Record<string, string> = { page_size: String(params.pageSize ?? 2000) };
      if (params.contractTypes?.length) query.contract_types = params.contractTypes.join(",");
      if (params.states?.length) query.states = params.states.join(",");
      if (after !== null) query.after = after;
      const page: z.infer<typeof RawProductsResponse> = await this.request("/v2/products", query, RawProductsResponse);
      for (const product of page.result) instruments.push(toInstrument(product));
      after = page.meta?.after ?? null;
    } while (after !== null);
    return instruments;
  }

  /** Tickers filtered by contract type and/or underlying, normalised to Quotes. */
  async getTickers(params: GetTickersParams = {}): Promise<Quote[]> {
    const query: Record<string, string> = {};
    if (params.contractTypes?.length) query.contract_types = params.contractTypes.join(",");
    if (params.underlying !== undefined) {
      const list = typeof params.underlying === "string" ? [params.underlying] : params.underlying;
      if (list.length) query.underlying_asset_symbols = list.join(",");
    }
    const body = await this.request("/v2/tickers", query, RawTickersResponse);
    const receivedAt = this.now();
    return body.result.map((ticker) => toQuote(ticker, receivedAt));
  }

  /** Single ticker by venue symbol. */
  async getTicker(symbol: string): Promise<Quote> {
    const body = await this.request(`/v2/tickers/${encodeURIComponent(symbol)}`, {}, RawTickerResponse);
    return toQuote(body.result, this.now());
  }

  /** Historical OHLC candles (venue caps a response at 2000 candles). Prices as decimal strings. */
  async getCandles(params: GetCandlesParams): Promise<Candle[]> {
    const body = await this.request(
      "/v2/history/candles",
      {
        symbol: params.symbol,
        resolution: params.resolution,
        start: String(Math.floor(params.start)),
        end: String(Math.floor(params.end)),
      },
      RawCandlesResponse,
    );
    return body.result.map((c) => ({
      time: c.time,
      open: toDecimal(c.open),
      high: toDecimal(c.high),
      low: toDecimal(c.low),
      close: toDecimal(c.close),
      volume: c.volume === null || c.volume === undefined ? "0" : toDecimal(c.volume),
    }));
  }

  private async request<S extends z.ZodType>(path: string, query: Record<string, string>, schema: S): Promise<z.infer<S>> {
    const { url, json } = await this.http.getJson(path, query);
    const failure = RawErrorResponse.safeParse(json);
    if (failure.success) {
      throw new DeltaApiError(url, failure.data.error?.code ?? "unknown", failure.data.error?.context ?? null);
    }
    const parsed = schema.safeParse(json);
    if (!parsed.success) throw new DeltaSchemaError(url, formatIssues(parsed.error));
    return parsed.data;
  }
}

function toDecimal(value: string | number): string {
  return typeof value === "number" ? numberToDecimal(value) : canonDecimal(value);
}
