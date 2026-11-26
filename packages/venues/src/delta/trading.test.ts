import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { DeltaTradingClientImpl, FakeDeltaTradingClient, contractsFor, describeOrderError, futuresMarginUsd, marginThresholdMissing, roundToTick, shortOptionMarginUsd, signDeltaRequest, type TradingFetch } from "./trading.js";

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

  it("HC-TR-192 HC-TR-295 short option margin = pct / 100 x spot x contract value + mark x contract value per contract; the percent is flat up to the threshold and grows per USD above it", () => {
    const btc = { contractValue: "0.001", initialMarginPct: "0.5", initialMarginScalingFactor: "0.000002", maxLeverageNotional: "200000" };
    // the figures of docs/research/delta-margin-verification.md (production BTC option, spot 59,209.3, premium left out):
    // below the threshold (3,378 lots at that spot) the listed percent alone applies
    expect(shortOptionMarginUsd({ ...btc, contracts: 100, spot: "59209.3", mark: "0" })).toBe("29.6");
    expect(shortOptionMarginUsd({ ...btc, contracts: 1_000, spot: "59209.3", mark: "0" })).toBe("296.05");
    expect(shortOptionMarginUsd({ ...btc, contracts: 3_000, spot: "59209.3", mark: "0" })).toBe("888.14");
    // above it: 296,046.50 USD is 96,046.50 over, 0.5 + 0.000002 x 96,046.50 = 0.692093 %
    expect(shortOptionMarginUsd({ ...btc, contracts: 5_000, spot: "59209.3", mark: "0" })).toBe("2048.92");
    expect(shortOptionMarginUsd({ ...btc, contracts: 10_000, spot: "59209.3", mark: "0" })).toBe("7603.58");
    // the testnet's parameters (factor 0.00002, threshold 100,000): the owner's check at 2,000 lots, spot 59,209.7
    expect(shortOptionMarginUsd({ contracts: 2_000, contractValue: "0.001", spot: "59209.7", mark: "0", initialMarginPct: "0.5", initialMarginScalingFactor: "0.00002", maxLeverageNotional: "100000" })).toBe("1028.34");
    // the option's own mark is added per contract: 100 contracts at spot 77,000, mark 450, 1 %: 0.77 + 0.45 each
    expect(shortOptionMarginUsd({ contracts: 100, contractValue: "0.001", spot: "77000", mark: "450", initialMarginPct: "1", initialMarginScalingFactor: "0.000005", maxLeverageNotional: "100000" })).toBe("122");
    // exactly at the threshold nothing is added
    expect(shortOptionMarginUsd({ contracts: 1_000, contractValue: "0.001", spot: "100000", mark: "0", initialMarginPct: "1", initialMarginScalingFactor: "0.000005", maxLeverageNotional: "100000" })).toBe("1000");
    // a factor with no threshold cannot be worked out: null, never the old per-contract arithmetic; a factor of 0 needs none
    expect(shortOptionMarginUsd({ contracts: 100, contractValue: "0.001", spot: "77000", mark: "450", initialMarginPct: "1", initialMarginScalingFactor: "0.000005", maxLeverageNotional: undefined })).toBeNull();
    expect(shortOptionMarginUsd({ contracts: 100, contractValue: "0.001", spot: "77000", mark: "450", initialMarginPct: "1", initialMarginScalingFactor: "0", maxLeverageNotional: undefined })).toBe("122");
    // without a scaling factor the percent alone applies
    expect(shortOptionMarginUsd({ contracts: 100, contractValue: "0.001", spot: "77000", mark: "450", initialMarginPct: "1", initialMarginScalingFactor: undefined, maxLeverageNotional: undefined })).toBe("122");
    // any missing input answers null: the caller says "unknown", never a guess
    expect(shortOptionMarginUsd({ contracts: null, contractValue: "0.001", spot: "77000", mark: "450", initialMarginPct: "1", initialMarginScalingFactor: undefined, maxLeverageNotional: undefined })).toBeNull();
    expect(shortOptionMarginUsd({ contracts: 100, contractValue: "0.001", spot: null, mark: "450", initialMarginPct: "1", initialMarginScalingFactor: undefined, maxLeverageNotional: undefined })).toBeNull();
    expect(shortOptionMarginUsd({ contracts: 100, contractValue: "0.001", spot: "77000", mark: null, initialMarginPct: "1", initialMarginScalingFactor: undefined, maxLeverageNotional: undefined })).toBeNull();
    expect(shortOptionMarginUsd({ contracts: 100, contractValue: "0.001", spot: "77000", mark: "450", initialMarginPct: undefined, initialMarginScalingFactor: undefined, maxLeverageNotional: undefined })).toBeNull();
    expect(shortOptionMarginUsd({ contracts: 100, contractValue: "0.001", spot: "nope", mark: "450", initialMarginPct: "1", initialMarginScalingFactor: undefined, maxLeverageNotional: undefined })).toBeNull();
    // the fake carries the parameters and the spot the same way
    const fake = new FakeDeltaTradingClient().product("P-BTC-76400-150926", 9, "0.001", "live", "0.1", { pct: "1", factor: "0.000005", threshold: "100000" }).markAt("P-BTC-76400-150926", "450", "77000");
    fake.markAt("P-BTC-76400-150926", "460"); // a re-mark without a spot keeps the spot
    return Promise.all([fake.getProduct("P-BTC-76400-150926"), fake.getTicker("P-BTC-76400-150926")]).then(([p, t]) => {
      expect(p).toMatchObject({ initialMarginPct: "1", initialMarginScalingFactor: "0.000005", maxLeverageNotional: "100000" });
      expect(t).toEqual({ mark: "460", spot: "77000" });
    });
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
    expect(ok).toEqual({ ok: true, order: { id: 501, clientOrderId: "hc-leg1-1", productId: 27, side: "buy", size: 10, unfilledSize: 0, state: "closed", averageFillPrice: "1201.5", limitPrice: null } });
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

  it("ADR-044 limit prices snap to the product tick toward the passive side; a product without a tick leaves the price alone", () => {
    expect(roundToTick("700.1234", "0.1", "buy")).toBe("700.1");
    expect(roundToTick("700.1234", "0.1", "sell")).toBe("700.2");
    expect(roundToTick("700", "0.1", "sell")).toBe("700.0");
    expect(roundToTick("1200.5", "0.5", "buy")).toBe("1200.5");
    expect(roundToTick("1200.7", "0.5", "buy")).toBe("1200.5");
    expect(roundToTick("1200.7", "0.5", "sell")).toBe("1201.0");
    expect(roundToTick("79521.3", "1", "buy")).toBe("79521");
    expect(roundToTick("700.1234", undefined, "buy")).toBe("700.1234");
    expect(roundToTick("700.1234", "0", "buy")).toBe("700.1234");
    expect(roundToTick("abc", "0.1", "buy")).toBe("abc");
    expect(new FakeDeltaTradingClient().product("C-1", 1)).toBeTruthy();
  });

  it("ADR-044 limit orders: the real client sends limit_order with the price; the fake rests a limit that does not cross and fills one that does", async () => {
    const f = fakeFetch(() => ({ body: { success: true, result: ORDER } }));
    const c = new DeltaTradingClientImpl({ baseUrl: BASE, fetch: f.impl, nodeEnv: "test", now: () => 1_700_000_000, timeoutMs: 20, sleep: () => Promise.resolve() });
    await c.placeOrder(CREDS, { productId: 27, size: 10, side: "buy", clientOrderId: "hc-leg1-9", orderType: "limit", limitPrice: "1200.5" });
    expect(JSON.parse(f.calls[0]!.init.body!)).toEqual({ product_id: 27, size: 10, side: "buy", order_type: "limit_order", limit_price: "1200.5", client_order_id: "hc-leg1-9", reduce_only: false });
    await c.placeOrder(CREDS, { productId: 27, size: 10, side: "buy", clientOrderId: "hc-leg1-10", orderType: "market" });
    expect((JSON.parse(f.calls[1]!.init.body!) as { order_type: string }).order_type).toBe("market_order");
    const fake = new FakeDeltaTradingClient().product("BTCUSD", 27).fillAt(27, "1200");
    const resting = await fake.placeOrder(CREDS, { productId: 27, size: 3, side: "buy", clientOrderId: "r", orderType: "limit", limitPrice: "1190" });
    expect(resting).toMatchObject({ ok: true, order: { state: "open", unfilledSize: 3, averageFillPrice: null } });
    const filled = await fake.placeOrder(CREDS, { productId: 27, size: 3, side: "buy", clientOrderId: "f", orderType: "limit", limitPrice: "1200" });
    expect(filled).toMatchObject({ ok: true, order: { state: "closed", averageFillPrice: "1200" } });
    const sold = await fake.placeOrder(CREDS, { productId: 27, size: 3, side: "sell", clientOrderId: "s", orderType: "limit", limitPrice: "1250" });
    expect(sold).toMatchObject({ ok: true, order: { state: "open" } });
    if (resting.ok) {
      expect((await fake.listOpenOrders(CREDS, [27])).map((o) => o.id)).toContain(resting.order.id);
      fake.complete(resting.order.id, "1190");
      expect((await fake.getOrder(CREDS, resting.order.id))?.averageFillPrice).toBe("1190");
    }
  });
});

describe("HC-TR-188 editOrder re-prices a resting limit in place (ADR-083)", () => {
  it("sends PUT /v2/orders with the id, product and price, and reads the venue's order back", async () => {
    const f = fakeFetch(() => ({ body: { success: true, result: { id: 501, client_order_id: "hc-leg-1", product_id: 27, side: "buy", size: 2, unfilled_size: 2, state: "open" } } }));
    const c = new DeltaTradingClientImpl({ baseUrl: BASE, fetch: f.impl, nodeEnv: "test", now: () => 1_700_000_000, minIntervalMs: 0 });
    const res = await c.editOrder(CREDS, { orderId: 501, productId: 27, limitPrice: "500.0" });
    expect(res).toEqual({ ok: true, order: { id: 501, clientOrderId: "hc-leg-1", productId: 27, side: "buy", size: 2, unfilledSize: 2, state: "open", averageFillPrice: null, limitPrice: null } });
    const call = f.calls.at(-1)!;
    expect(call.init.method).toBe("PUT");
    expect(call.url.pathname).toBe("/v2/orders");
    expect(JSON.parse(call.init.body!)).toEqual({ id: 501, product_id: 27, limit_price: "500.0" });
    expect(call.init.headers["api-key"]).toBe("key-1"); // signed like every private call
  });
  it("a refusal carries the venue's code; a transport failure is an unknown outcome", async () => {
    const refused = new DeltaTradingClientImpl({ baseUrl: BASE, fetch: fakeFetch(() => ({ status: 400, body: { success: false, error: { code: "order_not_found" } } })).impl, nodeEnv: "test", now: () => 1_700_000_000, minIntervalMs: 0 });
    expect(await refused.editOrder(CREDS, { orderId: 1, productId: 27, limitPrice: "1" })).toMatchObject({ ok: false, code: "order_not_found" });
    const down = new DeltaTradingClientImpl({ baseUrl: BASE, fetch: fakeFetch(() => ({ throwError: new Error("ECONNRESET") })).impl, nodeEnv: "test", now: () => 1_700_000_000, minIntervalMs: 0 });
    expect(await down.editOrder(CREDS, { orderId: 1, productId: 27, limitPrice: "1" })).toMatchObject({ ok: false, code: "unknown", unknown: true });
    const unreadable = new DeltaTradingClientImpl({ baseUrl: BASE, fetch: fakeFetch(() => ({ body: { success: true, result: { nope: 1 } } })).impl, nodeEnv: "test", now: () => 1_700_000_000, minIntervalMs: 0 });
    expect(await unreadable.editOrder(CREDS, { orderId: 1, productId: 27, limitPrice: "1" })).toMatchObject({ ok: false, code: "unknown", unknown: true, message: expect.stringContaining("could not be read") as string });
  });
  it("the fake moves a resting order's price: it fills when the new limit crosses the fill price, else keeps resting; a filled order cannot be edited or cancelled", async () => {
    const fake = new FakeDeltaTradingClient().product("C-BTC-80000-250926", 27).fillAt(27, "520");
    const placed = await fake.placeOrder(CREDS, { productId: 27, size: 1, side: "buy", clientOrderId: "hc-1-1", orderType: "limit", limitPrice: "500" });
    expect(placed).toMatchObject({ ok: true, order: { state: "open" } });
    const id = placed.ok ? placed.order.id : -1;
    expect(await fake.editOrder(CREDS, { orderId: id, productId: 27, limitPrice: "510" })).toMatchObject({ ok: true, order: { state: "open", unfilledSize: 1, limitPrice: "510" } });
    expect((await fake.getOrder(CREDS, id))?.limitPrice).toBe("510"); // the venue holds the new price
    fake.ordersDown = true;
    expect(await fake.getOrder(CREDS, id)).toBeNull();
    fake.ordersDown = false;
    expect(await fake.editOrder(CREDS, { orderId: id, productId: 27, limitPrice: "525" })).toMatchObject({ ok: true, order: { state: "closed", averageFillPrice: "520" } });
    expect(fake.edited.map((e) => e.limitPrice)).toEqual(["510", "525"]);
    expect(await fake.editOrder(CREDS, { orderId: id, productId: 27, limitPrice: "530" })).toMatchObject({ ok: false, code: "order_not_open" });
    expect(await fake.cancelOrder(CREDS, id, 27)).toBe(false);
    expect(await fake.editOrder(CREDS, { orderId: 999, productId: 27, limitPrice: "1" })).toMatchObject({ ok: false, code: "order_not_found" });
  });
});

describe("HC-TR-295 the margin percent grows per USD above the venue's threshold (ADR-146)", () => {
  const fut = { contracts: 350, contractValue: "0.001", price: "80000", initialMarginPct: "1", initialMarginScalingFactor: "0.000005", maxLeverageNotional: "100000" as string | undefined };
  it("HC-TR-295 a futures leg: nothing is added under the threshold, the factor counts every USD above it", () => {
    // 28,000 USD is under 100,000
    expect(futuresMarginUsd(fut)).toBe("280");
    // 3,500 contracts are 280,000 USD, 180,000 over: (1 + 0.000005 x 180,000) % = 1.9 % of 280,000
    expect(futuresMarginUsd({ ...fut, contracts: 3_500 })).toBe("5320");
  });

  it("HC-TR-295 a threshold that is absent, empty, not a number or below zero gives no figure, and so does a factor below zero or not a number; marginThresholdMissing names the first case", () => {
    for (const maxLeverageNotional of [undefined, "", "  ", "N/A", "-1"]) {
      expect(futuresMarginUsd({ ...fut, maxLeverageNotional })).toBeNull();
      expect(shortOptionMarginUsd({ contracts: 100, contractValue: "0.001", spot: "77000", mark: "450", initialMarginPct: "1", initialMarginScalingFactor: "0.000005", maxLeverageNotional })).toBeNull();
      expect(marginThresholdMissing({ initialMarginPct: "1", initialMarginScalingFactor: "0.000005", maxLeverageNotional })).toBe(true);
    }
    expect(futuresMarginUsd({ ...fut, initialMarginScalingFactor: "-0.000005" })).toBeNull();
    expect(futuresMarginUsd({ ...fut, initialMarginScalingFactor: "abc" })).toBeNull();
    // a threshold of 0 is a threshold: the factor counts from the first USD
    expect(futuresMarginUsd({ ...fut, maxLeverageNotional: "0" })).toBe("319.2"); // (1 + 0.000005 x 28,000) % of 28,000
    expect(marginThresholdMissing({ initialMarginPct: "1", initialMarginScalingFactor: "0.000005", maxLeverageNotional: "0" })).toBe(false);
    // nothing is missing when there is no factor, a factor of 0, or no margin percent at all (a venue with no margin data)
    expect(marginThresholdMissing({ initialMarginPct: "1" })).toBe(false);
    expect(marginThresholdMissing({ initialMarginPct: "1", initialMarginScalingFactor: "0" })).toBe(false);
    expect(marginThresholdMissing({ initialMarginScalingFactor: "0.000005" })).toBe(false);
    expect(marginThresholdMissing({ initialMarginPct: "1", initialMarginScalingFactor: "0.000005", maxLeverageNotional: "200000" })).toBe(false);
  });
});

describe("HC-TR-196 a futures leg carries an initial-margin estimate (ADR-095)", () => {
  it("HC-TR-196 margin is the percent of the notional, growing with size by the scaling factor (the side is no input: a long and a short are held alike)", () => {
    // 350 contracts x 0.001 BTC at 80,000 = 28,000 USD notional; 1 % of it is 280
    expect(futuresMarginUsd({ contracts: 350, contractValue: "0.001", price: "80000", initialMarginPct: "1", initialMarginScalingFactor: undefined, maxLeverageNotional: undefined })).toBe("280");
    // no premium term: unlike a sold option, nothing is added for the future's own price
    expect(futuresMarginUsd({ contracts: 1, contractValue: "0.001", price: "80000", initialMarginPct: "0.5", initialMarginScalingFactor: undefined, maxLeverageNotional: undefined })).toBe("0.4");
  });

  it("HC-TR-196 a missing input gives no figure, never a guess", () => {
    const ok = { contracts: 10, contractValue: "0.001", price: "80000", initialMarginPct: "1", initialMarginScalingFactor: undefined, maxLeverageNotional: undefined };
    expect(futuresMarginUsd({ ...ok, contracts: null })).toBeNull();
    expect(futuresMarginUsd({ ...ok, contracts: 0 })).toBeNull();
    expect(futuresMarginUsd({ ...ok, price: null })).toBeNull();
    expect(futuresMarginUsd({ ...ok, initialMarginPct: undefined })).toBeNull();
    expect(futuresMarginUsd({ ...ok, price: "not a number" })).toBeNull();
    // zero is not an estimate: a linear leg is never free, so a zero rate, price or contract value reads as "unknown"
    expect(futuresMarginUsd({ ...ok, initialMarginPct: "0" })).toBeNull();
    expect(futuresMarginUsd({ ...ok, price: "0" })).toBeNull();
  });
});
