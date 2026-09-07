/** Field-level diff of two schema Quotes into a QuoteDelta carrying only what changed. */
import type { Greeks, Quote, QuoteDelta } from "@hapiecoin/schema";

/** Every Quote field except the identity, in wire order. */
const SCALAR_FIELDS = [
  "ts",
  "mark",
  "bid",
  "ask",
  "last",
  "markIv",
  "bidIv",
  "askIv",
  "oi",
  "volume24h",
  "bidQty",
  "askQty",
  "spot",
  "change24hPct",
] as const;
type ScalarField = (typeof SCALAR_FIELDS)[number];

function sameGreeks(a: Greeks | undefined, b: Greeks | undefined): boolean {
  if (a === undefined || b === undefined) return a === b;
  return (
    a.delta === b.delta && a.gamma === b.gamma && a.theta === b.theta && a.vega === b.vega && a.rho === b.rho
  );
}

/**
 * Delta from `prev` to `next`. With no `prev` every present field is included. Returns null when nothing
 * changed, or when only `ts` moved (a venue re-stamp without new data is noise for the client).
 * Fields that disappear cannot be expressed by QuoteDelta (optional means "unchanged"); the next
 * snapshot corrects them. Delta India never drops a field once it has published it, so this is theoretical.
 */
export function quoteDelta(prev: Quote | undefined, next: Quote): QuoteDelta | null {
  const delta: QuoteDelta = { i: next.instrumentId };
  let changed = 0;
  let dataChanged = false;
  for (const field of SCALAR_FIELDS) {
    const value = next[field];
    if (value === undefined) continue;
    if (prev !== undefined && prev[field] === value) continue;
    setField(delta, field, value);
    changed += 1;
    if (field !== "ts") dataChanged = true;
  }
  if (next.greeks !== undefined && !sameGreeks(prev?.greeks, next.greeks)) {
    delta.greeks = next.greeks;
    changed += 1;
    dataChanged = true;
  }
  if (changed === 0 || !dataChanged) return null;
  return delta;
}

function setField(delta: QuoteDelta, field: ScalarField, value: string | number): void {
  (delta as Record<string, unknown>)[field] = value;
}

/** Merge `later` on top of `earlier` in place (a later tick within one batch wins field by field). */
export function mergeDelta(earlier: QuoteDelta, later: QuoteDelta): QuoteDelta {
  return Object.assign(earlier, later);
}
