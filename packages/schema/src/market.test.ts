import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  ChainRow,
  ChainSnapshot,
  Greeks,
  INSTRUMENT_ID_RE,
  Instrument,
  InstrumentId,
  InstrumentKind,
  Quote,
  VenueSymbol,
  makeInstrumentId,
  refineChainRows,
} from "./market.js";

/** Copy without the given keys (test helper; keeps unused-variable lint clean). */
function omit<T extends object, K extends keyof T>(obj: T, ...keys: K[]): Omit<T, K> {
  const dropped = new Set<PropertyKey>(keys);
  return Object.fromEntries(Object.entries(obj).filter(([k]) => !dropped.has(k))) as Omit<T, K>;
}

const call: Instrument = {
  id: "delta_india:C-BTC-80000-250926",
  venue: "delta_india",
  symbol: "C-BTC-80000-250926",
  underlying: "BTC",
  kind: "call",
  strike: "80000",
  expiry: "2026-09-25",
  settlementTime: "2026-09-25T12:00:00Z",
  contractSize: "0.001",
  tickSize: "0.1",
  quoteCurrency: "USD",
  venueProductId: 151077,
  isActive: true,
};

const quote: Quote = {
  instrumentId: "delta_india:C-BTC-80000-250926",
  ts: 1788543685911,
  mark: "1290.81008713",
  bid: "1247",
  ask: "1324",
  markIv: 0.4245,
  bidIv: 0.4199,
  askIv: 0.4281,
  oi: "1.0140",
  volume24h: "0.957",
  bidQty: "6501",
  askQty: "4427",
  spot: "79528.1",
  greeks: { delta: 0.164, gamma: 0.0000153, theta: -23.87, vega: 94.29, rho: 27.03 },
  change24hPct: -23.39,
};

describe("[SCHEMA] InstrumentId / VenueSymbol / InstrumentKind", () => {
  it("accepts venue:symbol ids and rejects other shapes", () => {
    expect(InstrumentId.safeParse("delta_india:C-BTC-80000-250926").success).toBe(true);
    expect(InstrumentId.safeParse("delta_india:BTCUSD").success).toBe(true);
    expect(InstrumentId.safeParse("binance:BTCUSDT").success).toBe(false);
    expect(InstrumentId.safeParse("delta_india:").success).toBe(false);
    expect(InstrumentId.safeParse("C-BTC-80000-250926").success).toBe(false);
    expect(InstrumentId.safeParse("delta_india:C BTC").success).toBe(false);
    expect(INSTRUMENT_ID_RE.source).toContain("delta_india");
  });
  it("makeInstrumentId builds the canonical id", () => {
    expect(makeInstrumentId("delta_india", "BTCUSD")).toBe("delta_india:BTCUSD");
  });
  it("VenueSymbol accepts exchange symbols and rejects blanks and spaces", () => {
    expect(VenueSymbol.safeParse("P-ETH-2400-110926").success).toBe(true);
    expect(VenueSymbol.safeParse(".DEXAUTUSD").success).toBe(false);
    expect(VenueSymbol.safeParse("").success).toBe(false);
    expect(VenueSymbol.safeParse("BTC USD").success).toBe(false);
  });
  it("InstrumentKind", () => {
    expect(InstrumentKind.options).toEqual(["call", "put", "future", "perpetual"]);
    expect(InstrumentKind.safeParse("option").success).toBe(false);
  });
});

describe("HC-WS-016 Instrument (strikes come from the instrument list, ADR-006)", () => {
  it("accepts a call, a put, a dated future and a perpetual", () => {
    expect(Instrument.safeParse(call).success).toBe(true);
    expect(
      Instrument.safeParse({ ...call, id: "delta_india:P-BTC-80000-250926", symbol: "P-BTC-80000-250926", kind: "put" })
        .success,
    ).toBe(true);
    const noStrike = omit(call, "strike", "settlementTime");
    expect(
      Instrument.safeParse({ ...noStrike, id: "delta_india:BTCUSD-250926", symbol: "BTCUSD-250926", kind: "future" })
        .success,
    ).toBe(true);
    const noExpiry = omit(noStrike, "expiry");
    expect(
      Instrument.safeParse({ ...noExpiry, id: "delta_india:BTCUSD", symbol: "BTCUSD", kind: "perpetual" }).success,
    ).toBe(true);
  });
  it("rejects an id that does not match venue:symbol", () => {
    const r = Instrument.safeParse({ ...call, id: "delta_india:BTCUSD" });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]?.path).toEqual(["id"]);
  });
  it("rejects options without a strike or expiry", () => {
    const r1 = Instrument.safeParse(omit(call, "strike"));
    expect(r1.success).toBe(false);
    expect(r1.error?.issues.map((i) => i.path.join("."))).toContain("strike");
    const r2 = Instrument.safeParse(omit(call, "expiry"));
    expect(r2.success).toBe(false);
    expect(r2.error?.issues.map((i) => i.path.join("."))).toContain("expiry");
  });
  it("rejects a future with a strike and a perpetual with an expiry", () => {
    const r1 = Instrument.safeParse({ ...call, id: "delta_india:BTCUSD", symbol: "BTCUSD", kind: "future" });
    expect(r1.success).toBe(false);
    expect(r1.error?.issues.map((i) => i.path.join("."))).toContain("strike");
    const r2 = Instrument.safeParse({
      ...omit(call, "strike"),
      id: "delta_india:BTCUSD",
      symbol: "BTCUSD",
      kind: "perpetual",
    });
    expect(r2.success).toBe(false);
    expect(r2.error?.issues.map((i) => i.path.join("."))).toContain("expiry");
  });
  it("rejects wrong primitive types", () => {
    expect(Instrument.safeParse({ ...call, strike: 80000 }).success).toBe(false);
    expect(Instrument.safeParse({ ...call, contractSize: "1e-3" }).success).toBe(false);
    expect(Instrument.safeParse({ ...call, venueProductId: "151077" }).success).toBe(false);
    expect(Instrument.safeParse({ ...call, venueProductId: 1.5 }).success).toBe(false);
    expect(Instrument.safeParse({ ...call, isActive: "yes" }).success).toBe(false);
    expect(Instrument.safeParse({ ...call, quoteCurrency: "USDT" }).success).toBe(false);
    expect(Instrument.safeParse({ ...call, settlementTime: "2026-09-25" }).success).toBe(false);
  });
});

describe("[SCHEMA] Greeks", () => {
  it("accepts numbers with optional rho and rejects strings, NaN and Infinity", () => {
    expect(Greeks.safeParse({ delta: 0.5, gamma: 0.0001, theta: -1, vega: 10 }).success).toBe(true);
    expect(Greeks.safeParse({ delta: 0.5, gamma: 0.0001, theta: -1, vega: 10, rho: 1 }).success).toBe(true);
    expect(Greeks.safeParse({ delta: "0.5", gamma: 0.0001, theta: -1, vega: 10 }).success).toBe(false);
    expect(Greeks.safeParse({ delta: Number.NaN, gamma: 0.0001, theta: -1, vega: 10 }).success).toBe(false);
    expect(Greeks.safeParse({ delta: 0.5, gamma: Number.POSITIVE_INFINITY, theta: -1, vega: 10 }).success).toBe(false);
    expect(Greeks.safeParse({ delta: 0.5, gamma: 0.0001, theta: -1 }).success).toBe(false);
  });
});

describe("[SCHEMA] Quote", () => {
  it("accepts a full quote and a minimal quote", () => {
    expect(Quote.safeParse(quote).success).toBe(true);
    expect(
      Quote.safeParse({ instrumentId: quote.instrumentId, ts: 1, mark: "1", oi: "0", spot: "79521" }).success,
    ).toBe(true);
  });
  it("rejects numeric prices, negative IV and bad ids", () => {
    expect(Quote.safeParse({ ...quote, mark: 1290.81 }).success).toBe(false);
    expect(Quote.safeParse({ ...quote, markIv: -0.1 }).success).toBe(false);
    expect(Quote.safeParse({ ...quote, markIv: "0.42" }).success).toBe(false);
    expect(Quote.safeParse({ ...quote, instrumentId: "BTCUSD" }).success).toBe(false);
    expect(Quote.safeParse({ ...quote, ts: -5 }).success).toBe(false);
    expect(Quote.safeParse({ ...quote, greeks: { delta: 1 } }).success).toBe(false);
    expect(Quote.safeParse({ ...quote, change24hPct: Number.NaN }).success).toBe(false);
  });
  it("strips unknown keys rather than failing (forward compatible)", () => {
    const r = Quote.safeParse({ ...quote, extra: 1 });
    expect(r.success).toBe(true);
    expect(r.data).not.toHaveProperty("extra");
  });
});

describe("GAPS-1 ChainRow / ChainSnapshot ordering", () => {
  const row = (strike: string): ChainRow => ({ strike, call: { ...quote }, put: { ...quote } });
  const snap = (rows: ChainRow[]): ChainSnapshot => ({
    venue: "delta_india",
    underlying: "BTC",
    expiry: "2026-09-25",
    ts: 1788543685911,
    spot: "79528.1",
    rows,
  });

  it("ChainRow accepts strike only, one side, or both", () => {
    expect(ChainRow.safeParse({ strike: "80000" }).success).toBe(true);
    expect(ChainRow.safeParse({ strike: "80000", call: quote }).success).toBe(true);
    expect(ChainRow.safeParse(row("80000")).success).toBe(true);
    expect(ChainRow.safeParse({ strike: 80000 }).success).toBe(false);
    expect(ChainRow.safeParse({ strike: "80000", put: { mark: "1" } }).success).toBe(false);
  });
  it("accepts an empty chain and an ascending, irregular ladder (200/400/600 steps)", () => {
    expect(ChainSnapshot.safeParse(snap([])).success).toBe(true);
    expect(ChainSnapshot.safeParse(snap(["78000", "78200", "78600", "79000", "80000", "81000"].map(row))).success).toBe(
      true,
    );
  });
  it("compares strikes numerically, not lexically", () => {
    expect(ChainSnapshot.safeParse(snap(["9000", "10000", "10000.5"].map(row))).success).toBe(true);
    expect(ChainSnapshot.safeParse(snap(["10000", "9000"].map(row))).success).toBe(false);
  });
  it("rejects duplicate strikes with the offending row in the path", () => {
    const r = ChainSnapshot.safeParse(snap(["80000", "80000.0"].map(row)));
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]?.path).toEqual(["rows", 1, "strike"]);
    expect(r.error?.issues[0]?.message).toMatch(/duplicate/);
  });
  it("rejects descending strikes with the offending row in the path", () => {
    const r = ChainSnapshot.safeParse(snap(["80000", "81000", "80500"].map(row)));
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]?.path).toEqual(["rows", 2, "strike"]);
    expect(r.error?.issues[0]?.message).toMatch(/sorted ascending/);
  });
  it("rejects header errors", () => {
    expect(ChainSnapshot.safeParse({ ...snap([]), expiry: "25SEP26" }).success).toBe(false);
    expect(ChainSnapshot.safeParse({ ...snap([]), spot: 79528.1 }).success).toBe(false);
    expect(ChainSnapshot.safeParse({ ...snap([]), underlying: "SOL" }).success).toBe(false);
  });
  it("refineChainRows can be reused with a default base path", () => {
    const schema = z.array(z.object({ strike: z.string() })).superRefine((rows, ctx) => {
      refineChainRows(rows, ctx);
    });
    const r = schema.safeParse([{ strike: "2" }, { strike: "1" }]);
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]?.path).toEqual([1, "strike"]);
  });
});
