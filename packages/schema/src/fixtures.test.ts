// Proves the shared shapes fit real Delta India data. The adapters below are test-only: the real
// venue adapter lives in @hapiecoin/venues. Fixtures are read from spec/fixtures (no network).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ChainSnapshot, Instrument, Quote, makeInstrumentId } from "./market.js";
import type { ChainRow } from "./market.js";
import { DecimalString, Underlying } from "./primitives.js";

const fixturesDir = new URL("../../../spec/fixtures/", import.meta.url);
function loadFixture(name: string): unknown[] {
  const raw: unknown = JSON.parse(readFileSync(new URL(name, fixturesDir), "utf8"));
  const parsed = z.object({ result: z.array(z.unknown()) }).parse(raw);
  return parsed.result;
}

/** Only the venue fields the adapters need; everything else on the wire is ignored. */
const DeltaProduct = z.object({
  id: z.number().int(),
  symbol: z.string(),
  contract_type: z.enum(["call_options", "put_options"]),
  strike_price: z.string(),
  settlement_time: z.string(),
  contract_value: z.string(),
  tick_size: z.string(),
  state: z.string(),
  underlying_asset: z.object({ symbol: Underlying }),
  quoting_asset: z.object({ symbol: z.enum(["USD"]) }),
});

const DeltaTicker = z.object({
  symbol: z.string(),
  strike_price: z.string(),
  mark_price: z.string(),
  spot_price: z.string(),
  oi: z.string(),
  volume: z.number(),
  mark_vol: z.string(),
  mark_change_24h: z.string(),
  timestamp: z.number(),
  greeks: z.object({ delta: z.string(), gamma: z.string(), theta: z.string(), vega: z.string(), rho: z.string() }),
  quotes: z.object({
    best_bid: z.string(),
    best_ask: z.string(),
    bid_iv: z.string(),
    ask_iv: z.string(),
    bid_size: z.string(),
    ask_size: z.string(),
  }),
});

/** Delta writes numbers with long zero tails ("0.001000000000000000"); trim them so ids stay canonical. */
function trimDecimal(s: string): string {
  return s.includes(".") ? s.replace(/0+$/, "").replace(/\.$/, "") : s;
}

function toInstrument(p: z.infer<typeof DeltaProduct>): Instrument {
  return Instrument.parse({
    id: makeInstrumentId("delta_india", p.symbol),
    venue: "delta_india",
    symbol: p.symbol,
    underlying: p.underlying_asset.symbol,
    kind: p.contract_type === "call_options" ? "call" : "put",
    strike: trimDecimal(p.strike_price),
    expiry: p.settlement_time.slice(0, 10),
    settlementTime: p.settlement_time,
    contractSize: trimDecimal(p.contract_value),
    tickSize: trimDecimal(p.tick_size),
    quoteCurrency: p.quoting_asset.symbol,
    venueProductId: p.id,
    isActive: p.state === "live",
  });
}

function toQuote(t: z.infer<typeof DeltaTicker>): Quote {
  return Quote.parse({
    instrumentId: makeInstrumentId("delta_india", t.symbol),
    ts: Math.floor(t.timestamp / 1000),
    mark: trimDecimal(t.mark_price),
    bid: t.quotes.best_bid,
    ask: t.quotes.best_ask,
    markIv: Number(t.mark_vol),
    bidIv: Number(t.quotes.bid_iv),
    askIv: Number(t.quotes.ask_iv),
    oi: trimDecimal(t.oi),
    volume24h: t.volume.toFixed(3),
    bidQty: t.quotes.bid_size,
    askQty: t.quotes.ask_size,
    spot: trimDecimal(t.spot_price),
    greeks: {
      delta: Number(t.greeks.delta),
      gamma: Number(t.greeks.gamma),
      theta: Number(t.greeks.theta),
      vega: Number(t.greeks.vega),
      rho: Number(t.greeks.rho),
    },
    change24hPct: Number(t.mark_change_24h),
  });
}

describe("HC-WS-016 Delta products fixture fits Instrument", () => {
  const products = loadFixture("delta-products.json").slice(0, 50).map((p) => DeltaProduct.parse(p));

  it("has 50 products to test", () => {
    expect(products).toHaveLength(50);
  });
  it("every product maps to a valid Instrument with a strike from the venue list", () => {
    const instruments = products.map(toInstrument);
    expect(instruments).toHaveLength(50);
    for (const inst of instruments) {
      expect(inst.id).toBe(`delta_india:${inst.symbol}`);
      expect(inst.kind === "call" || inst.kind === "put").toBe(true);
      expect(DecimalString.safeParse(inst.strike).success).toBe(true);
      expect(inst.expiry).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(inst.isActive).toBe(true);
    }
    expect(new Set(instruments.map((i) => i.underlying))).toEqual(new Set(["XAUT", "BTC", "ETH"]));
  });
  it("uses the documented contract sizes", () => {
    const sizes = new Map<string, Set<string>>();
    for (const inst of products.map(toInstrument)) {
      const set = sizes.get(inst.underlying) ?? new Set<string>();
      set.add(inst.contractSize);
      sizes.set(inst.underlying, set);
    }
    expect(sizes.get("BTC")).toEqual(new Set(["0.001"]));
    expect(sizes.get("ETH")).toEqual(new Set(["0.01"]));
    expect(sizes.get("XAUT")).toEqual(new Set(["0.001"]));
  });
});

describe("HC-WS-018 Delta tickers fixture fits Quote and ChainSnapshot", () => {
  const tickers = loadFixture("delta-tickers.json").slice(0, 50).map((t) => DeltaTicker.parse(t));

  it("has 50 tickers to test", () => {
    expect(tickers).toHaveLength(50);
  });
  it("every ticker maps to a valid Quote with IV as a fraction and greeks as numbers", () => {
    const quotes = tickers.map(toQuote);
    for (const q of quotes) {
      expect(q.markIv).toBeGreaterThan(0);
      expect(q.markIv).toBeLessThan(5);
      expect(q.greeks?.delta).toBeGreaterThanOrEqual(0);
      expect(q.greeks?.delta).toBeLessThanOrEqual(1);
      expect(q.ts).toBeGreaterThan(1_700_000_000_000);
      expect(q.ts).toBeLessThan(2_000_000_000_000);
    }
  });
  it("tickers of one expiry assemble into a sorted ChainSnapshot", () => {
    const byExpiry = new Map<string, ChainRow[]>();
    for (const t of tickers) {
      const expiry = t.symbol.split("-")[3] as string; // DDMMYY
      const rows = byExpiry.get(expiry) ?? [];
      rows.push({ strike: trimDecimal(t.strike_price), call: toQuote(t) });
      byExpiry.set(expiry, rows);
    }
    const [expiry, rows] = [...byExpiry.entries()].sort((a, b) => b[1].length - a[1].length)[0] as [string, ChainRow[]];
    expect(rows.length).toBeGreaterThan(1);
    const iso = `20${expiry.slice(4, 6)}-${expiry.slice(2, 4)}-${expiry.slice(0, 2)}`;
    const sorted = [...rows].sort((a, b) => Number(a.strike) - Number(b.strike));
    const snap = ChainSnapshot.parse({
      venue: "delta_india",
      underlying: "BTC",
      expiry: iso,
      ts: sorted[0]?.call?.ts,
      spot: sorted[0]?.call?.spot,
      rows: sorted,
    });
    expect(snap.rows).toHaveLength(rows.length);
    // The same rows in fixture order (descending strikes) are rejected by the ordering refinement.
    expect(ChainSnapshot.safeParse({ ...snap, rows }).success).toBe(rows.every((r, i) => r === sorted[i]));
  });
});
