import { describe, expect, it } from "vitest";
import { BinanceAdapter } from "./adapters/binance.js";
import { BybitAdapter } from "./adapters/bybit.js";
import { CoinGeckoAdapter } from "./adapters/coingecko.js";
import { DeltaAdapter } from "./adapters/delta.js";
import { DeribitAdapter } from "./adapters/deribit.js";
import { FearGreedAdapter } from "./adapters/feargreed.js";
import { OkxAdapter } from "./adapters/okx.js";
import { JsonClient } from "./http.js";
import { type Adapters, type JobContext, NoVenueError, buildCycle, buildFearGreed, buildFunding, buildLiquidations, buildLongShort, buildMarkets, buildOpenInterest, buildOptions, buildPremium, buildRsi, buildTakerVolume, sumSeries, toError, weightedSeries } from "./jobs.js";
import { MemoryStore } from "./store.js";
import { LiquidationBuffer } from "./liquidations.js";
import { FakeFetch } from "./test-support/fake-fetch.js";
import { KLINE_DAYS, LAST_CLOSE, T0, bybit, delta, deribit, healthyFetch, okx } from "./test-support/fixtures.js";

function adapters(f: FakeFetch, coingecko = true): Adapters {
  const c = new JsonClient({ fetch: f.fetch, sleep: () => Promise.resolve() });
  return { binance: new BinanceAdapter(c, "https://fapi"), bybit: new BybitAdapter(c, "https://bybit"), okx: new OkxAdapter(c, "https://okx"), coingecko: coingecko ? new CoinGeckoAdapter(c, "https://cg/api/v3", "k") : null, fearGreed: new FearGreedAdapter(c, "https://alt/fng/"), deribit: new DeribitAdapter(c, "https://deribit/api/v2"), delta: new DeltaAdapter(c, "https://delta") };
}
const ctx = (f: FakeFetch, coingecko = true): JobContext => ({ adapters: adapters(f, coingecko), now: () => T0, ttlMs: 60_000 });

describe("[INGEST] series maths", () => {
  it("sums per-venue series on a grid, carrying the last value of a venue that misses a bucket", () => {
    const out = sumSeries([{ points: [{ t: 0, v: 1 }, { t: 100, v: 2 }] }, { points: [{ t: 0, v: 10 }, { t: 200, v: 20 }] }], 100);
    expect(out).toEqual([{ t: 0, v: 11 }, { t: 100, v: 12 }, { t: 200, v: 22 }]);
    expect(sumSeries([], 100)).toEqual([]);
  });
  it("weights per bucket by the venues present", () => {
    const out = weightedSeries([{ points: [{ t: 0, v: 0.1 }, { t: 100, v: 0.3 }], weight: 3 }, { points: [{ t: 0, v: 0.5 }], weight: 1 }], 100);
    expect(out[0]?.v).toBeCloseTo(0.2, 9);
    expect(out[1]?.v).toBeCloseTo(0.3, 9);
    expect(weightedSeries([{ points: [{ t: 0, v: 1 }], weight: 0 }], 100)).toEqual([{ t: 0, v: 0 }]);
  });
});

describe("[INGEST] dataset builders", () => {
  it("funding aggregates three venues with an OI-weighted series", async () => {
    const s = await buildFunding(ctx(healthyFetch()), "btc");
    if (s.dataset !== "funding") throw new Error("wrong dataset");
    expect(s.key).toBe("funding:BTC");
    expect(s.source).toBe("Binance · Bybit · OKX");
    expect(s.data.venues.map((v) => v.venue)).toEqual(["binance", "bybit", "okx"]);
    expect(s.data.venues[2]).toMatchObject({ predicted: 0.00011, oiUsd: 8e8 });
    expect(s.data.venues[0]?.apr).toBeCloseTo(0.1095, 6);
    expect(s.data.oiWeighted.length).toBeGreaterThan(0);
    expect(s.asOf).toBe(T0);
  });
  it("leaves a failing venue out and fails only when every venue fails", async () => {
    const f = healthyFetch().on("/v5/market/tickers", { status: 500, text: "down" });
    const s = await buildFunding(ctx(f), "BTC");
    expect(s.source).toBe("Binance · OKX");
    const dead = new FakeFetch();
    await expect(buildFunding(ctx(dead), "BTC")).rejects.toBeInstanceOf(NoVenueError);
    await expect(buildOpenInterest(ctx(dead), "BTC")).rejects.toThrow(/every venue failed/);
    const strRejecting = adapters(healthyFetch());
    // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- non-Error rejections must be wrapped
    Object.assign(strRejecting.binance, { funding: () => Promise.reject("plain string") });
    const wrapped = await buildFunding({ adapters: strRejecting, now: () => T0, ttlMs: 1 }, "BTC");
    expect(wrapped.source).toBe("Bybit · OKX");
    const f2 = healthyFetch().on("/v5/market/tickers", { body: { retCode: 0, result: { list: [{ symbol: "BTCUSDT", lastPrice: "1", fundingRate: "0", nextFundingTime: "0", openInterest: "0", openInterestValue: "0" }] } } });
    const zeroWeight = await buildFunding(ctx(f2), "BTC");
    expect(zeroWeight.source).toContain("Bybit"); // oiUsd 0 → weight 1 fallback
  });
  it("open interest sums venues, computes 1 h / 24 h changes from history and aggregates", async () => {
    const s = await buildOpenInterest(ctx(healthyFetch()), "BTC");
    if (s.dataset !== "open-interest") throw new Error("wrong dataset");
    expect(s.data.totalUsd).toBeCloseTo(50000.123 * 80000.5 + 1_600_200_000 + 8e8, 0);
    const binance = s.data.venues.find((v) => v.venue === "binance")!;
    expect(binance.change1h).toBeCloseTo(50000.123 * 80000.5 / 3.95e9 - 1, 9);
    expect(binance.change24h).toBeCloseTo(50000.123 * 80000.5 / 3.9e9 - 1, 9);
    const bybit = s.data.venues.find((v) => v.venue === "bybit")!;
    expect(bybit.change24h).toBeNull(); // no point old enough
    expect(s.data.aggregated.length).toBeGreaterThan(0);
    const zero = healthyFetch().on("/futures/data/openInterestHist", { body: [{ symbol: "BTCUSDT", sumOpenInterest: "0", sumOpenInterestValue: "0", timestamp: T0 - 2 * 3_600_000 }] });
    const z = await buildOpenInterest(ctx(zero), "BTC");
    if (z.dataset !== "open-interest") throw new Error("wrong dataset");
    expect(z.data.venues.find((v) => v.venue === "binance")?.change1h).toBeNull(); // past value 0 → no ratio
  });
  it("long/short falls back to Bybit's account ratio when Binance is unreachable, and fails only when both do", async () => {
    const blocked = healthyFetch().on("/futures/data/globalLongShortAccountRatio", { status: 500, text: "reset" });
    const s = await buildLongShort(ctx(blocked), "BTC");
    if (s.dataset !== "long-short") throw new Error("wrong dataset");
    expect(s.source).toBe("Bybit");
    expect(s.data.venue).toBe("bybit");
    expect(s.data.global).toHaveLength(2);
    expect(s.data.latest.global).toMatchObject({ long: 0.55, short: 0.45 }); // newest fixture row
    expect(s.data.latest.global.ratio).toBeCloseTo(0.55 / 0.45, 9);
    expect(s.data.topAccounts).toEqual([]);
    expect(s.data.latest.topPositions).toEqual({ long: 0, short: 0, ratio: 0 });
    const both = blocked.on("/v5/market/account-ratio", { body: bybit.error });
    await expect(buildLongShort(ctx(both), "BTC")).rejects.toThrow(/long-short: every venue failed/);
  });
  it("long/short and taker volume come from Binance", async () => {
    const ls = await buildLongShort(ctx(healthyFetch()), "BTC");
    if (ls.dataset !== "long-short") throw new Error("wrong dataset");
    expect(ls.data.latest.global).toEqual({ long: 0.4737, short: 0.5263, ratio: 0.9 });
    expect(ls.data.latest.topPositions.ratio).toBe(1.5);
    expect(ls.data.global).toHaveLength(2);
    const empty = healthyFetch().on("/futures/data/globalLongShortAccountRatio", { body: [] });
    const e = await buildLongShort(ctx(empty), "BTC");
    if (e.dataset !== "long-short") throw new Error("wrong dataset");
    expect(e.data.latest.global).toEqual({ long: 0, short: 0, ratio: 0 });
    const tv = await buildTakerVolume(ctx(healthyFetch()), "BTC");
    if (tv.dataset !== "taker-volume") throw new Error("wrong dataset");
    expect(tv.data.points).toHaveLength(2);
  });
  it("markets needs the CoinGecko key; fear & greed reads alternative.me", async () => {
    await expect(buildMarkets(ctx(healthyFetch(), false))).rejects.toThrow("COINGECKO_API_KEY");
    const m = await buildMarkets(ctx(healthyFetch()));
    if (m.dataset !== "markets") throw new Error("wrong dataset");
    expect(m.data.rows[0]?.symbol).toBe("BTC");
    expect(m.source).toBe("CoinGecko");
    const g = await buildFearGreed(ctx(healthyFetch()));
    if (g.dataset !== "fear-greed") throw new Error("wrong dataset");
    expect(g.data.latest.value).toBe(42);
  });
  it("liquidations polls OKX into the buffer and reports which venues feed it", async () => {
    const buffer = new LiquidationBuffer({ now: () => T0 });
    const s = await buildLiquidations(ctx(healthyFetch()), ["BTC", "ETH"], buffer, { binance: true });
    if (s.dataset !== "liquidations") throw new Error("wrong dataset");
    expect(s.source).toBe("Binance · OKX");
    expect((await buildLiquidations(ctx(healthyFetch()), ["BTC"], buffer, { binance: true, bybit: true })).source).toBe("Binance · Bybit · OKX");
    expect(s.stale).toBe(false);
    expect(s.data.recent).toHaveLength(6); // both symbols get the same three-fill fixture
    const again = await buildLiquidations(ctx(healthyFetch()), ["BTC"], buffer, {});
    expect(again.source).toBe("OKX");
    expect(buffer.size()).toBe(6); // re-poll deduped
    const none = await buildLiquidations(ctx(new FakeFetch().on("/api/v5/public/liquidation-orders", { body: okx.error })), ["BTC"], new LiquidationBuffer(), { bybit: false });
    expect(none.source).toBe("no venue connected");
    expect(none.stale).toBe(true);
  });
  it("options: per-expiry OI and max pain per venue, expired and non-option rows skipped, one venue may fail", async () => {
    const s = await buildOptions(ctx(healthyFetch()), "BTC");
    if (s.dataset !== "options") throw new Error("wrong dataset");
    expect(s.source).toBe("Deribit · Delta India");
    const d = s.data.venues.find((v) => v.venue === "deribit")!;
    expect(d.instruments).toBe(6);
    expect(d.expiries.map((e) => e.label)).toEqual(["25SEP26", "30OCT26"]);
    expect(d.expiries[0]).toMatchObject({ callOi: 500, putOi: 150, strikes: 3, maxPain: 80000 });
    expect(d.expiries[0]?.expiry).toBe(Date.UTC(2026, 8, 25, 8));
    expect(d.oiBase).toBe(660);
    expect(d.oiUsd).toBe(660 * 80000);
    expect(d.volume24hUsd).toBe(6500);
    expect(d.putCallOi).toBeCloseTo(150 / 510, 9);
    const dl = s.data.venues.find((v) => v.venue === "delta")!;
    expect(dl).toMatchObject({ instruments: 3, oiBase: 2, underlyingPrice: 80100, putCallOi: 0.5 / 1.5 });
    expect(toError("boom").message).toBe("boom");
    expect(toError(new Error("kept"))).toBeInstanceOf(Error);
    expect(dl.expiries[0]?.expiry).toBe(Date.UTC(2026, 8, 25, 12));
    const oneDown = await buildOptions(ctx(healthyFetch().on("/v2/tickers", { status: 500, text: "down" })), "BTC");
    expect(oneDown.source).toBe("Deribit");
    const noPrice = healthyFetch().on("/api/v2/public/get_book_summary_by_currency", { body: { result: [{ instrument_name: "BTC-25SEP26-80000-C", open_interest: 1, volume_usd: 0, underlying_price: null }] } }).on("/v2/tickers", { body: delta.error });
    await expect(buildOptions(ctx(noPrice), "BTC")).rejects.toThrow(/options: every venue failed.*no underlying price/);
    const puts = await buildOptions(ctx(healthyFetch().on("/api/v2/public/get_book_summary_by_currency", { body: { result: [{ instrument_name: "ETH-25SEP26-3000-P", open_interest: 1, volume_usd: 0, underlying_price: 3000 }] } }).on("/v2/tickers", { body: delta.error })), "ETH");
    if (puts.dataset !== "options") throw new Error("wrong dataset");
    expect(puts.data.venues[0]?.putCallOi).toBeNull();
    expect(deribit.empty.result).toEqual([]);
  });
  it("cycle: averages need history, the fit covers every close; rsi per timeframe; premium keeps its own history", async () => {
    const c = await buildCycle(ctx(healthyFetch()));
    if (c.dataset !== "cycle") throw new Error("wrong dataset");
    expect(c.data.points).toHaveLength(KLINE_DAYS);
    expect(c.data.points.at(-1)?.close).toBe(LAST_CLOSE);
    expect(c.data.points[0]?.ma111).toBeNull();
    expect(c.data.points.at(-1)?.ma111).toBeGreaterThan(0);
    expect(c.data.points.at(-1)?.ma350x2).toBeGreaterThan(c.data.points.at(-1)!.ma111!);
    expect(c.data.points.at(-1)?.ma2y).toBeNull();
    expect(c.data.points.at(-1)?.ma2yX5).toBeNull();
    expect(c.data.points.at(-1)?.fit).toBeGreaterThan(100);
    expect(c.data.windowDays).toBe(KLINE_DAYS);
    await expect(buildCycle(ctx(healthyFetch().on("/v5/market/kline", { body: { retCode: 0, result: { list: [] } } })))).rejects.toThrow(/only 0 daily closes/);
    const r = await buildRsi(ctx(healthyFetch()), ["BTC", "ETH"]);
    if (r.dataset !== "rsi") throw new Error("wrong dataset");
    expect(r.data.rows).toHaveLength(2);
    expect(r.data.rows[0]?.rsi["1w"]).toBe(100); // climbing closes
    expect(r.data.rows[0]?.price).toBe(LAST_CLOSE);
    await expect(buildRsi(ctx(healthyFetch().on("/v5/market/kline", { body: bybit.error })), ["BTC"])).rejects.toBeInstanceOf(NoVenueError);
    await expect(buildRsi(ctx(healthyFetch().on("/v5/market/kline", { body: { retCode: 0, result: { list: [] } } })), ["BTC"])).rejects.toThrow(/rsi: every venue failed/); // no candles → no row
    const store = new MemoryStore();
    const p = await buildPremium(ctx(healthyFetch()), store);
    if (p.dataset !== "premium") throw new Error("wrong dataset");
    expect(p.data).toMatchObject({ coinbaseUsd: 80050, binanceUsd: 80000, premiumUsd: 50 });
    expect(p.data.points).toEqual([{ t: Math.floor(T0 / 3_600_000) * 3_600_000, v: 50 }]);
    const again = await buildPremium(ctx(healthyFetch()), store);
    expect(again.dataset === "premium" ? again.data.points : []).toHaveLength(1); // same hour overwrites
    await expect(buildPremium(ctx(healthyFetch(), false), store)).rejects.toThrow("COINGECKO_API_KEY");
    await expect(buildPremium(ctx(healthyFetch().on("/api/v3/exchanges/gdax/tickers", { body: { tickers: [] } })), store)).rejects.toThrow(/no BTC\/USD ticker on gdax/);
  });
  it("rejects a snapshot that fails the schema", async () => {
    const bad = healthyFetch().on("/fng/", { body: { data: [{ value: "50", timestamp: "-1" }] } });
    await expect(buildFearGreed(ctx(bad))).rejects.toThrow(/failed validation/);
  });
});
