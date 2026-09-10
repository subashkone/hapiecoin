// Adjustment workbench draft (ADR-044; HC-TR-148..151): pure helpers over an open position and a draft of
// changes. A draft holds "lots after" per open leg (fewer = trim, 0 = close, more = add on the same side) and
// the picked new contracts; a pick on a held contract nets against it (opposite side trims or closes, the same
// side adds, a larger opposite pick flips). Everything the ticket, the analysis pane and the confirm dialog
// show derives from here, and `toBody` is the one place the API request is built.
import type { AnalyzeResult } from "@hapiecoin/pricing";
import { expiryMs } from "@hapiecoin/pricing";
import type { AdjustBody, OrderType, StrategyLeg as ServerLeg, StrategyLegInput, Underlying } from "@hapiecoin/schema";
import { toDecimal } from "@hapiecoin/schema";
import { fmtExpiry, fmtStrike } from "@/lib/format";
import { type MoneyFormat, fmtMoney } from "@/lib/money";
import { settlementHourUtc } from "@/lib/pricing/legs";
import { type LegSide, type StrategyLeg, deltaSymbol } from "@/lib/strategy/legs";
import { MAX_OPEN_LEGS_UI, serverLegToLocal } from "@/lib/strategy/paper";

export type OptionKind = "call" | "put";

/** A new contract picked from the chain, priced at the mark when picked (re-read at Review). */
export interface AdjustPick {
  id: string;
  kind: OptionKind;
  side: LegSide;
  strike: string;
  expiry: string;
  lots: number;
  price: string;
  iv?: number | undefined;
  symbol: string;
}

/** A saved alternative (Plan A / B / C) the trader can compare and load back (ADR-044 extra 1; HC-TR-153). */
export interface SavedPlan {
  id: string;
  name: string;
  lotsAfter: Record<string, number>;
  picks: AdjustPick[];
  valuation: string | null;
}

export interface AdjustDraft {
  strategyId: string;
  /** Lots after the change per open leg id; absent = unchanged. */
  lotsAfter: Record<string, number>;
  picks: AdjustPick[];
  /** "Value at": an ISO date (an expiry, or any date from the scenario slider), "today" (everything at time value now), or null = the latest expiry of the combined position. */
  valuation: string | null;
  /** When the draft was opened, for the mark-age counter. */
  startedAt: number;
  plans: SavedPlan[];
}

export const MAX_PLANS = 3;
const PLAN_NAMES = ["Plan A", "Plan B", "Plan C"] as const;

/**
 * Keep the working change as the next free plan (up to three) and start the next change from the position as it
 * stands, so the table never shows the plan just saved twice; a full shelf leaves the draft as it is.
 */
export function savePlan(d: AdjustDraft, now = Date.now()): AdjustDraft {
  if (d.plans.length >= MAX_PLANS) return d;
  const name = PLAN_NAMES.find((n) => !d.plans.some((p) => p.name === n)) ?? `Plan ${d.plans.length + 1}`;
  const plan: SavedPlan = { id: `plan_${now.toString(36)}_${d.plans.length + 1}`, name, lotsAfter: { ...d.lotsAfter }, picks: d.picks.map((p) => ({ ...p })), valuation: d.valuation };
  return { ...d, lotsAfter: {}, picks: [], plans: [...d.plans, plan] };
}

/** The saved plan the working change is a copy of (after Save or Use), if any. */
export function matchingPlan(d: AdjustDraft, open: readonly ServerLeg[]): SavedPlan | undefined {
  const key = (x: { lotsAfter: Record<string, number>; picks: AdjustPick[]; valuation: string | null }) =>
    JSON.stringify([
      open.map((l) => [l.id, x.lotsAfter[l.id] ?? l.lots]),
      x.picks.map((p) => [p.symbol, p.side, p.lots]),
      x.valuation,
    ]);
  const mine = key(d);
  return d.plans.find((p) => key(p) === mine);
}

/** Load a saved plan back into the working changes. */
export function loadPlan(d: AdjustDraft, id: string): AdjustDraft {
  const p = d.plans.find((x) => x.id === id);
  return p ? { ...d, lotsAfter: { ...p.lotsAfter }, picks: p.picks.map((x) => ({ ...x })), valuation: p.valuation } : d;
}

export function removePlan(d: AdjustDraft, id: string): AdjustDraft {
  return { ...d, plans: d.plans.filter((p) => p.id !== id) };
}

/** The draft a plan describes (for pricing it next to the working changes). */
export function planDraft(d: AdjustDraft, p: SavedPlan): AdjustDraft {
  return { ...d, lotsAfter: p.lotsAfter, picks: p.picks, valuation: p.valuation };
}

export interface PickInput {
  kind: OptionKind;
  side: LegSide;
  strike: string;
  expiry: string;
  lots: number;
  price: string;
  iv?: number | undefined;
}

/** Mark per venue symbol right now, or undefined when there is no quote. */
export type MarkOf = (symbol: string) => string | undefined;

let seq = 0;
export function newPickId(now = Date.now()): string {
  seq += 1;
  return `pick_${now.toString(36)}_${seq.toString(36)}`;
}

export function newDraft(strategyId: string, now = Date.now()): AdjustDraft {
  return { strategyId, lotsAfter: {}, picks: [], valuation: null, startedAt: now, plans: [] };
}

export function lotsAfterOf(d: AdjustDraft, leg: ServerLeg): number {
  return d.lotsAfter[leg.id] ?? leg.lots;
}

const wholeLots = (n: number, min: number): number => Math.max(min, Math.round(Number.isFinite(n) ? n : min));

/** Set the lots a leg should have after the change (0 closes it). */
export function setLotsAfter(d: AdjustDraft, legId: string, lots: number): AdjustDraft {
  return { ...d, lotsAfter: { ...d.lotsAfter, [legId]: wholeLots(lots, 0) } };
}

export function setPickLots(d: AdjustDraft, id: string, lots: number): AdjustDraft {
  return { ...d, picks: d.picks.map((p) => (p.id === id ? { ...p, lots: wholeLots(lots, 1) } : p)) };
}

export function removePick(d: AdjustDraft, id: string): AdjustDraft {
  return { ...d, picks: d.picks.filter((p) => p.id !== id) };
}

export function setValuation(d: AdjustDraft, expiry: string | null): AdjustDraft {
  return { ...d, valuation: expiry };
}

const sameContract = (l: ServerLeg, kind: OptionKind, strike: string, expiry: string): boolean => l.kind === kind && Number(l.strike) === Number(strike) && l.expiry === expiry;

/**
 * Apply a chain pick (B / S on a strike) to the draft. On a contract the position does not hold it is a toggle:
 * the same side again removes the pick, the other side replaces it. On a held contract it nets: the same side adds
 * lots to the first held leg; the opposite side trims the held legs (largest first), and any remainder flips into
 * a pick on that side.
 */
export function pickOnDraft(d: AdjustDraft, open: readonly ServerLeg[], asset: Underlying, input: PickInput, now = Date.now()): AdjustDraft {
  const held = open.filter((l) => sameContract(l, input.kind, input.strike, input.expiry));
  const symbol = deltaSymbol(input.kind, asset, input.strike, input.expiry);
  const lots = wholeLots(input.lots, 1);
  if (held.length === 0) {
    const existing = d.picks.find((p) => p.symbol === symbol);
    if (existing && existing.side === input.side) return removePick(d, existing.id);
    if (existing) return { ...d, picks: d.picks.map((p) => (p.id === existing.id ? { ...p, side: input.side, lots, price: input.price, iv: input.iv } : p)) };
    return { ...d, picks: [...d.picks, { id: newPickId(now), kind: input.kind, side: input.side, strike: input.strike, expiry: input.expiry, lots, price: input.price, iv: input.iv, symbol }] };
  }
  const same = held.find((l) => l.side === input.side);
  if (same) return setLotsAfter(d, same.id, lotsAfterOf(d, same) + lots);
  const lotsAfter = { ...d.lotsAfter };
  let rest = lots;
  for (const leg of [...held].sort((a, b) => lotsAfterOf(d, b) - lotsAfterOf(d, a))) {
    const cur = lotsAfterOf(d, leg);
    const take = Math.min(cur, rest);
    lotsAfter[leg.id] = cur - take;
    rest -= take;
  }
  let picks = d.picks;
  if (rest > 0) {
    const existing = picks.find((p) => p.symbol === symbol && p.side === input.side);
    picks = existing ? picks.map((p) => (p.id === existing.id ? { ...p, lots: p.lots + rest } : p)) : [...picks, { id: newPickId(now), kind: input.kind, side: input.side, strike: input.strike, expiry: input.expiry, lots: rest, price: input.price, iv: input.iv, symbol }];
  }
  return { ...d, lotsAfter, picks };
}

export type EffectKind = "new" | "add" | "trim" | "close" | "flip";

export interface Effect {
  kind: EffectKind;
  legId?: string | undefined;
  pickId?: string | undefined;
  /** Lots the change moves (added, trimmed or closed). */
  lots: number;
  label: string;
}

export function instrumentOf(l: { kind: string; strike: string; expiry: string; symbol: string }): string {
  return l.kind === "future" ? `${l.symbol} perp` : `${fmtStrike(l.strike)} ${l.kind === "call" ? "C" : "P"} ${fmtExpiry(l.expiry)}`;
}

/** What the draft does to each open leg and each pick, in ticket order (open legs first, then picks). */
export function effects(d: AdjustDraft, open: readonly ServerLeg[]): Effect[] {
  const out: Effect[] = [];
  for (const leg of open) {
    const after = lotsAfterOf(d, leg);
    const delta = after - leg.lots;
    if (delta === 0) continue;
    if (delta > 0) out.push({ kind: "add", legId: leg.id, lots: delta, label: `ADDS +${delta} to ${instrumentOf(leg)}` });
    else if (after === 0) out.push({ kind: "close", legId: leg.id, lots: leg.lots, label: `CLOSES ${instrumentOf(leg)}` });
    else out.push({ kind: "trim", legId: leg.id, lots: -delta, label: `TRIMS ${instrumentOf(leg)} by ${-delta}` });
  }
  for (const p of d.picks) {
    const flipped = open.find((l) => sameContract(l, p.kind, p.strike, p.expiry) && l.side !== p.side && lotsAfterOf(d, l) === 0);
    out.push(flipped ? { kind: "flip", pickId: p.id, legId: flipped.id, lots: p.lots, label: `FLIPS ${instrumentOf(p)} to ${p.side} +${p.lots}` } : { kind: "new", pickId: p.id, lots: p.lots, label: "NEW LEG" });
  }
  return out;
}

export function isEmptyDraft(d: AdjustDraft, open: readonly ServerLeg[]): boolean {
  return effects(d, open).length === 0;
}

/** Open leg rows after the change: legs kept (lots after > 0), extra lots as their own rows, and every pick. */
export function openCountAfter(d: AdjustDraft, open: readonly ServerLeg[]): number {
  let n = d.picks.length;
  for (const leg of open) {
    const after = lotsAfterOf(d, leg);
    if (after > 0) n += 1;
    if (after > leg.lots) n += 1;
  }
  return n;
}

export function overCap(d: AdjustDraft, open: readonly ServerLeg[]): boolean {
  return openCountAfter(d, open) > MAX_OPEN_LEGS_UI;
}

/** The position as it is: open legs at their entry premiums. */
export function beforeLegs(open: readonly ServerLeg[], asset: Underlying): StrategyLeg[] {
  return open.map((l) => serverLegToLocal(l, asset));
}

/** A pick as a local leg (for quote subscriptions and pricing), at `price` or the price it was picked at. */
export function pickToLeg(p: AdjustPick, asset: Underlying, price = p.price): StrategyLeg {
  return { id: p.id, asset, kind: p.kind, side: p.side, strike: p.strike, expiry: p.expiry, lots: p.lots, price, iv: p.iv, symbol: p.symbol, status: "open", createdAt: 0 };
}

/**
 * The position after the change: kept lots at entry, added lots and picks at the current mark (falling back to
 * the entry or the pick price), so the "after" payoff is what the trader would actually hold.
 */
export function afterLegs(d: AdjustDraft, open: readonly ServerLeg[], asset: Underlying, markOf: MarkOf): StrategyLeg[] {
  const out: StrategyLeg[] = [];
  for (const leg of open) {
    const local = serverLegToLocal(leg, asset);
    const after = lotsAfterOf(d, leg);
    if (after > 0) out.push({ ...local, lots: Math.min(after, leg.lots) });
    if (after > leg.lots) out.push({ ...local, id: `${leg.id}:add`, lots: after - leg.lots, price: markOf(leg.symbol) ?? local.price });
  }
  for (const p of d.picks) out.push(pickToLeg(p, asset, markOf(p.symbol) ?? p.price));
  return out;
}

/** Premium the change moves, USD: positive = received (credit), negative = paid (debit). Exits at the mark, adds at the mark. */
export function cashflow(d: AdjustDraft, open: readonly ServerLeg[], markOf: MarkOf, lotSize: string): number {
  const size = Number(lotSize) || 0;
  let cash = 0;
  for (const leg of open) {
    const after = lotsAfterOf(d, leg);
    const mark = Number(markOf(leg.symbol) ?? leg.entryPrice ?? leg.price);
    if (after < leg.lots) cash += (leg.side === "buy" ? 1 : -1) * mark * (leg.lots - after) * size; // closing a long receives, closing a short pays
    else if (after > leg.lots) cash += (leg.side === "buy" ? -1 : 1) * mark * (after - leg.lots) * size;
  }
  for (const p of d.picks) cash += (p.side === "buy" ? -1 : 1) * Number(markOf(p.symbol) ?? p.price) * p.lots * size;
  return cash;
}

/** Distinct option expiries of the combined position, ascending. */
export function combinedExpiries(d: AdjustDraft, open: readonly ServerLeg[]): string[] {
  const set = new Set<string>();
  for (const leg of open) if (leg.kind !== "future" && lotsAfterOf(d, leg) > 0) set.add(leg.expiry);
  for (const p of d.picks) set.add(p.expiry);
  return [...set].sort();
}

export const VALUE_TODAY = "today";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** The "value at" instant: today, the chosen date (an expiry or a scenario date, at the settlement hour), else the latest expiry of the combined position; undefined without option legs. */
export function valuationMsOf(d: AdjustDraft, open: readonly ServerLeg[], asset: Underlying, nowMs: number): number | undefined {
  if (d.valuation === VALUE_TODAY) return nowMs;
  const expiries = combinedExpiries(d, open);
  if (expiries.length === 0) return undefined;
  const chosen = d.valuation && ISO_DATE.test(d.valuation) ? d.valuation : expiries[expiries.length - 1]!;
  try {
    return expiryMs(chosen, settlementHourUtc(asset));
  } catch {
    return expiryMs(expiries[expiries.length - 1]!, settlementHourUtc(asset)); // an impossible date falls back to the latest expiry
  }
}

/** ISO date `days` after the instant, for the scenario slider. */
export function isoDaysFrom(nowMs: number, days: number): string {
  return new Date(nowMs + days * 86_400_000).toISOString().slice(0, 10);
}

/** True when the change adds a contract that settles today (a 0-DTE leg), which the guard rails call out. */
export function addsZeroDte(d: AdjustDraft, open: readonly ServerLeg[], nowMs: number): boolean {
  const today = new Date(nowMs).toISOString().slice(0, 10);
  if (d.picks.some((p) => p.expiry <= today)) return true;
  return open.some((l) => l.kind !== "future" && lotsAfterOf(d, l) > l.lots && l.expiry <= today);
}

const dec = (v: string | number): string => toDecimal(Number(v), 4);

/** The API batch (ADR-044): trims and closes as `changes`, picks and extra lots as `adds`, expected marks per added symbol. */
export function toBody(d: AdjustDraft, open: readonly ServerLeg[], markOf: MarkOf, extra: { idempotencyKey: string; reason?: string | undefined; orderType?: OrderType | undefined }): AdjustBody {
  const changes: AdjustBody["changes"] = [];
  const adds: StrategyLegInput[] = [];
  const expected: Record<string, string> = {};
  const expect = (symbol: string) => {
    const mark = markOf(symbol);
    if (mark !== undefined && Number(mark) > 0) expected[symbol] = dec(mark);
  };
  for (const leg of open) {
    const after = lotsAfterOf(d, leg);
    const mark = markOf(leg.symbol) ?? leg.entryPrice ?? leg.price;
    if (after < leg.lots) changes.push({ legId: leg.id, lotsAfter: after, price: dec(mark) });
    else if (after > leg.lots) {
      adds.push({ kind: leg.kind, side: leg.side, strike: leg.strike, expiry: leg.expiry, symbol: leg.symbol, lots: after - leg.lots, price: dec(mark), ...(leg.iv === null ? {} : { iv: leg.iv }) });
      expect(leg.symbol);
    }
  }
  for (const p of d.picks) {
    adds.push({ kind: p.kind, side: p.side, strike: p.strike, expiry: p.expiry, symbol: p.symbol, lots: p.lots, price: dec(markOf(p.symbol) ?? p.price), ...(p.iv === undefined ? {} : { iv: p.iv }) });
    expect(p.symbol);
  }
  const reason = extra.reason?.trim();
  return { adds, changes, expected, orderType: extra.orderType ?? "market", idempotencyKey: extra.idempotencyKey, ...(reason ? { reason } : {}) };
}

export interface ChangeSummary {
  /** One line above the strip: "max loss worsens by ₹6,370 · you pay ₹4,781 · POP 12% → 0%". */
  line: string;
  /** Guard rails, in order of severity. */
  warnings: string[];
}

const pct = (p: number): string => (Number.isFinite(p) ? `${Math.round(p * 100)}%` : "—");

/** The before → after change in words, with the guard rails (ADR-044 decision 9). */
export function summarize(before: AnalyzeResult | null, after: AnalyzeResult | null, cash: number, money: MoneyFormat, flags: { zeroDte: boolean; overCap: boolean; staleMarks: boolean }): ChangeSummary {
  const parts: string[] = [];
  const warnings: string[] = [];
  if (before && after) {
    const b = before.maxLoss;
    const a = after.maxLoss;
    if (b === a) parts.push("max loss unchanged");
    else if (a === -Infinity) parts.push("max loss becomes unlimited");
    else if (b === -Infinity) parts.push(`max loss now ${fmtMoney(a, money, { signed: true })}, no longer unlimited`);
    else parts.push(`max loss ${a < b ? "worsens" : "improves"} by ${fmtMoney(Math.abs(a - b), money)}`);
    if (Number.isFinite(before.pop) || Number.isFinite(after.pop)) parts.push(`POP ${pct(before.pop)} → ${pct(after.pop)}`);
    if (a === -Infinity && b !== -Infinity) warnings.push("Unlimited loss introduced: the change leaves a naked short side");
  }
  if (Math.abs(cash) >= 0.005) parts.splice(1, 0, `${cash > 0 ? "you receive" : "you pay"} ${fmtMoney(Math.abs(cash), money)}`);
  if (flags.overCap) warnings.push(`Over the ${MAX_OPEN_LEGS_UI} open-leg cap: close or merge a leg first`);
  if (flags.zeroDte) warnings.push("Adds a leg that settles today (0 DTE)");
  if (flags.staleMarks) warnings.push("Marks are more than a minute old: Review re-reads them");
  return { line: parts.join(" · "), warnings };
}
