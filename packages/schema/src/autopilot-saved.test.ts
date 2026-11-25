// Saved Autopilot strategies (ADR-141, ADR-142): the settings an admin may save, and how they read.
import { describe, expect, it } from "vitest";
import { SavedBacktest, SavedCard, SavedDefinition, SavedLeg, SavedStrategyCreate, SavedStrategyPatch, savedEntryText, savedIstClock, savedIstWeekday, savedLossCapped, savedPlaybookOf, savedWindowText } from "./autopilot-saved.js";
import { AutopilotView } from "./autopilot.js";

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
    expect(savedWindowText(d)).toBe("9:30 to 10:30 PM IST");
    expect(savedWindowText({ fromHourUtc: 0, toHourUtc: 24 })).toBe("any time from 5:30 AM IST to 5:30 the next morning");
    expect(savedWindowText({ fromHourUtc: 20, toHourUtc: 22 })).toBe("1:30 to 3:30 AM IST");
    // the half of the day is said once when both ends share it, as the built-in strategies write it
    expect(savedWindowText({ fromHourUtc: 18, toHourUtc: 19 })).toBe("11:30 PM to 12:30 AM IST");
    expect(savedWindowText({ fromHourUtc: 6, toHourUtc: 8 })).toBe("11:30 AM to 1:30 PM IST");
    expect([savedIstClock(16), savedIstClock(24), savedIstClock(7)]).toEqual([{ time: "9:30", half: "PM" }, { time: "5:30", half: "AM" }, { time: "12:30", half: "PM" }]);
    expect(savedEntryText(d)).toBe("every day, 9:30 to 10:30 PM IST, on the next expiry");
    expect(savedEntryText(SavedDefinition.parse({ ...daily, weekdays: [5, 1] }))).toBe("on Monday, Friday, 9:30 to 10:30 PM IST, on the next expiry");
    expect(savedEntryText(SavedDefinition.parse({ ...daily, cadence: "weekly", weekdayUtc: 5 }))).toBe("each Friday, 9:30 to 10:30 PM IST, on the weekly expiry");
    expect(savedEntryText(SavedDefinition.parse({ ...daily, cadence: "monthly", oncePerExpiry: true, minDte: 20, maxDte: 35 }))).toBe("once per month-end expiry, 9:30 to 10:30 PM IST, on the month-end expiry");
    expect(savedEntryText(SavedDefinition.parse({ ...daily, fromHourUtc: 0, toHourUtc: 24, oncePerExpiry: true, conditions: { sma: { days: 50, side: "above" }, ivRank: { min: 60, lookbackDays: 90 } } }))).toBe("every day, any time from 5:30 AM IST to 5:30 the next morning, on the next expiry, when the price is above its 50-day average and volatility is in its set range");
    expect(savedEntryText(SavedDefinition.parse({ ...daily, conditions: { ivRank: { max: 40, lookbackDays: 90 } } }))).toBe("every day, 9:30 to 10:30 PM IST, on the next expiry, when volatility is in its set range");
    // the days are India's, like the times: a window from 19:00 UTC opens on the next India day
    expect([savedIstWeekday(5, 16), savedIstWeekday(5, 18), savedIstWeekday(4, 19), savedIstWeekday(6, 23), savedIstWeekday(5, 0)]).toEqual([5, 5, 5, 0, 5]);
    expect(savedEntryText(SavedDefinition.parse({ ...daily, cadence: "weekly", weekdayUtc: 4, fromHourUtc: 19, toHourUtc: 20 }))).toBe("each Friday, 12:30 to 1:30 AM IST, on the weekly expiry");
    expect(savedEntryText(SavedDefinition.parse({ ...daily, weekdays: [0, 6], fromHourUtc: 20, toHourUtc: 22 }))).toBe("on Sunday, Monday, 1:30 to 3:30 AM IST, on the next expiry");
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

describe("HC-TR-276 HC-TR-279 a saved strategy as a playbook, and as a trader's card", () => {
  const figures = { mean: 12.4, per: "day", positivePct: 71, worst: -180, samples: 106, basis: "autopilot-study, real fees" } as const;
  it("HC-TR-276 by the clock: its legs out of the money, its exits on the clock, no conditions, and what its evidence says without figures", () => {
    const p = savedPlaybookOf({ id: "sv_x", name: "X", summary: "Sums it up.", definition: SavedDefinition.parse({ ...daily, exits: { legStop: 2, takeProfitOfCredit: 0.5 } }), backtest: null });
    expect(p).toMatchObject({ id: "sv_x", name: "X", summary: "Sums it up.", rationale: "Sums it up.", minDte: 0.5, lots: 100, assets: ["BTC"], control: false, conditions: undefined, evidence: { claim: "No backtest entered.", source: "none" } });
    expect(p.template).toEqual({ name: "X", category: "Neutral", description: "Sums it up.", risk: "undefined", legs: [{ kind: "put", side: "sell", k: 0, pct: -2 }, { kind: "call", side: "sell", k: 0, pct: 2 }] });
    expect(p.clock).toMatchObject({ fromHourUtc: 16, toHourUtc: 17, weekdayUtc: undefined, cadence: undefined, oncePerExpiry: undefined, window: "9:30 to 10:30 PM IST", describe: "every day, 9:30 to 10:30 PM IST, on the next expiry", maxDte: 1.5, venues: ["delta_india"], legStop: 2, takeProfitOfCredit: 0.5 });
    expect(p.thresholds.minTrades).toBe(Number.MAX_SAFE_INTEGER);
  });

  it("HC-TR-276 on market conditions, monthly, with wings by strikes and a call by premium, its figures as its evidence", () => {
    const definition = SavedDefinition.parse({
      ...daily, cadence: "monthly", oncePerExpiry: true, fromHourUtc: 0, toHourUtc: 24, minDte: 20, maxDte: 35, conditions: { sma: { days: 50, side: "above" }, ivRank: { min: 60, lookbackDays: 90 } }, moveSide: { hours: 24, pct: 2 },
      legs: [{ kind: "put", side: "buy", by: "strikes", value: 8 }, { kind: "put", side: "sell", by: "strikes", value: 3 }, { kind: "call", side: "sell", by: "premium", value: 250 }, { kind: "call", side: "buy", by: "strikes", value: 8 }],
      exits: { ladder: [25, 50], lock: { at: 0.5, floor: 0.2 }, exitHourUtc: 10, legStop: 2, trailRestPct: 50, legBuyBackShare: 0.2 },
    });
    const p = savedPlaybookOf({ id: "sv_y", name: "Y", summary: "s", definition, backtest: figures });
    expect(p.conditions).toEqual({ sma: { days: 50, side: "above" }, ivRank: { min: 60, lookbackDays: 90 }, weekdays: undefined });
    expect(p.template).toMatchObject({ risk: "defined", legs: [{ kind: "put", side: "buy", k: -8 }, { kind: "put", side: "sell", k: -3 }, { kind: "call", side: "sell", k: 0, premium: 250 }, { kind: "call", side: "buy", k: 8 }] });
    expect(p.clock).toMatchObject({ cadence: "monthly", oncePerExpiry: true, moveSide: { hours: 24, pct: 2 }, ladder: [25, 50], lock: { at: 0.5, floor: 0.2 }, exitHourUtc: 10, trailRestPct: 50, legBuyBackShare: 0.2 });
    expect(p.evidence).toEqual({ claim: "$12.4 a day on 106 trades, 71 % of them positive, worst -$180 (USD, figures entered by hand).", source: "autopilot-study, real fees" });
    // chosen weekdays alone are a condition; a volatility rank alone is one too; a weekly strategy has its day on the clock
    expect(savedPlaybookOf({ id: "a", name: "A", summary: "s", definition: SavedDefinition.parse({ ...daily, weekdays: [1, 3] }), backtest: null }).conditions).toEqual({ sma: undefined, ivRank: undefined, weekdays: [1, 3] });
    expect(savedPlaybookOf({ id: "a", name: "A", summary: "s", definition: SavedDefinition.parse({ ...daily, conditions: { ivRank: { max: 40, lookbackDays: 90 } } }), backtest: null }).conditions).toMatchObject({ ivRank: { max: 40, lookbackDays: 90 } });
    expect(savedPlaybookOf({ id: "a", name: "A", summary: "s", definition: SavedDefinition.parse({ ...daily, cadence: "weekly", weekdayUtc: 5 }), backtest: null }).clock).toMatchObject({ weekdayUtc: 5, cadence: undefined, window: "Fridays, 9:30 to 10:30 PM IST" });
    // the day in the window is India's too
    expect(savedPlaybookOf({ id: "a", name: "A", summary: "s", definition: SavedDefinition.parse({ ...daily, cadence: "weekly", weekdayUtc: 4, fromHourUtc: 19, toHourUtc: 20 }), backtest: null }).clock.window).toBe("Fridays, 12:30 to 1:30 AM IST");
  });

  it("HC-TR-279 the Autopilot view carries the trader's saved strategies, or none at all", () => {
    const card = { id: "sv_x", version: 2, name: "X", summary: "s", definition: daily, backtest: figures, usable: true };
    expect(SavedCard.safeParse(card).success).toBe(true);
    expect(SavedCard.safeParse({ ...card, usable: undefined }).success).toBe(false);
    expect(AutopilotView.safeParse({ settings: { enabled: false, strategies: [] }, runs: [] }).success).toBe(true);
    expect(AutopilotView.parse({ settings: { enabled: false, strategies: [] }, runs: [], saved: [card] }).saved).toHaveLength(1);
  });
});
