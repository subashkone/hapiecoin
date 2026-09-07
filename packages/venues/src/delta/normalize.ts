/**
 * Delta Exchange India -> HapieCoin normalisation. Pure functions, no I/O.
 *
 * Symbols: options "C-BTC-80000-250926" / "P-ETH-2400-110926" (side-underlying-strike-DDMMYY),
 * perpetuals "BTCUSD". Expiry codes are the venue's "DDMMYY"; labels are "25SEP26".
 * BTC/ETH options settle 12:00 UTC on the expiry date; XAUT settles 16:00 UTC (fixture fact),
 * so `Instrument.settlementTime` always comes from the product's `settlement_time`, and the
 * 12:00 default in `expirySettlementIso` is only a fallback when no product is at hand.
 */
import { canonDecimal, decimalToNumber, numberToDecimal } from "../decimal.js";
import { InvalidExpiryError, InvalidSymbolError } from "../errors.js";
import type { Greeks, Instrument, InstrumentKind, Quote } from "../types.js";
import type { RawProduct, RawTicker, RawWsCompactTickerEntry } from "./raw.js";

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"] as const;

const OPTION_SYMBOL = /^([CP])-([A-Z0-9]+)-(\d+(?:\.\d+)?)-(\d{6})$/;
const EXPIRY_CODE = /^(\d{2})(\d{2})(\d{2})$/;
const EXPIRY_LABEL = /^(\d{2})([A-Z]{3})(\d{2})$/;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Default settlement hour (UTC) for BTC/ETH options when no product settlement_time is available. */
export const DEFAULT_SETTLEMENT_HOUR_UTC = 12;

export interface ParsedOptionSymbol {
  kind: "call" | "put";
  underlying: string;
  /** Canonical decimal string ("80000"). */
  strike: string;
  /** "DDMMYY". */
  expiryCode: string;
  /** "YYYY-MM-DD". */
  expiryDate: string;
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** "250926" -> "2026-09-25". Validates the calendar date (rejects "310226"). */
export function expiryCodeToDate(code: string): string {
  const m = EXPIRY_CODE.exec(code);
  if (!m) throw new InvalidExpiryError(code, "expected DDMMYY");
  const day = Number(m[1]);
  const month = Number(m[2]);
  const year = 2000 + Number(m[3]);
  const ms = Date.UTC(year, month - 1, day);
  const d = new Date(ms);
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) {
    throw new InvalidExpiryError(code, "not a calendar date");
  }
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

/** "2026-09-25" -> "250926". */
export function dateToExpiryCode(date: string): string {
  const m = ISO_DATE.exec(date);
  if (!m) throw new InvalidExpiryError(date, "expected YYYY-MM-DD");
  const year = Number(m[1]);
  if (year < 2000 || year > 2099) throw new InvalidExpiryError(date, "year out of 2000-2099");
  const code = `${m[3]}${m[2]}${String(year - 2000).padStart(2, "0")}`;
  expiryCodeToDate(code); // calendar validation
  return code;
}

/** "250926" -> "25SEP26" (2-digit year, uppercase month). */
export function expiryCodeToLabel(code: string): string {
  const date = expiryCodeToDate(code);
  const month = Number(date.slice(5, 7));
  return `${code.slice(0, 2)}${MONTHS[month - 1] ?? "???"}${code.slice(4, 6)}`;
}

/** "25SEP26" -> "250926". Case-insensitive on the month. */
export function labelToExpiryCode(label: string): string {
  const m = EXPIRY_LABEL.exec(label.toUpperCase());
  if (!m) throw new InvalidExpiryError(label, "expected DDMONYY");
  const monthIndex = MONTHS.indexOf(m[2] as (typeof MONTHS)[number]);
  if (monthIndex < 0) throw new InvalidExpiryError(label, `unknown month ${m[2] ?? ""}`);
  const code = `${m[1]}${pad2(monthIndex + 1)}${m[3]}`;
  expiryCodeToDate(code);
  return code;
}

/** Accepts "250926", "25SEP26" or "2026-09-25" and returns the venue code "250926". */
export function resolveExpiryCode(input: string): string {
  if (EXPIRY_CODE.test(input)) {
    expiryCodeToDate(input);
    return input;
  }
  if (ISO_DATE.test(input)) return dateToExpiryCode(input);
  return labelToExpiryCode(input);
}

/** Settlement instant for an expiry code: "250926" -> "2026-09-25T12:00:00.000Z" (hour configurable). */
export function expirySettlementIso(code: string, hourUtc: number = DEFAULT_SETTLEMENT_HOUR_UTC): string {
  const date = expiryCodeToDate(code);
  return new Date(`${date}T${pad2(hourUtc)}:00:00.000Z`).toISOString();
}

export function isOptionSymbol(symbol: string): boolean {
  return OPTION_SYMBOL.test(symbol);
}

/** "C-BTC-80000-250926" -> { kind: "call", underlying: "BTC", strike: "80000", expiryCode: "250926", expiryDate: "2026-09-25" }. */
export function parseOptionSymbol(symbol: string): ParsedOptionSymbol {
  const m = OPTION_SYMBOL.exec(symbol);
  if (!m) throw new InvalidSymbolError(symbol, "expected C|P-UNDERLYING-STRIKE-DDMMYY");
  const expiryCode = m[4] ?? "";
  return {
    kind: m[1] === "C" ? "call" : "put",
    underlying: m[2] ?? "",
    strike: canonDecimal(m[3] ?? "0"),
    expiryCode,
    expiryDate: expiryCodeToDate(expiryCode),
  };
}

export function contractTypeToKind(contractType: string): InstrumentKind {
  switch (contractType) {
    case "call_options":
      return "call";
    case "put_options":
      return "put";
    case "futures":
      return "future";
    case "perpetual_futures":
      return "perpetual";
    default:
      return "other";
  }
}

/** Raw product -> Instrument. Strikes and expiries come from the venue record, never from a step constant (ADR-006). */
export function toInstrument(product: RawProduct): Instrument {
  const kind = contractTypeToKind(product.contract_type);
  const settlementTime = product.settlement_time ?? null;
  let expiryCode: string | null = null;
  let expiryDate: string | null = null;
  if (kind === "call" || kind === "put") {
    const parsed = parseOptionSymbol(product.symbol);
    expiryCode = parsed.expiryCode;
    expiryDate = parsed.expiryDate;
  } else if (settlementTime !== null && kind !== "perpetual") {
    const ms = Date.parse(settlementTime);
    if (Number.isFinite(ms)) {
      expiryDate = new Date(ms).toISOString().slice(0, 10);
      expiryCode = dateToExpiryCode(expiryDate);
    }
  }
  const strikeRaw = product.strike_price ?? null;
  return {
    venue: "delta",
    id: product.id,
    symbol: product.symbol,
    kind,
    underlying: product.underlying_asset.symbol,
    quoteAsset: product.quoting_asset.symbol,
    settlingAsset: product.settling_asset?.symbol ?? product.quoting_asset.symbol,
    strike: strikeRaw === null ? null : canonDecimal(strikeRaw),
    expiryCode,
    expiryDate,
    settlementTime,
    contractValue: canonDecimal(product.contract_value),
    tickSize: canonDecimal(product.tick_size),
    state: product.state,
    tradingStatus: product.trading_status ?? null,
  };
}

function optDecimal(value: string | number | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  return typeof value === "number" ? numberToDecimal(value) : canonDecimal(value);
}

function optFraction(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  return decimalToNumber(String(value));
}

/** Build Greeks only when all five are present and finite; otherwise null (futures, partial data). */
export function toGreeks(raw: {
  delta?: string | number | null | undefined;
  gamma?: string | number | null | undefined;
  theta?: string | number | null | undefined;
  vega?: string | number | null | undefined;
  rho?: string | number | null | undefined;
}): Greeks | null {
  const delta = optFraction(raw.delta);
  const gamma = optFraction(raw.gamma);
  const theta = optFraction(raw.theta);
  const vega = optFraction(raw.vega);
  const rho = optFraction(raw.rho);
  if (delta === null || gamma === null || theta === null || vega === null || rho === null) return null;
  return { delta, gamma, theta, vega, rho };
}

/** Venue microsecond timestamp -> epoch ms; falls back to `time` (ISO) then `nowMs`. */
function venueTimestampMs(
  ticker: { timestamp?: number | null | undefined; time?: string | null | undefined },
  nowMs: number,
): number {
  if (typeof ticker.timestamp === "number") return Math.floor(ticker.timestamp / 1000);
  if (typeof ticker.time === "string") {
    const parsed = Date.parse(ticker.time);
    if (Number.isFinite(parsed)) return parsed;
  }
  return nowMs;
}

/** REST ticker or legacy `v2/ticker` frame -> Quote. */
export function toQuote(ticker: RawTicker, nowMs: number = Date.now()): Quote {
  const quotes = ticker.quotes ?? null;
  const greeks = ticker.greeks ?? null;
  const markIv = optFraction(ticker.mark_vol ?? quotes?.mark_iv);
  return {
    venue: "delta",
    symbol: ticker.symbol,
    instrumentId: ticker.product_id,
    mark: canonDecimal(ticker.mark_price),
    bid: optDecimal(quotes?.best_bid),
    ask: optDecimal(quotes?.best_ask),
    bidSize: optDecimal(quotes?.bid_size),
    askSize: optDecimal(quotes?.ask_size),
    markIv,
    bidIv: optFraction(quotes?.bid_iv),
    askIv: optFraction(quotes?.ask_iv),
    greeks: greeks === null ? null : toGreeks(greeks),
    oi: optDecimal(ticker.oi),
    oiContracts: optDecimal(ticker.oi_contracts),
    volume: optDecimal(ticker.volume),
    spot: optDecimal(ticker.spot_price ?? greeks?.spot),
    venueTs: venueTimestampMs(ticker, nowMs),
    receivedAt: nowMs,
  };
}

function cell(list: readonly (string | number | null)[] | null | undefined, index: number): string | number | null {
  if (!list) return null;
  return list[index] ?? null;
}

/**
 * Compact `ticker` frame entry (new public endpoint) -> Quote.
 * The compact frame carries no `oi` in underlying units and no `volume`; those are null here.
 */
export function compactToQuote(
  entry: RawWsCompactTickerEntry,
  frame: { sp?: string | null | undefined; ts: number },
  nowMs: number = Date.now(),
): Quote {
  return {
    venue: "delta",
    symbol: entry.s,
    instrumentId: entry.i,
    mark: canonDecimal(entry.m),
    bid: optDecimal(cell(entry.q, 2)),
    ask: optDecimal(cell(entry.q, 0)),
    bidSize: optDecimal(cell(entry.q, 3)),
    askSize: optDecimal(cell(entry.q, 1)),
    markIv: optFraction(cell(entry.qiv, 2)),
    bidIv: optFraction(cell(entry.qiv, 1)),
    askIv: optFraction(cell(entry.qiv, 0)),
    greeks: toGreeks({
      delta: cell(entry.g, 0),
      gamma: cell(entry.g, 1),
      rho: cell(entry.g, 2),
      theta: cell(entry.g, 3),
      vega: cell(entry.g, 4),
    }),
    oi: null,
    oiContracts: optDecimal(cell(entry.oi, 0)),
    volume: null,
    spot: optDecimal(frame.sp),
    venueTs: Math.floor(frame.ts / 1000),
    receivedAt: nowMs,
  };
}
