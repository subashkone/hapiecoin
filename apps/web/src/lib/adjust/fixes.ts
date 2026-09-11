// Quick fixes (ADR-044 decision 7; HC-TR-154): one-click drafts of the common repairs, built from the open
// position and the listed strikes of the chain, each landing in the workbench for review like any other draft.
// The workbench ranks them with the engine (smallest max loss, largest credit, closest to delta-neutral).
import type { StrategyLeg as ServerLeg, Underlying } from "@hapiecoin/schema";
import { fmtExpiry, fmtStrike } from "@/lib/format";
import { venueSymbol } from "@/lib/strategy/legs";
import { type AdjustDraft, type OptionKind, type PickInput, newPickId, pickOnDraft, setLotsAfter } from "./model";

/** One strike row of a chain window: the strike and the marks the picker shows. */
export interface FixRow {
  strike: string;
  call?: { mark: string; markIv?: number | undefined } | undefined;
  put?: { mark: string; markIv?: number | undefined } | undefined;
}

export interface FixContext {
  open: readonly ServerLeg[];
  asset: Underlying;
  /** The expiry the chain shows, and its rows ascending by strike. */
  expiry: string | null;
  rows: readonly FixRow[];
  /** The next listed expiry after `expiry` and its rows, when known. */
  nextExpiry?: string | null | undefined;
  nextRows?: readonly FixRow[] | undefined;
  spot: number | null;
}

export type FixKind = "rollUp" | "rollOut" | "hedgeCall";

export interface FixCandidate {
  kind: FixKind;
  label: string;
  /** The draft to load, or null when the fix cannot be built from what is listed (`note` says why). */
  draft: AdjustDraft | null;
  note: string;
}

const quoteOf = (r: FixRow, kind: OptionKind) => (kind === "call" ? r.call : r.put);
const isOption = (l: ServerLeg): l is ServerLeg & { kind: OptionKind } => l.kind === "call" || l.kind === "put";
const blank = (d: AdjustDraft): AdjustDraft => ({ ...d, lotsAfter: {}, picks: [] });

/**
 * A roll closes legs and opens their replacements: the replacements are plain picks, never netted against the legs
 * being closed (netting would collapse a spread whose wings sit on adjacent strikes into a naked short). Two
 * replacements on the same contract and side merge.
 */
function addPick(d: AdjustDraft, asset: Underlying, input: PickInput): AdjustDraft {
  const symbol = venueSymbol(input.kind, asset, input.strike, input.expiry);
  const same = d.picks.find((p) => p.symbol === symbol && p.side === input.side);
  if (same) return { ...d, picks: d.picks.map((p) => (p.id === same.id ? { ...p, lots: p.lots + input.lots } : p)) };
  return { ...d, picks: [...d.picks, { id: newPickId(), kind: input.kind, side: input.side, strike: input.strike, expiry: input.expiry, lots: input.lots, price: input.price, iv: input.iv, symbol }] };
}

/** Every open option leg on the chain's expiry moves one listed strike up (calls and puts alike): close it, open the same side at the next strike. */
function rollUp(base: AdjustDraft, ctx: FixContext): FixCandidate {
  const label = "Roll strikes up";
  const legs = ctx.open.filter((l): l is ServerLeg & { kind: OptionKind } => isOption(l) && l.expiry === ctx.expiry);
  if (!ctx.expiry || legs.length === 0) return { kind: "rollUp", label, draft: null, note: "no option legs on the shown expiry" };
  let d = blank(base);
  for (const leg of legs) {
    const i = ctx.rows.findIndex((r) => Number(r.strike) === Number(leg.strike));
    const next = i >= 0 ? ctx.rows.slice(i + 1).find((r) => quoteOf(r, leg.kind)) : undefined;
    const q = next ? quoteOf(next, leg.kind) : undefined;
    if (!next || !q) return { kind: "rollUp", label, draft: null, note: `no strike above ${fmtStrike(leg.strike)} listed with a ${leg.kind} quote` };
    d = setLotsAfter(d, leg.id, 0);
    d = addPick(d, ctx.asset, { kind: leg.kind, side: leg.side, strike: next.strike, expiry: ctx.expiry, lots: leg.lots, price: q.mark, iv: q.markIv });
  }
  return { kind: "rollUp", label, draft: d, note: `${legs.length} ${legs.length === 1 ? "leg" : "legs"} one strike up on ${fmtExpiry(ctx.expiry)}` };
}

/** Every open option leg on the chain's expiry moves to the same (or nearest listed) strike on the next expiry. */
function rollOut(base: AdjustDraft, ctx: FixContext): FixCandidate {
  const label = ctx.nextExpiry ? `Roll out to ${fmtExpiry(ctx.nextExpiry)}` : "Roll out";
  const legs = ctx.open.filter((l): l is ServerLeg & { kind: OptionKind } => isOption(l) && l.expiry === ctx.expiry);
  if (!ctx.expiry || legs.length === 0) return { kind: "rollOut", label, draft: null, note: "no option legs on the shown expiry" };
  if (!ctx.nextExpiry || !ctx.nextRows || ctx.nextRows.length === 0) return { kind: "rollOut", label, draft: null, note: "the next expiry's chain is not loaded yet" };
  let d = blank(base);
  for (const leg of legs) {
    const target = Number(leg.strike);
    const candidates = ctx.nextRows.filter((r) => quoteOf(r, leg.kind));
    // the nearest listed strike; on a tie the higher one, so a roll never drifts down
    const nearest = candidates.reduce<FixRow | undefined>((best, r) => {
      if (best === undefined) return r;
      const dr = Math.abs(Number(r.strike) - target);
      const db = Math.abs(Number(best.strike) - target);
      return dr < db || (dr === db && Number(r.strike) > Number(best.strike)) ? r : best;
    }, undefined);
    const q = nearest ? quoteOf(nearest, leg.kind) : undefined;
    if (!nearest || !q) return { kind: "rollOut", label, draft: null, note: `no ${leg.kind} quote near ${fmtStrike(leg.strike)} on ${fmtExpiry(ctx.nextExpiry)}` };
    d = setLotsAfter(d, leg.id, 0);
    d = addPick(d, ctx.asset, { kind: leg.kind, side: leg.side, strike: nearest.strike, expiry: ctx.nextExpiry, lots: leg.lots, price: q.mark, iv: q.markIv });
  }
  return { kind: "rollOut", label, draft: d, note: `${legs.length} ${legs.length === 1 ? "leg" : "legs"} to ${fmtExpiry(ctx.nextExpiry)}` };
}

/** Buy a call one listed strike above the highest short call (or above spot when nothing is short), sized like the short. */
function hedgeCall(base: AdjustDraft, ctx: FixContext): FixCandidate {
  const label = "Hedge with a call";
  if (!ctx.expiry) return { kind: "hedgeCall", label, draft: null, note: "no expiry shown" };
  const shorts = ctx.open.filter((l) => l.kind === "call" && l.side === "sell" && l.expiry === ctx.expiry);
  const anchor = shorts.length ? Math.max(...shorts.map((l) => Number(l.strike))) : ctx.spot;
  if (anchor === null) return { kind: "hedgeCall", label, draft: null, note: "waiting for the spot price" };
  const above = ctx.rows.find((r) => Number(r.strike) > anchor && r.call);
  if (!above?.call) return { kind: "hedgeCall", label, draft: null, note: `no call listed above ${fmtStrike(String(anchor))}` };
  const lots = shorts.length ? Math.max(...shorts.map((l) => l.lots)) : (ctx.open[0]?.lots ?? 1);
  const d = pickOnDraft(blank(base), ctx.open, ctx.asset, { kind: "call", side: "buy", strike: above.strike, expiry: ctx.expiry, lots, price: above.call.mark, iv: above.call.markIv });
  return { kind: "hedgeCall", label, draft: d, note: `buy ${lots} × ${fmtStrike(above.strike)} C ${fmtExpiry(ctx.expiry)}${shorts.length ? " above the short call" : " above spot"}` };
}

export function quickFixes(base: AdjustDraft, ctx: FixContext): FixCandidate[] {
  return [rollUp(base, ctx), rollOut(base, ctx), hedgeCall(base, ctx)];
}

export type FixRank = "smallest max loss" | "largest credit" | "closest to delta-neutral";

/** Which fix earns which tag, given each candidate's after figures (null when not priced). Ties go to the first. */
export function rankFixes(figures: readonly ({ maxLoss: number; cash: number; delta: number } | null)[]): (FixRank[])[] {
  const tags: FixRank[][] = figures.map(() => []);
  const best = (score: (f: { maxLoss: number; cash: number; delta: number }) => number, tag: FixRank) => {
    let bi = -1;
    let bs = -Infinity;
    figures.forEach((f, i) => {
      if (!f) return;
      const s = score(f);
      if (s > bs) {
        bs = s;
        bi = i;
      }
    });
    if (bi >= 0) tags[bi]!.push(tag);
  };
  best((f) => (Number.isFinite(f.maxLoss) ? f.maxLoss : -Number.MAX_VALUE), "smallest max loss");
  best((f) => f.cash, "largest credit");
  best((f) => -Math.abs(f.delta), "closest to delta-neutral");
  return tags;
}
