import { describe, expect, it } from "vitest";
import { canonDecimal } from "../decimal.js";
import { InvalidExpiryError, InvalidSymbolError } from "../errors.js";
import { LIVE_COMPACT_TICKER_FRAME, loadProductsFixture, loadTickersFixture } from "../test-support/fixtures.js";
import {
  DEFAULT_SETTLEMENT_HOUR_UTC,
  compactToQuote,
  contractTypeToKind,
  dateToExpiryCode,
  expiryCodeToDate,
  expiryCodeToLabel,
  expirySettlementIso,
  isOptionSymbol,
  labelToExpiryCode,
  parseOptionSymbol,
  resolveExpiryCode,
  toGreeks,
  toInstrument,
  toQuote,
} from "./normalize.js";
import { RawProductsResponse, RawTickersResponse, RawWsCompactTicker } from "./raw.js";
import type { RawProduct, RawTicker } from "./raw.js";

const products = RawProductsResponse.parse(loadProductsFixture());
const tickers = RawTickersResponse.parse(loadTickersFixture());

const PERP: RawProduct = {
  id: 27,
  symbol: "BTCUSD",
  contract_type: "perpetual_futures",
  state: "live",
  strike_price: null,
  settlement_time: null,
  contract_value: "0.001",
  tick_size: "0.5",
  underlying_asset: { id: 1, symbol: "BTC" },
  quoting_asset: { id: 14, symbol: "USD" },
  settling_asset: { id: 14, symbol: "USD" },
};

describe("[VENUES] option symbols", () => {
  it("[VENUES] parseOptionSymbol decodes side, underlying, strike and expiry", () => {
    expect(parseOptionSymbol("C-BTC-80000-250926")).toEqual({
      kind: "call",
      underlying: "BTC",
      strike: "80000",
      expiryCode: "250926",
      expiryDate: "2026-09-25",
    });
    expect(parseOptionSymbol("P-ETH-2400-110926")).toEqual({
      kind: "put",
      underlying: "ETH",
      strike: "2400",
      expiryCode: "110926",
      expiryDate: "2026-09-11",
    });
    expect(parseOptionSymbol("C-XAUT-4640.5-110926").strike).toBe("4640.5");
  });

  it("[VENUES] rejects non-option symbols", () => {
    expect(() => parseOptionSymbol("BTCUSD")).toThrow(InvalidSymbolError);
    expect(() => parseOptionSymbol("C-BTC-80000-2509")).toThrow(InvalidSymbolError);
    expect(() => parseOptionSymbol("X-BTC-80000-250926")).toThrow(InvalidSymbolError);
    try {
      parseOptionSymbol("nope");
    } catch (error) {
      expect((error as InvalidSymbolError).symbol).toBe("nope");
      expect((error as InvalidSymbolError).name).toBe("InvalidSymbolError");
    }
    expect(isOptionSymbol("C-BTC-80000-250926")).toBe(true);
    expect(isOptionSymbol("BTCUSD")).toBe(false);
  });

  it("[VENUES] every fixture option symbol parses and matches its strike_price", () => {
    for (const product of products.result) {
      const parsed = parseOptionSymbol(product.symbol);
      expect(parsed.strike).toBe(canonDecimal(product.strike_price as string));
      expect(parsed.underlying).toBe(product.underlying_asset.symbol);
      expect(parsed.kind).toBe(product.contract_type === "call_options" ? "call" : "put");
    }
  });
});

describe("[VENUES] expiry codes", () => {
  it("[VENUES] expiryCodeToDate / dateToExpiryCode round-trip", () => {
    expect(expiryCodeToDate("250926")).toBe("2026-09-25");
    expect(expiryCodeToDate("010130")).toBe("2030-01-01");
    expect(dateToExpiryCode("2026-09-25")).toBe("250926");
    expect(dateToExpiryCode("2030-01-01")).toBe("010130");
    for (const code of ["050926", "060926", "070926", "110926", "180926", "250926", "301026", "271126"]) {
      expect(dateToExpiryCode(expiryCodeToDate(code))).toBe(code);
    }
  });

  it("[VENUES] rejects malformed and impossible dates", () => {
    expect(() => expiryCodeToDate("25SEP26")).toThrow(InvalidExpiryError);
    expect(() => expiryCodeToDate("310226")).toThrow(InvalidExpiryError);
    expect(() => expiryCodeToDate("001026")).toThrow(InvalidExpiryError);
    expect(() => dateToExpiryCode("26-09-25")).toThrow(InvalidExpiryError);
    expect(() => dateToExpiryCode("1999-01-01")).toThrow(InvalidExpiryError);
    expect(() => dateToExpiryCode("2100-01-01")).toThrow(InvalidExpiryError);
    expect(() => dateToExpiryCode("2026-02-31")).toThrow(InvalidExpiryError);
    try {
      expiryCodeToDate("bad");
    } catch (error) {
      expect((error as InvalidExpiryError).input).toBe("bad");
      expect((error as InvalidExpiryError).name).toBe("InvalidExpiryError");
    }
  });

  it("[VENUES] labels use a 2-digit year and an uppercase month", () => {
    expect(expiryCodeToLabel("250926")).toBe("25SEP26");
    expect(expiryCodeToLabel("271126")).toBe("27NOV26");
    expect(expiryCodeToLabel("010127")).toBe("01JAN27");
    expect(labelToExpiryCode("25SEP26")).toBe("250926");
    expect(labelToExpiryCode("25sep26")).toBe("250926");
    expect(labelToExpiryCode("31DEC26")).toBe("311226");
    expect(() => labelToExpiryCode("25XYZ26")).toThrow(InvalidExpiryError);
    expect(() => labelToExpiryCode("2026")).toThrow(InvalidExpiryError);
    expect(() => labelToExpiryCode("31FEB26")).toThrow(InvalidExpiryError);
  });

  it("[VENUES] resolveExpiryCode accepts code, label and ISO date", () => {
    expect(resolveExpiryCode("250926")).toBe("250926");
    expect(resolveExpiryCode("25SEP26")).toBe("250926");
    expect(resolveExpiryCode("2026-09-25")).toBe("250926");
    expect(() => resolveExpiryCode("310226")).toThrow(InvalidExpiryError);
    expect(() => resolveExpiryCode("garbage")).toThrow(InvalidExpiryError);
  });

  it("[VENUES] expirySettlementIso defaults to 12:00 UTC (BTC/ETH) and accepts another hour (XAUT 16:00)", () => {
    expect(DEFAULT_SETTLEMENT_HOUR_UTC).toBe(12);
    expect(expirySettlementIso("250926")).toBe("2026-09-25T12:00:00.000Z");
    expect(expirySettlementIso("110926", 16)).toBe("2026-09-11T16:00:00.000Z");
  });
});

describe("[VENUES] toInstrument", () => {
  it("[VENUES] maps contract types to kinds", () => {
    expect(contractTypeToKind("call_options")).toBe("call");
    expect(contractTypeToKind("put_options")).toBe("put");
    expect(contractTypeToKind("futures")).toBe("future");
    expect(contractTypeToKind("perpetual_futures")).toBe("perpetual");
    expect(contractTypeToKind("move_options")).toBe("other");
  });

  it("[VENUES] round-trips all 972 fixture products", () => {
    const counts: Record<string, number> = {};
    for (const product of products.result) {
      const instrument = toInstrument(product);
      counts[instrument.underlying] = (counts[instrument.underlying] ?? 0) + 1;
      expect(instrument.venue).toBe("delta");
      expect(instrument.id).toBe(product.id);
      expect(instrument.symbol).toBe(product.symbol);
      expect(["call", "put"]).toContain(instrument.kind);
      expect(instrument.strike).toBe(canonDecimal(product.strike_price as string));
      expect(instrument.expiryCode).toBe(product.symbol.split("-")[3]);
      expect(instrument.settlementTime).toBe(product.settlement_time);
      expect(instrument.expiryDate).toBe((product.settlement_time as string).slice(0, 10));
      expect(["0.001", "0.01"]).toContain(instrument.contractValue);
      expect(["0.01", "0.1"]).toContain(instrument.tickSize);
      expect(instrument.quoteAsset).toBe("USD");
      expect(instrument.settlingAsset).toBe("USD");
      expect(instrument.state).toBe("live");
      expect(["operational", "disrupted_post_only", "disrupted_cancel_only"]).toContain(instrument.tradingStatus);
    }
    expect(counts).toEqual({ BTC: 594, ETH: 301, XAUT: 77 });
  });

  it("[VENUES] XAUT products settle at 16:00 UTC while BTC/ETH settle at 12:00 UTC", () => {
    const hours = new Map<string, Set<string>>();
    for (const product of products.result) {
      const instrument = toInstrument(product);
      const set = hours.get(instrument.underlying) ?? new Set<string>();
      set.add((instrument.settlementTime as string).slice(11));
      hours.set(instrument.underlying, set);
    }
    expect([...(hours.get("XAUT") as Set<string>)]).toEqual(["16:00:00Z"]);
    expect([...(hours.get("BTC") as Set<string>)]).toEqual(["12:00:00Z"]);
    expect([...(hours.get("ETH") as Set<string>)]).toEqual(["12:00:00Z"]);
  });

  it("[VENUES] handles perpetuals, dated futures and unknown types", () => {
    const perp = toInstrument(PERP);
    expect(perp).toMatchObject({ kind: "perpetual", strike: null, expiryCode: null, expiryDate: null, settlementTime: null });
    expect(perp.tradingStatus).toBeNull();

    const dated = toInstrument({ ...PERP, symbol: "BTCUSD-250926", contract_type: "futures", settlement_time: "2026-09-25T12:00:00Z" });
    expect(dated).toMatchObject({ kind: "future", expiryCode: "250926", expiryDate: "2026-09-25" });

    const badSettlement = toInstrument({ ...PERP, contract_type: "futures", settlement_time: "not-a-date" });
    expect(badSettlement).toMatchObject({ kind: "future", expiryCode: null, expiryDate: null });

    const other = toInstrument({ ...PERP, symbol: "MV-BTC-80000-250926", contract_type: "move_options", strike_price: "80000" });
    expect(other).toMatchObject({ kind: "other", strike: "80000", expiryCode: null });

    expect(toInstrument({ ...PERP, settling_asset: undefined }).settlingAsset).toBe("USD");
    expect(toInstrument({ ...PERP, trading_status: "disrupted_cancel_only" }).tradingStatus).toBe("disrupted_cancel_only");
  });
});

describe("[VENUES] toQuote", () => {
  const NOW = 1_800_000_000_000;

  it("[VENUES] round-trips all 307 fixture tickers with decimal strings, IV fractions and numeric greeks", () => {
    for (const ticker of tickers.result) {
      const quote = toQuote(ticker, NOW);
      expect(quote.venue).toBe("delta");
      expect(quote.symbol).toBe(ticker.symbol);
      expect(quote.instrumentId).toBe(ticker.product_id);
      expect(quote.mark).toBe(canonDecimal(ticker.mark_price));
      expect(quote.bid).toBe(canonDecimal(ticker.quotes?.best_bid as string));
      expect(quote.ask).toBe(canonDecimal(ticker.quotes?.best_ask as string));
      expect(quote.markIv).toBeCloseTo(Number(ticker.mark_vol), 12);
      expect(quote.bidIv).toBeCloseTo(Number(ticker.quotes?.bid_iv), 12);
      expect(quote.askIv).toBeCloseTo(Number(ticker.quotes?.ask_iv), 12);
      expect(quote.greeks).not.toBeNull();
      expect(quote.greeks?.delta).toBeCloseTo(Number(ticker.greeks?.delta), 12);
      expect(quote.greeks?.theta).toBeCloseTo(Number(ticker.greeks?.theta), 12);
      expect(quote.oi).toBe(canonDecimal(ticker.oi as string));
      expect(quote.oiContracts).toBe(canonDecimal(ticker.oi_contracts as string));
      // 37 fixture tickers carry no `volume` key at all; those normalise to null.
      if (ticker.volume === undefined) expect(quote.volume).toBeNull();
      else expect(quote.volume).toMatch(/^\d+(\.\d+)?$/);
      expect(quote.spot).toBe(canonDecimal(ticker.spot_price as string));
      expect(quote.venueTs).toBe(Math.floor((ticker.timestamp as number) / 1000));
      expect(quote.receivedAt).toBe(NOW);
    }
  });

  it("[VENUES] matches the first fixture ticker field by field", () => {
    const first = tickers.result[0] as RawTicker;
    expect(first.symbol).toBe("C-BTC-99000-271126");
    expect(toQuote(first, NOW)).toEqual({
      venue: "delta",
      symbol: "C-BTC-99000-271126",
      instrumentId: 151077,
      mark: "1290.81008713",
      bid: "1247",
      ask: "1324",
      bidSize: "6501",
      askSize: "4427",
      markIv: 0.42445466,
      bidIv: 0.41990933,
      askIv: 0.42807649,
      greeks: { delta: 0.16426413, gamma: 0.00001532, theta: -23.86507888, vega: 94.28945667, rho: 27.02663566 },
      oi: "1.014",
      oiContracts: "1014",
      volume: "0.957",
      spot: "79528.1",
      venueTs: 1788543685911,
      receivedAt: NOW,
    });
  });

  it("[VENUES] tolerates missing quotes, greeks and timestamps", () => {
    const base: RawTicker = { symbol: "BTCUSD", product_id: 27, mark_price: "79750.0" };
    const bare = toQuote(base, NOW);
    expect(bare).toMatchObject({
      mark: "79750",
      bid: null,
      ask: null,
      bidSize: null,
      askSize: null,
      markIv: null,
      bidIv: null,
      askIv: null,
      greeks: null,
      oi: null,
      oiContracts: null,
      volume: null,
      spot: null,
      venueTs: NOW,
      receivedAt: NOW,
    });

    const fromTime = toQuote({ ...base, time: "2026-09-05T20:04:33.744Z" }, NOW);
    expect(fromTime.venueTs).toBe(Date.parse("2026-09-05T20:04:33.744Z"));
    expect(toQuote({ ...base, time: "not a time" }, NOW).venueTs).toBe(NOW);

    const withIv = toQuote({ ...base, quotes: { mark_iv: "0.5", bid_size: 12, best_bid: "1" }, greeks: { spot: "80000" } }, NOW);
    expect(withIv.markIv).toBe(0.5);
    expect(withIv.bidSize).toBe("12");
    expect(withIv.bid).toBe("1");
    expect(withIv.spot).toBe("80000");
    expect(withIv.greeks).toBeNull();

    expect(toQuote({ ...base, volume: "1.50" }, NOW).volume).toBe("1.5");
    expect(toQuote(base).receivedAt).toBeGreaterThan(0);
  });

  it("[VENUES] toGreeks needs all five values", () => {
    expect(toGreeks({ delta: "0.5", gamma: "0.1", theta: "-1", vega: "2", rho: "0.3" })).toEqual({
      delta: 0.5,
      gamma: 0.1,
      theta: -1,
      vega: 2,
      rho: 0.3,
    });
    expect(toGreeks({ delta: "0.5", gamma: "0.1", theta: "-1", vega: "2" })).toBeNull();
    expect(toGreeks({ delta: "0.5", gamma: null, theta: "-1", vega: "2", rho: "0" })).toBeNull();
    expect(toGreeks({ delta: "0.5", gamma: "x", theta: "-1", vega: "2", rho: "0" })).toBeNull();
    expect(toGreeks({ delta: 0.5, gamma: 0.1, theta: -1, vega: 2, rho: 0 })).not.toBeNull();
  });
});

describe("[VENUES] compactToQuote (new public `ticker` channel)", () => {
  const NOW = 1_800_000_000_000;

  it("[VENUES] parses the live BTCUSD frame (null greeks for a perpetual)", () => {
    const frame = RawWsCompactTicker.parse(LIVE_COMPACT_TICKER_FRAME);
    const entry = frame.d[0];
    expect(entry).toBeDefined();
    const quote = compactToQuote(entry as NonNullable<typeof entry>, { sp: frame.sp, ts: frame.ts }, NOW);
    expect(quote).toEqual({
      venue: "delta",
      symbol: "BTCUSD",
      instrumentId: 27,
      mark: "79750.01150815",
      bid: "79753",
      ask: "79753.5",
      bidSize: "4387",
      askSize: "552",
      markIv: -0.38617139,
      bidIv: null,
      askIv: null,
      greeks: null,
      oi: null,
      oiContracts: "876853",
      volume: null,
      spot: "79777.9",
      venueTs: 1788725367575,
      receivedAt: NOW,
    });
  });

  it("[VENUES] maps option greeks in the documented order and tolerates missing arrays", () => {
    const quote = compactToQuote(
      {
        s: "C-BTC-80000-250926",
        i: 147879,
        m: "2500.5",
        g: ["0.5", "0.0001", "10", "-50", "70"],
        q: ["2510", 5, "2490", 7, null],
        qiv: ["0.36", "0.34", "0.35"],
        oi: ["100", "1"],
      },
      { sp: "80000", ts: 1_788_725_367_575_186 },
      NOW,
    );
    expect(quote.greeks).toEqual({ delta: 0.5, gamma: 0.0001, rho: 10, theta: -50, vega: 70 });
    expect(quote).toMatchObject({ ask: "2510", askSize: "5", bid: "2490", bidSize: "7", askIv: 0.36, bidIv: 0.34, markIv: 0.35, oiContracts: "100", spot: "80000" });

    const sparse = compactToQuote({ s: "X", i: 1, m: "1", q: ["1"] }, { ts: 2_000_000 }, NOW);
    expect(sparse).toMatchObject({ ask: "1", bid: null, greeks: null, markIv: null, oiContracts: null, spot: null, venueTs: 2000 });
    expect(compactToQuote({ s: "X", i: 1, m: "1" }, { sp: null, ts: 0 }).receivedAt).toBeGreaterThan(0);
  });
});
