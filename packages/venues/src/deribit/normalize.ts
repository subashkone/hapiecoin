/**
 * Pure Deribit -> venue-neutral shapes (ADR-067). Deribit options are inverse contracts of one coin, quoted and
 * settled in the coin: the adapter converts every price to USD per underlying unit with the index
 * (premium = mark × index, the USD the coin is worth now), so the chain, the engine and the client keep their
 * one convention. Greeks come through unchanged: a live comparison against Black-76 on the venue's forward
 * (spec/fixtures/deribit-tickers.json) showed delta, gamma, vega per vol point and theta per day equal to the
 * engine's per-unit greeks. Names are BASE-DDMMMYY-STRIKE-C|P with decimal strikes written "0d5"; the internal
 * expiry code stays DDMMYY so the chain helpers work for both venues.
 */
import { canonDecimal, numberToDecimal } from "../decimal.js";
import { InvalidSymbolError } from "../errors.js";
import type { Greeks, Instrument, InstrumentKind, Quote } from "../types.js";
import { dateToExpiryCode } from "../delta/normalize.js";
import type { RawBookSummary, RawInstrument, RawTicker } from "./raw.js";

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"] as const;
const OPTION_NAME = /^([A-Z0-9_]+)-(\d{1,2})([A-Z]{3})(\d{2})-(\d+(?:d\d+)?)-([CP])$/;
const PERPETUAL_NAME = /^([A-Z0-9_]+)-PERPETUAL$/;

/** Options settle at 08:00 UTC on the expiry date. */
export const DERIBIT_SETTLEMENT_HOUR_UTC = 8;

export interface ParsedDeribitOption {
  kind: "call" | "put";
  underlying: string;
  /** Canonical decimal string ("80000", "0.5"). */
  strike: string;
  /** Venue label "25SEP26". */
  label: string;
  /** "YYYY-MM-DD". */
  expiryDate: string;
  /** Internal "DDMMYY" code, shared with the chain helpers. */
  expiryCode: string;
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** "BTC-25SEP26-80000-C" -> parts; throws InvalidSymbolError for anything else (including an impossible date). */
export function parseDeribitOption(name: string): ParsedDeribitOption {
  const m = OPTION_NAME.exec(name);
  if (!m) throw new InvalidSymbolError(name, "expected BASE-DDMMMYY-STRIKE-C|P");
  const month = MONTHS.indexOf(m[3] as (typeof MONTHS)[number]);
  if (month < 0) throw new InvalidSymbolError(name, `unknown month ${m[3]}`);
  const day = Number(m[2]);
  const year = 2000 + Number(m[4]);
  const d = new Date(Date.UTC(year, month, day));
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month || d.getUTCDate() !== day) throw new InvalidSymbolError(name, "not a calendar date");
  const expiryDate = `${year}-${pad2(month + 1)}-${pad2(day)}`;
  return {
    kind: m[6] === "C" ? "call" : "put",
    underlying: m[1] ?? "",
    strike: canonDecimal((m[5] ?? "0").replace("d", ".")),
    label: `${m[2]}${m[3]}${m[4]}`,
    expiryDate,
    expiryCode: dateToExpiryCode(expiryDate),
  };
}

export function isDeribitOption(name: string): boolean {
  return OPTION_NAME.test(name);
}

/** "BTC-PERPETUAL" -> "BTC"; null otherwise. */
export function parseDeribitPerpetual(name: string): string | null {
  return PERPETUAL_NAME.exec(name)?.[1] ?? null;
}

/** "call", "BTC", "80000", "2026-09-25" -> "BTC-25SEP26-80000-C" (a decimal strike prints with "d"). */
export function formatDeribitOption(kind: "call" | "put", underlying: string, strike: string, expiryDate: string): string {
  const [y, mo, d] = expiryDate.split("-");
  const month = MONTHS[Number(mo) - 1];
  // the venue writes the day without a leading zero ("BTC-2OCT26-...")
  const label = d && month && y ? `${Number(d)}${month}${y.slice(2)}` : expiryDate;
  const k = Number(strike);
  const s = (Number.isFinite(k) && Number.isInteger(k) ? String(k) : strike).replace(".", "d");
  return `${underlying}-${label}-${s}-${kind === "call" ? "C" : "P"}`;
}

function kindOf(raw: RawInstrument): InstrumentKind {
  if (raw.kind === "option") return raw.option_type ?? "other";
  if (raw.kind === "future") return raw.settlement_period === "perpetual" ? "perpetual" : "future";
  return "other";
}

/** Raw instrument -> Instrument. Strikes and expiries come from the venue record (ADR-006); prices are USD after conversion, so the quote asset is USD. */
export function toDeribitInstrument(raw: RawInstrument): Instrument {
  const kind = kindOf(raw);
  const settlementTime = new Date(raw.expiration_timestamp).toISOString();
  const dated = kind === "call" || kind === "put" || kind === "future";
  const expiryDate = dated ? settlementTime.slice(0, 10) : null;
  return {
    venue: "deribit",
    id: raw.instrument_id,
    symbol: raw.instrument_name,
    kind,
    underlying: raw.base_currency,
    quoteAsset: raw.counter_currency ?? "USD",
    settlingAsset: raw.settlement_currency ?? raw.base_currency,
    strike: raw.strike === undefined ? null : canonDecimal(numberToDecimal(raw.strike)),
    expiryCode: expiryDate === null ? null : dateToExpiryCode(expiryDate),
    expiryDate,
    settlementTime: kind === "perpetual" ? null : settlementTime,
    /** Coin units per contract (1 for options); the tick stays in the coin, this venue is data-only. */
    contractValue: canonDecimal(numberToDecimal(raw.contract_size)),
    tickSize: canonDecimal(numberToDecimal(raw.tick_size)),
    // the shared vocabulary of the schema bridge (`isActive` is `state === "live"`), not the venue's "open" / "closed"
    state: raw.is_active ? "live" : "expired",
    tradingStatus: raw.is_active ? "operational" : "inactive",
  };
}

/** Coin price × index -> USD per underlying unit as a decimal string; null when either is missing or not positive. */
export function coinToUsd(price: number | null | undefined, index: number): string | null {
  if (price === null || price === undefined || !Number.isFinite(price) || !(index > 0)) return null;
  return numberToDecimal(price * index);
}

function pct(value: number | null | undefined): number | null {
  return value === null || value === undefined || !Number.isFinite(value) || value <= 0 ? null : value / 100;
}

function greeksOf(raw: RawTicker["greeks"]): Greeks | null {
  if (!raw) return null;
  const { delta, gamma, theta, vega, rho } = raw;
  return [delta, gamma, theta, vega, rho].every((g) => Number.isFinite(g)) ? { delta, gamma, theta, vega, rho } : null;
}

function coinAmount(value: number | null | undefined): string | null {
  return value === null || value === undefined || !Number.isFinite(value) ? null : numberToDecimal(value);
}

/** Ticker (REST result or WS notification data) -> Quote in USD per underlying unit; `instrumentId` from the instrument list. Null without a usable index (nothing to convert with). */
export function toDeribitQuote(ticker: RawTicker, instrumentId: number, nowMs: number = Date.now()): Quote | null {
  const index = ticker.index_price;
  if (!(index > 0)) return null;
  return {
    venue: "deribit",
    symbol: ticker.instrument_name,
    instrumentId,
    mark: coinToUsd(ticker.mark_price, index) ?? "0",
    bid: coinToUsd(ticker.best_bid_price, index),
    ask: coinToUsd(ticker.best_ask_price, index),
    bidSize: coinAmount(ticker.best_bid_amount),
    askSize: coinAmount(ticker.best_ask_amount),
    markIv: pct(ticker.mark_iv),
    bidIv: pct(ticker.bid_iv),
    askIv: pct(ticker.ask_iv),
    greeks: greeksOf(ticker.greeks),
    oi: coinAmount(ticker.open_interest),
    // one contract is one coin, so contracts and coin units coincide
    oiContracts: coinAmount(ticker.open_interest),
    volume: coinAmount(ticker.stats?.volume),
    spot: numberToDecimal(index),
    venueTs: ticker.timestamp,
    receivedAt: nowMs,
  };
}

/** Book-summary row -> Quote (the REST seed: no greeks; the delivery estimate stands in for the index). */
export function bookSummaryToQuote(row: RawBookSummary, instrumentId: number, nowMs: number = Date.now()): Quote | null {
  const index = row.estimated_delivery_price ?? null;
  if (row.mark_price === null || row.mark_price === undefined || index === null || !(index > 0)) return null;
  return {
    venue: "deribit",
    symbol: row.instrument_name,
    instrumentId,
    mark: coinToUsd(row.mark_price, index) ?? "0",
    bid: coinToUsd(row.bid_price, index),
    ask: coinToUsd(row.ask_price, index),
    bidSize: null,
    askSize: null,
    markIv: pct(row.mark_iv),
    bidIv: null,
    askIv: null,
    greeks: null,
    oi: coinAmount(row.open_interest),
    oiContracts: coinAmount(row.open_interest),
    volume: coinAmount(row.volume),
    spot: numberToDecimal(index),
    venueTs: row.creation_timestamp ?? nowMs,
    receivedAt: nowMs,
  };
}
