import { UNDERLYINGS } from "@hapiecoin/schema";
import { describe, expect, it } from "vitest";
import { toInstrument, toQuote } from "../delta/normalize.js";
import { RawProductsResponse, RawTickersResponse } from "../delta/raw.js";
import type { FetchLike } from "../delta/rest.js";
import { DeltaRestClient } from "../delta/rest.js";
import { DeltaTradingClientImpl } from "../delta/trading.js";
import type { TradingFetch } from "../delta/trading.js";
import { InvalidSymbolError } from "../errors.js";
import { SchemaAdapterError, isSchemaInstrument, toSchemaChainSnapshot, toSchemaInstrument } from "../schema-adapter.js";
import { FakeWebSocket } from "../test-support/fake-ws.js";
import { loadProductsFixture, loadTickersFixture } from "../test-support/fixtures.js";
import { UnknownVenueError, VenueCapabilityError, defaultLotSizes, marketOf, ownMarket, tradingClientOf } from "./adapter.js";
import type { VenueAdapter } from "./adapter.js";
import { DELTA_INDIA, DELTA_INDIA_MARKETS, formatDeltaOption } from "./delta-india.js";
import { DEFAULT_VENUE, VENUE_REGISTRY, getVenue, listVenues } from "./registry.js";

const products = RawProductsResponse.parse(loadProductsFixture()).result;
const tickers = RawTickersResponse.parse(loadTickersFixture()).result;
const options = products.filter((p) => p.contract_type === "call_options" || p.contract_type === "put_options");

describe("HC-SH-118 [VENUES] registry", () => {
  it("lists Delta India under its schema id and resolves the default venue", () => {
    expect(Object.keys(VENUE_REGISTRY)).toEqual(["delta_india"]);
    expect(DEFAULT_VENUE).toBe("delta_india");
    expect(getVenue(DEFAULT_VENUE)).toBe(DELTA_INDIA);
    expect(listVenues()).toEqual([DELTA_INDIA]);
    expect(DELTA_INDIA.id).toBe("delta_india");
    expect(DELTA_INDIA.label).toBe("Delta Exchange India");
  });

  it("throws UnknownVenueError for an id that is not registered", () => {
    expect(() => getVenue("nse")).toThrowError(UnknownVenueError);
    expect(() => getVenue("nse")).toThrow('Unknown venue "nse"');
    // Object.prototype keys must not resolve to functions
    for (const key of ["toString", "constructor", "hasOwnProperty", "__proto__"]) {
      expect(() => getVenue(key), key).toThrowError(UnknownVenueError);
    }
    expect.assertions(6);
  });
});

describe("HC-SH-118 [VENUES] Delta India market specs", () => {
  it("cover every schema underlying with the sizes recorded in the products fixture", () => {
    expect(DELTA_INDIA.underlyings).toEqual([...UNDERLYINGS]);
    expect(options.length).toBeGreaterThan(900);
    for (const p of options) {
      const spec = marketOf(DELTA_INDIA, p.underlying_asset.symbol);
      expect(spec.multiplier, p.symbol).toBe(p.contract_value);
      expect(spec.tickSize, p.symbol).toBe(p.tick_size);
      expect(spec.quoteCcy, p.symbol).toBe(p.quoting_asset.symbol);
      expect(spec.settleCcy, p.symbol).toBe(p.settling_asset?.symbol);
      expect(new Date(p.settlement_time ?? "").getUTCHours(), p.symbol).toBe(spec.settlementHourUtc);
    }
  });

  it("are linear USD European contracts with one contract per lot by default", () => {
    for (const u of UNDERLYINGS) {
      const spec = DELTA_INDIA_MARKETS[u];
      expect(spec.underlying).toBe(u);
      expect(spec.lotSize).toBe(spec.multiplier);
      expect(spec.exerciseStyle).toBe("european");
      expect(spec.isInverse).toBe(false);
      expect(spec.timezone).toBe("UTC");
      expect(spec.perpetualSymbol).toBe(`${u}USD`);
    }
    expect(DELTA_INDIA_MARKETS.BTC.settlementHourUtc).toBe(12);
    expect(DELTA_INDIA_MARKETS.XAUT.settlementHourUtc).toBe(16);
  });

  it("marketOf throws VenueCapabilityError for an underlying the venue does not list", () => {
    expect(() => marketOf(DELTA_INDIA, "SOL")).toThrowError(VenueCapabilityError);
    expect(() => marketOf(DELTA_INDIA, "constructor")).toThrowError(VenueCapabilityError);
    expect(ownMarket(DELTA_INDIA.markets, "__proto__")).toBeUndefined();
    try {
      marketOf(DELTA_INDIA, "SOL");
    } catch (e) {
      const err = e as VenueCapabilityError;
      expect(err.venue).toBe("delta_india");
      expect(err.capability).toBe("market SOL");
      expect(err.message).toBe("Venue delta_india has no market SOL");
    }
  });

  it("defaultLotSizes reproduces the literal the API routes carried, with 1 for a market the venue lacks", () => {
    expect(defaultLotSizes(DELTA_INDIA)).toEqual({ BTC: "0.001", ETH: "0.01", XAUT: "0.001" });
    const partial: VenueAdapter = { ...DELTA_INDIA, markets: { BTC: DELTA_INDIA_MARKETS.BTC } };
    expect(defaultLotSizes(partial)).toEqual({ BTC: "0.001", ETH: "1", XAUT: "1" });
  });
});

describe("HC-SH-118 [VENUES] Delta India symbol codec", () => {
  it("formats options exactly as the web client does (integral strike without decimals, DDMMYY, bad date passed through)", () => {
    const f = DELTA_INDIA.symbols.formatOption;
    expect(f).toBe(formatDeltaOption);
    expect(f("call", "BTC", "79400", "2026-09-07")).toBe("C-BTC-79400-070926");
    expect(f("put", "ETH", "4200.00", "2026-10-30")).toBe("P-ETH-4200-301026");
    expect(f("call", "XAUT", "3425.5", "2026-09-11")).toBe("C-XAUT-3425.5-110926");
    expect(f("call", "BTC", "80000", "bad")).toBe("C-BTC-80000-bad");
    expect(f("put", "BTC", "abc", "2026-09-07")).toBe("P-BTC-abc-070926");
  });

  it("format after parse is the identity over every option symbol in the fixture", () => {
    for (const p of options) {
      expect(DELTA_INDIA.symbols.isOption(p.symbol)).toBe(true);
      const parsed = DELTA_INDIA.symbols.parseOption(p.symbol);
      expect(DELTA_INDIA.symbols.formatOption(parsed.kind, parsed.underlying, parsed.strike, parsed.expiryDate)).toBe(p.symbol);
    }
  });

  it("names the perpetual and rejects non-option symbols", () => {
    expect(DELTA_INDIA.symbols.perpetual("BTC")).toBe("BTCUSD");
    expect(DELTA_INDIA.symbols.isOption("BTCUSD")).toBe(false);
    expect(() => DELTA_INDIA.symbols.parseOption("BTCUSD")).toThrowError(InvalidSymbolError);
  });
});

describe("HC-SH-118 [VENUES] Delta India calendar, fees, capabilities", () => {
  it("settles at 12:00 UTC, XAUT at 16:00, and an unknown underlying at the venue default", () => {
    const c = DELTA_INDIA.calendar;
    expect(c.settlementHourUtc("BTC")).toBe(12);
    expect(c.settlementHourUtc("ETH")).toBe(12);
    expect(c.settlementHourUtc("XAUT")).toBe(16);
    expect(c.settlementHourUtc("SOL")).toBe(12);
    expect(c.settlementHourUtc("constructor")).toBe(12);
    expect(c.expirySettlementIso("250926", "BTC")).toBe("2026-09-25T12:00:00.000Z");
    expect(c.expirySettlementIso("110926", "XAUT")).toBe("2026-09-11T16:00:00.000Z");
    // the fixture agrees: every option's settlement_time is its expiry date at the calendar hour
    for (const p of options) {
      const inst = toInstrument(p);
      expect(c.expirySettlementIso(inst.expiryCode ?? "", inst.underlying), p.symbol).toBe(new Date(p.settlement_time ?? "").toISOString());
    }
  });

  it("carries the seed broker's fee defaults and the Delta capability flags", () => {
    expect(DELTA_INDIA.fees).toEqual({ feePct: "0.05", gstPct: "18", feeCapPct: "10", basis: "spot-notional" });
    expect(DELTA_INDIA.capabilities).toEqual({
      options: true,
      perpetuals: true,
      liveTrading: true,
      greeksFromVenue: true,
      oiInCompactTicker: false,
      spotFallback: "binance",
    });
  });
});

describe("HC-SH-118 [VENUES] Delta India schema bridge and client factories", () => {
  it("delegates to the schema adapter functions", () => {
    const s = DELTA_INDIA.schema;
    const inst = toInstrument(options[0]!);
    expect(s.isSupported(inst)).toBe(isSchemaInstrument(inst));
    expect(s.instrumentId(inst.symbol)).toBe(`delta_india:${inst.symbol}`);
    expect(s.instrument(inst)).toEqual(toSchemaInstrument(inst));
    const q = toQuote(tickers[0]!, 0);
    expect(s.quote(q, "0").instrumentId).toBe(`delta_india:${q.symbol}`);
    expect(s.chainRows([], "80000")).toEqual([]);
    expect(() => s.chainSnapshot({ venue: "delta", underlying: "BTC", expiry: { code: "250926", date: "2026-09-25", label: "25SEP26", settlementTime: "2026-09-25T12:00:00.000Z", dte: 0, daysToExpiry: 0 }, spot: null, strikes: [], asOf: 0, rows: [], quoted: 0, total: 0 })).toThrowError(SchemaAdapterError);
    expect(toSchemaChainSnapshot).toBe(s.chainSnapshot);
  });

  it("builds the REST, market-data and trading clients from the same options the apps passed before", async () => {
    const fetch: FetchLike = () =>
      Promise.resolve({
        status: 200,
        headers: { get: () => null },
        text: () => Promise.resolve(JSON.stringify({ success: true, result: [] })),
      });
    const rest = DELTA_INDIA.rest({ baseUrl: "https://api.example", fetch });
    expect(rest).toBeInstanceOf(DeltaRestClient);
    expect(await rest.getProducts({ contractTypes: ["call_options"] })).toEqual([]);
    const md = DELTA_INDIA.marketData({ restUrl: "https://api.example", wsUrl: "wss://ws.example", fetch, WebSocket: FakeWebSocket });
    expect(md.status().instruments).toBe(0);
    // the trading safety guard refuses a real fetch under NODE_ENV=test, exactly as in the apps
    expect(() => tradingClientOf(DELTA_INDIA, { baseUrl: "https://api.example", nodeEnv: "test" })).toThrow("trading safety");
    const tradingFetch: TradingFetch = () => Promise.resolve({ status: 200, text: () => Promise.resolve("{}") });
    expect(tradingClientOf(DELTA_INDIA, { baseUrl: "https://api.example", nodeEnv: "test", fetch: tradingFetch })).toBeInstanceOf(DeltaTradingClientImpl);
  });

  it("tradingClientOf throws VenueCapabilityError on a data-only venue", () => {
    const dataOnly = Object.fromEntries(Object.entries(DELTA_INDIA).filter(([k]) => k !== "trading")) as VenueAdapter;
    expect(dataOnly.trading).toBeUndefined();
    expect(() => tradingClientOf(dataOnly, { baseUrl: "https://api.example" })).toThrow("Venue delta_india has no trading client");
  });
});
