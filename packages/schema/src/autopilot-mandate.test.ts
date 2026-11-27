import { describe, expect, it } from "vitest";
import { MANDATE_MAX_OPEN, MANDATE_REFUSALS, MANDATE_STATEMENT_KEYS, MANDATE_STATEMENTS, Mandate, MandateSign } from "./autopilot-mandate.js";

const TICKED = { realOrders: true, ownAccount: true, canLose: true, estimate: true };
const SIGN = { strategyId: "sv_abc", accountId: "cred_abc", lots: 10, maxCapitalUsd: 500, dayLossLimitUsd: 50, weekLossLimitUsd: 150, maxOpen: 1, statements: TICKED, confirm: "LIVE" };

describe("HC-TR-296 the mandate for live Autopilot (ADR-147)", () => {
  it("HC-TR-296 a signing names the strategy, the account, the limits in whole dollars, every statement ticked and the typed word", () => {
    expect(MandateSign.parse(SIGN)).toEqual(SIGN);
    expect(MANDATE_STATEMENT_KEYS.every((k) => MANDATE_STATEMENTS[k].length > 0)).toBe(true);
    expect(Object.keys(MANDATE_STATEMENTS)).toEqual([...MANDATE_STATEMENT_KEYS]);
    // the limits can be equal: a day's limit that is the week's, and the whole capital
    expect(MandateSign.safeParse({ ...SIGN, dayLossLimitUsd: 500, weekLossLimitUsd: 500 }).success).toBe(true);
    expect(MandateSign.safeParse({ ...SIGN, maxOpen: MANDATE_MAX_OPEN }).success).toBe(true);
  });

  it("HC-TR-297 a signing is refused in its shape: a statement not ticked or missing, cents, nothing or too much, limits out of order, a field nobody asked for", () => {
    const bad = (over: Record<string, unknown>) => MandateSign.safeParse({ ...SIGN, ...over });
    for (const key of MANDATE_STATEMENT_KEYS) expect(bad({ statements: { ...TICKED, [key]: false } }).success).toBe(false);
    expect(bad({ statements: { realOrders: true } }).success).toBe(false);
    for (const over of [{ lots: 0 }, { lots: 1.5 }, { maxCapitalUsd: 10.5 }, { maxCapitalUsd: 0 }, { maxCapitalUsd: 10_000_001 }, { maxOpen: 0 }, { maxOpen: MANDATE_MAX_OPEN + 1 }, { confirm: "L".repeat(17) }, { extra: 1 }]) expect(bad(over).success, JSON.stringify(over)).toBe(false);
    const week = bad({ weekLossLimitUsd: 40 });
    expect(week.success ? null : week.error.issues[0]!.message).toBe("The loss limit for the week is at least the limit for the day");
    const over = bad({ weekLossLimitUsd: 501 });
    expect(over.success ? null : over.error.issues[0]!.message).toBe("The loss limit for the week is within the capital it may use");
    const day = bad({ dayLossLimitUsd: 600, weekLossLimitUsd: 700 });
    expect(day.success ? null : day.error.issues[0]!.message).toBe("The loss limit for the day is within the capital it may use");
  });

  it("HC-TR-296 a mandate read back carries its state, whether it stands, and null for an account that was removed", () => {
    const m = { id: "mnd_1", strategyId: "sv_abc", strategyName: "Winged evening", version: 2, accountId: null, accountLabel: null, lots: 10, maxCapitalUsd: 500, dayLossLimitUsd: 50, weekLossLimitUsd: 150, maxOpen: 1, state: "ended", standing: false, signedAt: "2026-11-26T10:00:00.000Z", pausedAt: null, pauseReason: null, endedAt: null, endReason: MANDATE_REFUSALS.accountGone };
    expect(Mandate.parse(m)).toEqual(m);
    expect(Mandate.safeParse({ ...m, state: "live" }).success).toBe(false);
  });
});
