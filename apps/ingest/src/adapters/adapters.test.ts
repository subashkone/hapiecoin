// Venue and provider adapters against the documented response shapes (fixtures.ts), including their error paths.
import { describe, expect, it } from "vitest";
import { JsonClient } from "../http.js";
import { FakeFetch } from "../test-support/fake-fetch.js";
import { KLINE_DAYS, LAST_CLOSE, T0, WHALE_A, WHALE_B, WHALE_C, binance, bybit, coingecko, fng, healthyFetch, okx } from "../test-support/fixtures.js";
import { DeltaAdapter, parseDeltaSymbol } from "./delta.js";
import { DeribitAdapter, parseDeribitName } from "./deribit.js";
import { HyperliquidAdapter } from "./hyperliquid.js";
import { BinanceAdapter, perpSymbol } from "./binance.js";
import { BybitAdapter, BybitError } from "./bybit.js";
import { CoinGeckoAdapter, thin } from "./coingecko.js";
import { FearGreedAdapter } from "./feargreed.js";
import { OkxAdapter, OkxError, okxSwap, okxUnderlying } from "./okx.js";

const client = (f: FakeFetch) => new JsonClient({ fetch: f.fetch, sleep: () => Promise.resolve() });

describe("[INGEST] Binance adapter", () => {
  it("reads funding, open interest, the three long/short series and taker volume", async () => {
    const f = healthyFetch();
    const b = new BinanceAdapter(client(f), "https://fapi");
    expect(perpSymbol("btc")).toBe("BTCUSDT");
    const fund = await b.funding("btc");
    expect(fund).toEqual({ markPrice: 80000.5, rate: 0.0001, nextFundingAt: T0 + 8 * 3_600_000, history: [{ t: T0 - 16 * 3_600_000, v: 0.00012 }, { t: T0 - 8 * 3_600_000, v: 0.00008 }] });
    const oi = await b.openInterest("BTC");
    expect(oi.oiBase).toBe(50000.123);
    expect(oi.oiUsd).toBeCloseTo(50000.123 * 80000.5, 3);
    expect(oi.history.map((p) => p.v)).toEqual([3.9e9, 3.95e9, 4e9]);
    expect(f.calls.find((c) => c.url.includes("openInterestHist"))?.url).toContain("period=5m&limit=288");
    expect((await b.globalLongShort("BTC"))[1]).toEqual({ t: T0 - 3_600_000, ratio: 0.9, long: 0.4737, short: 0.5263 });
    expect((await b.topAccountsLongShort("BTC")).length).toBe(2);
    expect((await b.topPositionsLongShort("BTC"))[0]).toEqual({ t: T0 - 3_600_000, ratio: 1.5, long: 0.6, short: 0.4 });
    expect(await b.takerVolume("BTC")).toEqual([{ t: T0 - 7_200_000, buy: 900, sell: 1000 }, { t: T0 - 3_600_000, buy: 1100, sell: 1000 }]);
  });
  it("falls back to zero when a ratio row has neither account nor position fields", async () => {
    const f = new FakeFetch().on("/futures/data/globalLongShortAccountRatio", { body: [{ symbol: "BTCUSDT", longShortRatio: "1", timestamp: T0 }] });
    expect((await new BinanceAdapter(client(f), "https://fapi").globalLongShort("BTC"))[0]).toEqual({ t: T0, ratio: 1, long: 0, short: 0 });
  });
});

describe("[INGEST] Bybit adapter", () => {
  it("unwraps the envelope for tickers, funding history, OI history and account ratio", async () => {
    const b = new BybitAdapter(client(healthyFetch()), "https://bybit");
    expect(await b.ticker("BTC")).toEqual({ lastPrice: 80010, rate: 0.00005, nextFundingAt: T0 + 8 * 3_600_000, oiBase: 20000, oiUsd: 1_600_200_000 });
    expect(await b.fundingHistory("BTC")).toEqual([{ t: T0 - 16 * 3_600_000, v: 0.00004 }, { t: T0 - 8 * 3_600_000, v: 0.00006 }]);
    expect(await b.openInterestHistory("BTC")).toEqual([{ t: T0 - 600_000, v: 19900 }, { t: T0 - 300_000, v: 20000 }]);
    expect(await b.accountRatio("BTC")).toEqual([{ t: T0 - 7_200_000, long: 0.5, short: 0.5, ratio: 1 }, { t: T0 - 3_600_000, long: 0.55, short: 0.45, ratio: 0.55 / 0.45 }]);
    const k = await b.klines("BTC", "D", 400, "spot");
    expect(k).toHaveLength(KLINE_DAYS);
    expect(k[0]!.t).toBeLessThan(k[1]!.t);
    expect(k.at(-1)).toEqual({ t: T0, close: LAST_CLOSE });
    const book = await b.orderbook("BTC");
    expect(book.bids[0]).toEqual({ price: 79396, qty: 20 });
    expect(book.asks).toHaveLength(2);
    expect(book.ts).toBe(T0);
    await expect(new BybitAdapter(client(new FakeFetch().on("/v5/market/orderbook", { body: { retCode: 10001, retMsg: "params error", result: { a: [], b: [], ts: "1" } } })), "https://bybit").orderbook("BTC")).rejects.toBeInstanceOf(BybitError);
    await expect(new BybitAdapter(client(new FakeFetch().on("/v5/market/orderbook", { body: { retCode: 7, result: { a: [], b: [], ts: "1" } } })), "https://bybit").orderbook("BTC")).rejects.toThrow("Bybit retCode 7");
  });
  it("raises BybitError on a non-zero retCode, an empty ticker list and a zero sell ratio", async () => {
    const f = new FakeFetch().on("/v5/market/tickers", { body: { retCode: 0, result: { list: [] } } }).on("/v5/market/funding/history", { body: bybit.error }).on("/v5/market/account-ratio", { body: { retCode: 0, result: { list: [{ buyRatio: "1", sellRatio: "0", timestamp: "1" }] } } });
    const b = new BybitAdapter(client(f), "https://bybit");
    await expect(b.ticker("BTC")).rejects.toBeInstanceOf(BybitError);
    await expect(b.fundingHistory("BTC")).rejects.toThrow("params error");
    expect((await b.accountRatio("BTC"))[0]?.ratio).toBe(0);
    const noMsg = new BybitAdapter(client(new FakeFetch().on("/v5/market/funding/history", { body: { retCode: 5, result: { list: [] } } })), "https://bybit");
    await expect(noMsg.fundingHistory("BTC")).rejects.toThrow("Bybit retCode 5");
  });
});

describe("[INGEST] Deribit and Delta option adapters", () => {
  it("parses instrument names and keeps only options with a parseable name", async () => {
    expect(parseDeribitName("BTC-25SEP26-105000-C")).toEqual({ name: "BTC-25SEP26-105000-C", base: "BTC", expiry: Date.UTC(2026, 8, 25, 8), label: "25SEP26", strike: 105000, type: "call" });
    expect(parseDeribitName("XRP-9SEP26-0d5-P")?.strike).toBe(0.5);
    expect(parseDeribitName("BTC-PERPETUAL")).toBeNull();
    expect(parseDeribitName("BTC-25XXX26-1000-C")).toBeNull();
    expect(parseDeltaSymbol("P-BTC-97000-271126")).toEqual({ name: "P-BTC-97000-271126", base: "BTC", expiry: Date.UTC(2026, 10, 27, 12), label: "271126", strike: 97000, type: "put" });
    expect(parseDeltaSymbol("C-ETH-2500.5-090926")?.strike).toBe(2500.5);
    expect(parseDeltaSymbol("BTCUSD")).toBeNull();
    expect(parseDeltaSymbol("C-BTC-1-011326")).toBeNull(); // month 13
    const d = await new DeribitAdapter(client(healthyFetch()), "https://deribit/api/v2").options("btc");
    expect(d).toHaveLength(7);
    expect(d[0]).toMatchObject({ strike: 70000, type: "put", oi: 100, volumeUsd: 1000, underlyingPrice: 80000 });
    expect(d[5]).toMatchObject({ strike: 110000, oi: 0, volumeUsd: 0, underlyingPrice: null }); // sparse row
    const dl = await new DeltaAdapter(client(healthyFetch()), "https://delta").options("btc");
    expect(dl).toHaveLength(3);
    expect(dl[2]).toMatchObject({ strike: 90000, oi: 0, volumeUsd: 0, underlyingPrice: null });
    expect(dl[1]).toMatchObject({ strike: 75000, type: "put", oi: 0.5, volumeUsd: 100, underlyingPrice: 80100 });
  });
});

describe("[INGEST] Hyperliquid adapter", () => {
  it("ranks the leaderboard, maps positions (sign → side, zero and priceless rows skipped) and reads mark prices", async () => {
    const h = new HyperliquidAdapter({ http: client(healthyFetch()), baseUrl: "https://hl/", leaderboardUrl: "https://hl-stats/Mainnet/leaderboard" });
    expect(await h.leaderboard(2)).toEqual([WHALE_A, WHALE_B]);
    expect(await h.leaderboard(10)).toEqual([WHALE_A, WHALE_B, WHALE_C]);
    const ps = await h.positions(WHALE_A);
    expect(ps).toHaveLength(2);
    expect(ps[0]).toMatchObject({ wallet: WHALE_A, coin: "BTC", side: "short", size: 2024.7, notionalUsd: 160803631.77, entryPx: 72155.2, markPx: null, liquidationPx: 127257.09, leverage: 5, leverageType: "cross", marginUsed: 32160726.35 });
    expect(ps[1]).toMatchObject({ coin: "ETH", side: "long", liquidationPx: null, leverage: 3, leverageType: "isolated" });
    expect(await h.positions(WHALE_B)).toEqual([]);
    const marks = await h.markPrices();
    expect([...marks.entries()]).toEqual([["BTC", 79470], ["ETH", 3000.5]]);
    const bare = new HyperliquidAdapter({ http: client(new FakeFetch().on("/info", { body: { assetPositions: [{ position: { coin: "X", szi: "1", entryPx: "2", positionValue: "2" } }] } })), baseUrl: "https://hl", leaderboardUrl: "https://hl-stats/x" });
    expect((await bare.positions(WHALE_C))[0]).toMatchObject({ leverage: 1, leverageType: "cross", marginUsed: 0, unrealizedPnl: 0, liquidationPx: null });
  });
});

describe("[INGEST] OKX adapter", () => {
  it("reads funding with the predicted rate, open interest with the rubik history, long/short, last price and liquidations", async () => {
    const o = new OkxAdapter(client(healthyFetch()), "https://okx");
    expect(okxSwap("btc")).toBe("BTC-USDT-SWAP");
    expect(okxUnderlying("btc")).toBe("BTC-USDT");
    const fund = await o.funding("BTC");
    expect(fund).toEqual({ rate: 0.00009, predicted: 0.00011, nextFundingAt: T0 + 8 * 3_600_000, history: [{ t: T0 - 16 * 3_600_000, v: 0.00012 }, { t: T0 - 8 * 3_600_000, v: 0.0001 }] });
    const oi = await o.openInterest("BTC");
    expect(oi).toEqual({ oiBase: 10000, oiUsd: 8e8, history: [{ t: T0 - 600_000, v: 7.8e8 }, { t: T0 - 300_000, v: 7.9e8 }] });
    const ls = await o.longShortRatio("BTC");
    expect(ls.map((p) => p.ratio)).toEqual([1.1, 1.3]);
    expect(ls[0]!.long + ls[0]!.short).toBeCloseTo(1, 9);
    expect(await o.lastPrice("BTC")).toBe(80005);
    const liq = await o.liquidations("BTC");
    expect(liq).toEqual([
      { t: T0 - 60_000, venue: "okx", symbol: "BTC", side: "long", price: 79000, qty: 2, usd: 158000 },
      { t: T0 - 120_000, venue: "okx", symbol: "BTC", side: "short", price: 81000, qty: 1, usd: 81000 },
      { t: T0 - 180_000, venue: "okx", symbol: "BTC", side: "long", price: 78000, qty: 0.5, usd: 39000 },
    ]);
  });
  it("handles a blank predicted rate, error codes and empty lists", async () => {
    const f = new FakeFetch().on("/api/v5/public/funding-rate", { body: okx.fundingNoPredicted }).on("/api/v5/public/funding-rate-history", { body: okx.fundingHistory }).on("/api/v5/public/open-interest", { body: okx.empty }).on("/api/v5/rubik/stat/contracts/open-interest-volume", { body: okx.oiVolume }).on("/api/v5/market/ticker", { body: okx.error });
    const o = new OkxAdapter(client(f), "https://okx");
    expect((await o.funding("BTC")).predicted).toBeNull();
    await expect(o.openInterest("BTC")).rejects.toThrow("no open interest");
    await expect(o.lastPrice("BTC")).rejects.toBeInstanceOf(OkxError);
    const f2 = new FakeFetch().on("/api/v5/public/funding-rate", { body: okx.empty }).on("/api/v5/public/funding-rate-history", { body: okx.empty }).on("/api/v5/market/ticker", { body: okx.empty }).on("/api/v5/public/open-interest", { body: { code: "1", data: [] } }).on("/api/v5/rubik/stat/contracts/open-interest-volume", { body: okx.empty });
    const o2 = new OkxAdapter(client(f2), "https://okx");
    await expect(o2.funding("BTC")).rejects.toThrow("no funding");
    await expect(o2.lastPrice("BTC")).rejects.toThrow("no ticker");
    await expect(o2.openInterest("BTC")).rejects.toThrow("OKX code 1");
  });
});

describe("[INGEST] CoinGecko adapter", () => {
  it("maps markets and global data, skips odd symbols and null prices, thins sparklines and sends the demo key", async () => {
    const f = healthyFetch();
    const g = new CoinGeckoAdapter(client(f), "https://cg/api/v3", "demo-key-123");
    const m = await g.markets(50);
    expect(m.rows.map((r) => r.symbol)).toEqual(["BTC", "ETH"]);
    expect(m.rows[0]).toMatchObject({ rank: 1, name: "Bitcoin", price: 80000, change1h: 0.1, change24h: -1.2, change7d: 3.4, marketCap: 1.6e12, volume24h: 3e10 });
    expect(m.rows[0]?.sparkline7d).toHaveLength(40);
    expect(m.rows[1]?.sparkline7d).toEqual([]);
    expect(m.rows[1]?.change1h).toBeNull();
    expect(m.global).toEqual({ totalMarketCap: 2.9e12, volume24h: 9e10, btcDominance: 55.1, ethDominance: 12.4 });
    expect(f.calls[0]?.headers["x-cg-demo-api-key"]).toBe("demo-key-123");
    expect(f.calls[0]?.url).toContain("per_page=50");
    expect(await g.exchangePrice("gdax", "bitcoin", "BTC", "USD")).toBe(80050);
    expect(await g.exchangePrice("binance", "bitcoin", "BTC", "USDT")).toBe(80000);
    await expect(g.exchangePrice("binance", "bitcoin", "BTC", "BUSD")).rejects.toThrow("no BTC/BUSD ticker on binance");
    expect(thin([1, null, 3, 4, 5], 3)).toEqual([1, 4, 5]);
    expect(thin([1, 2], 3)).toEqual([1, 2]);
  });
  it("tolerates a global payload without the optional maps and a coin without a rank", async () => {
    const f = new FakeFetch().on("/api/v3/coins/markets", { body: [{ ...coingecko.markets[1], market_cap_rank: null }] }).on("/api/v3/global", { body: { data: {} } });
    const m = await new CoinGeckoAdapter(client(f), "https://cg/api/v3", "k").markets();
    expect(m.rows[0]?.rank).toBe(1);
    expect(m.global).toEqual({ totalMarketCap: null, volume24h: null, btcDominance: null, ethDominance: null });
  });
});

describe("[INGEST] Fear & Greed adapter", () => {
  it("orders the history oldest first and picks the newest as latest with its label", async () => {
    const a = new FearGreedAdapter(client(healthyFetch()), "https://alt/fng/");
    const d = await a.history();
    expect(d.points).toEqual([{ t: (Math.floor(T0 / 1000) - 86_400) * 1000, v: 60 }, { t: Math.floor(T0 / 1000) * 1000, v: 42 }]);
    expect(d.latest).toEqual({ value: 42, label: "Fear", at: Math.floor(T0 / 1000) * 1000 });
  });
  it("labels from the value when the provider omits the classification, and fails on an empty history", async () => {
    const f = new FakeFetch().on("/fng/", { body: { data: [{ value: "80", timestamp: "1000" }] } });
    expect((await new FearGreedAdapter(client(f), "https://alt/fng/").history()).latest.label).toBe("Extreme Greed");
    const empty = new FakeFetch().on("/fng/", { body: { ...fng, data: [] } });
    await expect(new FearGreedAdapter(client(empty), "https://alt/fng/").history()).rejects.toThrow("empty history");
    expect(binance.premiumIndex.symbol).toBe("BTCUSDT"); // fixtures stay importable
  });
});
