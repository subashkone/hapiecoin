// The Strategy Wizard's pure half (roadmap item 8, ADR-072; HC-TR-176..178): which templates qualify, what a
// candidate is worth if the trader's thesis comes true, how the candidates rank and which card earns which tag.
// The thesis is a view, a move in percent and a listed expiry; every candidate is a defined-risk template placed on
// the venue ladder at that expiry and valued at expiry, so "if right" means the expiry payoff at the target price.
import type { AnalyzeResult, PayoffPoint } from "@hapiecoin/pricing";
import { pnlAt } from "./analysis";
import type { StrategyLeg } from "./legs";
import type { StrategyTemplate } from "./templates";
import { OUTLOOKS, type Outlook } from "./useTemplateStats";

export type WizardView = Outlook;
export const WIZARD_VIEWS: readonly WizardView[] = OUTLOOKS;

/** The move (percent, unsigned) each view starts with; the trader edits it. */
export const DEFAULT_MOVE_PCT: Record<WizardView, number> = { Bullish: 3, Bearish: 3, Neutral: 2, Volatile: 5 };
/** Moves are read up to this size; beyond the listed strikes the expiry payoff is a straight line and is extended as one. */
export const MAX_MOVE_PCT = 50;

/** A move typed by the trader: finite, non-negative, capped. */
export function clampMove(pct: number): number {
  if (!Number.isFinite(pct)) return 0;
  return Math.min(MAX_MOVE_PCT, Math.max(0, Math.abs(pct)));
}
/** The underlying price a move lands on: +3 % of 80,000 is 82,400. */
export function targetFromMove(spot: number, signedPct: number): number {
  return spot * (1 + signedPct / 100);
}
/** The move (signed percent) a target price means from spot. */
export function moveFromTarget(spot: number, price: number): number {
  return spot > 0 ? (price / spot - 1) * 100 : 0;
}
/** Templates the wizard considers: a finite worst case, one expiry (calendars need the later chain, GAPS #76). */
export function eligibleTemplates(templates: readonly StrategyTemplate[]): StrategyTemplate[] {
  return templates.filter((t) => t.risk === "defined" && !t.tags?.includes("calendar"));
}

/**
 * Expiry P&L at a price: interpolated inside the engine's points, extended along the outer segment beyond them
 * (the engine's range reaches 5 % past the outer strike, where the expiry payoff is already a straight line).
 */
export function pnlAtExpiry(points: readonly PayoffPoint[], price: number): number {
  if (points.length < 2) return points.length === 1 ? points[0]!.pnlExpiry : Number.NaN;
  const first = points[0]!;
  const last = points[points.length - 1]!;
  if (price < first.price) {
    const next = points[1]!;
    const slope = next.price === first.price ? 0 : (next.pnlExpiry - first.pnlExpiry) / (next.price - first.price);
    return first.pnlExpiry + slope * (price - first.price);
  }
  if (price > last.price) {
    const prev = points[points.length - 2]!;
    const slope = last.price === prev.price ? 0 : (last.pnlExpiry - prev.pnlExpiry) / (last.price - prev.price);
    return last.pnlExpiry + slope * (price - last.price);
  }
  return pnlAt(points, price);
}

/** The least the strategy makes anywhere in [lo, hi] at expiry: the edges and every engine point between them. */
export function bandMinPnl(points: readonly PayoffPoint[], lo: number, hi: number): number {
  let min = Math.min(pnlAtExpiry(points, lo), pnlAtExpiry(points, hi));
  for (const p of points) if (p.price > lo && p.price < hi && p.pnlExpiry < min) min = p.pnlExpiry;
  return min;
}

export interface Thesis {
  view: WizardView;
  /** Unsigned move in percent (0..MAX_MOVE_PCT). */
  movePct: number;
}

/** Where the thesis says price ends: one price for a directional view, a band for neutral (inside) and volatile (outside). */
export function thesisPrices(spot: number, thesis: Thesis): { kind: "price"; price: number } | { kind: "band"; lo: number; hi: number } {
  const m = clampMove(thesis.movePct);
  if (thesis.view === "Bullish") return { kind: "price", price: targetFromMove(spot, m) };
  if (thesis.view === "Bearish") return { kind: "price", price: targetFromMove(spot, -m) };
  return { kind: "band", lo: targetFromMove(spot, -m), hi: targetFromMove(spot, m) };
}

/**
 * P&L at expiry if the thesis comes true: the target price for a directional view; the least anywhere inside the
 * band for Neutral ("stays within ±m %"); the smaller of the two band edges for Volatile ("moves m % either way").
 */
export function thesisPnl(points: readonly PayoffPoint[], spot: number, thesis: Thesis): number {
  const at = thesisPrices(spot, thesis);
  if (at.kind === "price") return pnlAtExpiry(points, at.price);
  if (thesis.view === "Neutral") return bandMinPnl(points, at.lo, at.hi);
  return Math.min(pnlAtExpiry(points, at.lo), pnlAtExpiry(points, at.hi));
}

/**
 * Whether the expiry payoff expresses the view at the trader's own move, read off the same curve as `thesisPnl`:
 * directional = profits at the target and more than at the opposite move (a structure that profits equally either
 * way is not a bet on direction; an OTM credit spread that profits everywhere but most in its direction still fits);
 * Neutral = profits everywhere inside the band; Volatile = profits at both band edges and less at spot.
 */
export function fitsView(points: readonly PayoffPoint[], spot: number, thesis: Thesis): boolean {
  if (points.length === 0 || !(spot > 0)) return false;
  const m = clampMove(thesis.movePct) / 100;
  const up = pnlAtExpiry(points, spot * (1 + m));
  const down = pnlAtExpiry(points, spot * (1 - m));
  switch (thesis.view) {
    case "Bullish":
      return up > 0 && up > down;
    case "Bearish":
      return down > 0 && down > up;
    case "Neutral":
      return bandMinPnl(points, spot * (1 - m), spot * (1 + m)) > 0;
    case "Volatile":
      return up > 0 && down > 0 && pnlAtExpiry(points, spot) < Math.min(up, down);
  }
}

/** A template placed on the ladder and priced once per chain; the thesis figures derive from its expiry curve. */
export interface WizardCandidate {
  template: StrategyTemplate;
  legs: StrategyLeg[];
  result: AnalyzeResult;
}

export interface RankedCandidate extends WizardCandidate {
  /** P&L at expiry if the thesis comes true (account currency at the edge, USD here). */
  pnlThesis: number;
  /** pnlThesis / |maxLoss|: what each unit of worst case earns when right. */
  returnOnRisk: number;
  pop: number | null;
}

/** Return on risk; a structure that cannot lose (never the case on a real ladder) would rank first. */
export function returnOnRisk(pnl: number, maxLoss: number): number {
  const risk = Math.abs(maxLoss);
  if (!(risk > 0)) return pnl > 0 ? Number.POSITIVE_INFINITY : 0;
  return pnl / risk;
}

/** The candidates that fit the thesis and profit under it, best first: return on risk, then POP, then name. */
export function rankCandidates(candidates: readonly WizardCandidate[], spot: number, thesis: Thesis): RankedCandidate[] {
  if (!(spot > 0)) return [];
  const out: RankedCandidate[] = [];
  for (const c of candidates) {
    const points = c.result.points;
    if (points.length === 0 || !Number.isFinite(c.result.maxLoss)) continue;
    if (!fitsView(points, spot, thesis)) continue;
    const pnlThesis = thesisPnl(points, spot, thesis);
    if (!(pnlThesis > 0)) continue;
    out.push({ ...c, pnlThesis, returnOnRisk: returnOnRisk(pnlThesis, c.result.maxLoss), pop: Number.isFinite(c.result.pop) ? c.result.pop : null });
  }
  return out.sort((a, b) => b.returnOnRisk - a.returnOnRisk || (b.pop ?? -1) - (a.pop ?? -1) || a.template.name.localeCompare(b.template.name));
}

export type WizardTag = "best return on risk" | "highest POP" | "smallest max loss";

/** One tag per card, each earned by an argmax over the shown cards and given once: no two cards claim the same virtue. */
export function tagBest(shown: readonly RankedCandidate[]): Map<string, WizardTag> {
  const tags = new Map<string, WizardTag>();
  const free = () => shown.filter((c) => !tags.has(c.template.name));
  const pick = (tag: WizardTag, better: (a: RankedCandidate, b: RankedCandidate) => boolean, ok: (c: RankedCandidate) => boolean) => {
    let best: RankedCandidate | null = null;
    for (const c of free()) if (ok(c) && (best === null || better(c, best))) best = c;
    if (best) tags.set(best.template.name, tag);
  };
  pick("best return on risk", (a, b) => a.returnOnRisk > b.returnOnRisk, () => true);
  pick("highest POP", (a, b) => (a.pop ?? -1) > (b.pop ?? -1), (c) => c.pop !== null);
  pick("smallest max loss", (a, b) => Math.abs(a.result.maxLoss) < Math.abs(b.result.maxLoss), () => true);
  return tags;
}
