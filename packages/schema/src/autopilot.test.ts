// Autopilot settings and log shapes (ADR-108; HC-TR-216, HC-TR-218).
import { describe, expect, it } from "vitest";
import { AUTOPILOT_EXIT_LABELS, AUTOPILOT_EXIT_STYLES, AutopilotRun, AutopilotSettings, AutopilotView, DEFAULT_AUTOPILOT_SETTINGS } from "./autopilot.js";

describe("HC-TR-216 Autopilot settings", () => {
  it("HC-TR-216 off and empty by default; a playbook is switched on once, with one of the two exit styles", () => {
    expect(AutopilotSettings.parse(DEFAULT_AUTOPILOT_SETTINGS)).toEqual({ enabled: false, strategies: [] });
    expect(AutopilotSettings.parse({ enabled: true, strategies: [{ playbookId: " trend-calls ", exit: "trail" }, { playbookId: "pin-butterfly", exit: "target" }] }).strategies[0]).toEqual({ playbookId: "trend-calls", exit: "trail" });
    const twice = AutopilotSettings.safeParse({ enabled: true, strategies: [{ playbookId: "a", exit: "trail" }, { playbookId: "a", exit: "target" }] });
    expect(twice.success).toBe(false);
    expect(twice.error?.issues[0]).toMatchObject({ message: "A playbook can be switched on once", path: ["strategies"] });
    expect(AutopilotSettings.safeParse({ enabled: true, strategies: [{ playbookId: "a", exit: "sometimes" }] }).success).toBe(false);
    expect(AutopilotSettings.safeParse({ enabled: true, strategies: [{ playbookId: "", exit: "trail" }] }).success).toBe(false);
    expect(AutopilotSettings.safeParse({ enabled: true, strategies: [], budget: 1 }).success).toBe(false);
    expect(Object.keys(AUTOPILOT_EXIT_LABELS)).toEqual([...AUTOPILOT_EXIT_STYLES]);
  });
});

describe("HC-TR-218 the Autopilot log", () => {
  it("HC-TR-218 a line names its playbook, venue, asset, what happened and why; the figures are optional", () => {
    const run = { id: "7", at: "2026-11-21T10:00:00+00:00", playbookId: "pin-butterfly", venue: "delta_india", asset: "BTC", kind: "skipped", reason: "Its entry conditions are not met", strategyId: null, detail: {} };
    expect(AutopilotRun.parse(run)).toEqual(run);
    const entered = { ...run, kind: "entered", strategyId: "strat_1", detail: { spot: "83200", expiry: "2026-11-27", dte: 6, entryCost: "18", maxProfit: "2", maxLoss: "-18", fees: "0.79", capital: "18", exit: "trail", targetUsd: "0.99", stopUsd: null, legs: [{ side: "buy", kind: "call", strike: "81000", price: "2600" }] } };
    expect(AutopilotView.parse({ settings: DEFAULT_AUTOPILOT_SETTINGS, runs: [entered] }).runs[0]!.detail.exit).toBe("trail");
    expect(AutopilotRun.safeParse({ ...run, kind: "exited" }).success).toBe(false);
    expect(AutopilotRun.safeParse({ ...run, detail: { surprise: 1 } }).success).toBe(false);
  });
});
