/**
 * Playbook proposals (ADR-102; HC-TR-207, HC-TR-208): what a playbook's plan would place on the latest recorded day,
 * detected by the API after the end-of-day chain write and stored once per playbook, venue, asset and day, with the
 * record status the playbook had at the time. A proposal is decision support: the trader opens it in the Builder in
 * paper mode or dismisses it; nothing is ever placed by the system. The per-user mark (taken, dismissed, the Telegram
 * delivery) is joined in for the caller.
 */
import { z } from "zod";
import { PlaybookStatus } from "./playbooks.js";
import { DecimalString, IsoDate, IsoDateTime, Underlying, Venue } from "./primitives.js";
import { LegExpiry, StrategyLegKind, StrategyLegSide, toDecimal } from "./strategies.js";

/** `new` until the caller marks it; `taken` once opened in the Builder; `dismissed` hides it. */
export const ProposalStatus = z.enum(["new", "taken", "dismissed"]);
export type ProposalStatus = z.infer<typeof ProposalStatus>;
export const ProposalMarkStatus = z.enum(["taken", "dismissed"]);
export type ProposalMarkStatus = z.infer<typeof ProposalMarkStatus>;

/** One leg as the plan would place it: the venue's listed strike and expiry, the mark it was priced at, the plan's size. */
export const ProposalLeg = z.strictObject({
  kind: StrategyLegKind,
  side: StrategyLegSide,
  /** Empty for a future leg. */
  strike: z.string(),
  expiry: LegExpiry,
  lots: z.number().int().min(1),
  price: DecimalString,
  iv: z.number().nullable(),
});
export type ProposalLeg = z.infer<typeof ProposalLeg>;

export const Proposal = z.strictObject({
  id: z.string().min(1),
  playbookId: z.string().min(1),
  venue: Venue,
  asset: Underlying,
  /** The recorded day the plan enters on. */
  day: IsoDate,
  /** The expiry the plan picked (the first listed at or past the plan's minimum days to expiry). */
  expiry: LegExpiry,
  spot: DecimalString,
  legs: z.array(ProposalLeg).min(1),
  /** Net premium for the plan's size: positive paid, negative received. */
  entryCost: DecimalString,
  /** Expiry extremes for the plan's size; null when unbounded. */
  maxProfit: DecimalString.nullable(),
  maxLoss: DecimalString.nullable(),
  /** The playbook's record status when the proposal was detected. */
  recordStatus: PlaybookStatus,
  createdAt: IsoDateTime,
  /** The caller's mark. */
  status: ProposalStatus,
  /** When the caller's Telegram message for it went out, if it did. */
  telegramSentAt: IsoDateTime.nullable(),
});
export type Proposal = z.infer<typeof Proposal>;

export const Proposals = z.strictObject({
  venue: Venue,
  /** The day the list is for (YYYY-MM-DD, UTC). */
  day: IsoDate,
  items: z.array(Proposal),
});
export type Proposals = z.infer<typeof Proposals>;

export const ProposalMarkBody = z.strictObject({ status: ProposalMarkStatus });
export type ProposalMarkBody = z.infer<typeof ProposalMarkBody>;

/** The engine's figures for a proposal, before money is rounded to cents at the edge; Infinity marks an unbounded extreme. */
export interface ProposalFigures {
  spot: number;
  entryCost: number;
  maxProfit: number;
  maxLoss: number;
}

/** Money to cents, an unbounded extreme to null: the one projection the API and the mock share. */
export function projectProposalFigures(f: ProposalFigures): Pick<Proposal, "spot" | "entryCost" | "maxProfit" | "maxLoss"> {
  return {
    spot: toDecimal(f.spot, 2),
    entryCost: toDecimal(f.entryCost, 2),
    maxProfit: Number.isFinite(f.maxProfit) ? toDecimal(f.maxProfit, 2) : null,
    maxLoss: Number.isFinite(f.maxLoss) ? toDecimal(f.maxLoss, 2) : null,
  };
}
