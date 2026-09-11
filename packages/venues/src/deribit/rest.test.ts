import { describe, expect, it } from "vitest";
import { VenueApiError, VenueHttpError, VenueSchemaError } from "../errors.js";
import type { FetchLike } from "../http.js";
import { loadDeribitBookSummaryFixture, loadDeribitInstrumentsFixture, loadDeribitTickerFixture } from "../test-support/fixtures.js";
import { DeribitRestClient } from "./rest.js";

const instruments = loadDeribitInstrumentsFixture() as { result: { instrument_name: string; instrument_id: number; is_active: boolean }[] };
const book = loadDeribitBookSummaryFixture() as { result: { instrument_name: string }[] };
const ticker = loadDeribitTickerFixture();

interface Reply {
  status?: number;
  body?: unknown;
  text?: string;
  throwError?: Error;
}

function fakeFetch(handler: (url: URL, call: number) => Reply) {
  const calls: URL[] = [];
  const impl: FetchLike = (input) => {
    const url = new URL(input);
    calls.push(url);
    const reply = handler(url, calls.length);
    if (reply.throwError) return Promise.reject(reply.throwError);
    return Promise.resolve({
      status: reply.status ?? 200,
      headers: { get: () => null },
      text: () => Promise.resolve(reply.text ?? JSON.stringify(reply.body ?? { jsonrpc: "2.0", result: [] })),
    });
  };
  return { impl, calls };
}

function routes(url: URL): Reply {
  switch (url.pathname) {
    case "/api/v2/public/get_instruments":
      return { body: url.searchParams.get("currency") === "BTC" ? instruments : { jsonrpc: "2.0", result: [] } };
    case "/api/v2/public/get_book_summary_by_currency":
      return { body: book };
    case "/api/v2/public/ticker":
      return { body: ticker };
    case "/api/v2/public/get_index_price":
      return { body: { jsonrpc: "2.0", result: { index_price: 77618.03, estimated_delivery_price: 77618.03 } } };
    default:
      return { status: 404, text: "not found" };
  }
}

const client = (fetch: FetchLike, extra: Partial<ConstructorParameters<typeof DeribitRestClient>[0]> = {}) =>
  new DeribitRestClient({ baseUrl: "https://www.deribit.com/api/v2/", fetch, sleep: () => Promise.resolve(), now: () => 42, ...extra });

describe("HC-SH-122 [VENUES] Deribit REST", () => {
  it("lists active option instruments per currency with the venue's query and normalises them", async () => {
    const { impl, calls } = fakeFetch(routes);
    const out = await client(impl).getInstruments("btc");
    expect(out).toHaveLength(950);
    expect(out[0]).toMatchObject({ venue: "deribit", symbol: "BTC-12SEP26-69000-C", id: 691120, kind: "call" });
    expect(calls[0]!.toString()).toBe("https://www.deribit.com/api/v2/public/get_instruments?currency=BTC&kind=option&expired=false");
    expect(await client(impl).getInstruments("ETH")).toEqual([]);
    // inactive instruments are dropped
    const { impl: inactive } = fakeFetch(() => ({ body: { jsonrpc: "2.0", result: [{ ...instruments.result[0], is_active: false }] } }));
    expect(await client(inactive).getInstruments("BTC")).toEqual([]);
  });

  it("seeds quotes from the book summary for known instruments only, reads one ticker and the index", async () => {
    const { impl } = fakeFetch(routes);
    const c = client(impl);
    const ids = new Map(instruments.result.slice(0, 10).map((i) => [i.instrument_name, i.instrument_id]));
    const quotes = await c.getBookSummary("BTC", ids);
    expect(quotes).toHaveLength(10);
    expect(quotes.every((q) => q.venue === "deribit" && q.greeks === null && q.receivedAt === 42)).toBe(true);
    const t = (await c.getTicker("BTC-12SEP26-69000-C", 691120))!;
    expect(t.instrumentId).toBe(691120);
    expect(t.greeks).not.toBeNull();
    expect(await c.getIndexPrice("btc_usd")).toBe(77618.03);
  });

  it("surfaces the venue's error envelope, a shape mismatch, a body that is not JSON and an exhausted retry", async () => {
    const { impl: apiError } = fakeFetch(() => ({ body: { jsonrpc: "2.0", error: { code: 10001, message: "error" } } }));
    await expect(client(apiError).getIndexPrice("btc_usd")).rejects.toBeInstanceOf(VenueApiError);
    await expect(client(apiError).getIndexPrice("btc_usd")).rejects.toMatchObject({ venue: "deribit", code: "10001", detail: "error" });
    const { impl: wrongShape } = fakeFetch(() => ({ body: { jsonrpc: "2.0", result: { nope: true } } }));
    await expect(client(wrongShape).getInstruments("BTC")).rejects.toBeInstanceOf(VenueSchemaError);
    const { impl: notJson } = fakeFetch(() => ({ text: "<html>" }));
    await expect(client(notJson).getInstruments("BTC")).rejects.toBeInstanceOf(VenueSchemaError);
    const { impl: busy, calls } = fakeFetch(() => ({ status: 429, text: "slow down" }));
    const err = await client(busy, { maxAttempts: 2 }).getInstruments("BTC").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(VenueHttpError);
    expect(err).toMatchObject({ venue: "deribit", status: 429, retryable: true, attempts: 2 });
    expect(calls).toHaveLength(2);
    const { impl: notFound } = fakeFetch(() => ({ status: 404, text: "missing" }));
    await expect(client(notFound).getInstruments("BTC")).rejects.toMatchObject({ status: 404, retryable: false });
    const { impl: down } = fakeFetch(() => ({ throwError: new Error("ECONNRESET") }));
    await expect(client(down, { maxAttempts: 1 }).getInstruments("BTC")).rejects.toMatchObject({ status: 0, bodySnippet: "ECONNRESET" });
  });
});
