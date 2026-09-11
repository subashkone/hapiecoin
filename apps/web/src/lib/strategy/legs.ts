// Strategy legs added from the chain (HC-TR-017, HC-TR-018, HC-WS-024..027; ADR-022). Pure helpers over a
// per-asset list kept in the UI store. Prices and IVs are copied from the live quote; the quantity in
// underlying units is derived (lots × lot size) when needed and never stored twice (typescript rule 3).
import type { Underlying } from "@hapiecoin/schema";
import { currentVenue } from "@/lib/venue";

/** Options from the chain, or a perpetual future added from the Builder (HC-TR-016, HC-TR-035). */
export type LegKind = "call" | "put" | "future";
export type LegSide = "buy" | "sell";

export interface StrategyLeg {
  id: string;
  asset: Underlying;
  kind: LegKind;
  side: LegSide;
  /** Strike as the venue decimal string. */
  strike: string;
  /** Expiry ISO date "YYYY-MM-DD". */
  expiry: string;
  lots: number;
  /** Mark at the time the leg was added, USD per underlying unit as Delta quotes it (decimal string). */
  price: string;
  /** Mark IV at the time the leg was added, decimal fraction; undefined when the venue had none. */
  iv?: number | undefined;
  /** Venue-style symbol, e.g. C-BTC-79400-070926. */
  symbol: string;
  status: "open";
  /** False = kept in the table but left out of the analysis, ticket and trades (HC-TR-146). Undefined = enabled. */
  enabled?: boolean | undefined;
  createdAt: number;
}

/** Open and not switched off: the legs the analysis, ticket and trade flows use. */
export function isActiveLeg(l: StrategyLeg): boolean {
  return l.status === "open" && l.enabled !== false;
}
export function activeLegs(legs: readonly StrategyLeg[]): StrategyLeg[] {
  return legs.filter(isActiveLeg);
}

/** Ten active legs per strategy (HC-TR-017; new strategies stop at 8 in the builder, item 4). */
export const MAX_ACTIVE_LEGS = 10;
export const LOT_PRESETS: readonly number[] = [1, 2, 5, 10, 25, 50, 100, 250, 500, 1000];
/** 100 lots like the reference site's Builder (ADR-028); the row-control presets stay 1..1000. */
export const DEFAULT_LOTS = 100;

export function isLotPreset(n: unknown): n is number {
  return typeof n === "number" && LOT_PRESETS.includes(n);
}

/** Next preset up or down from `lots`; a non-preset value snaps to the nearest preset first. Clamped. */
export function stepLots(lots: number, delta: 1 | -1): number {
  const i = LOT_PRESETS.indexOf(lots);
  if (i >= 0) return LOT_PRESETS[Math.max(0, Math.min(LOT_PRESETS.length - 1, i + delta))] ?? DEFAULT_LOTS;
  const nearest = LOT_PRESETS.reduce((best, p) => (Math.abs(p - lots) < Math.abs(best - lots) ? p : best), DEFAULT_LOTS);
  return stepLots(nearest, delta);
}

/** The venue's symbol for a leg through the port's codec (ADR-064): C-BTC-79400-070926 for an option, BTCUSD for the perpetual. */
export function venueSymbol(kind: LegKind, asset: Underlying, strike: string, expiryIso: string): string {
  const { symbols } = currentVenue();
  return kind === "future" ? symbols.perpetual(asset) : symbols.formatOption(kind, asset, strike, expiryIso);
}

export interface NewLegInput {
  asset: Underlying;
  kind: LegKind;
  side: LegSide;
  strike: string;
  expiry: string;
  lots: number;
  price: string;
  iv?: number | undefined;
}

export type AddLegResult = { ok: true; leg: StrategyLeg; legs: StrategyLeg[] } | { ok: false; reason: "limit" | "lots" };

let counter = 0;
export function newLegId(now = Date.now()): string {
  counter += 1;
  return `leg_${now.toString(36)}_${counter.toString(36)}`;
}

/** Append a leg unless the active-leg limit is reached or the lots are not a positive integer. */
export function addLeg(legs: readonly StrategyLeg[], input: NewLegInput, now = Date.now()): AddLegResult {
  if (!Number.isInteger(input.lots) || input.lots <= 0) return { ok: false, reason: "lots" };
  if (legs.filter((l) => l.status === "open").length >= MAX_ACTIVE_LEGS) return { ok: false, reason: "limit" };
  const leg: StrategyLeg = {
    id: newLegId(now),
    asset: input.asset,
    kind: input.kind,
    side: input.side,
    strike: input.strike,
    expiry: input.expiry,
    lots: input.lots,
    price: input.price,
    iv: input.iv,
    symbol: venueSymbol(input.kind, input.asset, input.strike, input.expiry),
    status: "open",
    createdAt: now,
  };
  return { ok: true, leg, legs: [...legs, leg] };
}

export function removeLeg(legs: readonly StrategyLeg[], id: string): StrategyLeg[] {
  return legs.filter((l) => l.id !== id);
}

/** Legs that belong on one chain: same asset and expiry (HC-TR-018 / HC-WS-027). */
export function legsForChain(legs: readonly StrategyLeg[], asset: Underlying, expiry: string): StrategyLeg[] {
  return legs.filter((l) => l.asset === asset && l.expiry === expiry && l.status === "open");
}

export interface SideMarks {
  buyLots: number;
  sellLots: number;
  /** Stripe / outline colour: buy when any long, sell when short only, null when no leg. */
  tone: "buy" | "sell" | null;
}

export interface RowMarks {
  call: SideMarks;
  put: SideMarks;
  /** Pills in display order: C B n, C S n, P B n, P S n. */
  pills: { text: string; tone: "buy" | "sell"; title: string }[];
}

/** Flip a leg's side (HC-TR-009). */
export function toggleLegSide(legs: readonly StrategyLeg[], id: string): StrategyLeg[] {
  return legs.map((l) => (l.id === id ? { ...l, side: l.side === "buy" ? "sell" : "buy" } : l));
}

/** Include / exclude a leg from the analysis without deleting it (HC-TR-146). */
export function toggleLegEnabled(legs: readonly StrategyLeg[], id: string): StrategyLeg[] {
  return legs.map((l) => (l.id === id ? { ...l, enabled: l.enabled === false } : l));
}

/** Change an option leg's type, strike or expiry in place (HC-TR-147); the symbol follows, the quote replaces the stored price when given. */
export function setLegInstrument(legs: readonly StrategyLeg[], id: string, patch: { kind?: "call" | "put"; strike?: string; expiry?: string }, quote?: { price: string; iv?: number | undefined }): StrategyLeg[] {
  return legs.map((l) => {
    if (l.id !== id || l.kind === "future") return l;
    const kind = patch.kind ?? l.kind;
    const strike = patch.strike ?? l.strike;
    const expiry = patch.expiry ?? l.expiry;
    return { ...l, kind, strike, expiry, symbol: venueSymbol(kind, l.asset, strike, expiry), ...(quote ? { price: quote.price, iv: quote.iv } : {}) };
  });
}

/** Set lots on one leg, or on every open leg when `basket` is on (HC-TR-004, HC-TR-011); lots are clamped to ≥ 1 integers. */
export function setLegLots(legs: readonly StrategyLeg[], id: string, lots: number, basket = false): StrategyLeg[] {
  const v = Math.max(1, Math.round(Number.isFinite(lots) ? lots : 1));
  return legs.map((l) => (l.id === id || (basket && l.status === "open") ? { ...l, lots: v } : l));
}

/** Set a custom price on one leg, or on every open leg when `basket` is on (HC-TR-010). */
export function setLegPrice(legs: readonly StrategyLeg[], id: string, price: string, basket = false): StrategyLeg[] {
  return legs.map((l) => (l.id === id || (basket && l.status === "open") ? { ...l, price } : l));
}

function sideMarks(legs: readonly StrategyLeg[], kind: LegKind, strike: string): SideMarks {
  const mine = legs.filter((l) => l.kind === kind && Number(l.strike) === Number(strike));
  const buyLots = mine.filter((l) => l.side === "buy").reduce((s, l) => s + l.lots, 0);
  const sellLots = mine.filter((l) => l.side === "sell").reduce((s, l) => s + l.lots, 0);
  return { buyLots, sellLots, tone: buyLots > 0 ? "buy" : sellLots > 0 ? "sell" : null };
}

/** What one strike row should show for the legs it holds (HC-WS-027). */
export function rowMarks(chainLegs: readonly StrategyLeg[], strike: string): RowMarks {
  const call = sideMarks(chainLegs, "call", strike);
  const put = sideMarks(chainLegs, "put", strike);
  const pills: RowMarks["pills"] = [];
  const push = (letter: "C" | "P", side: LegSide, lots: number, kind: string) => {
    if (lots > 0) pills.push({ text: `${letter} ${side === "buy" ? "B" : "S"} ${lots}`, tone: side, title: `${side === "buy" ? "Long" : "Short"} ${lots} lots ${kind}` });
  };
  push("C", "buy", call.buyLots, "call");
  push("C", "sell", call.sellLots, "call");
  push("P", "buy", put.buyLots, "put");
  push("P", "sell", put.sellLots, "put");
  return { call, put, pills };
}

/**
 * Quantity in underlying units for display only (lots × lot size), rendered at the lot size's own precision
 * so float noise never reaches the screen (typescript rule 3: quantities are integer lots; this is text).
 */
export function legQuantity(lots: number, lotSize: string | undefined): string | null {
  if (lotSize === undefined) return null;
  const size = Number(lotSize);
  if (!Number.isFinite(size) || size <= 0 || !Number.isInteger(lots) || lots <= 0) return null;
  const decimals = lotSize.includes(".") ? lotSize.split(".")[1]!.replace(/0+$/, "").length : 0;
  return (lots * size).toFixed(decimals);
}

/** Bring any stored value to a valid leg list: unknown shapes are dropped. */
export function normaliseLegs(input: unknown): StrategyLeg[] {
  if (!Array.isArray(input)) return [];
  const out: StrategyLeg[] = [];
  for (const x of input) {
    if (typeof x !== "object" || x === null) continue;
    const l = x as Partial<StrategyLeg>;
    if (
      typeof l.id === "string" &&
      (l.kind === "call" || l.kind === "put" || l.kind === "future") &&
      (l.side === "buy" || l.side === "sell") &&
      typeof l.strike === "string" &&
      typeof l.expiry === "string" &&
      typeof l.lots === "number" &&
      Number.isInteger(l.lots) &&
      l.lots > 0 &&
      typeof l.price === "string" &&
      typeof l.symbol === "string" &&
      (l.asset === "BTC" || l.asset === "ETH" || l.asset === "XAUT")
    ) {
      out.push({
        id: l.id,
        asset: l.asset,
        kind: l.kind,
        side: l.side,
        strike: l.strike,
        expiry: l.expiry,
        lots: l.lots,
        price: l.price,
        iv: typeof l.iv === "number" ? l.iv : undefined,
        symbol: l.symbol,
        ...(l.enabled === false ? { enabled: false } : {}),
        status: "open",
        createdAt: typeof l.createdAt === "number" ? l.createdAt : 0,
      });
    }
  }
  return out;
}
