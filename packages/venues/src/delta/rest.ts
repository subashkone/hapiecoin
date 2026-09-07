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

export type FetchLike = (input: string, init: { signal: AbortSignal; headers: Record<string, string> }) => Promise<{
  status: number;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
}>;

export interface DeltaRestClientOptions {
  /** e.g. "https://api.india.delta.exchange" (no trailing slash needed). */
  baseUrl: string;
  /** Injectable fetch (tests pass a fake; defaults to globalThis.fetch). */
  fetch?: FetchLike;
  /** Injectable sleep for backoff (tests pass a recorder). */
  sleep?: (ms: number) => Promise<void>;
  /** Total attempts per request including the first (default 3). */
  maxAttempts?: number;
  /** First backoff delay; doubles per retry (default 250 ms). */
  backoffBaseMs?: number;
  /** Per-attempt timeout (default 5000 ms). */
  timeoutMs?: number;
  /** Clock used for `Quote.receivedAt` (default Date.now). */
  now?: () => number;
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

const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_BACKOFF_BASE_MS = 250;
const DEFAULT_TIMEOUT_MS = 5000;
const SNIPPET_LENGTH = 200;

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function snippet(text: string): string {
  return text.length > SNIPPET_LENGTH ? `${text.slice(0, SNIPPET_LENGTH)}…` : text;
}

function retryAfterMs(header: string | null): number | null {
  if (header === null) return null;
  const seconds = Number(header);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : null;
}

export class DeltaRestClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: FetchLike;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly maxAttempts: number;
  private readonly backoffBaseMs: number;
  private readonly timeoutMs: number;
  private readonly now: () => number;

  constructor(options: DeltaRestClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    const fetchImpl: FetchLike | undefined = options.fetch ?? globalThis.fetch;
    if (!fetchImpl) throw new Error("DeltaRestClient: no fetch implementation available; pass options.fetch");
    this.fetchImpl = fetchImpl;
    this.sleep = options.sleep ?? defaultSleep;
    this.maxAttempts = Math.max(1, options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS);
    this.backoffBaseMs = options.backoffBaseMs ?? DEFAULT_BACKOFF_BASE_MS;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
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

  private buildUrl(path: string, query: Record<string, string>): string {
    const url = new URL(this.baseUrl + path);
    for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
    return url.toString();
  }

  private async request<S extends z.ZodType>(
    path: string,
    query: Record<string, string>,
    schema: S,
  ): Promise<z.infer<S>> {
    const url = this.buildUrl(path, query);
    let attempt = 0;
    for (;;) {
      attempt += 1;
      const outcome = await this.attemptOnce(url);
      if (outcome.kind === "response" && !(outcome.status === 429 || outcome.status >= 500)) {
        if (outcome.status < 200 || outcome.status >= 300) {
          throw new DeltaHttpError({
            status: outcome.status,
            url,
            bodySnippet: snippet(outcome.text),
            retryable: false,
            attempts: attempt,
          });
        }
        return this.decode(url, outcome.text, schema);
      }
      if (attempt >= this.maxAttempts) {
        throw new DeltaHttpError({
          status: outcome.kind === "response" ? outcome.status : 0,
          url,
          bodySnippet: snippet(outcome.kind === "response" ? outcome.text : outcome.message),
          retryable: true,
          attempts: attempt,
        });
      }
      const hinted = outcome.kind === "response" ? outcome.retryAfterMs : null;
      await this.sleep(hinted ?? this.backoffBaseMs * 2 ** (attempt - 1));
    }
  }

  private async attemptOnce(
    url: string,
  ): Promise<
    | { kind: "response"; status: number; text: string; retryAfterMs: number | null }
    | { kind: "transport"; message: string }
  > {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(url, {
        signal: controller.signal,
        headers: { Accept: "application/json" },
      });
      const text = await response.text();
      return {
        kind: "response",
        status: response.status,
        text,
        retryAfterMs: retryAfterMs(response.headers.get("retry-after")),
      };
    } catch (error) {
      return { kind: "transport", message: error instanceof Error ? error.message : String(error) };
    } finally {
      clearTimeout(timer);
    }
  }

  private decode<S extends z.ZodType>(url: string, text: string, schema: S): z.infer<S> {
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      throw new DeltaSchemaError(url, [`body is not JSON: ${snippet(text)}`]);
    }
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
