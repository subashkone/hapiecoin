/**
 * Delta Exchange India behind the venue port (ADR-063), the browser-safe core: every value here is what the
 * apps hard-coded before. Contract sizes and ticks from the recorded product list
 * (spec/fixtures/delta-products.json), settlement at 12:00 UTC (16:00 for XAUT), USD quoting and settlement,
 * the seed broker's fee defaults, the symbol format the web client already produced. The REST, market-data
 * and trading factories live in ./delta-india-clients.ts, which pulls in node:crypto and stays server-side
 * (ADR-064).
 */
import type { Underlying } from "@hapiecoin/schema";
import {
  DEFAULT_SETTLEMENT_HOUR_UTC,
  expirySettlementIso,
  isOptionSymbol,
  parseOptionSymbol,
} from "../delta/normalize.js";
import {
  SCHEMA_VENUE,
  isSchemaInstrument,
  schemaInstrumentId,
  toSchemaChainRows,
  toSchemaChainSnapshot,
  toSchemaInstrument,
  toSchemaQuote,
} from "../schema-adapter.js";
import { type MarketSpec, type OptionKind, type VenueCore, ownMarket } from "./adapter.js";

function market(underlying: Underlying, multiplier: string, tickSize: string, settlementHourUtc: number): MarketSpec {
  return {
    underlying,
    quoteCcy: "USD",
    settleCcy: "USD",
    multiplier,
    lotSize: multiplier,
    tickSize,
    exerciseStyle: "european",
    settlementHourUtc,
    timezone: "UTC",
    isInverse: false,
    perpetualSymbol: `${underlying}USD`,
  };
}

/** Linear USD contracts: one lot is one contract by default; XAUT options settle at 16:00 UTC, the others at 12:00. */
export const DELTA_INDIA_MARKETS: Readonly<Record<Underlying, MarketSpec>> = {
  BTC: market("BTC", "0.001", "0.1", DEFAULT_SETTLEMENT_HOUR_UTC),
  ETH: market("ETH", "0.01", "0.01", DEFAULT_SETTLEMENT_HOUR_UTC),
  XAUT: market("XAUT", "0.001", "0.01", 16),
};

/** The option half of the web client's former `deltaSymbol` (its future branch is `symbols.perpetual`): integral strikes print without decimals, the expiry as DDMMYY; an unparseable date passes through. */
export function formatDeltaOption(kind: OptionKind, underlying: string, strike: string, expiryDate: string): string {
  const [y, m, d] = expiryDate.split("-");
  const code = d && m && y ? `${d}${m}${y.slice(2)}` : expiryDate;
  const k = Number(strike);
  const s = Number.isFinite(k) && Number.isInteger(k) ? String(k) : strike;
  return `${kind === "call" ? "C" : "P"}-${underlying}-${s}-${code}`;
}

const PERPETUAL = /^([A-Z]+)USD$/;

/** "BTCUSD" -> "BTC"; null for anything that is not a perpetual symbol. */
export function parseDeltaPerpetual(symbol: string): string | null {
  const m = PERPETUAL.exec(symbol);
  return m?.[1] ?? null;
}

function settlementHour(underlying: string): number {
  return ownMarket(DELTA_INDIA_MARKETS, underlying)?.settlementHourUtc ?? DEFAULT_SETTLEMENT_HOUR_UTC;
}

export const DELTA_INDIA_CORE: VenueCore = {
  id: SCHEMA_VENUE,
  label: "Delta Exchange India",
  underlyings: ["BTC", "ETH", "XAUT"],
  markets: DELTA_INDIA_MARKETS,
  symbols: {
    isOption: isOptionSymbol,
    parseOption: parseOptionSymbol,
    formatOption: formatDeltaOption,
    perpetual: (underlying) => `${underlying}USD`,
    parsePerpetual: parseDeltaPerpetual,
  },
  calendar: {
    settlementHourUtc: settlementHour,
    expirySettlementIso: (code, underlying) => expirySettlementIso(code, settlementHour(underlying)),
  },
  fees: { feePct: "0.05", gstPct: "18", feeCapPct: "10", basis: "spot-notional" },
  capabilities: {
    options: true,
    perpetuals: true,
    liveTrading: true,
    greeksFromVenue: true,
    oiInCompactTicker: false,
    spotFallback: "binance",
  },
  schema: {
    isSupported: isSchemaInstrument,
    instrumentId: schemaInstrumentId,
    instrument: toSchemaInstrument,
    quote: toSchemaQuote,
    chainRows: toSchemaChainRows,
    chainSnapshot: toSchemaChainSnapshot,
  },
};
