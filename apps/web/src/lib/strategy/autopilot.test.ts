// What the Autopilot screen reads off a trade Autopilot opened (ADR-109; HC-TR-220).
import type { AutopilotRun, Strategy, StrategyRule } from "@hapiecoin/schema";
import { describe, expect, it } from "vitest";
import { HEALTH_LABELS, autopilotLevels, capitalInUse, latestRun, tradeHealth } from "./autopilot";

const AT = "2026-11-21T09:36:00Z";
const rule = (over: Partial<StrategyRule>): StrategyRule => ({ id: "rule_1", kind: "target", trigger: "money", value: "1", basis: null, basisUsd: null, thresholdUsd: "1", legId: null, scope: "strategy", trail: null, peakPnl: null, channels: ["push"], state: "armed", firedAt: null, firedPnl: null, outcome: null, note: null, createdAt: AT, updatedAt: AT, ...over });
const strategy = (rules: StrategyRule[] | undefined): Strategy => ({ id: "strat_1", name: "Pin butterfly · Autopilot", asset: "BTC", venue: "delta_india", status: "paper", tradingMode: "paper", templateName: "Long Call Butterfly", brokerId: "brk_delta", legs: [], realizedPnl: "0", pnlHistory: [], notes: "", tags: ["autopilot"], orderBatchId: null, orders: [], adjustments: [], rules, startedAt: AT, closedAt: null, createdAt: AT, updatedAt: AT, autopilotPlaybookId: "pin-butterfly" });
const run = (over: Partial<AutopilotRun>): AutopilotRun => ({ id: "1", at: AT, playbookId: "pin-butterfly", venue: "delta_india", asset: "BTC", kind: "entered", reason: "entered", strategyId: "strat_1", detail: { capital: "18" }, ...over });

describe("HC-TR-220 the exit levels of an Autopilot trade", () => {
  it("HC-TR-220 reads the target, the trail and the stop from the armed rules", () => {
    expect(autopilotLevels(strategy(undefined))).toEqual({ targetUsd: null, trails: false, bestUsd: null, trailExitUsd: null, stopUsd: null, legStop: null, legStopTrailPct: null });
    // a plain target and a stop; a fired rule is history, not a level
    expect(autopilotLevels(strategy([rule({ thresholdUsd: "0.91" }), rule({ id: "r2", kind: "stop", thresholdUsd: "-9" }), rule({ id: "r3", kind: "stop", thresholdUsd: "-99", state: "fired" })]))).toEqual({ targetUsd: 0.91, trails: false, bestUsd: null, trailExitUsd: null, stopUsd: 9, legStop: null, legStopTrailPct: null });
    // ADR-112: an evening strangle has no profit level and no strategy stop, only a stop on each sold option
    expect(autopilotLevels(strategy([rule({ id: "l1", kind: "leg_stop", trigger: "multiple", value: "3", thresholdUsd: "804", legId: "leg_1", scope: "leg" })]))).toEqual({ targetUsd: null, trails: false, bestUsd: null, trailExitUsd: null, stopUsd: null, legStop: 3, legStopTrailPct: null });
    // HC-TR-228: a stop set to trail the rest says so; once it has fired, the running trail gives the profit the rest exits at
    const trailing = rule({ id: "l2", kind: "leg_stop", trigger: "multiple", value: "2", thresholdUsd: "536", legId: "leg_2", scope: "leg", trail: { trigger: "pct", value: "50" } });
    expect(autopilotLevels(strategy([trailing]))).toMatchObject({ legStop: 2, legStopTrailPct: 50 });
    expect(autopilotLevels(strategy([trailing])).restTrailExitUsd).toBeUndefined();
    expect(autopilotLevels(strategy([trailing, rule({ id: "t1", kind: "trail", trigger: "pct", value: "50", thresholdUsd: "-26.8" })])).restTrailExitUsd).toBeNull(); // not in profit yet
    expect(autopilotLevels(strategy([trailing, rule({ id: "t1", kind: "trail", trigger: "pct", value: "50", thresholdUsd: "-26.8", peakPnl: "20" })])).restTrailExitUsd).toBe(10);
    // a trailing target before and after it is reached: the exit is the best less a tenth
    expect(autopilotLevels(strategy([rule({ thresholdUsd: "2", trail: { trigger: "pct", value: "10" } })]))).toMatchObject({ targetUsd: 2, trails: true, bestUsd: null, trailExitUsd: null });
    expect(autopilotLevels(strategy([rule({ thresholdUsd: "2", trail: { trigger: "pct", value: "10" }, peakPnl: "5" })]))).toMatchObject({ trails: true, bestUsd: 5, trailExitUsd: 4.5 });
    // a give-back the trader changed to money on the Desk: the best less that amount, as the engine reads it
    expect(autopilotLevels(strategy([rule({ trail: { trigger: "money", value: "1" }, peakPnl: "5" })])).trailExitUsd).toBe(4);
  });
});

describe("HC-TR-220 the health of an Autopilot trade", () => {
  it("HC-TR-220 in profit is on track; in loss it is losing; three quarters of the allowed loss used is close to its stop", () => {
    expect(tradeHealth(3, 10)).toEqual({ health: "good", usedPct: 0 });
    expect(tradeHealth(0, 10).health).toBe("good");
    expect(tradeHealth(-4, 10)).toEqual({ health: "watch", usedPct: 40 });
    expect(tradeHealth(-7.5, 10)).toEqual({ health: "danger", usedPct: 75 });
    expect(tradeHealth(-25, 10)).toEqual({ health: "danger", usedPct: 100 });
    // no stop: the loss is bounded by the premium paid, there is no share to show
    expect(tradeHealth(-4, null)).toEqual({ health: "watch", usedPct: null });
    expect(tradeHealth(2, null)).toEqual({ health: "good", usedPct: null });
    expect(tradeHealth(-1, 0).usedPct).toBeNull();
    expect(Object.keys(HEALTH_LABELS)).toEqual(["good", "watch", "danger"]);
  });
});

describe("HC-TR-219 the log, read for the screen", () => {
  it("HC-TR-219 the newest line of a playbook on an asset, and the capital the open trades tie up", () => {
    const runs = [run({ id: "3", kind: "skipped", asset: "ETH", strategyId: null, detail: {} }), run({ id: "2", strategyId: "strat_2", detail: { capital: "5.5" } }), run({ id: "1" }), run({ id: "0", kind: "noted", detail: { capital: "100" } }), run({ id: "9", strategyId: "strat_3", detail: {} })];
    expect(latestRun(runs, "pin-butterfly", "BTC")!.id).toBe("2");
    expect(latestRun(runs, "pin-butterfly", "ETH")!.id).toBe("3");
    expect(latestRun(runs, "trend-calls", "BTC")).toBeUndefined();
    // only entries of trades still open count; a note or an entry with no figure adds nothing
    expect(capitalInUse(runs, new Set(["strat_1", "strat_2", "strat_3"]))).toBe(23.5);
    expect(capitalInUse(runs, new Set(["strat_1"]))).toBe(18);
    expect(capitalInUse(runs, new Set())).toBe(0);
  });
});
