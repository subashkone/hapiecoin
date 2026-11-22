import { describe, expect, it } from "vitest";
import type { StrategyRule } from "@hapiecoin/schema";
import { LADDER_PRESETS, LADDER_PRESET_LABELS, ladderBodies, ladderDraftOf, ladderProblem, ladderProgress, ladderText, presetSteps, splitLots, withStep } from "./ladder";

const step = (value: string, closeShare: string, state: StrategyRule["state"] = "armed"): StrategyRule => ({ id: `rule_${value}`, kind: "step", trigger: "pct", value, basis: null, basisUsd: null, thresholdUsd: value, legId: null, scope: "strategy", closeShare, channels: ["push"], state, firedAt: null, firedPnl: null, outcome: null, note: null, createdAt: "2026-11-22T10:00:00Z", updatedAt: "2026-11-22T10:00:00Z" });

describe("HC-TR-237 the profit ladder as the dialog types it (ADR-120)", () => {
  it("HC-TR-237 lots are shared out in whole parts, the larger ones first; a preset is its levels on equal parts with the last one held", () => {
    expect(splitLots(100, 4)).toEqual([25, 25, 25, 25]);
    expect(splitLots(100, 3)).toEqual([34, 33, 33]);
    expect(splitLots(5, 4)).toEqual([2, 1, 1, 1]);
    expect(presetSteps("standard", 100)).toEqual([{ pct: "25", lots: "25" }, { pct: "50", lots: "25" }, { pct: "75", lots: "25" }]);
    expect(presetSteps("late", 100)).toEqual([{ pct: "50", lots: "34" }, { pct: "75", lots: "33" }]);
    expect(presetSteps("early", 100).map((s) => `${s.pct}:${s.lots}`)).toEqual(["10:20", "25:20", "40:20", "55:20"]);
    expect(Object.keys(LADDER_PRESET_LABELS)).toEqual([...Object.keys(LADDER_PRESETS), "custom"]);
  });

  it("HC-TR-237 one more step goes halfway from the last level to 100 % and the lots are shared out again", () => {
    expect(withStep([], 100)).toEqual([{ pct: "25", lots: "50" }]);
    expect(withStep(presetSteps("late", 100), 100)).toEqual([{ pct: "50", lots: "25" }, { pct: "75", lots: "25" }, { pct: "88", lots: "25" }]);
    expect(withStep([{ pct: "97", lots: "50" }], 100).map((s) => s.pct)).toEqual(["97", "99"]);
    expect(withStep([{ pct: "abc", lots: "50" }], 100).map((s) => s.pct)).toEqual(["abc", "25"]);
  });

  it("HC-TR-237 the steps are refused in the trader's words: none or too many, a leg too small, a level missing or not rising, lots not whole, nothing left to hold", () => {
    const ok = presetSteps("standard", 100);
    expect(ladderProblem(ok, 100)).toBeNull();
    expect(ladderProblem([], 100)).toBe("Add at least one step before the part that is held");
    expect(ladderProblem([...presetSteps("early", 100), { pct: "90", lots: "1" }], 100)).toBe("At most 4 steps before the part that is held");
    expect(ladderProblem(ok, 3)).toBe("3 lots cannot be closed in 4 parts");
    expect(ladderProblem([{ pct: "25", lots: "1" }], 1)).toBe("1 lot cannot be closed in parts");
    expect(ladderProblem([], 0)).toBe("0 lots cannot be closed in parts"); // the leg's size is said before the empty steps
    expect(ladderProblem([{ pct: "50", lots: "123456" }], 1_000_000)).toBe("Step 1: close at least 1 whole lot");
    expect(ladderProblem([{ pct: "", lots: "25" }], 100)).toBe("Step 1: enter a level of 1 % or more");
    expect(ladderProblem([{ pct: "0.5", lots: "25" }], 100)).toBe("Step 1: enter a level of 1 % or more");
    expect(ladderProblem([{ pct: "50", lots: "25" }, { pct: "50", lots: "25" }], 100)).toBe("Step 2: the level must be above step 1 (50 %)");
    expect(ladderProblem([{ pct: "50", lots: "2.5" }], 100)).toBe("Step 1: close at least 1 whole lot");
    expect(ladderProblem([{ pct: "50", lots: "0" }], 100)).toBe("Step 1: close at least 1 whole lot");
    expect(ladderProblem([{ pct: "50", lots: "60" }, { pct: "75", lots: "40" }], 100)).toBe("The steps close 100 of 100 lots: leave at least 1 lot to hold");
  });

  it("HC-TR-237 the lots typed become each step's share of what is left when it fires, and an armed set comes back as the same lots", () => {
    const bodies = ladderBodies(presetSteps("standard", 100), 100, ["push"]);
    expect(bodies.map((b) => [b.kind, b.trigger, b.value, b.closeShare])).toEqual([["step", "pct", "25", "0.25"], ["step", "pct", "50", "0.333333"], ["step", "pct", "75", "0.5"]]);
    expect(ladderBodies([{ pct: "50.0", lots: "34" }, { pct: "75", lots: "33" }], 100, ["push", "email"])).toEqual([
      { kind: "step", trigger: "pct", value: "50", closeShare: "0.34", channels: ["push", "email"] },
      { kind: "step", trigger: "pct", value: "75", closeShare: "0.5", channels: ["push", "email"] },
    ]);
    // read back in the order of the levels, whatever order the rules arrive in; a fired step is not part of the draft
    const draft = ladderDraftOf([step("75", "0.5"), step("25", "0.25", "fired"), step("50", "0.333333")], 75);
    expect(draft).toEqual({ on: true, preset: "custom", steps: [{ pct: "50", lots: "25" }, { pct: "75", lots: "25" }] });
    expect(ladderDraftOf([{ ...step("50", "0.5"), closeShare: null }], 10).steps).toEqual([{ pct: "50", lots: "1" }]);
    // nothing armed: Standard, switched off; a leg too small for it starts empty
    expect(ladderDraftOf(undefined, 100)).toEqual({ on: false, preset: "standard", steps: presetSteps("standard", 100) });
    expect(ladderDraftOf([], 3)).toEqual({ on: false, preset: "standard", steps: [] });
  });

  it("HC-TR-238 the card counts the steps taken of all the parts, names the next level, and says when only the held part is left", () => {
    expect(ladderProgress(undefined)).toBeNull();
    expect(ladderText([])).toBeNull();
    const rules = [step("75", "0.5"), step("25", "0.25", "fired"), step("50", "0.333333")];
    expect(ladderProgress(rules)).toEqual({ taken: 1, parts: 4, next: "50" });
    expect(ladderText(rules)).toBe("profit steps 1 of 4 taken, next at 50 %");
    // once no step is armed there is no line: the last step fired, or the ladder was removed after one did
    expect(ladderText(rules.map((r) => ({ ...r, state: "fired" as const })))).toBeNull();
    expect(ladderProgress([step("25", "0.25", "disarmed")])).toBeNull();
    // a ladder armed afresh after a step of an older one fired counts its own steps only
    const older = { ...step("20", "0.2", "fired"), createdAt: "2026-11-21T09:00:00Z" };
    expect(ladderText([older, step("50", "0.5"), step("75", "0.5")])).toBe("profit steps 0 of 3 taken, next at 50 %");
  });
});
