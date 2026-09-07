import { ChainRow, ChainSnapshot, Instrument, Quote } from "@hapiecoin/schema";
import { describe, expect, it } from "vitest";
import { buildChain, listExpiries } from "./delta/chain.js";
import { compactToQuote, toInstrument, toQuote } from "./delta/normalize.js";
import { RawProductsResponse, RawTickersResponse, RawWsCompactTicker } from "./delta/raw.js";
import type { RawProduct } from "./delta/raw.js";
import {
  SCHEMA_VENUE,
  SchemaAdapterError,
  isSchemaInstrument,
  latestSpot,
  schemaInstrumentId,
  toSchemaChainRows,
  toSchemaChainSnapshot,
  toSchemaInstrument,
  toSchemaQuote,
} from "./schema-adapter.js";
import {
  LIVE_COMPACT_TICKER_FRAME,
  loadProductsFixture,
  loadTickersFixture,
} from "./test-support/fixtures.js";
import type { Instrument as VenueInstrument, Quote as VenueQuote } from "./types.js";

const NOW = Date.parse("2026-09-04T12:00:00Z");
const products = RawProductsResponse.parse(loadProductsFixture()).result;
const instruments = products.map(toInstrument);
const quotes = RawTickersResponse.parse(loadTickersFixture()).result.map((t) => toQuote(t, NOW));

const PERP_PRODUCT: RawProduct = {
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

const FUTURE_PRODUCT: RawProduct = {
  ...PERP_PRODUCT,
  id: 28,
  symbol: "BTCUSD-250926",
  contract_type: "futures",
  settlement_time: "2026-09-25T12:00:00Z",
};

describe("[VENUES] schema adapter: instruments", () => {
  it("[VENUES] every option in the products fixture passes @hapiecoin/schema Instrument.parse", () => {
    expect(instruments).toHaveLength(972);
    for (const inst of instruments) {
      expect(isSchemaInstrument(inst)).toBe(true);
      const adapted = toSchemaInstrument(inst);
      expect(Instrument.parse(adapted)).toEqual(adapted);
      expect(adapted.venue).toBe(SCHEMA_VENUE);
      expect(adapted.id).toBe(schemaInstrumentId(inst.symbol));
      expect(adapted.strike).toBe(inst.strike);
      expect(adapted.expiry).toBe(inst.expiryDate);
      expect(adapted.contractSize).toBe(inst.contractValue);
      expect(adapted.venueProductId).toBe(inst.id);
      expect(adapted.isActive).toBe(true);
    }
  });

  it("[VENUES] maps a perpetual (no expiry, no strike) and a dated future (expiry, no strike)", () => {
    const perp = toSchemaInstrument(toInstrument(PERP_PRODUCT));
    expect(Instrument.parse(perp)).toEqual(perp);
    expect(perp).toMatchObject({
      kind: "perpetual",
      symbol: "BTCUSD",
      contractSize: "0.001",
      tickSize: "0.5",
    });
    expect(perp).not.toHaveProperty("expiry");
    expect(perp).not.toHaveProperty("strike");
    expect(perp).not.toHaveProperty("settlementTime");

    const future = toSchemaInstrument(toInstrument(FUTURE_PRODUCT));
    expect(Instrument.parse(future)).toEqual(future);
    expect(future).toMatchObject({
      kind: "future",
      expiry: "2026-09-25",
      settlementTime: "2026-09-25T12:00:00Z",
    });
    expect(future).not.toHaveProperty("strike");
  });

  it("[VENUES] rejects records the schema cannot hold with SchemaAdapterError", () => {
    const base = toInstrument(PERP_PRODUCT);
    const other: VenueInstrument = { ...base, kind: "other" };
    expect(isSchemaInstrument(other)).toBe(false);
    expect(() => toSchemaInstrument(other)).toThrow(SchemaAdapterError);

    const sol: VenueInstrument = { ...base, underlying: "SOL" };
    expect(isSchemaInstrument(sol)).toBe(false);
    expect(() => toSchemaInstrument(sol)).toThrow(/underlying SOL/);

    const eur: VenueInstrument = { ...base, quoteAsset: "EUR" };
    expect(() => toSchemaInstrument(eur)).toThrow(/quote asset EUR/);

    const optionNoStrike: VenueInstrument = { ...instruments[0]!, strike: null };
    expect(() => toSchemaInstrument(optionNoStrike)).toThrow(/without a strike/);

    const futureNoExpiry: VenueInstrument = { ...toInstrument(FUTURE_PRODUCT), expiryDate: null };
    const error = (() => {
      try {
        toSchemaInstrument(futureNoExpiry);
        return null;
      } catch (e) {
        return e as SchemaAdapterError;
      }
    })();
    expect(error).toBeInstanceOf(SchemaAdapterError);
    expect(error?.symbol).toBe("BTCUSD-250926");
    expect(error?.reason).toMatch(/without an expiry/);
    expect(error?.name).toBe("SchemaAdapterError");
  });
});

describe("[VENUES] schema adapter: quotes", () => {
  it("[VENUES] every ticker in the fixture passes Quote.parse with the renamed fields", () => {
    expect(quotes).toHaveLength(307);
    for (const q of quotes) {
      const adapted = toSchemaQuote(q);
      expect(Quote.parse(adapted)).toEqual(adapted);
      expect(adapted.instrumentId).toBe(`delta_india:${q.symbol}`);
      expect(adapted.ts).toBe(q.venueTs);
      expect(adapted.oi).toBe(q.oiContracts);
      expect(adapted.bidQty).toBe(q.bidSize);
      expect(adapted.askQty).toBe(q.askSize);
      expect(adapted.volume24h).toBe(q.volume ?? undefined);
      expect(adapted.spot).toBe(q.spot);
      expect(adapted.greeks).toEqual(q.greeks);
    }
  });

  it("[VENUES] omits nullable fields instead of emitting null, and uses the fallback spot", () => {
    const first = quotes[0]!;
    const sparse: VenueQuote = {
      ...first,
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
    };
    const adapted = toSchemaQuote(sparse, "79521");
    expect(Quote.parse(adapted)).toEqual(adapted);
    expect(adapted).toEqual({
      instrumentId: `delta_india:${first.symbol}`,
      ts: first.venueTs,
      mark: first.mark,
      oi: "0",
      spot: "79521",
    });
    expect(() => toSchemaQuote(sparse)).toThrow(SchemaAdapterError);
    expect(() => toSchemaQuote(sparse, null)).toThrow(/without a spot/);
  });

  it("[VENUES] drops a negative IV (perpetual compact frame) so the schema's non-negative IV holds", () => {
    const frame = RawWsCompactTicker.parse(LIVE_COMPACT_TICKER_FRAME);
    const q = compactToQuote(frame.d[0]!, frame, NOW);
    expect(q.markIv).toBeLessThan(0);
    const adapted = toSchemaQuote(q);
    expect(Quote.parse(adapted)).toEqual(adapted);
    expect(adapted).not.toHaveProperty("markIv");
    expect(adapted).not.toHaveProperty("bidIv");
    expect(adapted).not.toHaveProperty("askIv");
    expect(adapted).not.toHaveProperty("greeks");
    expect(adapted.oi).toBe("876853");
    expect(adapted.spot).toBe("79777.9");

    const withIv: VenueQuote = { ...q, markIv: 0.4, bidIv: 0.39, askIv: 0 };
    expect(toSchemaQuote(withIv)).toMatchObject({ markIv: 0.4, bidIv: 0.39, askIv: 0 });
  });
});

describe("[GAPS-1] schema adapter: chain rows keep the instrument-list strikes", () => {
  it("[GAPS-1] BTC 25SEP26 rows pass ChainRow.parse and ChainSnapshot.parse with 52 strikes from the list", () => {
    const chain = buildChain({ instruments, quotes, underlying: "BTC", expiry: "25SEP26", nowMs: NOW });
    const rows = toSchemaChainRows(chain.rows);
    expect(rows).toHaveLength(52);
    expect(rows.map((r) => r.strike)).toEqual(chain.strikes);
    for (const row of rows) expect(ChainRow.parse(row)).toEqual(row);
    // the fixture has call tickers only: put sides are omitted, not null
    expect(rows.every((r) => !("put" in r))).toBe(true);
    expect(rows.filter((r) => r.call).length).toBe(chain.quoted);

    const snapshot = toSchemaChainSnapshot(chain);
    expect(ChainSnapshot.parse(snapshot)).toEqual(snapshot);
    expect(snapshot).toMatchObject({
      venue: "delta_india",
      underlying: "BTC",
      expiry: "2026-09-25",
      ts: NOW,
    });
    expect(snapshot.spot).toBe(chain.spot);
  });

  it("[GAPS-1] every BTC/ETH/XAUT expiry adapts to a valid ChainSnapshot (spot falls back when unquoted)", () => {
    for (const underlying of ["BTC", "ETH", "XAUT"]) {
      for (const expiry of listExpiries(instruments, underlying, NOW)) {
        const chain = buildChain({ instruments, quotes, underlying, expiry: expiry.code, nowMs: NOW });
        const snapshot = toSchemaChainSnapshot(chain, "1");
        expect(ChainSnapshot.parse(snapshot)).toEqual(snapshot);
        expect(snapshot.rows.map((r) => r.strike)).toEqual(chain.strikes);
      }
    }
  });

  it("[GAPS-1] chain spot fallback order: quote spot, then latest spot in the rows, then the caller's fallback", () => {
    const chain = buildChain({ instruments, quotes: [], underlying: "ETH", expiry: "25SEP26", nowMs: NOW });
    expect(chain.spot).toBeNull();
    expect(latestSpot(chain.rows)).toBeNull();
    expect(() => toSchemaChainSnapshot(chain)).toThrow(SchemaAdapterError);
    expect(toSchemaChainSnapshot(chain, "2400").spot).toBe("2400");
    expect(toSchemaChainRows(chain.rows)).toEqual(chain.rows.map((r) => ({ strike: r.strike })));

    const btc = buildChain({ instruments, quotes, underlying: "BTC", expiry: "25SEP26", nowMs: NOW });
    const row = btc.rows.find((r) => r.call?.quote)!;
    const put = btc.rows.find((r) => r.put)!;
    const noSpot: VenueQuote = { ...row.call!.quote!, spot: null, venueTs: 1 };
    const rows = toSchemaChainRows([
      { strike: "1", call: { instrument: row.call!.instrument, quote: noSpot }, put: null },
      {
        strike: "2",
        call: null,
        put: { instrument: put.put!.instrument, quote: { ...noSpot, spot: "5", venueTs: 2 } },
      },
    ]);
    expect(rows[0]!.call!.spot).toBe("5");
    expect(rows[1]!.put!.spot).toBe("5");
    expect(latestSpot([{ strike: "1", call: null, put: null }])).toBeNull();

    const bad: VenueInstrument = { ...instruments[0]!, underlying: "SOL" };
    const solChain = { ...btc, underlying: "SOL", rows: [], strikes: [] };
    expect(() => toSchemaChainSnapshot(solChain)).toThrow(/underlying SOL/);
    expect(isSchemaInstrument(bad)).toBe(false);
  });
});
