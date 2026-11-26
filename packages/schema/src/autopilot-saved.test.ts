// Saved Autopilot strategies (ADR-141, ADR-142): the settings an admin may save, and how they read.
import { describe, expect, it } from "vitest";
import { SavedBacktest, SavedBacktestRun, SavedBacktestStart, SavedBacktestTyped, SavedCard, SavedDefinition, SavedLeg, SavedStrategyCreate, SavedStrategyPatch, savedEntryText, savedIstClock, savedIstWeekday, savedLossCapped, savedPlaybookOf, savedProfitCapped, savedWindowText } from "./autopilot-saved.js";
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
    // HC-TR-284: entered a day out or more, it is not "the next expiry"
    expect(savedEntryText(SavedDefinition.parse({ ...daily, minDte: 1, maxDte: 3 }))).toBe("every day, 9:30 to 10:30 PM IST, on the first expiry at least 1 day out");
    expect(savedEntryText(SavedDefinition.parse({ ...daily, minDte: 0.9, maxDte: 3 }))).toBe("every day, 9:30 to 10:30 PM IST, on the next expiry");
    expect(savedEntryText(SavedDefinition.parse({ ...daily, fromHourUtc: 0, toHourUtc: 24, oncePerExpiry: true, minDte: 14, maxDte: 400, conditions: { sma: { days: 50, side: "above" } } }))).toBe("every day, any time from 5:30 AM IST to 5:30 the next morning, on the first expiry at least 14 days out, when the price is above its 50-day average");
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

describe("HC-TR-281 a saved strategy may pay premium (ADR-143)", () => {
  const leg = (kind: "call" | "put", side: "buy" | "sell", value: number, over: object = {}) => ({ kind, side, by: "strikes", value, ...over });
  const callSpread = [leg("call", "buy", 0), leg("call", "sell", 2)];
  const butterfly = [leg("call", "buy", 2, { itm: true }), leg("call", "sell", 0, { ratio: 2 }), leg("call", "buy", 2)];
  const trend = { ...daily, fromHourUtc: 0, toHourUtc: 24, oncePerExpiry: true, minDte: 14, maxDte: 400 };
  const legsOf = (list: object[]) => SavedDefinition.shape.legs.parse(list);

  it("HC-TR-281 a leg may sit at the money or in the money by strikes, and be a multiple of the lots", () => {
    expect(SavedLeg.safeParse(leg("call", "buy", 0)).success).toBe(true);
    expect(SavedLeg.safeParse(leg("call", "buy", 2, { itm: true })).success).toBe(true);
    expect(SavedLeg.safeParse(leg("call", "sell", 0, { ratio: 2 })).success).toBe(true);
    // in the money is by strikes, at least one strike in; per cent and premium stay above zero; a multiple has a limit
    expect(SavedLeg.safeParse(leg("call", "buy", 0, { itm: true })).success).toBe(false);
    expect(SavedLeg.safeParse({ kind: "call", side: "buy", by: "pct", value: 2, itm: true }).success).toBe(false);
    expect(SavedLeg.safeParse({ kind: "call", side: "buy", by: "pct", value: 0 }).success).toBe(false);
    expect(SavedLeg.safeParse({ kind: "call", side: "buy", by: "premium", value: 0 }).success).toBe(false);
    expect(SavedLeg.safeParse(leg("call", "sell", 0, { ratio: 1 })).success).toBe(false);
    expect(SavedLeg.safeParse(leg("call", "sell", 0, { ratio: 6 })).success).toBe(false);
  });

  it("HC-TR-281 what limits a trade, lot for lot: its loss when every sold option is covered, its profit when no more is bought than sold", () => {
    expect([savedLossCapped(legsOf(butterfly)), savedProfitCapped(legsOf(butterfly))]).toEqual([true, true]);
    expect([savedLossCapped(legsOf(callSpread)), savedProfitCapped(legsOf(callSpread))]).toEqual([true, true]);
    // a sold strangle: the most it makes is its premium, its loss has no limit
    expect([savedLossCapped(legsOf([sellPut, sellCall])), savedProfitCapped(legsOf([sellPut, sellCall]))]).toEqual([false, true]);
    // three sold against two bought is not covered; two bought against one sold has no limit to what it can make
    expect(savedLossCapped(legsOf([leg("call", "buy", 2, { itm: true }), leg("call", "sell", 0, { ratio: 3 }), leg("call", "buy", 2)]))).toBe(false);
    expect([savedLossCapped(legsOf([leg("call", "buy", 2, { ratio: 2 }), leg("call", "sell", 0)])), savedProfitCapped(legsOf([leg("call", "buy", 2, { ratio: 2 }), leg("call", "sell", 0)]))]).toEqual([true, false]);
    expect(savedProfitCapped(legsOf([leg("put", "buy", 2, { ratio: 2 }), leg("put", "sell", 0)]))).toBe(false);
  });

  it("HC-TR-281 a target needs a most to make, a stop a most to lose; one profit level; an exit before expiry that leaves the trade a day; a sold option always", () => {
    const exits = (legs: object[], e: object, over: object = {}) => ok({ ...trend, legs, exits: e, ...over });
    expect(exits(callSpread, { targetOfMax: 0.5, stopOfMax: 0.5, timeStopDte: 7 })).toBe(true);
    expect(exits(butterfly, { targetOfMax: 0.75 })).toBe(true);
    expect(exits(callSpread, { targetOfMax: 0.1, takeTrailPct: 10 })).toBe(true);
    // a strategy that would never trade is refused where it is typed: a lone bought call, a straddle, a backspread
    expect(exits([leg("call", "buy", 0)], { targetOfMax: 0.5 })).toBe(false);
    expect(exits([leg("call", "buy", 0), leg("put", "buy", 0)], { targetOfMax: 0.5 })).toBe(false);
    expect(exits([leg("call", "buy", 2, { ratio: 2 }), leg("call", "sell", 0)], { targetOfMax: 0.5 })).toBe(false);
    expect(exits([leg("call", "buy", 0)], {})).toBe(false);
    // a sold strangle may take a share of the most it can make (its premium), and has no most to lose to stop on
    expect(exits([sellPut, sellCall], { targetOfMax: 0.5 })).toBe(true);
    expect(exits([sellPut, sellCall], { stopOfMax: 0.5 })).toBe(false);
    expect(exits([buyPut, sellPut, sellCall, buyCall], { stopOfMax: 0.5, takeProfitOfCredit: 0.5 })).toBe(true);
    // one profit level, not two; a level below the whole
    expect(exits(callSpread, { targetOfMax: 0.5, takeProfitOfCredit: 0.5 })).toBe(false);
    expect(exits(callSpread, { targetOfMax: 1 })).toBe(false);
    // entered at least 14 days out: an exit 13 days out leaves a day, 14 does not; none at the settlement itself
    expect(exits(callSpread, { targetOfMax: 0.5, timeStopDte: 13 })).toBe(true);
    expect(exits(callSpread, { targetOfMax: 0.5, timeStopDte: 14 })).toBe(false);
    expect(exits(callSpread, { targetOfMax: 0.5, timeStopDte: 0 })).toBe(false);
    expect(exits([sellPut, sellCall], { legStop: 2, timeStopDte: 7 })).toBe(true);
  });

  it("HC-TR-281 as a playbook: legs at and in the money and their multiple, the whole-trade exits beside the clock, a trail from the level", () => {
    const p = savedPlaybookOf({ id: "sv_b", name: "B", summary: "s", definition: SavedDefinition.parse({ ...trend, legs: butterfly, exits: { targetOfMax: 0.75, stopOfMax: 0.5, timeStopDte: 3, takeTrailPct: 10 } }), backtest: null });
    expect(p.template.legs).toEqual([{ kind: "call", side: "buy", k: -2 }, { kind: "call", side: "sell", k: 0, lots: 2 }, { kind: "call", side: "buy", k: 2 }]);
    expect(p.template.risk).toBe("defined");
    expect(p.exits).toEqual({ targetPct: 0.75, stopPct: 0.5, timeStopDte: 3 });
    expect(p.clock.takeTrailPct).toBe(10);
    expect(Object.keys(p.clock)).not.toEqual(expect.arrayContaining(["targetOfMax", "stopOfMax", "timeStopDte"]));
    // a put in the money sits above the spot; with one of the three alone the others are absent
    const puts = savedPlaybookOf({ id: "sv_p", name: "P", summary: "s", definition: SavedDefinition.parse({ ...trend, legs: [leg("put", "buy", 1, { itm: true }), leg("put", "sell", 2)], exits: { targetOfMax: 0.5 } }), backtest: null });
    expect(puts.template.legs).toEqual([{ kind: "put", side: "buy", k: 1 }, { kind: "put", side: "sell", k: -2 }]);
    expect(puts.exits).toEqual({ targetPct: 0.5, stopPct: undefined, timeStopDte: undefined });
    expect(savedPlaybookOf({ id: "sv_t", name: "T", summary: "s", definition: SavedDefinition.parse({ ...trend, legs: [sellPut, sellCall], exits: { timeStopDte: 7 } }), backtest: null }).exits).toEqual({ targetPct: undefined, stopPct: undefined, timeStopDte: 7 });
    expect(savedPlaybookOf({ id: "sv_s", name: "S", summary: "s", definition: SavedDefinition.parse({ ...trend, legs: callSpread, exits: { stopOfMax: 0.5, targetOfMax: 0.2 } }), backtest: null }).exits).toMatchObject({ stopPct: 0.5 });
    // a strategy with none of them is as it was: no exits beside the clock
    expect(savedPlaybookOf({ id: "sv_n", name: "N", summary: "s", definition: SavedDefinition.parse(daily), backtest: null }).exits).toBeUndefined();
  });
});

describe("HC-TR-288 figures computed in the app (ADR-144)", () => {
  const typed = { mean: 12.4, per: "day", positivePct: 71, worst: -180, samples: 106, basis: "HapieCoin backtest" } as const;
  const origin = { id: "bt_1", from: "2026-08-01", to: "2026-11-20", resolution: "5m", notes: ["Fills are at the price of the bar: no bid and ask, no slippage."] } as const;

  it("HC-TR-288 figures may carry the run they came from; a form's figures never do, so a change through the form cannot claim one", () => {
    expect(SavedBacktest.safeParse(typed).success).toBe(true);
    expect(SavedBacktest.safeParse({ ...typed, run: origin }).success).toBe(true);
    expect(SavedBacktest.safeParse({ ...typed, run: { ...origin, resolution: "1m" } }).success).toBe(false);
    expect(SavedBacktestTyped.safeParse(typed).success).toBe(true);
    expect(SavedBacktestTyped.safeParse({ ...typed, run: origin }).success).toBe(false);
    expect(SavedStrategyPatch.safeParse({ backtest: typed }).success).toBe(true);
    expect(SavedStrategyPatch.safeParse({ backtest: { ...typed, run: origin } }).success).toBe(false);
    expect(SavedBacktestStart.safeParse({}).success).toBe(true);
    expect(SavedBacktestStart.safeParse({ from: "2026-08-01", to: "2026-11-20" }).success).toBe(true);
    expect(SavedBacktestStart.safeParse({ from: "yesterday" }).success).toBe(false);
  });

  it("HC-TR-288 a card says where its figures come from: typed by hand, or backtested in the app with its prices and its period", () => {
    const claim = (backtest: object | null) => savedPlaybookOf({ id: "sv_a", name: "A", summary: "s", definition: SavedDefinition.parse(daily), backtest: backtest === null ? null : SavedBacktest.parse(backtest) }).evidence.claim;
    expect(claim(typed)).toBe("$12.4 a day on 106 trades, 71 % of them positive, worst -$180 (USD, figures entered by hand).");
    expect(claim({ ...typed, run: origin })).toBe("$12.4 a day on 106 trades, 71 % of them positive, worst -$180 (USD, backtested in the app on 5-minute prices, 2026-08-01 to 2026-11-20).");
    expect(claim({ ...typed, run: { ...origin, resolution: "1h" } })).toContain("backtested in the app on hourly prices, 2026-08-01 to 2026-11-20");
    expect(claim(null)).toBe("No backtest entered.");
  });

  it("HC-TR-288 a run as the screens get it: its state, its period, its figures or none, and what it could not do", () => {
    const run = { id: "bt_1", strategyId: "sv_a", status: "done", progress: { done: 5, total: 5 }, from: "2026-08-01", to: "2026-08-05", resolution: "5m", figures: typed, noEntry: { "Already traded this expiry": 2 }, barsJudged: 900, barsSkipped: 3, notes: origin.notes, trades: [{ asset: "BTC", entryAt: "2026-08-01T16:00:00.000Z", closedAt: "2026-08-02T12:00:00.000Z", expiry: "2026-08-02", spot: 83200, legs: [{ kind: "put", side: "sell", strike: 82400, lots: 100, price: 234.5 }], gross: 23.45, fees: 0.9086, net: 22.54, reason: "expired", events: [{ at: "2026-08-02T12:00:00.000Z", kind: "settled", pnl: 23.45 }], barsSkipped: 0 }], error: null, current: true, createdAt: "2026-11-26T10:00:00.000Z", finishedAt: "2026-11-26T10:00:05.000Z" };
    expect(SavedBacktestRun.safeParse(run).success).toBe(true);
    expect(SavedBacktestRun.safeParse({ ...run, status: "running", figures: null, finishedAt: null }).success).toBe(true);
    expect(SavedBacktestRun.safeParse({ ...run, status: "queued" }).success).toBe(false);
    // a run's own figures are the numbers alone: the mark of the run is put on when they go to the strategy
    expect(SavedBacktestRun.safeParse({ ...run, figures: { ...typed, run: origin } }).success).toBe(false);
  });
});
