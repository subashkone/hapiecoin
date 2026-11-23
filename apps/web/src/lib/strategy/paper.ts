// Paper-trading arithmetic (Phase 3 item 1, ADR-024): fee estimates, per-leg and per-strategy P&L at live
// marks, day P&L, and the converters between the server's strategy legs and the Builder's local legs.
// Money here is display-side: every stored figure comes from the API as a decimal string.
import type { Broker, Strategy, StrategyLeg as ServerLeg, StrategyLegInput, Underlying } from "@hapiecoin/schema";
import { settlementHourUtc } from "@/lib/pricing/legs";
import { toDecimal } from "@hapiecoin/schema";
import { type FeeRule, type TradeFees, tradeFees } from "@hapiecoin/pricing";
import { type StrategyLeg, venueSymbol } from "./legs";

/** UI mirror of the API limit (HC-TR-017). */
export const MAX_OPEN_LEGS_UI = 10;

export interface FeeEstimate {
  fee: number;
  gst: number;
  total: number;
  per: { id: string; fee: number; gst: number }[];
}

/**
 * Exchange fee estimate per leg (mock's model): notional × fee %, options capped at cap % of the premium,
 * plus GST on the fee. Notional = spot × lots × lot size; premium = price × lots × lot size.
 */
export function feeFor(legs: readonly { id: string; kind: string; lots: number; price: string }[], spot: number, lotSize: string, broker: Broker | undefined): FeeEstimate {
  const feePct = Number(broker?.feePct ?? 0) / 100;
  const capPct = Number(broker?.feeCapPct ?? 0) / 100;
  const gstPct = Number(broker?.gstPct ?? 0) / 100;
  const lot = Number(lotSize) || 0;
  let fee = 0;
  let gst = 0;
  const per = legs.map((l) => {
    const qty = l.lots * lot;
    let f = spot * qty * feePct;
    if (l.kind !== "future") f = Math.min(f, Number(l.price) * qty * capPct);
    const g = f * gstPct;
    fee += f;
    gst += g;
    return { id: l.id, fee: f, gst: g };
  });
  return { fee, gst, total: fee + gst, per };
}

export interface LegPnl {
  entry: number;
  current: number;
  pnl: number;
  closed: boolean;
}

/** P&L of one server leg: closed legs at their exit, open legs at `current` (falls back to entry). */
export function legPnl(leg: ServerLeg, current: number | null, lotSize: string): LegPnl {
  const entry = Number(leg.entryPrice ?? leg.price);
  const closed = leg.status === "squared_off";
  const now = closed ? Number(leg.exitPrice ?? entry) : current ?? entry;
  const sign = leg.side === "buy" ? 1 : -1;
  return { entry, current: now, pnl: (now - entry) * leg.lots * Number(lotSize) * sign, closed };
}

export interface StrategyPnl {
  unrealized: number;
  realized: number;
  total: number;
  openLegs: number;
  byLeg: Map<string, LegPnl>;
}

/** Strategy P&L: realised from the server, unrealised from the open legs at the given current prices. */
export function strategyPnl(s: Strategy, currentFor: (leg: ServerLeg) => number | null, lotSize: string): StrategyPnl {
  const byLeg = new Map<string, LegPnl>();
  let unrealized = 0;
  let openLegs = 0;
  for (const l of s.legs) {
    const p = legPnl(l, currentFor(l), lotSize);
    byLeg.set(l.id, p);
    if (!p.closed) {
      unrealized += p.pnl;
      openLegs += 1;
    }
  }
  const realized = Number(s.realizedPnl);
  return { unrealized, realized, total: unrealized + realized, openLegs, byLeg };
}

/** Day P&L: today's total minus the last stored point before today (0 when there is none). */
export function dayPnl(s: Strategy, total: number, today = new Date().toISOString().slice(0, 10)): number {
  const prev = s.pnlHistory.filter((p) => p.day < today).at(-1);
  return prev ? total - Number(prev.pnl) : total;
}

/** Calendar days the strategy has been (or was) active. */
/** Nearest and latest expiry of the open option legs (ISO dates), or null when nothing option-like is open (ADR-059). */
export function expiryOf(s: Strategy): { nearest: string; latest: string } | null {
  const ex = openLegs(s)
    .filter((l) => l.kind !== "future")
    .map((l) => l.expiry)
    .sort();
  const first = ex[0];
  return first === undefined ? null : { nearest: first, latest: ex[ex.length - 1] ?? first };
}

/** Days to the settlement instant of an ISO expiry (12:00 UTC; XAUT 16:00 UTC), one decimal, never negative. */
export function daysLeft(iso: string, now = Date.now(), hourUtc = 12): number {
  const settle = Date.parse(`${iso}T${String(hourUtc).padStart(2, "0")}:00:00Z`);
  return Number.isFinite(settle) ? Math.max(0, Math.round(((settle - now) / 86_400_000) * 10) / 10) : 0;
}

export type Lifecycle = "open" | "expiring" | "closed";

/** closed = archived; expiring = an open leg settles within a day; else open (HC-TR-157). */
export function lifecycleOf(s: Strategy, now = Date.now()): Lifecycle {
  if (s.status === "archived") return "closed";
  const e = expiryOf(s);
  return e !== null && daysLeft(e.nearest, now, settlementHourUtc(s.asset, s.venue)) <= 1 ? "expiring" : "open";
}

export function daysOf(s: Strategy, now = Date.now()): number {
  if (!s.startedAt) return 0;
  const end = s.closedAt ? new Date(s.closedAt).getTime() : now;
  return Math.max(0, Math.floor((end - new Date(s.startedAt).getTime()) / 86_400_000));
}

/**
 * How long a trade has been (or was) held, in words a trader reads at a glance (HC-TR-252): "42 m" under an hour,
 * "11 h 16 m" under two days, "3 d 4 h" beyond. Null for a trade that never started. A daily trade read "0d" before.
 */
export function heldOf(s: Strategy, now = Date.now()): string | null {
  if (!s.startedAt) return null;
  const start = new Date(s.startedAt).getTime();
  const end = s.closedAt ? new Date(s.closedAt).getTime() : now;
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  const mins = Math.max(0, Math.floor((end - start) / 60_000));
  const h = Math.floor(mins / 60);
  if (h < 1) return `${mins} m`;
  if (h < 48) return `${h} h ${mins % 60} m`;
  return `${Math.floor(h / 24)} d ${h % 24} h`;
}

/** Who opened a trade (HC-TR-250): Autopilot took a playbook's entry, or the trader placed it. */
export type TradeSource = "autopilot" | "manual";
export function sourceOf(s: Strategy): TradeSource {
  return s.autopilotPlaybookId ? "autopilot" : "manual";
}

/**
 * The exchange fees of a trade so far, estimated from its stored legs under the venue's published rule (HC-TR-253):
 * every entry fill, every exit made, and the settlement fee of a leg that expired in the money. Null when the venue
 * publishes no rule here (a data-only venue): the card says so rather than showing nothing owed.
 */
export function feesOf(s: Strategy, lotSize: string, rule: FeeRule | null): TradeFees | null {
  if (rule === null) return null;
  const lot = Number(lotSize) || 0;
  return tradeFees(
    s.legs.map((l) => ({
      kind: l.kind,
      strike: Number(l.strike) || 0,
      quantity: l.lots * lot,
      entryPrice: l.entryPrice === null ? null : Number(l.entryPrice),
      exitPrice: l.status === "squared_off" && l.exitPrice !== null ? Number(l.exitPrice) : null,
      settled: l.closeReason === "expired",
    })),
    rule,
  );
}

/**
 * Whether a position's capital can be read as its worst loss (HC-TR-255). "uncovered": more options sold than bought
 * on the call side or on the put side, so the loss is unlimited (calls) or runs to the price reaching zero (puts) and
 * what it ties up is the exchange's margin, which is not recorded with the trade. "futures": any futures leg, margined
 * the same way. "covered": every sold option has a bought one on its side.
 */
export type Cover = "covered" | "uncovered" | "futures";
export function coverOf(legs: readonly { kind: ServerLeg["kind"]; side: ServerLeg["side"]; lots: number }[]): Cover {
  let calls = 0;
  let puts = 0;
  for (const l of legs) {
    if (l.kind === "future") return "futures";
    const signed = l.side === "buy" ? l.lots : -l.lots;
    if (l.kind === "call") calls += signed;
    else puts += signed;
  }
  return calls < 0 || puts < 0 ? "uncovered" : "covered";
}

export interface SetSummary {
  trades: number;
  /** Trades above zero after their fees. */
  won: number;
  /** P&L before fees. */
  total: number;
  /** Estimated fees; 0 for a trade whose venue publishes no rule. */
  fees: number;
  /** total − fees. */
  net: number;
}

/** The trades on screen in one line (HC-TR-252, HC-TR-254): how many, how many ended above zero after fees, and their P&L before fees, the fees, and what is left. */
export function summaryOf(rows: readonly Strategy[], totalOf: (s: Strategy) => number, feeOf: (s: Strategy) => number | null = () => 0): SetSummary {
  let won = 0;
  let total = 0;
  let fees = 0;
  for (const s of rows) {
    const t = totalOf(s);
    const f = feeOf(s) ?? 0;
    total += t;
    fees += f;
    if (t - f > 0) won += 1;
  }
  return { trades: rows.length, won, total, fees, net: total - fees };
}

/** Sparkline series: stored history plus the live total. */
export function pnlSeries(s: Strategy, total: number): number[] {
  const pts = s.pnlHistory.map((p) => Number(p.pnl));
  pts.push(total);
  if (pts.length < 2) pts.unshift(0);
  return pts;
}

export function openLegs(s: Strategy): ServerLeg[] {
  return s.legs.filter((l) => l.status === "open");
}

/** A server leg in the Builder's local shape, so the quote and pricing hooks can price it. */
export function serverLegToLocal(leg: ServerLeg, asset: Underlying): StrategyLeg {
  return {
    id: leg.id,
    asset,
    kind: leg.kind,
    side: leg.side,
    strike: leg.strike,
    expiry: leg.expiry,
    lots: leg.lots,
    price: leg.entryPrice ?? leg.price,
    ...(leg.iv === null ? {} : { iv: leg.iv }),
    symbol: leg.symbol,
    status: "open",
    createdAt: leg.openedAt ? new Date(leg.openedAt).getTime() : 0,
  };
}

/** A Builder leg as the API accepts it. */
export function localLegToInput(leg: StrategyLeg): StrategyLegInput {
  return {
    kind: leg.kind,
    side: leg.side,
    strike: leg.kind === "future" ? "" : leg.strike,
    expiry: leg.kind === "future" ? "PERP" : leg.expiry,
    symbol: leg.symbol,
    lots: leg.lots,
    price: leg.price,
    ...(leg.iv === undefined ? {} : { iv: leg.iv }),
  };
}

/** Entry / exit map for the API from live prices, as decimal strings. */
export function priceMap(legs: readonly ServerLeg[], priceOf: (leg: ServerLeg) => number | null): Record<string, string> {
  const out: Record<string, string> = {};
  for (const l of legs) {
    const p = priceOf(l);
    out[l.id] = toDecimal(p ?? Number(l.entryPrice ?? l.price), 4);
  }
  return out;
}

export function fmtLeg(leg: ServerLeg): string {
  return `${leg.side.toUpperCase()} ${leg.kind === "future" ? leg.symbol : `${leg.kind.toUpperCase()} ${Number(leg.strike).toLocaleString("en-US")}`} × ${leg.lots}`;
}

/** A picked chain leg as the API accepts it (adjustments): venue symbol derived the same way as the Builder. */
export function pickToInput(l: { asset: Underlying; kind: StrategyLeg["kind"]; side: StrategyLeg["side"]; strike: string; expiry: string; lots: number; price: string; iv?: number | undefined }): StrategyLegInput {
  return {
    kind: l.kind,
    side: l.side,
    strike: l.kind === "future" ? "" : l.strike,
    expiry: l.kind === "future" ? "PERP" : l.expiry,
    symbol: venueSymbol(l.kind, l.asset, l.strike, l.expiry),
    lots: l.lots,
    price: toDecimal(Number(l.price), 4),
    ...(l.iv === undefined ? {} : { iv: l.iv }),
  };
}
