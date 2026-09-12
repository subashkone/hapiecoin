/**
 * Deribit v2 public REST (base https://www.deribit.com/api/v2, verified 11 Sep 2026 against the live API and
 * docs.deribit.com api-reference):
 *   GET /public/get_instruments?currency=BTC&kind=option&expired=false   (1 request/s sustained, 50 burst)
 *   GET /public/get_book_summary_by_currency?currency=BTC&kind=option    (the REST seed: marks, IV, OI, no greeks)
 *   GET /public/ticker?instrument_name=BTC-25SEP26-80000-C
 *   GET /public/get_index_price?index_name=btc_usd
 * Every reply is `{ jsonrpc, result }` or `{ jsonrpc, error: { code, message } }`. No key, no orders: data-only.
 */
import { VenueApiError, VenueHttpError, VenueSchemaError } from "../errors.js";
import { type FetchLike, JsonHttp } from "../http.js";
import type { Instrument, Quote } from "../types.js";
import { bookSummaryToQuote, toDeribitInstrument, toDeribitQuote } from "./normalize.js";
import { RawBookSummaryResponse, RawIndexPriceResponse, RawInstrumentsResponse, RawRpcErrorResponse, RawTickerResponse, formatIssues } from "./raw.js";
import type { z } from "zod";

export interface DeribitRestClientOptions {
  /** e.g. "https://www.deribit.com/api/v2" (no trailing slash needed). */
  baseUrl: string;
  fetch?: FetchLike | undefined;
  sleep?: ((ms: number) => Promise<void>) | undefined;
  maxAttempts?: number | undefined;
  backoffBaseMs?: number | undefined;
  timeoutMs?: number | undefined;
  /** Clock used for `Quote.receivedAt` (default Date.now). */
  now?: (() => number) | undefined;
}

const VENUE = "deribit";

export class DeribitRestClient {
  private readonly http: JsonHttp;
  private readonly now: () => number;

  constructor(options: DeribitRestClientOptions) {
    this.http = new JsonHttp({
      baseUrl: options.baseUrl,
      fetch: options.fetch,
      sleep: options.sleep,
      maxAttempts: options.maxAttempts,
      backoffBaseMs: options.backoffBaseMs,
      timeoutMs: options.timeoutMs,
      errors: {
        http: (opts) => new VenueHttpError(VENUE, opts),
        schema: (source, issues) => new VenueSchemaError(VENUE, source, issues),
      },
    });
    this.now = options.now ?? Date.now;
  }

  /** Active instruments of one currency (options by default), normalised; inactive ones are dropped. */
  async getInstruments(currency: string, kind = "option"): Promise<Instrument[]> {
    const body = await this.request("/public/get_instruments", { currency: currency.toUpperCase(), kind, expired: "false" }, RawInstrumentsResponse);
    return body.result.filter((r) => r.is_active).map(toDeribitInstrument);
  }

  /** The book summary of one currency's options as quotes (no greeks); rows whose instrument is unknown are skipped. */
  async getBookSummary(currency: string, instrumentIds: ReadonlyMap<string, number>): Promise<Quote[]> {
    const body = await this.request("/public/get_book_summary_by_currency", { currency: currency.toUpperCase(), kind: "option" }, RawBookSummaryResponse);
    const now = this.now();
    const out: Quote[] = [];
    for (const row of body.result) {
      const id = instrumentIds.get(row.instrument_name);
      if (id === undefined) continue;
      const quote = bookSummaryToQuote(row, id, now);
      if (quote) out.push(quote);
    }
    return out;
  }

  /** One instrument's ticker (with greeks and the index); null when the venue sends no index to convert with. */
  async getTicker(instrumentName: string, instrumentId: number): Promise<Quote | null> {
    const body = await this.request("/public/ticker", { instrument_name: instrumentName }, RawTickerResponse);
    return toDeribitQuote(body.result, instrumentId, this.now());
  }

  /** The current index price of "btc_usd" / "eth_usd". */
  async getIndexPrice(indexName: string): Promise<number> {
    const body = await this.request("/public/get_index_price", { index_name: indexName }, RawIndexPriceResponse);
    return body.result.index_price;
  }

  private async request<S extends z.ZodType>(path: string, query: Record<string, string>, schema: S): Promise<z.infer<S>> {
    const { url, json } = await this.http.getJson(path, query);
    const failure = RawRpcErrorResponse.safeParse(json);
    if (failure.success) throw new VenueApiError(VENUE, url, String(failure.data.error.code), failure.data.error.message);
    const parsed = schema.safeParse(json);
    if (!parsed.success) throw new VenueSchemaError(VENUE, url, formatIssues(parsed.error));
    return parsed.data;
  }
}
