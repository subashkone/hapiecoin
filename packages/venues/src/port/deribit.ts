/**
 * Deribit behind the venue port, the browser-safe core (ADR-067): BTC and ETH options, inverse contracts of one
 * coin settling at 08:00 UTC, data-only (no trading factory, so `tradingClientOf` refuses it). Prices reach the
 * app in USD per underlying unit (the adapter converts with the index), so the market spec says USD quoting,
 * coin settlement and `isInverse: true`. Deribit publishes its own index on every ticker, so no spot fallback.
 */
import type { Underlying } from "@hapiecoin/schema";
import { DERIBIT_SETTLEMENT_HOUR_UTC, formatDeribitOption, isDeribitOption, parseDeribitOption, parseDeribitPerpetual } from "../deribit/normalize.js";
import { dateToExpiryCode, expiryCodeToDate } from "../delta/normalize.js";
import { isSchemaInstrument, schemaInstrumentId, toSchemaChainRows, toSchemaChainSnapshot, toSchemaInstrument, toSchemaQuote } from "../schema-adapter.js";
import { type MarketSpec, type OptionKind, type VenueCore, ownMarket } from "./adapter.js";

function market(underlying: Underlying, tickSize: string): MarketSpec {
  return {
    underlying,
    quoteCcy: "USD",
    settleCcy: underlying,
    /** One coin per contract; the venue's minimum order is 0.1 contract, so a lot defaults to that. */
    multiplier: "1",
    lotSize: "0.1",
    /** The venue tick in the coin (0.0001 BTC); prices shown in USD move by tick × index. */
    tickSize,
    exerciseStyle: "european",
    settlementHourUtc: DERIBIT_SETTLEMENT_HOUR_UTC,
    timezone: "UTC",
    isInverse: true,
    perpetualSymbol: `${underlying}-PERPETUAL`,
  };
}

/** From spec/fixtures/deribit-instruments-btc.json (11 Sep 2026): contract_size 1, tick_size 0.0001, min_trade_amount 0.1; ETH options tick 0.0005. */
export const DERIBIT_MARKETS: Readonly<Partial<Record<Underlying, MarketSpec>>> = {
  BTC: market("BTC", "0.0001"),
  ETH: market("ETH", "0.0005"),
};

function settlementHour(): number {
  return DERIBIT_SETTLEMENT_HOUR_UTC;
}

export const DERIBIT_CORE: VenueCore = {
  id: "deribit",
  label: "Deribit",
  underlyings: ["BTC", "ETH"],
  markets: DERIBIT_MARKETS,
  symbols: {
    isOption: isDeribitOption,
    parseOption: (symbol) => {
      const p = parseDeribitOption(symbol);
      return { kind: p.kind, underlying: p.underlying, strike: p.strike, expiryCode: p.expiryCode, expiryDate: p.expiryDate };
    },
    formatOption: (kind: OptionKind, underlying, strike, expiryDate) => formatDeribitOption(kind, underlying, strike, expiryDate),
    perpetual: (underlying) => `${underlying}-PERPETUAL`,
    parsePerpetual: parseDeribitPerpetual,
  },
  calendar: {
    settlementHourUtc: settlementHour,
    expirySettlementIso: (code) => new Date(`${expiryCodeToDate(code)}T08:00:00.000Z`).toISOString(),
  },
  /** Data-only: nothing is traded here, so the fee defaults are zero. */
  fees: { feePct: "0", gstPct: "0", feeCapPct: "0", basis: "spot-notional" },
  capabilities: {
    options: true,
    perpetuals: true,
    liveTrading: false,
    greeksFromVenue: true,
    oiInCompactTicker: true,
    spotFallback: null,
  },
  schema: {
    isSupported: isSchemaInstrument,
    instrumentId: (symbol) => schemaInstrumentId(symbol, "deribit"),
    instrument: toSchemaInstrument,
    quote: toSchemaQuote,
    chainRows: toSchemaChainRows,
    chainSnapshot: toSchemaChainSnapshot,
  },
};

/** The internal expiry code of a Deribit name, for callers holding only the venue label ("25SEP26"). */
export function deribitLabelToExpiryCode(label: string): string {
  return dateToExpiryCode(parseDeribitOption(`BTC-${label}-1-C`).expiryDate);
}

/** Spec lookup for the port helpers (own keys only). */
export function deribitMarket(underlying: string): MarketSpec | undefined {
  return ownMarket(DERIBIT_MARKETS, underlying);
}
