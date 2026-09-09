import { describe, expect, it } from "vitest";
import { ConfigError, loadConfig } from "./config.js";

describe("[INGEST] config", () => {
  it("applies defaults, parses the symbol list and ignores empty strings", () => {
    const c = loadConfig({ REDIS_URL: "", COINGECKO_API_KEY: "" });
    expect(c.INGEST_PORT).toBe(3003);
    expect(c.REDIS_URL).toBeUndefined();
    expect(c.COINGECKO_API_KEY).toBeUndefined();
    expect(c.ANALYTICS_SYMBOLS).toEqual(["BTC", "ETH", "SOL", "XRP", "BNB", "DOGE", "ADA", "AVAX", "LINK", "LTC"]);
    expect(c.DERIVATIVES_REFRESH_MS).toBe(60_000);
    expect(c.BYBIT_WS_URL).toBe("wss://stream.bybit.com/v5/public/linear");
    expect(c.OPTIONS_SYMBOLS).toEqual(["BTC", "ETH"]);
    expect(loadConfig({ OPTIONS_SYMBOLS: "btc" }).OPTIONS_SYMBOLS).toEqual(["BTC"]);
    expect(c.CYCLE_REFRESH_MS).toBe(3_600_000);
    expect(c.WHALE_WALLETS).toEqual([]);
    expect(c.WHALE_CANDIDATES).toBe(200);
    expect(loadConfig({ WHALE_WALLETS: " 0x5B5D51203A0F9079F8AEB098A6523A13F298C060 ,, " }).WHALE_WALLETS).toEqual(["0x5b5d51203a0f9079f8aeb098a6523a13f298c060"]);
    expect(() => loadConfig({ WHALE_WALLETS: "nope" })).toThrow(ConfigError);
    expect(loadConfig({ ANALYTICS_SYMBOLS: " btc, eth ,, sol " }).ANALYTICS_SYMBOLS).toEqual(["BTC", "ETH", "SOL"]);
  });
  it("lists every problem", () => {
    expect(() => loadConfig({ INGEST_PORT: "70000", REDIS_URL: "http://nope", ANALYTICS_SYMBOLS: "b" })).toThrow(ConfigError);
    try {
      loadConfig({ INGEST_PORT: "70000", ANALYTICS_SYMBOLS: "b" });
    } catch (e) {
      const err = e as ConfigError;
      expect(err.issues.length).toBeGreaterThanOrEqual(2);
      expect(err.message).toContain("INGEST_PORT");
    }
  });
});
