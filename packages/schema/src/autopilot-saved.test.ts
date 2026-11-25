// Saved Autopilot strategies (ADR-141, ADR-142): the settings an admin may save, and how they read.
import { describe, expect, it } from "vitest";
import { SavedBacktest, SavedDefinition, SavedLeg, SavedStrategyCreate, SavedStrategyPatch, savedEntryText, savedLossCapped, savedWindowText } from "./autopilot-saved.js";

const sellPut = { kind: "put", side: "sell", by: "pct", value: 2 } as const;
const sellCall = { kind: "call", side: "sell", by: "pct", value: 2 } as const;
const buyPut = { kind: "put", side: "buy", by: "pct", value: 4 } as const;
const buyCall = { kind: "call", side: "buy", by: "pct", value: 4 } as const;
const daily = { assets: ["BTC"], venues: ["delta_india"], lots: 100, cadence: "daily", fromHourUtc: 16, toHourUtc: 17, oncePerExpiry: false, minDte: 0.5, maxDte: 1.5, legs: [sellPut, sellCall], exits: {} } as const;
const ok = (d: unknown) => SavedDefinition.safeParse(d).success;

describe("HC-TR-269 the settings of a saved strategy", () => {
  it("HC-TR-269 accepts a daily strangle and refuses a window, an expiry range or a list that cannot be", () => {
    expect(ok(daily)).toBe(true);
    expect(ok({ ...daily, fromHourUtc: 17, toHourUtc: 17 })).toBe(false);
    expect(ok({ ...daily, toHourUtc: 25 })).toBe(false);
    expect(ok({ ...daily, minDte: 2, maxDte: 1.5 })).toBe(false);
    expect(ok({ ...daily, assets: ["BTC", "BTC"] })).toBe(false);
    expect(ok({ ...daily, venues: ["delta_india", "delta_india"] })).toBe(false);
    expect(ok({ ...daily, venues: ["deribit"] })).toBe(false);
    expect(ok({ ...daily, minDte: 0 })).toBe(false);
    expect(ok({ ...daily, minDte: 0.04 })).toBe(true);
    expect(ok({ ...daily, assets: [] })).toBe(false);
    expect(ok({ ...daily, lots: 0 })).toBe(false);
  });

  it("HC-TR-269 needs a sold option, whole strikes, and a per cent that is a distance", () => {
    expect(ok({ ...daily, legs: [buyPut, buyCall] })).toBe(false);
    expect(SavedLeg.safeParse({ kind: "call", side: "sell", by: "strikes", value: 3 }).success).toBe(true);
    expect(SavedLeg.safeParse({ kind: "call", side: "sell", by: "strikes", value: 2.5 }).success).toBe(false);
    expect(SavedLeg.safeParse({ kind: "call", side: "sell", by: "strikes", value: 51 }).success).toBe(false);
    expect(SavedLeg.safeParse({ kind: "call", side: "sell", by: "pct", value: 51 }).success).toBe(false);
    expect(SavedLeg.safeParse({ kind: "call", side: "sell", by: "premium", value: 250 }).success).toBe(true);
    expect(SavedLeg.safeParse({ kind: "call", side: "sell", by: "premium", value: 0 }).success).toBe(false);
  });

  it("HC-TR-269 ties the weekday to a weekly strategy and the weekdays to a daily one", () => {
    expect(ok({ ...daily, cadence: "weekly", weekdayUtc: 5 })).toBe(true);
    expect(ok({ ...daily, cadence: "weekly" })).toBe(false);
    expect(ok({ ...daily, weekdayUtc: 5 })).toBe(false);
    expect(ok({ ...daily, weekdays: [1, 3] })).toBe(true);
    expect(ok({ ...daily, weekdays: [1, 1] })).toBe(false);
    expect(ok({ ...daily, cadence: "monthly", weekdays: [1] })).toBe(false);
    expect(ok({ ...daily, cadence: "monthly", oncePerExpiry: true, minDte: 20, maxDte: 35 })).toBe(true);
  });

  it("HC-TR-269 refuses exits that contradict each other", () => {
    const exits = (e: object) => ok({ ...daily, exits: e });
    expect(exits({ legStop: 2, takeProfitOfCredit: 0.5, trailRestPct: 50, exitHourUtc: 10, legBuyBackAt: 5 })).toBe(true);
    expect(exits({ trailRestPct: 50 })).toBe(false);
    expect(exits({ takeProfitOfCredit: 1 })).toBe(false);
    expect(exits({ legBuyBackAt: 5, legBuyBackShare: 0.2 })).toBe(false);
    expect(exits({ legBuyBackShare: 0.2 })).toBe(true);
    expect(exits({ legStop: 1 })).toBe(false);
    expect(exits({ takeTrailPct: 20 })).toBe(false);
    expect(exits({ takeTrailPct: 20, takeProfitOfCredit: 0.5 })).toBe(true);
    expect(exits({ lock: { at: 0.3, floor: 0.3 } })).toBe(false);
    expect(exits({ lock: { at: 0.5, floor: 0.2 } })).toBe(true);
    expect(exits({ ladder: [25, 50, 75] })).toBe(true);
    expect(exits({ ladder: [50, 25] })).toBe(false);
    expect(exits({ ladder: [] })).toBe(false);
  });

  it("HC-TR-276 takes market conditions with or without a window, and a volatility rank with a bound", () => {
    expect(ok({ ...daily, fromHourUtc: 0, toHourUtc: 24, oncePerExpiry: true, conditions: { sma: { days: 50, side: "above" } } })).toBe(true);
    // a long window would enter again after each close: it enters once per expiry
    expect(ok({ ...daily, fromHourUtc: 0, toHourUtc: 24 })).toBe(false);
    expect(ok({ ...daily, fromHourUtc: 10, toHourUtc: 17 })).toBe(false);
    expect(ok({ ...daily, fromHourUtc: 11, toHourUtc: 17 })).toBe(true);
    expect(ok({ ...daily, conditions: { ivRank: { min: 60, lookbackDays: 90 } } })).toBe(true);
    expect(ok({ ...daily, conditions: { ivRank: { max: 40, lookbackDays: 90 } } })).toBe(true);
    expect(ok({ ...daily, conditions: { ivRank: { lookbackDays: 90 } } })).toBe(false);
    expect(ok({ ...daily, conditions: { ivRank: { min: 70, max: 30, lookbackDays: 90 } } })).toBe(false);
    expect(ok({ ...daily, conditions: { ivRank: { min: 30, max: 70, lookbackDays: 90 } } })).toBe(true);
    expect(ok({ ...daily, conditions: { sma: { days: 1, side: "above" } } })).toBe(false);
    expect(ok({ ...daily, moveSide: { hours: 24, pct: 2 } })).toBe(true);
    // a premium and a buy-back price are money of one coin
    expect(ok({ ...daily, assets: ["BTC", "ETH"] })).toBe(true);
    expect(ok({ ...daily, assets: ["BTC", "ETH"], exits: { legBuyBackAt: 5 } })).toBe(false);
    expect(ok({ ...daily, assets: ["BTC", "ETH"], exits: { legBuyBackShare: 0.2 } })).toBe(true);
    expect(ok({ ...daily, assets: ["BTC", "ETH"], legs: [{ kind: "call", side: "sell", by: "premium", value: 250 }] })).toBe(false);
    expect(ok({ ...daily, legs: [{ kind: "call", side: "sell", by: "premium", value: 250 }], exits: { legBuyBackAt: 5 } })).toBe(true);
  });

  it("HC-TR-269 knows a loss that is limited: every sold option covered by a bought one of its kind", () => {
    expect(savedLossCapped([sellPut, sellCall])).toBe(false);
    expect(savedLossCapped([buyPut, sellPut, sellCall, buyCall])).toBe(true);
    expect(savedLossCapped([buyPut, sellPut, sellCall])).toBe(false);
    expect(savedLossCapped([sellPut, sellCall, buyCall])).toBe(false);
  });

  it("HC-TR-269 writes the entry as a trader in India reads it", () => {
    const d = SavedDefinition.parse(daily);
    expect(savedWindowText(d)).toBe("21:30 to 22:30 IST");
    expect(savedWindowText({ fromHourUtc: 0, toHourUtc: 24 })).toBe("any time of day");
    expect(savedWindowText({ fromHourUtc: 20, toHourUtc: 22 })).toBe("01:30 to 03:30 IST");
    expect(savedEntryText(d)).toBe("every day, 21:30 to 22:30 IST, on the next expiry");
    expect(savedEntryText(SavedDefinition.parse({ ...daily, weekdays: [5, 1] }))).toBe("on Monday, Friday, 21:30 to 22:30 IST, on the next expiry");
    expect(savedEntryText(SavedDefinition.parse({ ...daily, cadence: "weekly", weekdayUtc: 5 }))).toBe("each Friday, 21:30 to 22:30 IST, on the weekly expiry");
    expect(savedEntryText(SavedDefinition.parse({ ...daily, cadence: "monthly", oncePerExpiry: true, minDte: 20, maxDte: 35 }))).toBe("once per month-end expiry, 21:30 to 22:30 IST, on the month-end expiry");
    expect(savedEntryText(SavedDefinition.parse({ ...daily, fromHourUtc: 0, toHourUtc: 24, oncePerExpiry: true, conditions: { sma: { days: 50, side: "above" }, ivRank: { min: 60, lookbackDays: 90 } } }))).toBe("every day, any time of day, on the next expiry, when the price above its 50-day average and volatility in its set range");
    expect(savedEntryText(SavedDefinition.parse({ ...daily, conditions: { ivRank: { max: 40, lookbackDays: 90 } } }))).toBe("every day, 21:30 to 22:30 IST, on the next expiry, when volatility in its set range");
  });
});

describe("HC-TR-270 / HC-TR-271 what an admin sends", () => {
  it("HC-TR-270 creates with a name, a summary and settings; a patch changes something", () => {
    expect(SavedStrategyCreate.safeParse({ name: " Evening strangle ", summary: "Sell both sides each evening.", definition: daily }).success).toBe(true);
    expect(SavedStrategyCreate.safeParse({ name: "", summary: "x", definition: daily }).success).toBe(false);
    expect(SavedStrategyCreate.safeParse({ name: "x".repeat(61), summary: "x", definition: daily }).success).toBe(false);
    expect(SavedStrategyPatch.safeParse({}).success).toBe(false);
    expect(SavedStrategyPatch.safeParse({ backtest: null }).success).toBe(true);
    expect(SavedStrategyPatch.safeParse({ audience: "plans", planIds: ["plan_1"] }).success).toBe(true);
    expect(SavedStrategyPatch.safeParse({ audience: "everyone" }).success).toBe(false);
  });

  it("HC-TR-271 takes backtest figures only with where they come from", () => {
    expect(SavedBacktest.safeParse({ mean: 12.4, per: "day", positivePct: 71, worst: -180, samples: 106, basis: "autopilot-study, 8 Aug to 21 Nov 2026, real fees" }).success).toBe(true);
    expect(SavedBacktest.safeParse({ mean: 12.4, per: "day", positivePct: 71, worst: -180, samples: 106, basis: " " }).success).toBe(false);
    expect(SavedBacktest.safeParse({ mean: 12.4, per: "day", positivePct: 101, worst: -180, samples: 106, basis: "x" }).success).toBe(false);
    expect(SavedBacktest.safeParse({ mean: 12.4, per: "day", positivePct: 71, worst: -180, samples: 0, basis: "x" }).success).toBe(false);
  });
});
