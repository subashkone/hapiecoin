// Exchange positions as analysable legs (HC-TR-144, ADR-026): a Delta symbol back to kind / asset / strike / expiry,
// contracts back to lots, and the position's P&L at the venue mark. Pure functions, unit-tested.
import type { LivePosition, Underlying } from "@hapiecoin/schema";
import { UNDERLYINGS } from "@hapiecoin/schema";
import type { StrategyLeg } from "./legs";

export interface ParsedSymbol {
  kind: "call" | "put" | "future";
  asset: Underlying;
  /** Venue decimal string; "0" for a future. */
  strike: string;
  /** ISO date; "" for a future. */
  expiry: string;
}

const isAsset = (s: string): s is Underlying => (UNDERLYINGS as readonly string[]).includes(s);

/** `C-BTC-80000-250926` → call BTC 80000 2026-09-25; `BTCUSD` → the perpetual; null for anything else. */
export function parseDeltaSymbol(symbol: string): ParsedSymbol | null {
  const fut = /^([A-Z]+)USD$/.exec(symbol);
  if (fut && isAsset(fut[1]!)) return { kind: "future", asset: fut[1], strike: "0", expiry: "" };
  const m = /^([CP])-([A-Z]+)-(\d+(?:\.\d+)?)-(\d{2})(\d{2})(\d{2})$/.exec(symbol);
  if (!m || !isAsset(m[2]!)) return null;
  return { kind: m[1] === "C" ? "call" : "put", asset: m[2], strike: m[3]!, expiry: `20${m[6]}-${m[5]}-${m[4]}` };
}

/** Whole lots for `contracts` of `contractValue` units at `lotSize` units per lot; null unless whole and ≥ 1. */
export function lotsFor(contracts: number, contractValue: string, lotSize: string): number | null {
  const cv = Number(contractValue);
  const ls = Number(lotSize);
  if (!(cv > 0) || !(ls > 0) || !(contracts > 0)) return null;
  const n = (contracts * cv) / ls;
  const r = Math.round(n);
  return r >= 1 && Math.abs(n - r) < 1e-6 ? r : null;
}

/** A position as a Builder-style leg at its entry price; null when the symbol, size or sizing is unusable. */
export function positionToLeg(p: LivePosition, lotSize: string): StrategyLeg | null {
  if (!p.symbol || p.size === 0 || !p.entryPrice || !p.contractValue) return null;
  const parsed = parseDeltaSymbol(p.symbol);
  if (!parsed) return null;
  const lots = lotsFor(Math.abs(p.size), p.contractValue, lotSize);
  if (lots === null) return null;
  return {
    id: `pos_${p.productId}`,
    asset: parsed.asset,
    kind: parsed.kind,
    side: p.size > 0 ? "buy" : "sell",
    strike: parsed.strike,
    expiry: parsed.expiry,
    lots,
    price: p.entryPrice,
    symbol: p.symbol,
    status: "open",
    createdAt: 0,
  };
}

/** Unrealised P&L in USD at the venue mark: (mark − entry) × signed contracts × contract value; null without a mark. */
export function positionPnl(p: LivePosition): number | null {
  if (!p.mark || !p.entryPrice || !p.contractValue) return null;
  const v = (Number(p.mark) - Number(p.entryPrice)) * p.size * Number(p.contractValue);
  return Number.isFinite(v) ? v : null;
}
