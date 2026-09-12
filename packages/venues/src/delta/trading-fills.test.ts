// Fills reader on the trading client (ADR-073; HC-TR-179): GET /v2/fills read-only, newest first, cursor-paged,
// tolerant of the documented shape's loose types; an unreadable page throws; the fake pages and records like the venue.
import { describe, expect, it } from "vitest";
import { DeltaApiError } from "../errors.js";
import { DeltaTradingClientImpl, FakeDeltaTradingClient, type TradingFetch, fillInstant } from "./trading.js";

const BASE = "https://cdn-ind.testnet.example";
const CREDS = { apiKey: "key-1", apiSecret: "secret-1" };
type Reply = { status?: number; body?: unknown; text?: string; throwError?: Error };
function client(handler: (url: URL, call: number) => Reply) {
  const calls: URL[] = [];
  const fetch: TradingFetch = (input) => {
    const url = new URL(input);
    calls.push(url);
    const reply = handler(url, calls.length);
    if (reply.throwError) return Promise.reject(reply.throwError);
    return Promise.resolve({ status: reply.status ?? 200, text: () => Promise.resolve(reply.text ?? JSON.stringify(reply.body)) });
  };
  return { c: new DeltaTradingClientImpl({ baseUrl: BASE, fetch, now: () => 1_700_000_000, nodeEnv: "test", minIntervalMs: 0 }), calls };
}
const RAW = { id: 9001, size: "10", price: 1500, side: "sell", product_id: 101, product_symbol: "C-BTC-80000-250926", order_id: 501, role: "taker", commission: "0.75", created_at: "2026-09-11T09:00:00.000Z", extra_field: "kept" };

describe("HC-TR-179 listFills", () => {
  it("reads a page newest first, keeps the venue's row raw, follows the cursor on the next call, and clamps the page size", async () => {
    const { c, calls } = client((url, call) => (call === 1 ? { body: { success: true, result: [RAW, { ...RAW, id: "9000", size: 5, created_at: 1_789_117_200, commission: null, order_id: null, role: undefined }], meta: { after: "cursor-2" } } } : { body: { success: true, result: [], meta: { after: null } } }));
    const page = await c.listFills(CREDS, { pageSize: 1000 });
    expect(calls[0]!.pathname).toBe("/v2/fills");
    expect(calls[0]!.searchParams.get("page_size")).toBe("100"); // the venue's cap
    expect(page.after).toBe("cursor-2");
    expect(page.fills.map((f) => [f.id, f.orderId, f.size, f.price, f.commission, f.role, f.filledAt])).toEqual([
      ["9001", "501", 10, "1500", "0.75", "taker", "2026-09-11T09:00:00.000Z"],
      ["9000", null, 5, "1500", "0", null, "2026-09-11T09:00:00.000Z"], // an epoch in seconds
    ]);
    expect(page.fills[0]!.raw).toMatchObject({ extra_field: "kept", product_id: 101 });
    const next = await c.listFills(CREDS, { after: "cursor-2", pageSize: 0 });
    expect(calls[1]!.searchParams.get("after")).toBe("cursor-2");
    expect(calls[1]!.searchParams.get("page_size")).toBe("1");
    expect(next).toEqual({ fills: [], after: null });
  });

  it("an epoch in seconds, milliseconds or microseconds becomes the same instant; ISO text passes through", () => {
    expect(fillInstant(1_789_117_200)).toBe("2026-09-11T09:00:00.000Z");
    expect(fillInstant(1_789_117_200_000)).toBe("2026-09-11T09:00:00.000Z");
    expect(fillInstant(1_789_117_200_000_000)).toBe("2026-09-11T09:00:00.000Z");
    expect(fillInstant("2026-09-11T09:00:00.000Z")).toBe("2026-09-11T09:00:00.000Z");
  });

  it("throws, never answers empty, when the transport fails, the venue refuses, or the shape cannot be read", async () => {
    const down = client(() => ({ throwError: new Error("socket hang up") }));
    await expect(down.c.listFills(CREDS)).rejects.toMatchObject({ name: "DeltaApiError", code: "fills_unavailable", context: { transport: true } });
    const refused = client(() => ({ status: 401, body: { success: false, error: { code: "invalid_api_key" } } }));
    await expect(refused.c.listFills(CREDS)).rejects.toMatchObject({ code: "fills_unavailable", context: { status: 401, code: "invalid_api_key" } });
    const odd = client(() => ({ body: { success: true, result: [{ id: 1, weird: true }] } }));
    const err = await odd.c.listFills(CREDS).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DeltaApiError);
    expect((err as DeltaApiError).context).toEqual({ parse: true, keys: ["id", "weird"] }); // field names only, never values
    const notArray = client(() => ({ body: { success: true, result: "nope" } }));
    await expect(notArray.c.listFills(CREDS)).rejects.toMatchObject({ context: { parse: true, keys: [] } });
  });
});

describe("HC-TR-179 the fake venue's fills", () => {
  it("records per key with the documented spelling in raw, pages newest first by an index cursor, and can be down", async () => {
    const fake = new FakeDeltaTradingClient().product("C-BTC-80000-250926", 101, "0.001");
    const a = fake.addFill("key-a", { productId: 101, side: "buy", size: 10, price: "1200" });
    fake.addFill("key-a", { id: "given", productId: 101, side: "sell", size: 10, price: "1500", commission: "0.75", filledAt: "2026-09-12T10:00:00.000Z", orderId: "77", role: "maker", symbol: "C-BTC-80000-250926", raw: { custom: true } });
    fake.addFill("key-b", { productId: 555, side: "buy", size: 1, price: "1" });
    expect(a.symbol).toBe("C-BTC-80000-250926"); // from the product list
    expect(a.raw).toMatchObject({ product_id: 101, product_symbol: "C-BTC-80000-250926", side: "buy", commission: "0" });
    const page1 = await fake.listFills({ apiKey: "key-a", apiSecret: "s" }, { pageSize: 1 });
    expect(page1.fills.map((f) => f.id)).toEqual(["given"]); // newest first
    expect(page1.after).toBe("1");
    const page2 = await fake.listFills({ apiKey: "key-a", apiSecret: "s" }, { after: page1.after, pageSize: 1 });
    expect(page2.fills.map((f) => f.id)).toEqual([a.id]);
    expect(page2.after).toBeNull();
    expect((await fake.listFills({ apiKey: "key-b", apiSecret: "s" })).fills.map((f) => [f.symbol, f.raw])).toEqual([[null, expect.objectContaining({ product_id: 555, product_symbol: null }) as unknown]]);
    expect((await fake.listFills({ apiKey: "key-c", apiSecret: "s" }, { pageSize: 500 })).fills).toEqual([]);
    fake.fillsDown = true;
    await expect(fake.listFills({ apiKey: "key-a", apiSecret: "s" })).rejects.toMatchObject({ code: "fills_unavailable" });
  });
});
