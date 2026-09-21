// Repair ideas (ADR-094; HC-TR-194, HC-TR-195): what the workbench offers a trader whose position needs work. A
// diagnosis of the open position (how far spot is from each short strike, which side is tested), then a catalogue of
// standard repairs built only from the listed strikes of the chain (ADR-006), each one a draft that lands in the
// workbench for review like any other change. Nothing here prices anything: the panel prices every draft with the
// engine and ranks them by the goal the trader picks. An adjustment swaps one risk for another, so every idea says
// what it gives up, and no tag ever says "best".
import type { StrategyLeg as ServerLeg, Underlying } from "@hapiecoin/schema";
import { fmtExpiry, fmtStrike } from "@/lib/format";
import { venueSymbol } from "@/lib/strategy/legs";
import { perpetualSymbolOf } from "@/lib/venue";
import { type AdjustDraft, type OptionKind, PERP, type PickInput, lotsAfterOf, newPickId, setLotsAfter } from "./model";

/** One strike row of a chain: the strike and the marks the picker shows. Always the whole ladder, never a view slice. */
export interface RepairRow {
  strike: string;
  call?: { mark: string; markIv?: number | undefined } | undefined;
  put?: { mark: string; markIv?: number | undefined } | undefined;
}

export interface RepairContext {
  open: readonly ServerLeg[];
  asset: Underlying;
  /** The expiry the chain shows, and its rows ascending by strike. */
  expiry: string | null;
  rows: readonly RepairRow[];
  /** The next listed expiry after `expiry` and its rows, when known. */
  nextExpiry?: string | null | undefined;
  nextRows?: readonly RepairRow[] | undefined;
  spot: number | null;
  /** One standard deviation move to the nearest expiry, in price units (the engine's figure); null when unknown. */
  expectedMove: number | null;
  /** Net delta of the whole open position in units of the underlying (the engine's figure, futures included); for the hedge. */
  netDelta?: number | null | undefined;
  /** Units of the underlying in one lot (0.001 BTC), the same for an option and for the perpetual. */
  lotSize?: number | null | undefined;
  /** The strategy's own venue: the perpetual is named and netted on it, never on the workspace's (the ticket does the same). */
  venue?: string | undefined;
}

type OptLeg = ServerLeg & { kind: OptionKind };
const isOption = (l: ServerLeg): l is OptLeg => l.kind === "call" || l.kind === "put";
const quoteOf = (r: RepairRow, kind: OptionKind) => (kind === "call" ? r.call : r.put);
/** A quote an idea may be priced from: present and above zero. A far wing quoted at 0 would make a roll look free. */
const usable = (r: RepairRow, kind: OptionKind): boolean => {
  const q = quoteOf(r, kind);
  return q !== undefined && Number.isFinite(Number(q.mark)) && Number(q.mark) > 0;
};
const blank = (d: AdjustDraft): AdjustDraft => ({ ...d, lotsAfter: {}, picks: [] });
const n = (s: string): number => Number(s);
const cp = (kind: OptionKind): string => (kind === "call" ? "C" : "P");
/** `a` is further out of the money than `b` for this kind. */
const further = (kind: OptionKind, a: number, b: number): boolean => (kind === "call" ? a > b : a < b);

// ---------------------------------------------------------------------------------------------------------------
// Diagnosis
// ---------------------------------------------------------------------------------------------------------------

/** One short contract of the shown expiry: twin rows on the same contract (an earlier add books a second row) are one short. */
export interface ShortDistance {
  legIds: readonly string[];
  kind: OptionKind;
  strike: number;
  lots: number;
  /** Price units between spot and the strike, positive while the short is out of the money. */
  distance: number;
  /** `distance` as a fraction of spot. */
  pct: number;
  /** `distance` in expected moves; null when the expected move is unknown. */
  sigmas: number | null;
}

export interface Diagnosis {
  shorts: ShortDistance[];
  /** The short contract closest to spot (in expected moves when known, else in percent); null without a short option. */
  tested: ShortDistance | null;
  /** The tested short is in the money or less than one expected move away. */
  underPressure: boolean;
  /** Long options on the shown expiry with nothing sold further out on their side. */
  nakedLongs: number;
  /** Option legs are held on the shown expiry but the spot price has not arrived: nothing can be measured yet. */
  waiting: boolean;
}

export function diagnose(ctx: RepairContext): Diagnosis {
  const legs = ctx.open.filter((l): l is OptLeg => isOption(l) && l.expiry === ctx.expiry);
  const spot = ctx.spot !== null && ctx.spot > 0 ? ctx.spot : null;
  const shorts: ShortDistance[] = [];
  if (spot !== null) {
    for (const l of legs) {
      if (l.side !== "sell") continue;
      const strike = n(l.strike);
      const at = shorts.findIndex((s) => s.kind === l.kind && s.strike === strike);
      const twin = shorts[at];
      if (twin) {
        shorts[at] = { ...twin, legIds: [...twin.legIds, l.id], lots: twin.lots + l.lots };
        continue;
      }
      const distance = l.kind === "call" ? strike - spot : spot - strike;
      const sigmas = ctx.expectedMove !== null && ctx.expectedMove > 0 ? distance / ctx.expectedMove : null;
      shorts.push({ legIds: [l.id], kind: l.kind, strike, lots: l.lots, distance, pct: distance / spot, sigmas });
    }
  }
  const key = (s: ShortDistance): number => s.sigmas ?? s.pct;
  const tested = shorts.reduce<ShortDistance | null>((best, s) => (best === null || key(s) < key(best) ? s : best), null);
  const underPressure = tested !== null && (tested.distance < 0 || (tested.sigmas !== null ? tested.sigmas < 1 : tested.pct < 0.05));
  const nakedLongs = legs.filter((l) => l.side === "buy" && !legs.some((s) => s.side === "sell" && s.kind === l.kind && further(l.kind, n(s.strike), n(l.strike)))).length;
  return { shorts, tested, underPressure, nakedLongs, waiting: spot === null && legs.length > 0 };
}

/** "short 92,000 C is above spot by 14.4 % (0.86 σ) · short 66,000 P is below spot by 17.9 % (1.07 σ) · the call side is tested". */
export function diagnosisLine(d: Diagnosis): string {
  if (d.waiting) return "Waiting for the spot price: the ideas are built once it arrives";
  if (d.shorts.length === 0) return d.nakedLongs > 0 ? "No short option on this expiry: the ideas below lower the cost of the long legs" : "No option leg on the shown expiry";
  const part = (s: ShortDistance): string => {
    const where = s.distance < 0 ? "in the money by" : s.kind === "call" ? "above spot by" : "below spot by";
    const sig = s.sigmas === null ? "" : ` (${Math.abs(s.sigmas).toFixed(2)} σ)`;
    return `short ${fmtStrike(String(s.strike))} ${cp(s.kind)} is ${where} ${(Math.abs(s.pct) * 100).toFixed(1)} %${sig}`;
  };
  const tail = d.tested ? ` · the ${d.tested.kind} side is ${d.underPressure ? "tested" : "the nearer one"}` : "";
  return d.shorts.map(part).join(" · ") + tail;
}

// ---------------------------------------------------------------------------------------------------------------
// The catalogue
// ---------------------------------------------------------------------------------------------------------------

export type RepairKind = "capCheap" | "capBalanced" | "capTight" | "rollTestedAway" | "rollUntestedCloser" | "rollOut" | "rollOutAway" | "halveTested" | "closeTested" | "convertToSpread" | "rollCheaper" | "hedgeDelta";

export interface RepairIdea {
  kind: RepairKind;
  label: string;
  /** The orders in words: "buy 500 × 95,000 C and 500 × 65,000 P 27 Nov". Empty when the idea cannot be built. */
  what: string;
  /** What the trader pays for the benefit, in one line. */
  givesUp: string;
  /** The draft to load, or null when the idea cannot be built from what is listed (`note` says why). */
  draft: AdjustDraft | null;
  note: string;
}

/** A wing may cost at most this share of the short leg's mark on its side: cheap, balanced, tight. */
export const WING_BUDGET: Record<"capCheap" | "capBalanced" | "capTight", number> = { capCheap: 0.1, capBalanced: 0.25, capTight: 0.5 };
/** Strikes a roll moves by. */
export const ROLL_STEPS = 2;
/** A short rolled toward spot must stay at least this many expected moves (or this share of spot) out of the money. */
export const MIN_SIGMAS_AFTER_ROLL_IN = 0.5;
export const MIN_PCT_AFTER_ROLL_IN = 0.02;
/** A leg rolled to the next expiry may skip at most this many listed strikes when its own strike is not quoted there. */
export const MAX_SKIPPED_ON_ROLL_OUT = 1;

/** Open legs on the contract that the draft still holds: a leg the idea has closed is out of the way. */
function heldOn(d: AdjustDraft, open: readonly ServerLeg[], input: Pick<PickInput, "kind" | "strike" | "expiry">): OptLeg[] {
  return open.filter((l): l is OptLeg => isOption(l) && l.kind === input.kind && l.expiry === input.expiry && n(l.strike) === n(input.strike) && lotsAfterOf(d, l) > 0);
}

/** The order would meet the other side of the same contract, held or already picked: the two would cancel, not repair. */
function collides(d: AdjustDraft, open: readonly ServerLeg[], asset: Underlying, input: PickInput): boolean {
  const symbol = venueSymbol(input.kind, asset, input.strike, input.expiry);
  return heldOn(d, open, input).some((l) => l.side !== input.side) || d.picks.some((p) => p.symbol === symbol && p.side !== input.side);
}

/**
 * Put one order of an idea on the draft. On a contract the position still holds on the same side the lots are added
 * to that leg; otherwise it is a pick, merged with an earlier pick of the idea on the same contract and side (twin
 * legs roll into one order). Never a toggle, and never netted against a leg the idea closes: the closes are applied
 * first and `heldOn` skips them. Callers refuse an idea that `collides` before they get here.
 */
function place(d: AdjustDraft, open: readonly ServerLeg[], asset: Underlying, input: PickInput): AdjustDraft {
  const same = heldOn(d, open, input).find((l) => l.side === input.side);
  if (same) return setLotsAfter(d, same.id, lotsAfterOf(d, same) + input.lots);
  const symbol = venueSymbol(input.kind, asset, input.strike, input.expiry);
  const twin = d.picks.find((p) => p.symbol === symbol && p.side === input.side);
  if (twin) return { ...d, picks: d.picks.map((p) => (p.id === twin.id ? { ...p, lots: p.lots + input.lots } : p)) };
  return { ...d, picks: [...d.picks, { id: newPickId(), kind: input.kind, side: input.side, strike: input.strike, expiry: input.expiry, lots: input.lots, price: input.price, iv: input.iv, symbol }] };
}

/** Usable rows of `kind` strictly further out of the money than `strike`, nearest first. */
function beyond(rows: readonly RepairRow[], strike: number, kind: OptionKind): RepairRow[] {
  const out = rows.filter((r) => usable(r, kind) && further(kind, n(r.strike), strike));
  return out.sort((a, b) => (kind === "call" ? n(a.strike) - n(b.strike) : n(b.strike) - n(a.strike)));
}
/** Usable rows of `kind` strictly nearer the money than `strike`, nearest to the strike first. */
function inside(rows: readonly RepairRow[], strike: number, kind: OptionKind): RepairRow[] {
  const out = rows.filter((r) => usable(r, kind) && further(kind, strike, n(r.strike)));
  return out.sort((a, b) => (kind === "call" ? n(b.strike) - n(a.strike) : n(a.strike) - n(b.strike)));
}
/**
 * Where a leg lands on another expiry's ladder: its own strike when that is quoted there; else, for a short, the
 * next quoted strike further out of the money (a roll out must never move a short toward spot unasked) and, for a
 * long, the nearest quoted strike either way (on a tie the one further out). Undefined when that would skip more
 * than MAX_SKIPPED_ON_ROLL_OUT listed strikes: a sparse ladder is no reason to move a leg across the chain.
 */
function landing(rows: readonly RepairRow[], strike: number, kind: OptionKind, side: "buy" | "sell"): RepairRow | undefined {
  const exact = rows.find((r) => n(r.strike) === strike && usable(r, kind));
  if (exact) return exact;
  const out = beyond(rows, strike, kind)[0];
  const inn = side === "sell" ? undefined : inside(rows, strike, kind)[0];
  const to = out && inn ? (Math.abs(n(inn.strike) - strike) < Math.abs(n(out.strike) - strike) ? inn : out) : (out ?? inn);
  if (!to) return undefined;
  const lo = Math.min(strike, n(to.strike));
  const hi = Math.max(strike, n(to.strike));
  const skipped = rows.filter((r) => n(r.strike) > lo && n(r.strike) < hi).length;
  return skipped <= MAX_SKIPPED_ON_ROLL_OUT ? to : undefined;
}
const legText = (side: "buy" | "sell", lots: number, strike: string, kind: OptionKind, expiry: string): string => `${side} ${lots} × ${fmtStrike(strike)} ${cp(kind)} ${fmtExpiry(expiry)}`;
const pickOf = (r: RepairRow, kind: OptionKind, side: "buy" | "sell", expiry: string, lots: number): PickInput => {
  const q = quoteOf(r, kind)!;
  return { kind, side, strike: r.strike, expiry, lots, price: q.mark, iv: q.markIv };
};

/**
 * Short lots on a side that no long answers, and the furthest short strike (the wing goes beyond it). Every long of
 * the kind counts, nearer the money or further out: past the last strike the loss grows with the short lots minus
 * the long lots, so a long nearer the money caps the risk as well (a debit spread is already defined risk).
 * A held future is not counted (GAPS #117).
 */
function uncovered(legs: readonly OptLeg[], kind: OptionKind): { lots: number; anchor: OptLeg } | null {
  const shorts = legs.filter((l) => l.kind === kind && l.side === "sell");
  if (shorts.length === 0) return null;
  const anchor = shorts.reduce((a, b) => (further(kind, n(b.strike), n(a.strike)) ? b : a));
  const cover = legs.filter((l) => l.kind === kind && l.side === "buy").reduce((s, l) => s + l.lots, 0);
  const lots = shorts.reduce((s, l) => s + l.lots, 0) - cover;
  return lots > 0 ? { lots, anchor } : null;
}

function capIdea(kind: "capCheap" | "capBalanced" | "capTight", base: AdjustDraft, ctx: RepairContext, legs: readonly OptLeg[]): RepairIdea {
  const label = kind === "capCheap" ? "Cap the risk · cheap wings" : kind === "capBalanced" ? "Cap the risk · balanced wings" : "Cap the risk · tight wings";
  const givesUp = "You pay for the wings, so the most you can make falls; a far wing only helps in an extreme move";
  const off = (note: string): RepairIdea => ({ kind, label, what: "", givesUp, draft: null, note });
  if (!ctx.expiry) return off("no expiry shown");
  const expiry = ctx.expiry;
  const sides = (["call", "put"] as const).map((k) => ({ k, u: uncovered(legs, k) })).filter((s): s is { k: OptionKind; u: { lots: number; anchor: OptLeg } } => s.u !== null);
  if (sides.length === 0) return off("every short on this expiry is already answered by a long on its side");
  let d = blank(base);
  const parts: string[] = [];
  const notes: string[] = [];
  for (const { k, u } of sides) {
    const candidates = beyond(ctx.rows, n(u.anchor.strike), k);
    if (candidates.length === 0) {
      notes.push(`no ${k} listed beyond ${fmtStrike(u.anchor.strike)}`);
      continue;
    }
    const anchorRow = ctx.rows.find((r) => n(r.strike) === n(u.anchor.strike));
    const shortMark = anchorRow && usable(anchorRow, k) ? n(quoteOf(anchorRow, k)!.mark) : n(u.anchor.price);
    const budget = shortMark * WING_BUDGET[kind];
    // the nearest strike within the budget is the tightest protection that budget buys; past the end of the ladder
    // the furthest listed strike is the cheapest there is
    const within = candidates.find((r) => n(quoteOf(r, k)!.mark) <= budget);
    const wing = within ?? candidates[candidates.length - 1]!;
    if (!within) notes.push(`the ${k} ladder ends at ${fmtStrike(wing.strike)}, above the ${Math.round(WING_BUDGET[kind] * 100)} % budget`);
    d = place(d, ctx.open, ctx.asset, pickOf(wing, k, "buy", expiry, u.lots)); // beyond every short of the kind, so it can only meet a held long: the lots are added to it
    parts.push(legText("buy", u.lots, wing.strike, k, expiry));
  }
  if (parts.length === 0) return off(notes.join(" · "));
  return { kind, label, what: parts.join(" and "), givesUp, draft: d, note: notes.join(" · ") };
}

/** The rows of one short contract (twins included). */
const rowsOf = (legs: readonly OptLeg[], short: ShortDistance | null | undefined): OptLeg[] => (short ? legs.filter((l) => short.legIds.includes(l.id)) : []);
/** A held long of the kind between the short's strike (exclusive) and the strike it would move to (inclusive). */
function longInTheWay(legs: readonly OptLeg[], kind: OptionKind, from: number, to: number): OptLeg | undefined {
  const lo = Math.min(from, to);
  const hi = Math.max(from, to);
  return legs.find((l) => l.kind === kind && l.side === "buy" && n(l.strike) !== from && n(l.strike) >= lo && n(l.strike) <= hi);
}

/** Close every row of one short contract and sell the same lots at `to`, or say why not. */
function moveShort(kind: "rollTestedAway" | "rollUntestedCloser", label: string, givesUp: string, base: AdjustDraft, ctx: RepairContext, legs: readonly OptLeg[], rowsOfShort: readonly OptLeg[], to: RepairRow, expiry: string): RepairIdea {
  const first = rowsOfShort[0]!;
  const off = (note: string): RepairIdea => ({ kind, label, what: "", givesUp, draft: null, note });
  const blocker = longInTheWay(legs, first.kind, n(first.strike), n(to.strike));
  if (blocker) return off(`your long ${fmtStrike(blocker.strike)} ${cp(first.kind)} is in the way: moving the short onto or past it would turn the spread around`);
  const lots = rowsOfShort.reduce((s, l) => s + l.lots, 0);
  let d = blank(base);
  for (const l of rowsOfShort) d = setLotsAfter(d, l.id, 0);
  const order = pickOf(to, first.kind, "sell", expiry, lots);
  if (collides(d, ctx.open, ctx.asset, order)) return off(`you hold the other side of ${fmtStrike(to.strike)} ${cp(first.kind)}: selling it would cancel that leg, not move the short`);
  d = place(d, ctx.open, ctx.asset, order);
  return { kind, label, what: `close ${fmtStrike(first.strike)} ${cp(first.kind)}, ${legText("sell", lots, to.strike, first.kind, expiry)}`, givesUp, draft: d, note: "" };
}

function rollTestedAway(base: AdjustDraft, ctx: RepairContext, legs: readonly OptLeg[], tested: ShortDistance | null): RepairIdea {
  const kind = "rollTestedAway" as const;
  const label = "Roll the tested short away";
  const givesUp = "You buy back the tested short, at a loss if it has moved against you, and sell a cheaper one: less credit, more room";
  const off = (note: string): RepairIdea => ({ kind, label, what: "", givesUp, draft: null, note });
  const rowsOfShort = rowsOf(legs, tested);
  const first = rowsOfShort[0];
  if (!first || !ctx.expiry) return off("no short option on the shown expiry");
  const out = beyond(ctx.rows, n(first.strike), first.kind);
  const to = out[Math.min(ROLL_STEPS, out.length) - 1];
  if (!to) return off(`no ${first.kind} listed beyond ${fmtStrike(first.strike)}`);
  return moveShort(kind, label, givesUp, base, ctx, legs, rowsOfShort, to, ctx.expiry);
}

function rollUntestedCloser(base: AdjustDraft, ctx: RepairContext, legs: readonly OptLeg[], dx: Diagnosis): RepairIdea {
  const kind = "rollUntestedCloser" as const;
  const label = "Roll the untested side closer";
  const givesUp = "More credit and a centred position, but less room on the side you move in";
  const off = (note: string): RepairIdea => ({ kind, label, what: "", givesUp, draft: null, note });
  const other = dx.tested ? dx.shorts.filter((s) => s.kind !== dx.tested!.kind).sort((a, b) => (b.sigmas ?? b.pct) - (a.sigmas ?? a.pct))[0] : undefined;
  const rowsOfShort = rowsOf(legs, other);
  const first = rowsOfShort[0];
  if (!first || !ctx.expiry || ctx.spot === null) return off("no short on the other side to move");
  const spot = ctx.spot;
  const roomOk = (r: RepairRow): boolean => {
    const dist = first.kind === "call" ? n(r.strike) - spot : spot - n(r.strike);
    return ctx.expectedMove !== null && ctx.expectedMove > 0 ? dist >= MIN_SIGMAS_AFTER_ROLL_IN * ctx.expectedMove : dist >= MIN_PCT_AFTER_ROLL_IN * spot;
  };
  const steps = inside(ctx.rows, n(first.strike), first.kind).slice(0, ROLL_STEPS).filter(roomOk);
  const to = steps[steps.length - 1];
  if (!to) return off(`${fmtStrike(first.strike)} ${cp(first.kind)} is already close to spot`);
  return moveShort(kind, label, givesUp, base, ctx, legs, rowsOfShort, to, ctx.expiry);
}

function rollOut(kind: "rollOut" | "rollOutAway", base: AdjustDraft, ctx: RepairContext, legs: readonly OptLeg[], tested: ShortDistance | null): RepairIdea {
  const label = kind === "rollOut" ? (ctx.nextExpiry ? `Roll out to ${fmtExpiry(ctx.nextExpiry)}` : "Roll out") : ctx.nextExpiry ? `Roll out to ${fmtExpiry(ctx.nextExpiry)} and away` : "Roll out and away";
  const givesUp = "More time for the trade to work and usually a credit, but the risk stays open for longer";
  const off = (note: string): RepairIdea => ({ kind, label, what: "", givesUp, draft: null, note });
  if (legs.length === 0) return off("no option legs on the shown expiry");
  if (!ctx.nextExpiry || !ctx.nextRows || ctx.nextRows.length === 0) return off("the next expiry's chain is not loaded yet");
  if (kind === "rollOutAway" && !tested) return off("no short option to move away");
  const next = ctx.nextExpiry;
  const notes: string[] = [];
  const moves: { leg: OptLeg; to: RepairRow }[] = [];
  for (const leg of legs) {
    let to = landing(ctx.nextRows, n(leg.strike), leg.kind, leg.side);
    if (!to) return off(`no ${leg.kind} quote at or next to ${fmtStrike(leg.strike)} on ${fmtExpiry(next)}`);
    if (n(to.strike) !== n(leg.strike)) notes.push(`${fmtStrike(leg.strike)} ${cp(leg.kind)} is not quoted on ${fmtExpiry(next)}: it moves to ${fmtStrike(to.strike)}`);
    if (kind === "rollOutAway" && tested && tested.legIds.includes(leg.id)) {
      const out = beyond(ctx.nextRows, n(to.strike), leg.kind);
      to = out[Math.min(ROLL_STEPS, out.length) - 1] ?? to;
    }
    moves.push({ leg, to });
  }
  // a long that was further out than a short of its kind must still be further out after the move, or the spread has turned around
  for (const s of moves) {
    if (s.leg.side !== "sell") continue;
    const turned = moves.find((l) => l.leg.side === "buy" && l.leg.kind === s.leg.kind && further(s.leg.kind, n(l.leg.strike), n(s.leg.strike)) && !further(s.leg.kind, n(l.to.strike), n(s.to.strike)));
    if (turned) return off(`the short ${fmtStrike(s.leg.strike)} ${cp(s.leg.kind)} would land on or past your long ${fmtStrike(turned.leg.strike)} ${cp(s.leg.kind)} on ${fmtExpiry(next)}`);
  }
  let d = blank(base);
  for (const { leg } of moves) d = setLotsAfter(d, leg.id, 0);
  const parts: string[] = [];
  for (const { leg, to } of moves) {
    const order = pickOf(to, leg.kind, leg.side, next, leg.lots);
    if (collides(d, ctx.open, ctx.asset, order)) return off(`${fmtStrike(to.strike)} ${cp(leg.kind)} ${fmtExpiry(next)} would meet its own other side (a leg you hold there, or another leg of this roll): the two would cancel`);
    d = place(d, ctx.open, ctx.asset, order);
    parts.push(legText(leg.side, leg.lots, to.strike, leg.kind, next));
  }
  return { kind, label, what: `close ${legs.length === 1 ? "the leg" : `all ${legs.length} legs`}, ${parts.join(", ")}`, givesUp, draft: d, note: [...new Set(notes)].join(" · ") };
}

function sizeIdea(kind: "halveTested" | "closeTested", base: AdjustDraft, legs: readonly OptLeg[], tested: ShortDistance | null): RepairIdea {
  const label = kind === "halveTested" ? "Halve the tested short" : "Close the tested short";
  const givesUp = kind === "halveTested" ? "You book half of that short's result now, a loss if it has moved against you, and keep half the risk" : "You book that short's result now, a loss if it has moved against you; the rest of the position stays on its own";
  const off = (note: string): RepairIdea => ({ kind, label, what: "", givesUp, draft: null, note });
  const rowsOfShort = rowsOf(legs, tested);
  const first = rowsOfShort[0];
  if (!first) return off("no short option on the shown expiry");
  const total = rowsOfShort.reduce((s, l) => s + l.lots, 0);
  if (kind === "halveTested" && total < 2) return off("the tested short is a single lot");
  const bought = kind === "halveTested" ? total - Math.ceil(total / 2) : total;
  let back = bought;
  let d = blank(base);
  for (const l of [...rowsOfShort].sort((a, b) => b.lots - a.lots)) {
    const take = Math.min(l.lots, back);
    if (take > 0) d = setLotsAfter(d, l.id, l.lots - take);
    back -= take;
  }
  return { kind, label, what: `buy back ${bought} of ${total} × ${fmtStrike(first.strike)} ${cp(first.kind)}`, givesUp, draft: d, note: "" };
}

function longIdea(kind: "convertToSpread" | "rollCheaper", base: AdjustDraft, ctx: RepairContext, legs: readonly OptLeg[]): RepairIdea {
  const label = kind === "convertToSpread" ? "Convert to a spread" : "Roll to a cheaper strike";
  const givesUp = kind === "convertToSpread" ? "The premium you receive lowers your cost, but the profit above the sold strike is gone" : "You take cash out of the trade, but it needs a bigger move to pay";
  const off = (note: string): RepairIdea => ({ kind, label, what: "", givesUp, draft: null, note });
  const longs = legs.filter((l) => l.side === "buy" && !legs.some((s) => s.side === "sell" && s.kind === l.kind));
  if (longs.length === 0 || !ctx.expiry) return off("no long option without a sold leg on its side");
  const expiry = ctx.expiry;
  const side = kind === "convertToSpread" ? "sell" : "buy";
  let d = blank(base);
  if (kind === "rollCheaper") for (const leg of longs) d = setLotsAfter(d, leg.id, 0); // the closes first, so no replacement is netted against a leg on its way out
  const parts: string[] = [];
  for (const leg of longs) {
    // a strike where the order would meet its own other side (another long still held) is skipped, not netted
    const out = beyond(ctx.rows, n(leg.strike), leg.kind).filter((r) => !collides(d, ctx.open, ctx.asset, pickOf(r, leg.kind, side, expiry, leg.lots)));
    const to = out[Math.min(ROLL_STEPS, out.length) - 1];
    if (!to) return off(`no ${leg.kind} listed beyond ${fmtStrike(leg.strike)}`);
    d = place(d, ctx.open, ctx.asset, pickOf(to, leg.kind, side, expiry, leg.lots));
    parts.push(kind === "convertToSpread" ? legText("sell", leg.lots, to.strike, leg.kind, expiry) : `close ${fmtStrike(leg.strike)} ${cp(leg.kind)}, ${legText("buy", leg.lots, to.strike, leg.kind, expiry)}`);
  }
  return { kind, label, what: parts.join(" and "), givesUp, draft: d, note: "" };
}

/**
 * Hedge the delta with the perpetual (ADR-095, HC-TR-198): |net delta| ÷ lot size in whole lots, sold when the delta is
 * positive and bought when it is negative, netted against a future the position already holds (more of the same side
 * adds to it, the other side trims it first). Fully neutral, never a half hedge: the lots can be edited after loading.
 * It is a snapshot: the delta moves with the market, a future has no floor, and funding is not modelled; the card says so.
 */
function hedgeIdea(base: AdjustDraft, ctx: RepairContext): RepairIdea {
  const kind = "hedgeDelta" as const;
  const label = "Hedge the delta with the future";
  const givesUp = "A future has no floor, so this removes the direction risk now but does not cap the loss; the delta moves with the market, so the hedge needs re-doing; funding payments on the perpetual are not modelled";
  const off = (note: string): RepairIdea => ({ kind, label, what: "", givesUp, draft: null, note });
  const { netDelta, lotSize, spot } = ctx;
  if (netDelta === null || netDelta === undefined || !Number.isFinite(netDelta) || !lotSize || !(lotSize > 0) || spot === null) return off("waiting for the position's delta");
  const lots = Math.round(Math.abs(netDelta) / lotSize);
  if (lots < 1) return off("the position is already within one lot of delta-neutral");
  const side = netDelta > 0 ? "sell" : "buy";
  if (perpetualSymbolOf(ctx.asset, ctx.venue) === null) return off("this exchange lists no perpetual future for the asset");
  const symbol = venueSymbol("future", ctx.asset, PERP.strike, PERP.expiry, ctx.venue);
  const held = ctx.open.filter((l) => l.kind === "future" && l.symbol === symbol);
  let d = blank(base);
  let rest = lots;
  const same = held.find((l) => l.side === side);
  if (same) {
    d = setLotsAfter(d, same.id, same.lots + lots);
    rest = 0;
  } else {
    for (const l of [...held].sort((a, b) => b.lots - a.lots)) {
      const take = Math.min(l.lots, rest);
      if (take > 0) d = setLotsAfter(d, l.id, l.lots - take);
      rest -= take;
    }
  }
  if (rest > 0) d = { ...d, picks: [...d.picks, { id: newPickId(), kind: "future", side, strike: PERP.strike, expiry: PERP.expiry, lots: rest, price: String(spot), iv: undefined, symbol }] };
  const size = `${lots} × ${symbol} perp (${(lots * lotSize).toFixed(3)} ${ctx.asset})`;
  const what = same ? `${side} ${size}, added to the future you hold` : rest < lots ? `${side} ${size}: ${lots - rest} of them close the future you hold${rest > 0 ? `, ${rest} open the other side` : ""}` : `${side} ${size} at the index`;
  return { kind, label, what, givesUp, draft: d, note: "" };
}

/**
 * Two drafts that trade the same contracts the same way are one idea (and a working change with an idea's signature is that
 * idea). `looseFutures` leaves the lots of a futures pick out: the hedge is re-sized with every refresh of the delta, and a
 * loaded hedge of 350 lots must still read as the hedge idea when the card says 351 two seconds later.
 */
export function draftSignature(d: AdjustDraft, looseFutures = false): string {
  const closes = Object.entries(d.lotsAfter).map(([id, lots]) => `${id}=${lots}`).sort();
  const picks = d.picks.map((p) => (looseFutures && p.kind === "future" ? `${p.symbol}:${p.side}` : `${p.symbol}:${p.side}:${p.lots}`)).sort();
  return [...closes, ...picks].join("|");
}

/**
 * The ideas for the position on the shown expiry: short-side repairs when something is sold, else the two for longs.
 * None before the spot price has arrived: the tested side cannot be named and nothing could be priced.
 */
export function repairIdeas(base: AdjustDraft, ctx: RepairContext): RepairIdea[] {
  if (ctx.spot === null || !(ctx.spot > 0)) return [];
  const legs = ctx.open.filter((l): l is OptLeg => isOption(l) && l.expiry === ctx.expiry);
  const dx = diagnose(ctx);
  const all: RepairIdea[] = dx.shorts.length
    ? [capIdea("capCheap", base, ctx, legs), capIdea("capBalanced", base, ctx, legs), capIdea("capTight", base, ctx, legs), rollTestedAway(base, ctx, legs, dx.tested), rollUntestedCloser(base, ctx, legs, dx), rollOut("rollOut", base, ctx, legs, dx.tested), rollOut("rollOutAway", base, ctx, legs, dx.tested), sizeIdea("halveTested", base, legs, dx.tested), sizeIdea("closeTested", base, legs, dx.tested), hedgeIdea(base, ctx)]
    : [longIdea("convertToSpread", base, ctx, legs), longIdea("rollCheaper", base, ctx, legs), rollOut("rollOut", base, ctx, legs, null), hedgeIdea(base, ctx)];
  // when two ideas come to the same trade (budgets landing on the same strikes of a short ladder, a roll out and away
  // with nothing listed further out), the later one adds nothing: keep the first
  const seen = new Set<string>();
  return all.filter((idea) => {
    if (!idea.draft) return true;
    const sig = draftSignature(idea.draft);
    if (seen.has(sig)) return false;
    seen.add(sig);
    return true;
  });
}

// ---------------------------------------------------------------------------------------------------------------
// Ranking
// ---------------------------------------------------------------------------------------------------------------

export type RepairGoal = "maxLoss" | "credit" | "neutral" | "breakevens";
export const REPAIR_GOALS: readonly { id: RepairGoal; label: string }[] = [
  { id: "maxLoss", label: "Reduce max loss" },
  { id: "credit", label: "Collect credit" },
  { id: "neutral", label: "Get neutral" },
  { id: "breakevens", label: "Widen break-evens" },
];

export interface RepairFigures {
  maxLoss: number;
  maxProfit: number;
  breakevens: readonly number[];
  pop: number;
  delta: number;
  cash: number;
}

/** Undefined risk first: nothing matters more than the loss having no floor. A tested side next, else the credit. */
export function defaultGoal(dx: Diagnosis, before: RepairFigures | null): RepairGoal {
  if (before && !Number.isFinite(before.maxLoss)) return "maxLoss";
  if (dx.underPressure) return "breakevens";
  return "credit";
}

const width = (f: RepairFigures): number => (f.breakevens.length >= 2 ? f.breakevens[f.breakevens.length - 1]! - f.breakevens[0]! : -Infinity);
/** Higher is better for the goal. */
export function scoreFor(goal: RepairGoal, f: RepairFigures): number {
  switch (goal) {
    case "maxLoss":
      return Number.isFinite(f.maxLoss) ? f.maxLoss : -Number.MAX_VALUE;
    case "credit":
      return f.cash;
    case "neutral":
      return -Math.abs(f.delta);
    case "breakevens":
      return width(f);
  }
}

/** Indices of `figures` best first for the goal; unpriced ideas keep their catalogue order at the end. */
export function orderIdeas(figures: readonly (RepairFigures | null)[], goal: RepairGoal): number[] {
  const priced = figures.map((f, i) => ({ f, i })).filter((x): x is { f: RepairFigures; i: number } => x.f !== null);
  priced.sort((a, b) => scoreFor(goal, b.f) - scoreFor(goal, a.f) || a.i - b.i);
  return [...priced.map((x) => x.i), ...figures.map((f, i) => (f === null ? i : -1)).filter((i) => i >= 0)];
}

export type RepairTag = "defines your risk" | "smallest max loss" | "largest credit" | "closest to delta-neutral" | "widest break-evens";

/**
 * The tags a card may show. The hedge never carries "defines your risk", even when the engine finds a floor (a naked
 * short call hedged into a covered call stops losing above the strike): a future has no floor of its own, the hedge is
 * sized for today's delta only, and the card says so. The figures on the card stay what the engine computed.
 */
export function tagsForIdea(kind: RepairKind, tags: readonly RepairTag[]): RepairTag[] {
  return kind === "hedgeDelta" ? tags.filter((t) => t !== "defines your risk") : [...tags];
}

/** Factual tags per idea. "defines your risk" goes to every idea that turns an unlimited loss into a limited one. */
export function tagIdeas(figures: readonly (RepairFigures | null)[], before: RepairFigures | null): RepairTag[][] {
  const tags: RepairTag[][] = figures.map(() => []);
  if (before && !Number.isFinite(before.maxLoss)) figures.forEach((f, i) => f && Number.isFinite(f.maxLoss) && tags[i]!.push("defines your risk"));
  const best = (goal: RepairGoal, tag: RepairTag) => {
    const [first] = orderIdeas(figures, goal);
    const f = first === undefined ? null : figures[first];
    if (first === undefined || !f || !Number.isFinite(scoreFor(goal, f)) || scoreFor(goal, f) <= -Number.MAX_VALUE) return;
    if (goal === "credit" && f.cash <= 0) return; // the least expensive debit is not a credit
    tags[first]!.push(tag);
  };
  best("maxLoss", "smallest max loss");
  best("credit", "largest credit");
  best("neutral", "closest to delta-neutral");
  best("breakevens", "widest break-evens");
  return tags;
}
