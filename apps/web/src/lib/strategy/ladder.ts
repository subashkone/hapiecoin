// Take profit in steps (ADR-120; HC-TR-237): the dialog's side of a profit ladder. The trader types, for each step,
// how far the open lots must be up (per cent of the premium they were opened for) and how many lots to close; the
// server stores a step as a share of whatever the leg holds when it fires, so the lots typed here are turned into
// that chain of shares and back. The last part has no step: it is held to a stop or to settlement.
import { LADDER_STEPS, type RuleChannel, type StrategyRule, stepLots, toDecimal } from "@hapiecoin/schema";

export interface LadderStep {
  /** The level as typed, in per cent. */
  pct: string;
  /** Lots to close on the reference leg, as typed. */
  lots: string;
}
export const LADDER_PRESETS = { early: [10, 25, 40, 55], standard: [25, 50, 75], late: [50, 75] } as const;
export type LadderPreset = keyof typeof LADDER_PRESETS | "custom";
export const LADDER_PRESET_LABELS: Record<LadderPreset, string> = { early: "Early", standard: "Standard", late: "Late", custom: "Custom" };
export interface LadderDraft {
  on: boolean;
  preset: LadderPreset;
  steps: LadderStep[];
}

/** `lots` in `parts` whole parts as equal as they come, the larger ones first: 100 in 3 is 34 / 33 / 33. */
export function splitLots(lots: number, parts: number): number[] {
  const base = Math.floor(lots / parts);
  const extra = lots - base * parts;
  return Array.from({ length: parts }, (_, i) => base + (i < extra ? 1 : 0));
}

/** The steps of a preset on a leg of `lots`: equal parts, the last one held. */
export function presetSteps(preset: Exclude<LadderPreset, "custom">, lots: number): LadderStep[] {
  const levels = LADDER_PRESETS[preset];
  const parts = splitLots(lots, levels.length + 1);
  return levels.map((pct, i) => ({ pct: String(pct), lots: String(parts[i]) }));
}

/** One more step after the last: halfway from its level to 100 %, and the lots shared out equally again. */
export function withStep(steps: readonly LadderStep[], lots: number): LadderStep[] {
  const last = steps.length ? Number(steps[steps.length - 1]!.pct) : 0;
  const level = Number.isFinite(last) && last > 0 && last < 95 ? Math.round(last + (100 - last) / 2) : last >= 95 ? 99 : 25;
  const parts = splitLots(lots, steps.length + 2);
  return [...steps, { pct: String(level), lots: "" }].map((s, i) => ({ pct: s.pct, lots: String(parts[i]) }));
}

const whole = (v: string) => /^\d{1,5}$/.test(v.trim());
const level = (v: string) => /^\d{1,3}(\.\d{1,2})?$/.test(v.trim());

/** Why the steps cannot be armed, in the trader's words; null when they can. `lots` is the reference leg's open lots. */
export function ladderProblem(steps: readonly LadderStep[], lots: number): string | null {
  if (lots < 2) return `${lots} ${lots === 1 ? "lot" : "lots"} cannot be closed in parts`;
  if (steps.length < LADDER_STEPS.min) return "Add at least one step before the part that is held";
  if (steps.length > LADDER_STEPS.max) return `At most ${LADDER_STEPS.max} steps before the part that is held`;
  if (lots < steps.length + 1) return `${lots} ${lots === 1 ? "lot" : "lots"} cannot be closed in ${steps.length + 1} parts`;
  let used = 0;
  let prev = 0;
  for (const [i, s] of steps.entries()) {
    const n = i + 1;
    if (!level(s.pct) || Number(s.pct) < 1 || Number(s.pct) > 1000) return `Step ${n}: enter a level of 1 % or more`;
    if (Number(s.pct) <= prev) return `Step ${n}: the level must be above step ${i} (${prev} %)`;
    if (!whole(s.lots) || Number(s.lots) < 1) return `Step ${n}: close at least 1 whole lot`;
    prev = Number(s.pct);
    used += Number(s.lots);
  }
  if (used >= lots) return `The steps close ${used} of ${lots} lots: leave at least 1 lot to hold`;
  return null;
}

/** The rule bodies of a valid ladder: each step's share of what the leg still holds when it fires. */
export function ladderBodies(steps: readonly LadderStep[], lots: number, channels: RuleChannel[]): { kind: "step"; trigger: "pct"; value: string; closeShare: string; channels: RuleChannel[] }[] {
  let left = lots;
  return steps.map((s) => {
    const closeShare = toDecimal(Number(s.lots) / left, 6);
    left -= Number(s.lots);
    return { kind: "step" as const, trigger: "pct" as const, value: String(Number(s.pct)), closeShare, channels };
  });
}

/** The draft the dialog opens with: the armed steps as lots of the reference leg, or the Standard preset switched off. */
export function ladderDraftOf(rules: readonly StrategyRule[] | undefined, lots: number): LadderDraft {
  const armed = (rules ?? []).filter((r) => r.kind === "step" && r.state === "armed").sort((a, b) => Number(a.value) - Number(b.value));
  if (armed.length === 0) return { on: false, preset: "standard", steps: lots >= LADDER_PRESETS.standard.length + 1 ? presetSteps("standard", lots) : [] };
  let left = lots;
  const steps = armed.map((r) => {
    const n = stepLots(left, r.closeShare ?? "0");
    left -= n;
    return { pct: r.value, lots: String(n) };
  });
  return { on: true, preset: "custom", steps };
}

/**
 * Where the ladder that is armed now stands, for the card: its steps taken of all its parts (the held one included),
 * and the next level. Only steps armed together count (they share the instant they were written), so a ladder removed
 * or replaced after a step fired does not go on being counted. Null while no step is armed: the part that is left
 * needs no line.
 */
export function ladderProgress(rules: readonly StrategyRule[] | undefined): { taken: number; parts: number; next: string } | null {
  const armed = (rules ?? []).filter((r) => r.kind === "step" && r.state === "armed").sort((a, b) => Number(a.value) - Number(b.value));
  const first = armed[0];
  if (!first) return null;
  const taken = (rules ?? []).filter((r) => r.kind === "step" && r.state === "fired" && r.createdAt === first.createdAt).length;
  return { taken, parts: taken + armed.length + 1, next: first.value };
}

/** The card's words for a ladder: "profit steps 1 of 4 taken, next at 50 %". */
export function ladderText(rules: readonly StrategyRule[] | undefined): string | null {
  const p = ladderProgress(rules);
  return p ? `profit steps ${p.taken} of ${p.parts} taken, next at ${p.next} %` : null;
}
