import { afterEach, describe, expect, it, vi } from "vitest";
import { DeltaApiError, DeltaHttpError, DeltaSchemaError } from "../errors.js";
import { loadProductsFixture, loadTickersFixture } from "../test-support/fixtures.js";
import { DeltaRestClient } from "./rest.js";
import type { FetchLike } from "./rest.js";

const BASE = "https://api.example.test";
const products = loadProductsFixture() as { result: unknown[]; meta: Record<string, unknown> };
const tickers = loadTickersFixture() as { result: unknown[] };

interface Reply {
  status?: number;
  body?: unknown;
  text?: string;
  headers?: Record<string, string>;
  /** Reject instead of responding (transport failure). */
  throwError?: Error;
  /** Never resolve until the abort signal fires, then reject like fetch does. */
  hang?: boolean;
}

function fakeFetch(handler: (url: URL, call: number) => Reply) {
  const calls: URL[] = [];
  const impl: FetchLike = (input, init) => {
    const url = new URL(input);
    calls.push(url);
    const reply = handler(url, calls.length);
    if (reply.throwError) return Promise.reject(reply.throwError);
    if (reply.hang) {
      return new Promise((_, reject) => {
        init.signal.addEventListener("abort", () => reject(new Error("The operation was aborted")));
      });
    }
    const headers = new Map(Object.entries(reply.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
    const text = reply.text ?? JSON.stringify(reply.body ?? { success: true, result: [] });
    return Promise.resolve({
      status: reply.status ?? 200,
      headers: { get: (name: string) => headers.get(name.toLowerCase()) ?? null },
      text: () => Promise.resolve(text),
    });
  };
  return { impl, calls };
}

function client(fetch: FetchLike, extra: Partial<ConstructorParameters<typeof DeltaRestClient>[0]> = {}) {
  const sleeps: number[] = [];
  const rest = new DeltaRestClient({
    baseUrl: `${BASE}/`,
    fetch,
    sleep: (ms) => {
      sleeps.push(ms);
      return Promise.resolve();
    },
    now: () => 1_800_000_000_000,
    ...extra,
  });
  return { rest, sleeps };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("[VENUES] DeltaRestClient.getProducts", () => {
  it("[VENUES] loads and normalises the 972 fixture products with the documented query", async () => {
    const { impl, calls } = fakeFetch(() => ({ body: products }));
    const { rest } = client(impl);
    const instruments = await rest.getProducts({ contractTypes: ["call_options", "put_options"], states: ["live"] });
    expect(instruments).toHaveLength(972);
    expect(instruments[0]).toMatchObject({ venue: "delta", symbol: "C-XAUT-4640-110926", kind: "call", strike: "4640" });
    expect(calls).toHaveLength(1);
    const url = calls[0] as URL;
    expect(url.origin + url.pathname).toBe(`${BASE}/v2/products`);
    expect(url.searchParams.get("page_size")).toBe("2000");
    expect(url.searchParams.get("contract_types")).toBe("call_options,put_options");
    expect(url.searchParams.get("states")).toBe("live");
    expect(url.searchParams.has("after")).toBe(false);
  });

  it("[VENUES] follows the `after` cursor across pages", async () => {
    const [a, b, c] = products.result;
    const { impl, calls } = fakeFetch((url) =>
      url.searchParams.get("after") === "cursor-1"
        ? { body: { success: true, result: [c], meta: { after: null } } }
        : { body: { success: true, result: [a, b], meta: { after: "cursor-1" } } },
    );
    const { rest } = client(impl);
    const instruments = await rest.getProducts({ pageSize: 2 });
    expect(instruments).toHaveLength(3);
    expect(calls.map((u) => u.searchParams.get("after"))).toEqual([null, "cursor-1"]);
    expect(calls[0]?.searchParams.get("page_size")).toBe("2");
    expect(calls[0]?.searchParams.has("contract_types")).toBe(false);
  });

  it("[VENUES] treats a missing meta as a single page", async () => {
    const { impl } = fakeFetch(() => ({ body: { success: true, result: [products.result[0]] } }));
    const { rest } = client(impl);
    expect(await rest.getProducts({ contractTypes: [], states: [] })).toHaveLength(1);
  });
});

describe("[VENUES] DeltaRestClient.getTickers / getTicker", () => {
  it("[VENUES] loads the 307 fixture tickers with contract type and underlying filters", async () => {
    const { impl, calls } = fakeFetch(() => ({ body: tickers }));
    const { rest } = client(impl);
    const quotes = await rest.getTickers({ contractTypes: ["call_options"], underlying: "BTC" });
    expect(quotes).toHaveLength(307);
    expect(quotes[0]).toMatchObject({ symbol: "C-BTC-99000-271126", mark: "1290.81008713", receivedAt: 1_800_000_000_000 });
    const url = calls[0] as URL;
    expect(url.pathname).toBe("/v2/tickers");
    expect(url.searchParams.get("contract_types")).toBe("call_options");
    expect(url.searchParams.get("underlying_asset_symbols")).toBe("BTC");
  });

  it("[VENUES] accepts several underlyings and no filters at all", async () => {
    const { impl, calls } = fakeFetch(() => ({ body: { success: true, result: [] } }));
    const { rest } = client(impl);
    await rest.getTickers({ underlying: ["BTC", "ETH"] });
    await rest.getTickers({ underlying: [] });
    await rest.getTickers();
    expect(calls[0]?.searchParams.get("underlying_asset_symbols")).toBe("BTC,ETH");
    expect(calls[1]?.search).toBe("");
    expect(calls[2]?.search).toBe("");
  });

  it("[VENUES] getTicker fetches /v2/tickers/{symbol} URL-encoded", async () => {
    const { impl, calls } = fakeFetch(() => ({ body: { success: true, result: tickers.result[0] } }));
    const { rest } = client(impl);
    const quote = await rest.getTicker("C-BTC-99000-271126");
    expect(quote.instrumentId).toBe(151077);
    expect(calls[0]?.pathname).toBe("/v2/tickers/C-BTC-99000-271126");
  });
});

describe("[VENUES] DeltaRestClient.getCandles", () => {
  it("[VENUES] sends unix-second bounds and returns decimal-string OHLC", async () => {
    const { impl, calls } = fakeFetch(() => ({
      body: {
        success: true,
        result: [
          { time: 1700000000, open: 79000.5, high: 79100, low: 78900.25, close: 79050, volume: 12.5 },
          { time: 1700000060, open: "79050", high: "79060", low: "79040", close: "79055", volume: null },
          { time: 1700000120, open: 1, high: 1, low: 1, close: 1 },
        ],
      },
    }));
    const { rest } = client(impl);
    const candles = await rest.getCandles({ symbol: "MARK:C-BTC-80000-250926", resolution: "1m", start: 1700000000.9, end: 1700000200 });
    expect(candles).toEqual([
      { time: 1700000000, open: "79000.5", high: "79100", low: "78900.25", close: "79050", volume: "12.5" },
      { time: 1700000060, open: "79050", high: "79060", low: "79040", close: "79055", volume: "0" },
      { time: 1700000120, open: "1", high: "1", low: "1", close: "1", volume: "0" },
    ]);
    const url = calls[0] as URL;
    expect(url.pathname).toBe("/v2/history/candles");
    expect(url.searchParams.get("symbol")).toBe("MARK:C-BTC-80000-250926");
    expect(url.searchParams.get("resolution")).toBe("1m");
    expect(url.searchParams.get("start")).toBe("1700000000");
    expect(url.searchParams.get("end")).toBe("1700000200");
  });
});

describe("[VENUES] DeltaRestClient retry and error paths", () => {
  it("[VENUES] retries 429 with exponential backoff and honours Retry-After", async () => {
    const { impl, calls } = fakeFetch((_url, call) =>
      call === 1
        ? { status: 429, text: "slow down" }
        : call === 2
          ? { status: 429, text: "slow down", headers: { "Retry-After": "2" } }
          : { body: { success: true, result: [] } },
    );
    const { rest, sleeps } = client(impl, { maxAttempts: 4 });
    expect(await rest.getTickers()).toEqual([]);
    expect(calls).toHaveLength(3);
    expect(sleeps).toEqual([250, 2000]);
  });

  it("[VENUES] gives up after maxAttempts on 5xx with a typed retryable error", async () => {
    const { impl, calls } = fakeFetch(() => ({ status: 503, text: "<html>upstream down</html>" }));
    const { rest, sleeps } = client(impl);
    const error = await rest.getTickers().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DeltaHttpError);
    const http = error as DeltaHttpError;
    expect(http).toMatchObject({ status: 503, retryable: true, attempts: 3, bodySnippet: "<html>upstream down</html>" });
    expect(http.url).toBe(`${BASE}/v2/tickers`);
    expect(http.message).toContain("503");
    expect(http.name).toBe("DeltaHttpError");
    expect(calls).toHaveLength(3);
    expect(sleeps).toEqual([250, 500]);
  });

  it("[VENUES] does not retry 4xx and truncates the body snippet", async () => {
    const long = "x".repeat(500);
    const { impl, calls } = fakeFetch(() => ({ status: 404, text: long }));
    const { rest, sleeps } = client(impl);
    const error = (await rest.getTicker("NOPE").catch((e: unknown) => e)) as DeltaHttpError;
    expect(error).toBeInstanceOf(DeltaHttpError);
    expect(error).toMatchObject({ status: 404, retryable: false, attempts: 1 });
    expect(error.bodySnippet).toHaveLength(201);
    expect(error.bodySnippet.endsWith("…")).toBe(true);
    expect(calls).toHaveLength(1);
    expect(sleeps).toEqual([]);
  });

  it("[VENUES] retries transport failures and reports status 0 when they persist", async () => {
    const { impl } = fakeFetch(() => ({ throwError: new Error("ECONNRESET") }));
    const { rest, sleeps } = client(impl, { maxAttempts: 2, backoffBaseMs: 10 });
    const error = (await rest.getProducts().catch((e: unknown) => e)) as DeltaHttpError;
    expect(error).toBeInstanceOf(DeltaHttpError);
    expect(error).toMatchObject({ status: 0, retryable: true, attempts: 2, bodySnippet: "ECONNRESET" });
    expect(sleeps).toEqual([10]);
  });

  it("[VENUES] stringifies non-Error transport failures", async () => {
    // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- deliberately not an Error
    const impl: FetchLike = () => Promise.reject("weird");
    const { rest } = client(impl, { maxAttempts: 1 });
    const error = (await rest.getProducts().catch((e: unknown) => e)) as DeltaHttpError;
    expect(error.bodySnippet).toBe("weird");
  });

  it("[VENUES] aborts a hung request after timeoutMs and retries", async () => {
    const { impl, calls } = fakeFetch((_url, call) => (call === 1 ? { hang: true } : { body: { success: true, result: [] } }));
    const { rest, sleeps } = client(impl, { timeoutMs: 5 });
    expect(await rest.getTickers()).toEqual([]);
    expect(calls).toHaveLength(2);
    expect(sleeps).toEqual([250]);
  });

  it("[VENUES] rejects non-JSON and schema-mismatched bodies with DeltaSchemaError", async () => {
    const { impl } = fakeFetch((_url, call) =>
      call === 1 ? { text: "<html>not json</html>" } : { body: { success: true, result: [{ symbol: "X" }] } },
    );
    const { rest } = client(impl);
    const notJson = (await rest.getTickers().catch((e: unknown) => e)) as DeltaSchemaError;
    expect(notJson).toBeInstanceOf(DeltaSchemaError);
    expect(notJson.issues[0]).toContain("not JSON");
    expect(notJson.source).toBe(`${BASE}/v2/tickers`);
    expect(notJson.name).toBe("DeltaSchemaError");

    const mismatch = (await rest.getTickers().catch((e: unknown) => e)) as DeltaSchemaError;
    expect(mismatch).toBeInstanceOf(DeltaSchemaError);
    expect(mismatch.issues.some((i) => i.startsWith("result.0.product_id"))).toBe(true);
    expect(mismatch.message).toContain("failed validation");
  });

  it("[VENUES] surfaces `success: false` envelopes as DeltaApiError", async () => {
    const { impl } = fakeFetch((_url, call) =>
      call === 1
        ? { body: { success: false, error: { code: "invalid_symbol", context: { symbol: "X" } } } }
        : { body: { success: false } },
    );
    const { rest } = client(impl);
    const withCode = (await rest.getTicker("X").catch((e: unknown) => e)) as DeltaApiError;
    expect(withCode).toBeInstanceOf(DeltaApiError);
    expect(withCode).toMatchObject({ code: "invalid_symbol", context: { symbol: "X" }, name: "DeltaApiError" });
    expect(withCode.url).toBe(`${BASE}/v2/tickers/X`);
    const bare = (await rest.getTicker("X").catch((e: unknown) => e)) as DeltaApiError;
    expect(bare).toMatchObject({ code: "unknown", context: null });
  });

  it("[VENUES] falls back to globalThis.fetch and the real sleep; refuses to start without any fetch", async () => {
    vi.stubGlobal("fetch", undefined);
    expect(() => new DeltaRestClient({ baseUrl: BASE })).toThrow(/no fetch implementation/);

    const { impl, calls } = fakeFetch((_url, call) => (call === 1 ? { status: 500, text: "boom" } : { body: { success: true, result: [] } }));
    vi.stubGlobal("fetch", impl);
    const rest = new DeltaRestClient({ baseUrl: BASE, backoffBaseMs: 1 });
    expect(await rest.getTickers()).toEqual([]);
    expect(calls).toHaveLength(2);
    expect((await rest.getTickers())[0]).toBeUndefined();
  });

  it("[VENUES] clamps maxAttempts to at least one", async () => {
    const { impl, calls } = fakeFetch(() => ({ status: 500, text: "boom" }));
    const { rest } = client(impl, { maxAttempts: 0 });
    await expect(rest.getTickers()).rejects.toBeInstanceOf(DeltaHttpError);
    expect(calls).toHaveLength(1);
  });
});
