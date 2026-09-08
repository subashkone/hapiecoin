import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { DeltaTradingClientImpl, FakeDeltaTradingClient, contractsFor, describeOrderError, signDeltaRequest, type TradingFetch } from "./trading.js";

const BASE = "https://cdn-ind.testnet.example";
const CREDS = { apiKey: "key-1", apiSecret: "secret-1" };

interface Reply {
  status?: number;
  body?: unknown;
  text?: string;
  throwError?: Error;
  hang?: boolean;
}
function fakeFetch(handler: (url: URL, init: { method: string; headers: Record<string, string>; body?: string }, call: number) => Reply) {
  const calls: { url: URL; init: { method: string; headers: Record<string, string>; body?: string } }[] = [];
  const impl: TradingFetch = (input, init) => {
    const url = new URL(input);
    calls.push({ url, init });
    const reply = handler(url, init, calls.length);
    if (reply.throwError) return Promise.reject(reply.throwError);
    if (reply.hang) {
      return new Promise((_, reject) => {
        init.signal.addEventListener("abort", () => {
          const e = new Error("aborted");
          e.name = "AbortError";
          reject(e);
        });
      });
    }
    const text = reply.text ?? JSON.stringify(reply.body ?? { success: true, result: [] });
    return Promise.resolve({ status: reply.status ?? 200, text: () => Promise.resolve(text) });
  };
  return { impl, calls };
}
const ORDER = { id: 501, client_order_id: "hc-leg1-1", product_id: 27, side: "buy", size: 10, unfilled_size: 0, state: "closed", average_fill_price: "1201.5" };

describe("[VENUES] Delta trading client (ADR-025)", () => {
  it("signs method + timestamp + path + query + body with HMAC-SHA256 hex", () => {
    const req = signDeltaRequest({ baseUrl: BASE + "/", method: "POST", path: "/v2/orders", body: '{"a":1}', apiKey: "k", apiSecret: "s", timestamp: 1_700_000_000 });
    expect(req.url).toBe(`${BASE}/v2/orders`);
    expect(req.headers["signature"]).toBe(createHmac("sha256", "s").update('POST1700000000/v2/orders{"a":1}').digest("hex"));
    expect(req.headers["api-key"]).toBe("k");
    const q = signDeltaRequest({ baseUrl: BASE, method: "GET", path: "/v2/orders", query: "states=open", apiKey: "k", apiSecret: "s", timestamp: 1 });
    expect(q.url).toBe(`${BASE}/v2/orders?states=open`);
  });

  it("contracts = lots × lot size ÷ contract value, whole numbers only", () => {
    expect(contractsFor(10, "0.001", "0.001")).toBe(10);
    expect(contractsFor(3, "0.01", "0.001")).toBe(30);
    expect(contractsFor(1, "0.0005", "0.001")).toBeNull();
    expect(contractsFor(0, "0.001", "0.001")).toBeNull();
    expect(contractsFor(1, "0.001", "0")).toBeNull();
  });

  it("refuses to run under NODE_ENV=test without an injected fetch (trading safety rule 2)", () => {
    expect(() => new DeltaTradingClientImpl({ baseUrl: BASE, nodeEnv: "test" })).toThrow(/trading safety/);
    expect(() => new DeltaTradingClientImpl({ baseUrl: BASE, nodeEnv: "test", fetch: fakeFetch(() => ({})).impl })).not.toThrow();
  });

  it("places a market order with the client order id, reads the fill, maps venue errors and never retries an order", async () => {
    const replies: Reply[] = [
      { body: { success: true, result: ORDER } },
      { status: 400, body: { success: false, error: { code: "insufficient_margin", context: { additional_margin_required: "12.5" } } } },
      { status: 429, body: { success: false, error: { code: "rate_limited" } } },
      { hang: true },
    ];
    const f = fakeFetch((_u, _i, call) => replies[call - 1] ?? {});
    const sleeps: number[] = [];
    const c = new DeltaTradingClientImpl({ baseUrl: BASE, fetch: f.impl, nodeEnv: "test", now: () => 1_700_000_000, timeoutMs: 20, sleep: (ms) => { sleeps.push(ms); return Promise.resolve(); } });
    const ok = await c.placeOrder(CREDS, { productId: 27, size: 10, side: "buy", clientOrderId: "hc-leg1-1" });
    expect(ok).toEqual({ ok: true, order: { id: 501, clientOrderId: "hc-leg1-1", productId: 27, side: "buy", size: 10, unfilledSize: 0, state: "closed", averageFillPrice: "1201.5" } });
    expect(f.calls[0]!.init.method).toBe("POST");
    expect(JSON.parse(f.calls[0]!.init.body!)).toEqual({ product_id: 27, size: 10, side: "buy", order_type: "market_order", client_order_id: "hc-leg1-1", reduce_only: false });
    expect(f.calls[0]!.init.headers["api-key"]).toBe("key-1");
    const margin = await c.placeOrder(CREDS, { productId: 27, size: 10, side: "buy", clientOrderId: "hc-leg1-2" });
    expect(margin).toMatchObject({ ok: false, code: "insufficient_margin", retryable: false });
    expect((margin as { message: string }).message).toContain("12.5");
    const limited = await c.placeOrder(CREDS, { productId: 27, size: 10, side: "buy", clientOrderId: "hc-leg1-3" });
    expect(limited).toMatchObject({ ok: false, code: "rate_limited", retryable: true });
    const unknown = await c.placeOrder(CREDS, { productId: 27, size: 10, side: "buy", clientOrderId: "hc-leg1-4" });
    expect(unknown).toMatchObject({ ok: false, code: "unknown", unknown: true });
    expect(f.calls).toHaveLength(4); // one HTTP call per placement, no silent retry
    expect(await c.placeOrder(CREDS, { productId: 27, size: 0.5, side: "buy", clientOrderId: "x" })).toMatchObject({ ok: false, code: "invalid_size" });
    // the token bucket spaced the four calls at 100 ms on the frozen clock
    expect(sleeps).toEqual([100, 200, 300]);
  });

  it("looks products up once (cached), lists open orders, cancels, and reads positions and balances", async () => {
    const f = fakeFetch((url) => {
      if (url.pathname === "/v2/products/BTCUSD") return { body: { success: true, result: { id: 27, symbol: "BTCUSD", contract_value: "0.001", contract_type: "perpetual_futures", state: "live" } } };
      if (url.pathname === "/v2/orders" ) return { body: { success: true, result: [ORDER, { ...ORDER, id: 502, state: "open", unfilled_size: 3, average_fill_price: null }] } };
      if (url.pathname === "/v2/orders/501") return { body: { success: true, result: ORDER } };
      if (url.pathname === "/v2/positions/margined") return { body: { success: true, result: [{ product_id: 27, product_symbol: "BTCUSD", size: 10, entry_price: "1201.5", realized_pnl: "0", margin: "12" }] } };
      if (url.pathname === "/v2/wallet/balances") return { body: { success: true, result: [{ asset_symbol: "USD", balance: "1000", available_balance: "900" }] } };
      return { status: 404, body: { success: false, error: { code: "not_found" } } };
    });
    const c = new DeltaTradingClientImpl({ baseUrl: BASE, fetch: f.impl, nodeEnv: "test", now: () => 1_700_000_000, minIntervalMs: 0 });
    expect(await c.getProduct("BTCUSD")).toEqual({ id: 27, symbol: "BTCUSD", contractValue: "0.001", contractType: "perpetual_futures", state: "live" });
    await c.getProduct("BTCUSD");
    expect(f.calls.filter((x) => x.url.pathname.startsWith("/v2/products")).length).toBe(1);
    expect(f.calls[0]!.init.headers["api-key"]).toBeUndefined(); // public endpoint, unsigned
    await expect(c.getProduct("NOPE")).rejects.toThrow(/product lookup failed/);
    const open = await c.listOpenOrders(CREDS, [27, 28]);
    expect(open.map((o) => o.id)).toEqual([501, 502]);
    expect(f.calls.at(-1)!.url.search).toBe("?product_ids=27,28&states=open,pending");
    expect((await c.getOrder(CREDS, 501))?.averageFillPrice).toBe("1201.5");
    expect(await c.cancelOrder(CREDS, 501, 27)).toBe(true);
    expect(f.calls.at(-1)!.init.method).toBe("DELETE");
    expect(await c.getPositions(CREDS)).toEqual([{ productId: 27, symbol: "BTCUSD", size: 10, entryPrice: "1201.5", realizedPnl: "0", margin: "12" }]);
    expect(await c.getBalances(CREDS)).toEqual([{ asset: "USD", balance: "1000", availableBalance: "900" }]);
  });

  it("describes the documented order errors", () => {
    expect(describeOrderError("market_disrupted")).toContain("disrupted");
    expect(describeOrderError("something_else")).toContain("something_else");
  });

  it("the fake fills, fails once, partially fills and completes, and records calls", async () => {
    const fake = new FakeDeltaTradingClient().product("BTCUSD", 27).fillAt(27, "1200").failWith(28, "insufficient_margin", { once: true });
    expect((await fake.getProduct("BTCUSD")).id).toBe(27);
    const a = await fake.placeOrder(CREDS, { productId: 27, size: 1, side: "buy", clientOrderId: "a" });
    expect(a).toMatchObject({ ok: true, order: { averageFillPrice: "1200", state: "closed" } });
    expect(await fake.placeOrder(CREDS, { productId: 28, size: 1, side: "buy", clientOrderId: "b" })).toMatchObject({ ok: false, code: "insufficient_margin" });
    expect((await fake.placeOrder(CREDS, { productId: 28, size: 1, side: "buy", clientOrderId: "b" })).ok).toBe(true);
    fake.partialNextOrder();
    const p = await fake.placeOrder(CREDS, { productId: 27, size: 2, side: "sell", clientOrderId: "c" });
    expect(p).toMatchObject({ ok: true, order: { state: "open", unfilledSize: 1 } });
    if (p.ok) {
      expect((await fake.listOpenOrders(CREDS, [27])).map((o) => o.id)).toEqual([p.order.id]);
      fake.complete(p.order.id, "1250");
      expect((await fake.getOrder(CREDS, p.order.id))?.state).toBe("closed");
    }
    expect(fake.placed).toHaveLength(4);
  });
});
