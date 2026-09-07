import { describe, expect, it } from "vitest";
import { UnknownExpiryError } from "../errors.js";
import { loadProductsFixture, loadTickersFixture } from "../test-support/fixtures.js";
import type { Instrument, Quote } from "../types.js";
import { buildChain, listExpiries, strikeStep } from "./chain.js";
import { toInstrument, toQuote } from "./normalize.js";
import { RawProductsResponse, RawTickersResponse } from "./raw.js";

const NOW = Date.parse("2026-09-04T12:00:00Z");
const instruments = RawProductsResponse.parse(loadProductsFixture()).result.map(toInstrument);
const quotes = RawTickersResponse.parse(loadTickersFixture()).result.map((t) => toQuote(t, NOW));
const quoteMap = new Map(quotes.map((q) => [q.instrumentId, q]));

function strikesFromInstruments(underlying: string, code: string): string[] {
  return [
    ...new Set(
      instruments
        .filter((i) => i.underlying === underlying && i.expiryCode === code)
        .map((i) => i.strike as string),
    ),
  ].sort((a, b) => Number(a) - Number(b));
}

describe("[GAPS-1] strikes come only from the instrument list (ADR-006)", () => {
  it("[GAPS-1] BTC 25SEP26 (weekly) has 52 strikes with mixed 500/1000 steps", () => {
    const chain = buildChain({ instruments, quotes: quoteMap, underlying: "BTC", expiry: "25SEP26", nowMs: NOW });
    expect(chain.strikes).toHaveLength(52);
    expect(chain.rows).toHaveLength(52);
    expect(chain.strikes).toEqual(strikesFromInstruments("BTC", "250926"));
    const report = strikeStep(chain.rows);
    expect(report.steps).toEqual([500, 1000]);
    expect(report.uniform).toBe(false);
    expect(report.counts["500"]).toBeGreaterThan(0);
    expect(report.counts["1000"]).toBeGreaterThan(0);
    expect((report.counts["500"] ?? 0) + (report.counts["1000"] ?? 0)).toBe(51);
  });

  it("[GAPS-1] BTC daily expiries use 200/400/600 steps", () => {
    const daily = buildChain({ instruments, quotes: quoteMap, underlying: "BTC", expiry: "060926", nowMs: NOW });
    expect(daily.strikes).toHaveLength(38);
    expect(strikeStep(daily.rows).steps).toEqual([200, 400, 600]);

    const nextDaily = buildChain({ instruments, quotes: quoteMap, underlying: "BTC", expiry: "2026-09-07", nowMs: NOW });
    expect(nextDaily.strikes).toHaveLength(31);
    expect(strikeStep(nextDaily.rows).steps).toEqual([200, 400]);
  });

  it("[GAPS-1] BTC monthly 27NOV26 is a uniform 1000 ladder", () => {
    const monthly = buildChain({ instruments, quotes: quoteMap, underlying: "BTC", expiry: "27NOV26", nowMs: NOW });
    expect(monthly.strikes).toHaveLength(38);
    expect(strikeStep(monthly.rows)).toEqual({ steps: [1000], counts: { "1000": 37 }, uniform: true });
  });

  it("[GAPS-1] every BTC/ETH/XAUT expiry ladder equals the instrument list: ascending, unique, nothing invented", () => {
    for (const underlying of ["BTC", "ETH", "XAUT"]) {
      for (const expiry of listExpiries(instruments, underlying, NOW)) {
        const chain = buildChain({ instruments, quotes: [], underlying, expiry: expiry.code, nowMs: NOW });
        const expected = strikesFromInstruments(underlying, expiry.code);
        expect(chain.strikes).toEqual(expected);
        expect(new Set(chain.strikes).size).toBe(chain.strikes.length);
        for (let i = 1; i < chain.strikes.length; i += 1) {
          expect(Number(chain.strikes[i])).toBeGreaterThan(Number(chain.strikes[i - 1]));
        }
        expect(chain.total).toBe(
          instruments.filter((i) => i.underlying === underlying && i.expiryCode === expiry.code).length,
        );
        for (const row of chain.rows) {
          if (row.call) expect(row.call.instrument.strike).toBe(row.strike);
          if (row.put) expect(row.put.instrument.strike).toBe(row.strike);
        }
      }
    }
  });

  it("[GAPS-1] strike counts differ per expiry (27 to 52 for BTC)", () => {
    const counts = listExpiries(instruments, "BTC", NOW).map(
      (e) => buildChain({ instruments, quotes: [], underlying: "BTC", expiry: e.code, nowMs: NOW }).strikes.length,
    );
    expect(Math.min(...counts)).toBe(27);
    expect(Math.max(...counts)).toBe(52);
    expect(counts).toEqual([43, 38, 31, 31, 27, 52, 47, 38]);
  });
});

describe("[VENUES] listExpiries", () => {
  it("[VENUES] returns BTC expiries sorted by settlement with labels, dates and dte", () => {
    const expiries = listExpiries(instruments, "BTC", NOW);
    expect(expiries.map((e) => e.code)).toEqual([
      "050926",
      "060926",
      "070926",
      "110926",
      "180926",
      "250926",
      "301026",
      "271126",
    ]);
    const weekly = expiries.find((e) => e.code === "250926");
    expect(weekly).toEqual({
      code: "250926",
      label: "25SEP26",
      date: "2026-09-25",
      settlementTime: "2026-09-25T12:00:00Z",
      dte: 21,
      daysToExpiry: 21,
    });
    expect(expiries[0]).toMatchObject({ code: "050926", dte: 1, daysToExpiry: 1 });
  });

  it("[VENUES] XAUT expiries carry the venue's 16:00 UTC settlement", () => {
    const expiries = listExpiries(instruments, "XAUT", NOW);
    expect(expiries.map((e) => [e.code, e.settlementTime])).toEqual([
      ["050926", "2026-09-05T16:00:00Z"],
      ["110926", "2026-09-11T16:00:00Z"],
    ]);
    expect(expiries[0]?.dte).toBeCloseTo(1 + 4 / 24, 10);
    expect(expiries[0]?.daysToExpiry).toBe(2);
  });

  it("[VENUES] ignores other underlyings and non-options; clamps past expiries to 0 days", () => {
    const perp: Instrument = {
      ...(instruments[0] as Instrument),
      id: 1,
      symbol: "BTCUSD",
      kind: "perpetual",
      strike: null,
      expiryCode: null,
      expiryDate: null,
      settlementTime: null,
    };
    expect(listExpiries([perp], "BTC", NOW)).toEqual([]);
    expect(listExpiries(instruments, "SOL", NOW)).toEqual([]);
    const later = Date.parse("2026-12-01T00:00:00Z");
    for (const expiry of listExpiries(instruments, "BTC", later)) {
      expect(expiry.dte).toBeLessThan(0);
      expect(expiry.daysToExpiry).toBe(0);
    }
    expect(listExpiries(instruments, "BTC").length).toBe(8);
  });

  it("[VENUES] falls back to 12:00 UTC when a record has no settlement_time", () => {
    const first = instruments.find((i) => i.symbol === "C-BTC-80000-250926") as Instrument;
    const noSettlement: Instrument = { ...first, settlementTime: null };
    expect(listExpiries([noSettlement], "BTC", NOW)[0]?.settlementTime).toBe("2026-09-25T12:00:00.000Z");
    const chain = buildChain({ instruments: [noSettlement], quotes: [], underlying: "BTC", expiry: "250926", nowMs: NOW });
    expect(chain.expiry.settlementTime).toBe("2026-09-25T12:00:00.000Z");
    expect(chain.rows[0]).toEqual({ strike: "80000", call: { instrument: noSettlement, quote: null }, put: null });
  });
});

describe("[VENUES] buildChain quotes and metadata", () => {
  it("[VENUES] attaches call quotes by instrument id and reports the latest spot", () => {
    const chain = buildChain({ instruments, quotes: quoteMap, underlying: "BTC", expiry: "271126", nowMs: NOW });
    const callQuotes = quotes.filter((q) => q.symbol.endsWith("-271126"));
    expect(chain.quoted).toBe(callQuotes.length);
    expect(chain.total).toBe(instruments.filter((i) => i.underlying === "BTC" && i.expiryCode === "271126").length);
    for (const row of chain.rows) {
      expect(row.call).not.toBeNull();
      expect(row.call?.quote?.instrumentId).toBe(row.call?.instrument.id);
      expect(row.call?.quote?.symbol).toBe(row.call?.instrument.symbol);
      expect(row.put?.quote ?? null).toBeNull();
    }
    const latest = callQuotes.reduce((a, b) => (b.venueTs > a.venueTs ? b : a));
    expect(chain.spot).toBe(latest.spot);
    expect(chain).toMatchObject({ venue: "delta", underlying: "BTC", asOf: NOW });
    expect(chain.expiry.label).toBe("27NOV26");
  });

  it("[VENUES] accepts quotes as an array and defaults nowMs", () => {
    const fromArray = buildChain({ instruments, quotes, underlying: "BTC", expiry: "271126" });
    expect(fromArray.quoted).toBe(quotes.filter((q) => q.symbol.endsWith("-271126")).length);
    expect(fromArray.asOf).toBeGreaterThan(NOW);
  });

  it("[VENUES] spot stays null without quotes and ignores quotes without spot", () => {
    const empty = buildChain({ instruments, quotes: [], underlying: "ETH", expiry: "250926", nowMs: NOW });
    expect(empty.spot).toBeNull();
    expect(empty.quoted).toBe(0);
    const ethCall = instruments.find((i) => i.symbol === "C-ETH-2400-250926") as Instrument;
    const noSpot: Quote = { ...(quotes[0] as Quote), instrumentId: ethCall.id, symbol: ethCall.symbol, spot: null };
    const withNoSpot = buildChain({ instruments, quotes: [noSpot], underlying: "ETH", expiry: "250926", nowMs: NOW });
    expect(withNoSpot.spot).toBeNull();
    expect(withNoSpot.quoted).toBe(1);
    const older: Quote = { ...(quotes[0] as Quote), instrumentId: ethCall.id, spot: "1", venueTs: 1 };
    const putSide = instruments.find((i) => i.symbol === "P-ETH-2400-250926") as Instrument;
    const newer: Quote = { ...(quotes[0] as Quote), instrumentId: putSide.id, spot: "2", venueTs: 2 };
    expect(buildChain({ instruments, quotes: [newer, older], underlying: "ETH", expiry: "250926", nowMs: NOW }).spot).toBe("2");
  });

  it("[VENUES] throws UnknownExpiryError for an expiry without instruments", () => {
    expect(() => buildChain({ instruments, quotes: [], underlying: "BTC", expiry: "010130", nowMs: NOW })).toThrow(
      UnknownExpiryError,
    );
    try {
      buildChain({ instruments, quotes: [], underlying: "SOL", expiry: "250926", nowMs: NOW });
    } catch (error) {
      expect(error).toBeInstanceOf(UnknownExpiryError);
      expect((error as UnknownExpiryError).underlying).toBe("SOL");
      expect((error as UnknownExpiryError).expiry).toBe("250926");
      expect((error as UnknownExpiryError).name).toBe("UnknownExpiryError");
    }
  });

  it("[VENUES] strikeStep handles empty and single-row ladders and fractional strikes", () => {
    expect(strikeStep([])).toEqual({ steps: [], counts: {}, uniform: true });
    expect(strikeStep([{ strike: "100" }])).toEqual({ steps: [], counts: {}, uniform: true });
    expect(strikeStep([{ strike: "4640" }, { strike: "4642.5" }, { strike: "4645" }])).toEqual({
      steps: [2.5],
      counts: { "2.5": 2 },
      uniform: true,
    });
  });
});
