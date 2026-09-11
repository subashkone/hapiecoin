import { describe, expect, it } from "vitest";
import { InvalidSymbolError } from "../errors.js";
import { loadDeribitBookSummaryFixture, loadDeribitInstrumentsFixture, loadDeribitTickerFixture, loadDeribitTickersFixture } from "../test-support/fixtures.js";
import { DERIBIT_SETTLEMENT_HOUR_UTC, bookSummaryToQuote, coinToUsd, formatDeribitOption, isDeribitOption, parseDeribitOption, parseDeribitPerpetual, toDeribitInstrument, toDeribitQuote } from "./normalize.js";
import { RawBookSummaryResponse, RawInstrumentsResponse, RawTickerResponse, RawTickersResponse } from "./raw.js";

const instruments = RawInstrumentsResponse.parse(loadDeribitInstrumentsFixture()).result;
const ticker = RawTickerResponse.parse(loadDeribitTickerFixture()).result;
const tickers = RawTickersResponse.parse(loadDeribitTickersFixture()).result;
const book = RawBookSummaryResponse.parse(loadDeribitBookSummaryFixture()).result;

describe("HC-SH-122 [VENUES] Deribit names", () => {
  it("parses BASE-DMMMYY-STRIKE-C|P, keeps the venue's label and derives the shared DDMMYY code", () => {
    expect(parseDeribitOption("BTC-25SEP26-80000-C")).toEqual({ kind: "call", underlying: "BTC", strike: "80000", label: "25SEP26", expiryDate: "2026-09-25", expiryCode: "250926" });
    expect(parseDeribitOption("ETH-2OCT26-0d5-P")).toEqual({ kind: "put", underlying: "ETH", strike: "0.5", label: "2OCT26", expiryDate: "2026-10-02", expiryCode: "021026" });
    for (const bad of ["BTC-PERPETUAL", "BTC-31FEB26-1-C", "BTC-25XXX26-1-C", "C-BTC-80000-250926"]) expect(() => parseDeribitOption(bad)).toThrowError(InvalidSymbolError);
    expect(isDeribitOption("BTC-25SEP26-80000-C")).toBe(true);
    expect(isDeribitOption("BTC-PERPETUAL")).toBe(false);
    expect(parseDeribitPerpetual("BTC-PERPETUAL")).toBe("BTC");
    expect(parseDeribitPerpetual("BTC-25SEP26-80000-C")).toBeNull();
  });

  it("formats names the way the venue writes them and round-trips every fixture name", () => {
    expect(formatDeribitOption("call", "BTC", "80000", "2026-09-25")).toBe("BTC-25SEP26-80000-C");
    expect(formatDeribitOption("put", "ETH", "0.5", "2026-10-02")).toBe("ETH-2OCT26-0d5-P");
    expect(formatDeribitOption("put", "ETH", "4200.00", "2026-10-30")).toBe("ETH-30OCT26-4200-P");
    expect(formatDeribitOption("call", "BTC", "80000", "bad")).toBe("BTC-bad-80000-C");
    expect(instruments.length).toBe(950);
    for (const raw of instruments) {
      const p = parseDeribitOption(raw.instrument_name);
      expect(formatDeribitOption(p.kind, p.underlying, p.strike, p.expiryDate)).toBe(raw.instrument_name);
      expect(Date.parse(`${p.expiryDate}T08:00:00Z`)).toBe(raw.expiration_timestamp); // the name and the timestamp agree
    }
    expect(DERIBIT_SETTLEMENT_HOUR_UTC).toBe(8);
  });
});

describe("HC-SH-122 [VENUES] Deribit instruments and quotes in USD per underlying unit", () => {
  it("maps an inverse option instrument: one coin per contract, the tick in the coin, USD quote asset, coin settlement", () => {
    const inst = toDeribitInstrument(instruments[0]!);
    expect(inst).toEqual({
      venue: "deribit",
      id: 691120,
      symbol: "BTC-12SEP26-69000-C",
      kind: "call",
      underlying: "BTC",
      quoteAsset: "USD",
      settlingAsset: "BTC",
      strike: "69000",
      expiryCode: "120926",
      expiryDate: "2026-09-12",
      settlementTime: "2026-09-12T08:00:00.000Z",
      contractValue: "1",
      tickSize: "0.0001",
      state: "live",
      tradingStatus: "operational",
    });
    expect(toDeribitInstrument({ ...instruments[0]!, kind: "future", settlement_period: "perpetual", option_type: undefined, strike: undefined, is_active: false, state: undefined, counter_currency: undefined, settlement_currency: undefined })).toMatchObject({ kind: "perpetual", strike: null, expiryCode: null, expiryDate: null, settlementTime: null, state: "expired", tradingStatus: "inactive", quoteAsset: "USD", settlingAsset: "BTC" });
    expect(toDeribitInstrument({ ...instruments[0]!, kind: "future", settlement_period: "month" })).toMatchObject({ kind: "future", expiryDate: "2026-09-12" });
    expect(toDeribitInstrument({ ...instruments[0]!, kind: "spot" }).kind).toBe("other");
    expect(toDeribitInstrument({ ...instruments[0]!, option_type: undefined }).kind).toBe("other");
  });

  it("converts a ticker: mark, bid and ask × index, IV from percent, greeks and open interest through, the index as spot", () => {
    const q = toDeribitQuote(ticker, 691120, 5)!;
    expect(q.venue).toBe("deribit");
    expect(q.instrumentId).toBe(691120);
    expect(Number(q.mark)).toBeCloseTo(0.1118 * 77698.01, 6);
    expect(Number(q.bid)).toBeCloseTo(0.11 * 77698.01, 6);
    expect(Number(q.ask)).toBeCloseTo(0.114 * 77698.01, 6);
    expect(q.bidSize).toBe("56");
    expect(q.askSize).toBe("1");
    expect(q.markIv).toBeCloseTo(0.9655, 12);
    expect(q.bidIv).toBeNull(); // the venue sends 0 when nobody bids
    expect(q.askIv).toBeCloseTo(1.9316, 12);
    expect(q.greeks).toEqual(ticker.greeks);
    expect(q.oi).toBe("0");
    expect(q.oiContracts).toBe("0");
    expect(q.volume).toBe("0");
    expect(q.spot).toBe("77698.01");
    expect(q.venueTs).toBe(1789148191482);
    expect(q.receivedAt).toBe(5);
    const bare = toDeribitQuote({ ...ticker, best_bid_price: null, best_ask_price: undefined, greeks: null, stats: null, open_interest: undefined, mark_iv: 0, best_bid_amount: null, best_ask_amount: undefined }, 1)!;
    expect(bare).toMatchObject({ bid: null, ask: null, greeks: null, volume: null, oi: null, oiContracts: null, markIv: null, bidSize: null, askSize: null });
    expect(bare.receivedAt).toBeGreaterThan(0);
    expect(toDeribitQuote({ ...ticker, greeks: { ...ticker.greeks!, vega: Number.NaN } }, 1)!.greeks).toBeNull();
    expect(coinToUsd(0.5, 0)).toBeNull();
    expect(coinToUsd(Number.NaN, 100)).toBeNull();
    expect(coinToUsd(0.25, 80_000)).toBe("20000");
    expect(toDeribitQuote({ ...ticker, index_price: 0 }, 1)).toBeNull(); // nothing to convert with: the tick is dropped, like the seed
  });

  it("the venue's greeks are the engine's per-unit greeks: mark × index and the greeks agree with the forward-priced model", () => {
    // Black-76 on the venue's forward with mark_iv: the recorded greeks match per unit, so no conversion is applied
    const ncdf = (x: number) => 0.5 * erfc(-x / Math.SQRT2);
    const npdf = (x: number) => Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
    const byName = new Map(instruments.map((i) => [i.instrument_name, i]));
    expect(tickers.length).toBe(16);
    for (const t of tickers) {
      const raw = byName.get(t.instrument_name)!;
      const F = t.underlying_price!;
      const K = raw.strike!;
      const sigma = t.mark_iv! / 100;
      const T = (raw.expiration_timestamp - t.timestamp) / 86_400_000 / 365;
      const sq = sigma * Math.sqrt(T);
      const d1 = (Math.log(F / K) + 0.5 * sq * sq) / sq;
      const isCall = raw.option_type === "call";
      const delta = isCall ? ncdf(d1) : ncdf(d1) - 1;
      const vega = F * npdf(d1) * Math.sqrt(T) * 0.01;
      const theta = -(F * npdf(d1) * sigma) / (2 * Math.sqrt(T)) / 365;
      const q = toDeribitQuote(t, raw.instrument_id, 0)!;
      expect(q.greeks!.delta).toBeCloseTo(delta, 3);
      expect(Math.abs(q.greeks!.vega - vega) / vega).toBeLessThan(0.01);
      expect(Math.abs(q.greeks!.theta - theta) / Math.abs(theta)).toBeLessThan(0.01);
      // the USD premium is the coin mark times the index (the forward carries a small basis over the index)
      expect(Number(q.mark)).toBeCloseTo(t.mark_price * t.index_price, 4);
    }
  });

  it("the book summary seeds a quote without greeks from the delivery estimate, and skips rows without a mark or an index", () => {
    const row = book.find((r) => r.instrument_name === "BTC-12SEP26-69000-C")!;
    const q = bookSummaryToQuote(row, 691120, 9)!;
    expect(Number(q.mark)).toBeCloseTo(row.mark_price! * row.estimated_delivery_price!, 6);
    expect(q.spot).toBe(String(row.estimated_delivery_price));
    expect(q.greeks).toBeNull();
    expect(q.markIv).toBeCloseTo(0.9655, 12);
    expect(q.venueTs).toBe(row.creation_timestamp); // the venue's own stamp, so a later tick always wins over the seed
    expect(bookSummaryToQuote({ ...row, creation_timestamp: undefined }, 691120, 9)!.venueTs).toBe(9);
    expect(q).toMatchObject({ bidSize: null, askSize: null, bidIv: null, askIv: null, oi: "0", volume: "0" });
    expect(bookSummaryToQuote({ ...row, mark_price: null }, 1, 9)).toBeNull();
    expect(bookSummaryToQuote({ ...row, estimated_delivery_price: null }, 1, 9)).toBeNull();
    expect(bookSummaryToQuote({ ...row, estimated_delivery_price: 0 }, 1, 9)).toBeNull();
    expect(bookSummaryToQuote(row, 691120)!.receivedAt).toBeGreaterThan(0);
  });
});

/** Complementary error function (Abramowitz-Stegun 7.1.26, enough for a 1e-3 tolerance). */
function erfc(x: number): number {
  const z = Math.abs(x);
  const t = 1 / (1 + 0.5 * z);
  const r = t * Math.exp(-z * z - 1.26551223 + t * (1.00002368 + t * (0.37409196 + t * (0.09678418 + t * (-0.18628806 + t * (0.27886807 + t * (-1.13520398 + t * (1.48851587 + t * (-0.82215223 + t * 0.17087277)))))))));
  return x >= 0 ? r : 2 - r;
}
