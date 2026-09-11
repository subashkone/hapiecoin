import { describe, expect, it } from "vitest";
import { DeribitMarketData } from "../deribit/market-data.js";
import { InvalidSymbolError } from "../errors.js";
import type { FetchLike } from "../http.js";
import { FakeWebSocket } from "../test-support/fake-ws.js";
import { loadDeribitBookSummaryFixture, loadDeribitInstrumentsFixture, loadDeribitTickerFixture } from "../test-support/fixtures.js";
import { VenueCapabilityError, marketOf, tradingClientOf } from "./adapter.js";
import { DEFAULT_VENUE, VENUE_CORES, getVenueCore } from "./core.js";
import { DERIBIT, deribitRest } from "./deribit-clients.js";
import { DERIBIT_CORE, DERIBIT_MARKETS, deribitLabelToExpiryCode, deribitMarket } from "./deribit.js";
import { VENUE_REGISTRY, getVenue } from "./registry.js";

const fetchFixtures: FetchLike = (input) => {
  const url = new URL(input);
  const btc = url.searchParams.get("currency") === "BTC";
  const none = { jsonrpc: "2.0", result: [] };
  const first = (loadDeribitInstrumentsFixture() as { result: Record<string, unknown>[] }).result[0]!;
  const perpetual = { ...first, instrument_name: "BTC-PERPETUAL", instrument_id: 1, kind: "future", settlement_period: "perpetual", option_type: undefined, strike: undefined };
  let body: unknown;
  if (url.pathname.endsWith("get_instruments")) body = !btc ? none : url.searchParams.get("kind") === "future" ? { jsonrpc: "2.0", result: [perpetual] } : loadDeribitInstrumentsFixture();
  else if (url.pathname.endsWith("/ticker")) body = { jsonrpc: "2.0", result: { ...(loadDeribitTickerFixture() as { result: object }).result, instrument_name: url.searchParams.get("instrument_name") } };
  else body = btc ? loadDeribitBookSummaryFixture() : none;
  return Promise.resolve({ status: 200, headers: { get: () => null }, text: () => Promise.resolve(JSON.stringify(body)) });
};

describe("HC-SH-122 [VENUES] Deribit behind the port, data-only (ADR-067)", () => {
  it("is registered beside Delta India, stays off the default, and refuses a trading client", () => {
    expect(getVenue("deribit")).toBe(DERIBIT);
    expect(getVenueCore("deribit")).toBe(DERIBIT_CORE);
    expect(Object.keys(VENUE_REGISTRY)).toEqual(Object.keys(VENUE_CORES));
    expect(DEFAULT_VENUE).toBe("delta_india");
    expect(DERIBIT.trading).toBeUndefined();
    expect(() => tradingClientOf(DERIBIT, { baseUrl: "https://x" })).toThrowError(VenueCapabilityError);
    expect(DERIBIT.capabilities).toEqual({ options: true, perpetuals: true, liveTrading: false, greeksFromVenue: true, oiInCompactTicker: true, spotFallback: null });
    for (const key of Object.keys(DERIBIT_CORE) as (keyof typeof DERIBIT_CORE)[]) expect(DERIBIT[key]).toBe(DERIBIT_CORE[key]);
  });

  it("describes inverse coin contracts in USD terms: one coin per contract, 0.1 lots, coin ticks, 08:00 UTC, zero fees", () => {
    expect(DERIBIT_CORE.underlyings).toEqual(["BTC", "ETH"]);
    expect(marketOf(DERIBIT_CORE, "BTC")).toEqual({ underlying: "BTC", quoteCcy: "USD", settleCcy: "BTC", multiplier: "1", lotSize: "0.1", tickSize: "0.0001", exerciseStyle: "european", settlementHourUtc: 8, timezone: "UTC", isInverse: true, perpetualSymbol: "BTC-PERPETUAL" });
    expect(DERIBIT_MARKETS.ETH?.tickSize).toBe("0.0005");
    expect(deribitMarket("XAUT")).toBeUndefined();
    expect(() => marketOf(DERIBIT_CORE, "XAUT")).toThrowError(VenueCapabilityError);
    expect(DERIBIT_CORE.fees).toEqual({ feePct: "0", gstPct: "0", feeCapPct: "0", basis: "spot-notional" });
    expect(DERIBIT_CORE.calendar.settlementHourUtc("BTC")).toBe(8);
    expect(DERIBIT_CORE.calendar.settlementHourUtc("ETH")).toBe(8);
    expect(DERIBIT_CORE.calendar.expirySettlementIso("250926", "BTC")).toBe("2026-09-25T08:00:00.000Z");
  });

  it("codec: venue names in and out, the perpetual, and the label helper", () => {
    const s = DERIBIT_CORE.symbols;
    expect(s.isOption("BTC-25SEP26-80000-C")).toBe(true);
    expect(s.parseOption("BTC-25SEP26-80000-C")).toEqual({ kind: "call", underlying: "BTC", strike: "80000", expiryCode: "250926", expiryDate: "2026-09-25" });
    expect(s.formatOption("put", "ETH", "4200", "2026-10-30")).toBe("ETH-30OCT26-4200-P");
    expect(s.perpetual("ETH")).toBe("ETH-PERPETUAL");
    expect(s.parsePerpetual("ETH-PERPETUAL")).toBe("ETH");
    expect(deribitLabelToExpiryCode("25SEP26")).toBe("250926");
    expect(deribitLabelToExpiryCode("2OCT26")).toBe("021026");
    expect(deribitLabelToExpiryCode("02OCT26")).toBe("021026"); // a padded day is read too
    expect(() => deribitLabelToExpiryCode("nope")).toThrowError(InvalidSymbolError);
    expect(DERIBIT_CORE.schema.instrumentId("BTC-25SEP26-80000-C")).toBe("deribit:BTC-25SEP26-80000-C");
  });

  it("the REST factory serves live options and their seeded quotes per underlying; the market-data factory builds a session", async () => {
    const rest = deribitRest({ baseUrl: "https://www.deribit.com/api/v2", fetch: fetchFixtures, now: () => 7 });
    const products = await rest.products();
    expect(products).toHaveLength(950);
    expect(products.every((p) => p.venue === "deribit")).toBe(true);
    const quotes = await rest.tickers("BTC");
    expect(quotes).toHaveLength(950);
    expect(quotes[0]?.receivedAt).toBe(7);
    expect(await rest.tickers("ETH")).toEqual([]);
    const withPerpetual = await rest.tickers("BTC", { perpetuals: true });
    expect(withPerpetual).toHaveLength(quotes.length + 1);
    expect(withPerpetual.at(-1)?.symbol).toBe("BTC-PERPETUAL");
    expect(await rest.tickers("XAUT")).toEqual([]); // not a Deribit market: no request, no envelope error
    const md = DERIBIT.marketData({ restUrl: "https://www.deribit.com/api/v2", wsUrl: "wss://ws.example.test", fetch: fetchFixtures, WebSocket: FakeWebSocket, channel: "agg2" });
    expect(md).toBeInstanceOf(DeribitMarketData);
    expect((md as DeribitMarketData).ws.interval).toBe("agg2");
  });
});
