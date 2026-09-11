/**
 * Option chain assembly. Strikes come ONLY from the instrument list for the expiry
 * (ADR-006, GAPS-1): never from a step constant. Real Delta ladders are irregular
 * (200/400/600 daily, 500/1000 weekly, 1000 monthly); `strikeStep` reports what was observed.
 */
import { compareDecimal, decimalToNumber } from "../decimal.js";
import { UnknownExpiryError } from "../errors.js";
import type { ChainRow, ChainSnapshot, Expiry, Instrument, Quote } from "../types.js";
import { expiryCodeToDate, expiryCodeToLabel, resolveExpiryCode } from "./normalize.js";

const DAY_MS = 86_400_000;

export interface BuildChainInput {
  instruments: readonly Instrument[];
  /** Quotes keyed by `Instrument.id`, or a list (indexed by `instrumentId`). */
  quotes: ReadonlyMap<number, Quote> | readonly Quote[];
  underlying: string;
  /** "250926", "25SEP26" or "2026-09-25". */
  expiry: string;
  /** Clock for `asOf` and `dte` (injectable for tests). */
  nowMs?: number;
}

export interface StrikeStepReport {
  /** Distinct step sizes between consecutive strikes, ascending. */
  steps: number[];
  /** Occurrences per step size, keyed by the step as a string. */
  counts: Record<string, number>;
  /** True when a single step size covers the whole ladder. */
  uniform: boolean;
}

function isOption(instrument: Instrument): boolean {
  return (instrument.kind === "call" || instrument.kind === "put") && instrument.expiryCode !== null;
}

/** Products always carry settlement_time (fixture fact); 12:00 UTC is the fallback for a malformed record. */
function settlementFor(instrument: Instrument, code: string): string {
  return instrument.settlementTime ?? `${expiryCodeToDate(code)}T12:00:00.000Z`;
}

function makeExpiry(code: string, settlementTime: string, nowMs: number): Expiry {
  const settlementMs = Date.parse(settlementTime);
  const dte = (settlementMs - nowMs) / DAY_MS;
  return {
    code,
    label: expiryCodeToLabel(code),
    date: expiryCodeToDate(code),
    settlementTime,
    dte,
    daysToExpiry: Math.max(0, Math.ceil(dte)),
  };
}

/** Expiries that have option instruments for `underlying`, sorted by settlement time ascending. */
export function listExpiries(
  instruments: readonly Instrument[],
  underlying: string,
  nowMs: number = Date.now(),
): Expiry[] {
  const byCode = new Map<string, string>();
  for (const instrument of instruments) {
    if (instrument.underlying !== underlying || !isOption(instrument)) continue;
    const code = instrument.expiryCode as string;
    if (byCode.has(code)) continue;
    byCode.set(code, settlementFor(instrument, code));
  }
  return [...byCode.entries()]
    .map(([code, settlementTime]) => makeExpiry(code, settlementTime, nowMs))
    .sort((a, b) => Date.parse(a.settlementTime) - Date.parse(b.settlementTime) || a.code.localeCompare(b.code));
}

function quoteLookup(quotes: ReadonlyMap<number, Quote> | readonly Quote[]): ReadonlyMap<number, Quote> {
  if (quotes instanceof Map) return quotes;
  const map = new Map<number, Quote>();
  for (const quote of quotes as readonly Quote[]) map.set(quote.instrumentId, quote);
  return map;
}

/** Build a ChainSnapshot for one underlying/expiry from the instrument list and the latest quotes. */
export function buildChain(input: BuildChainInput): ChainSnapshot {
  const nowMs = input.nowMs ?? Date.now();
  const code = resolveExpiryCode(input.expiry);
  const options = input.instruments.filter(
    (i) => i.underlying === input.underlying && isOption(i) && i.expiryCode === code,
  );
  if (options.length === 0) throw new UnknownExpiryError(input.underlying, input.expiry);

  const quotes = quoteLookup(input.quotes);
  const rowsByStrike = new Map<string, ChainRow>();
  let spot: string | null = null;
  let spotTs = -1;
  let quoted = 0;

  for (const instrument of options) {
    const strike = instrument.strike as string;
    let row = rowsByStrike.get(strike);
    if (!row) {
      row = { strike, call: null, put: null };
      rowsByStrike.set(strike, row);
    }
    const quote = quotes.get(instrument.id) ?? null;
    if (quote) {
      quoted += 1;
      if (quote.spot !== null && quote.venueTs > spotTs) {
        spot = quote.spot;
        spotTs = quote.venueTs;
      }
    }
    const side = { instrument, quote };
    if (instrument.kind === "call") row.call = side;
    else row.put = side;
  }

  const rows = [...rowsByStrike.values()].sort((a, b) => compareDecimal(a.strike, b.strike));
  const first = options[0] as Instrument;
  return {
    venue: first.venue,
    underlying: input.underlying,
    expiry: makeExpiry(code, settlementFor(first, code), nowMs),
    spot,
    strikes: rows.map((r) => r.strike),
    rows,
    asOf: nowMs,
    quoted,
    total: options.length,
  };
}

/** Observed strike steps of a ladder (documents irregular ladders; never used to generate strikes). */
export function strikeStep(rows: readonly { strike: string }[]): StrikeStepReport {
  const counts: Record<string, number> = {};
  const steps = new Set<number>();
  for (let i = 1; i < rows.length; i += 1) {
    const prev = decimalToNumber(rows[i - 1]?.strike) ?? 0;
    const next = decimalToNumber(rows[i]?.strike) ?? 0;
    const step = Number((next - prev).toPrecision(12));
    steps.add(step);
    counts[String(step)] = (counts[String(step)] ?? 0) + 1;
  }
  const sorted = [...steps].sort((a, b) => a - b);
  return { steps: sorted, counts, uniform: sorted.length <= 1 };
}
