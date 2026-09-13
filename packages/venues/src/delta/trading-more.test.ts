// Remaining branches of the trading client and its fake: defaults, transport and parse failures, marks, every
// documented error text, and the fake's bookkeeping helpers (the package holds a 100 % line / function floor).
import { afterEach, describe, expect, it, vi } from "vitest";
import { DeltaTradingClientImpl, FakeDeltaTradingClient, describeOrderError, signDeltaRequest, type TradingFetch } from "./trading.js";

const BASE = "https://cdn-ind.testnet.example";
const CREDS = { apiKey: "key-1", apiSecret: "secret-1" };
const reply = (status: number, text: string) => Promise.resolve({ status, text: () => Promise.resolve(text) });
const json = (body: unknown, status = 200) => reply(status, JSON.stringify(body));

afterEach(() => vi.unstubAllGlobals());

describe("[VENUES] trading client edges", () => {
  it("query strings may carry their own question mark, and the env guard reads NODE_ENV when no option is given", () => {
    expect(signDeltaRequest({ baseUrl: BASE, method: "GET", path: "/v2/orders", query: "?a=1", apiKey: "k", apiSecret: "s", timestamp: 1 }).url).toBe(`${BASE}/v2/orders?a=1`);
    expect(() => new DeltaTradingClientImpl({ baseUrl: BASE })).toThrow(/trading safety/); // vitest sets NODE_ENV=test
  });

  it("uses the global fetch, the wall clock and a real sleep by default", async () => {
    const seen: string[] = [];
    vi.stubGlobal("fetch", (url: string) => {
      seen.push(url);
      return json({ success: true, result: { id: 1, symbol: "BTCUSD", contract_value: 0.001, contract_type: "perpetual_futures", state: "live" } });
    });
    // a frozen clock: the bucket's second slot is always 5 ms away, so the default sleep (a real timer) is asked for it
    // every run; on the real whole-second clock the two calls could straddle a second and skip the wait (CI saw that)
    const c = new DeltaTradingClientImpl({ baseUrl: `${BASE}/`, nodeEnv: "development", minIntervalMs: 5, now: () => 1_700_000_000 });
    const before = Date.now();
    expect((await c.getProduct("BTCUSD")).contractValue).toBe("0.001");
    expect(await c.getMark("BTCUSD")).toBeNull(); // the stub answers a product, not a ticker: no mark_price
    expect(Date.now() - before).toBeGreaterThanOrEqual(4); // the second call waited for the bucket
    // a client built without `now` reads the default whole-second clock
    const live = new DeltaTradingClientImpl({ baseUrl: BASE, nodeEnv: "development", minIntervalMs: 0 });
    expect((await live.getProduct("BTCUSD")).contractValue).toBe("0.001");
    expect(seen).toEqual([`${BASE}/v2/products/BTCUSD`, `${BASE}/v2/tickers/BTCUSD`, `${BASE}/v2/products/BTCUSD`]);
  });

  it("non-JSON, non-envelope and transport failures are reported without throwing", async () => {
    const replies: (() => ReturnType<TradingFetch>)[] = [
      () => reply(502, "<html>bad gateway</html>"),
      () => json([1, 2, 3]),
      () => Promise.reject(new Error("socket hang up")),
      // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- the client must survive non-Error throws
      () => Promise.reject("weird"),
      () => json({ success: true, result: { nope: true } }),
    ];
    let i = 0;
    const c = new DeltaTradingClientImpl({ baseUrl: BASE, nodeEnv: "test", fetch: () => replies[i++]!(), minIntervalMs: 0 });
    const order = { productId: 1, size: 1, side: "buy" as const, clientOrderId: "x" };
    expect(await c.placeOrder(CREDS, order)).toMatchObject({ ok: false, code: "http_502", retryable: true });
    expect(await c.placeOrder(CREDS, order)).toMatchObject({ ok: false, code: "http_200" });
    expect(await c.placeOrder(CREDS, order)).toMatchObject({ ok: false, code: "unknown", message: expect.stringContaining("socket hang up") as string });
    expect(await c.placeOrder(CREDS, order)).toMatchObject({ ok: false, code: "unknown", message: expect.stringContaining("weird") as string });
    expect(await c.placeOrder(CREDS, order)).toMatchObject({ ok: false, code: "unknown", message: expect.stringContaining("could not be read") as string });
  });

  it("product lookups fail on transport errors, expire from the cache, and marks read mark_price", async () => {
    let now = 1_700_000_000;
    let calls = 0;
    const c = new DeltaTradingClientImpl({
      baseUrl: BASE,
      nodeEnv: "test",
      minIntervalMs: 0,
      productTtlMs: 1000,
      now: () => now,
      fetch: (url: string) => {
        calls += 1;
        if (url.includes("/v2/products/DOWN")) return Promise.reject(new Error("offline"));
        if (url.includes("/v2/products/")) return json({ success: true, result: { id: 7, symbol: "X", contract_value: "0.001", contract_type: "call_options", state: "live" } });
        if (url.endsWith("/v2/tickers/HAS")) return json({ success: true, result: { mark_price: 1234.5 } });
        if (url.endsWith("/v2/tickers/NONE")) return json({ success: true, result: { mark_price: null } });
        if (url.endsWith("/v2/tickers/BAD")) return json({ success: true, result: "?" });
        if (url.endsWith("/v2/tickers/ERR")) return json({ success: false, error: { code: "not_found" } }, 404);
        return Promise.reject(new Error("offline"));
      },
    });
    await expect(c.getProduct("DOWN")).rejects.toThrow(/offline/);
    await c.getProduct("X");
    await c.getProduct("X");
    expect(calls).toBe(2);
    now += 2; // past the 1 s ttl
    await c.getProduct("X");
    expect(calls).toBe(3);
    expect(await c.getMark("HAS")).toBe("1234.5");
    expect(await c.getMark("NONE")).toBeNull();
    expect(await c.getMark("BAD")).toBeNull();
    expect(await c.getMark("ERR")).toBeNull();
    expect(await c.getMark("GONE")).toBeNull();
  });

  it("order, open-order, position and balance reads answer empty on failures and tolerate sparse venue payloads", async () => {
    const script = new Map<string, () => ReturnType<TradingFetch>>([
      ["/v2/orders/1", () => json({ success: false, error: { code: "not_found" } }, 404)],
      ["/v2/orders/2", () => json({ success: true, result: { id: "not a number" } })],
      ["/v2/orders/3", () => Promise.reject(new Error("offline"))],
      ["/v2/orders?product_ids=1&states=open,pending", () => json({ success: true, result: "?" })],
      ["/v2/orders?product_ids=2&states=open,pending", () => json({ success: false })],
      ["/v2/positions/margined", () => json({ success: true, result: [{ product_id: 1, product: { symbol: "FROM-PRODUCT" }, size: -2 }, { product_id: 2, size: 1 }] })],
      ["/v2/wallet/balances", () => json({ success: true, result: [{ asset_symbol: "USDT", balance: 55 }] })],
    ]);
    let failNext = false;
    const c = new DeltaTradingClientImpl({
      baseUrl: BASE,
      nodeEnv: "test",
      minIntervalMs: 0,
      fetch: (url: string) => {
        if (failNext) {
          failNext = false;
          return json({ success: true, result: "not a list" });
        }
        return script.get(url.slice(BASE.length))?.() ?? json({ success: false, error: { code: "nope" } }, 500);
      },
    });
    expect(await c.getOrder(CREDS, 1)).toBeNull();
    expect(await c.getOrder(CREDS, 2)).toBeNull();
    expect(await c.getOrder(CREDS, 3)).toBeNull();
    expect(await c.listOpenOrders(CREDS, [1])).toEqual([]);
    expect(await c.listOpenOrders(CREDS, [2])).toEqual([]);
    expect(await c.getPositions(CREDS)).toEqual([
      { productId: 1, symbol: "FROM-PRODUCT", size: -2, entryPrice: null, realizedPnl: null, margin: null },
      { productId: 2, symbol: null, size: 1, entryPrice: null, realizedPnl: null, margin: null },
    ]);
    expect(await c.getBalances(CREDS)).toEqual([{ asset: "USDT", balance: "55", availableBalance: "55" }]);
    failNext = true;
    await expect(c.getPositions(CREDS)).rejects.toThrow(/positions_unavailable/); // never an empty list: "could not read" is not "holds nothing"
    failNext = true;
    expect(await c.getBalances(CREDS)).toEqual([]);
    expect(await c.cancelOrder(CREDS, 9, 1)).toBe(false); // 500 from the fallback
    const down = new DeltaTradingClientImpl({ baseUrl: BASE, nodeEnv: "test", minIntervalMs: 0, fetch: () => Promise.reject(new Error("offline")) });
    await expect(down.getPositions(CREDS)).rejects.toThrow(/positions_unavailable/);
    expect(await down.getBalances(CREDS)).toEqual([]);
    const refused = new DeltaTradingClientImpl({ baseUrl: BASE, nodeEnv: "test", minIntervalMs: 0, fetch: () => json({ success: false, error: { code: "nope" } }, 500) });
    await expect(refused.getPositions(CREDS)).rejects.toThrow(/positions_unavailable/); // a 500 is not "no positions" either
  });

  it("names every documented order error and ignores a context without the margin figure", () => {
    const cases: [string, RegExp][] = [
      ["order_size_exceed_available", /exceeds/],
      ["immediate_liquidation", /liquidate/],
      ["invalid_product_id", /does not know/],
      ["open_order_limit_exceeded", /Too many open orders/],
      ["rate_limited", /rate limit/],
    ];
    for (const [code, words] of cases) expect(describeOrderError(code)).toMatch(words);
    expect(describeOrderError("insufficient_margin", { other: 1 })).not.toContain("additional margin");
    expect(describeOrderError("insufficient_margin", "text")).not.toContain("additional margin");
  });
});

describe("[VENUES] fake trading client bookkeeping", () => {
  it("marks, balances, positions, forget, contract types, default fill price, retryable failures and cancels", async () => {
    const fake = new FakeDeltaTradingClient().product("BTCUSD", 1).product("C-BTC-1", 2, "0.001", "live").product("P-BTC-1", 3).markAt("BTCUSD", "80000");
    expect((await fake.getProduct("BTCUSD")).contractType).toBe("perpetual_futures");
    expect((await fake.getProduct("C-BTC-1")).contractType).toBe("call_options");
    expect((await fake.getProduct("P-BTC-1")).contractType).toBe("put_options");
    expect(await fake.getMark("BTCUSD")).toBe("80000");
    expect(await fake.getMark("nope")).toBeNull();
    expect(await fake.getBalances()).toEqual([{ asset: "USD", balance: "10000", availableBalance: "10000" }]);
    fake.setBalances([{ asset: "BTC", balance: "1", availableBalance: "0.5" }]).setPositions([{ productId: 1, symbol: "BTCUSD", size: 3, entryPrice: "1", realizedPnl: "0", margin: "1" }]);
    expect((await fake.getBalances())[0]!.asset).toBe("BTC");
    expect((await fake.getPositions())[0]!.size).toBe(3);
    fake.positionsDown = true;
    await expect(fake.getPositions()).rejects.toThrow(/positions_unavailable/);
    fake.positionsDown = false;
    fake.forget("P-BTC-1");
    await expect(fake.getProduct("P-BTC-1")).rejects.toThrow(/not listed/);
    const filled = await fake.placeOrder(CREDS, { productId: 1, size: 1, side: "buy", clientOrderId: "a" });
    expect(filled).toMatchObject({ ok: true, order: { averageFillPrice: "100" } }); // default fill
    fake.failWith(2, "market_disrupted", { retryable: true });
    expect(await fake.placeOrder(CREDS, { productId: 2, size: 1, side: "buy", clientOrderId: "b" })).toMatchObject({ ok: false, code: "market_disrupted", retryable: true });
    expect(await fake.placeOrder(CREDS, { productId: 2, size: 1, side: "buy", clientOrderId: "b" })).toMatchObject({ ok: false }); // sticky until cleared
    fake.succeed(2);
    expect((await fake.placeOrder(CREDS, { productId: 2, size: 1, side: "buy", clientOrderId: "b2" })).ok).toBe(true); // cleared
    fake.failWith(3, "unknown");
    expect(await fake.placeOrder(CREDS, { productId: 3, size: 1, side: "buy", clientOrderId: "c" })).toMatchObject({ ok: false, code: "unknown", unknown: true });
    expect(await fake.getOrder(CREDS, 424242)).toBeNull();
    if (!filled.ok) throw new Error("expected a fill");
    expect(await fake.cancelOrder(CREDS, filled.order.id, 99)).toBe(false); // wrong product
    expect(await fake.cancelOrder(CREDS, 424242)).toBe(false);
    expect(await fake.cancelOrder(CREDS, filled.order.id)).toBe(false); // a filled order cannot be cancelled (ADR-083): the venue refuses too
    fake.fillAt(filled.order.productId, "200");
    const resting = await fake.placeOrder(CREDS, { productId: filled.order.productId, size: 1, side: "buy", clientOrderId: "r", orderType: "limit", limitPrice: "100" });
    if (!resting.ok) throw new Error("expected a resting order");
    expect(await fake.cancelOrder(CREDS, resting.order.id)).toBe(true);
    expect(fake.cancelled).toEqual([resting.order.id]);
    expect((await fake.getOrder(CREDS, resting.order.id))?.state).toBe("cancelled");
    fake.complete(424242, "1"); // unknown id: no-op
  });
});
