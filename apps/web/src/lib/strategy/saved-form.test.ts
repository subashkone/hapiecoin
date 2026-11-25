// The editor of a saved Autopilot strategy as data (HC-TR-278): India time and weekdays to the engine's UTC hours and
// days and back, every field to its setting, and the first thing wrong said in the admin's words.
import type { SavedStrategy } from "@hapiecoin/schema";
import { describe, expect, it } from "vitest";
import { FROM_HOURS, LEG_PRESETS, type SavedForm, emptySavedForm, istClock, istWeekday, sameDefinition, savedBacktestOf, savedDefinitionOf, savedFormOf, utcWeekday } from "./saved-form";

const form = (over: Partial<SavedForm> = {}): SavedForm => ({ ...emptySavedForm(), name: "Evening strangle", summary: "Sell both sides.", ...over });
const defOf = (f: SavedForm) => {
  const r = savedDefinitionOf(f);
  if (!r.ok) throw new Error(r.error);
  return r.value;
};
const errOf = (f: SavedForm) => {
  const r = savedDefinitionOf(f);
  return r.ok ? null : r.error;
};
const strategy = (f: SavedForm, over: Partial<SavedStrategy> = {}): SavedStrategy => ({
  id: "sv_1", familyId: "sv_1", version: 1, name: f.name, summary: f.summary, definition: defOf(f), stage: "draft", audience: "admins", userIds: [], planIds: [], backtest: null, backtestAt: null, traded: false, lossCapped: false, entryText: "", createdBy: null, createdAt: "2026-11-25T10:00:00.000Z", updatedAt: "2026-11-25T10:00:00.000Z", publishedAt: null, retiredAt: null, ...over,
});

describe("HC-TR-278 India time and the engine's UTC hours", () => {
  it("HC-TR-278 reads a UTC hour as the India clock, and the hours run from 05:30 through the India day", () => {
    expect(istClock(16)).toBe("9:30 PM");
    expect(istClock(0)).toBe("5:30 AM");
    expect(istClock(19)).toBe("12:30 AM");
    expect(istClock(24)).toBe("5:30 AM");
    expect(FROM_HOURS).toHaveLength(24);
  });

  it("HC-TR-278 an India weekday is the UTC day before it when the window starts at 12:30 AM IST or later in the night", () => {
    // 21:30 IST on Friday is 16:00 UTC on Friday
    expect(utcWeekday(5, 16)).toBe(5);
    // 12:30 AM IST on Friday is 19:00 UTC on Thursday
    expect(utcWeekday(5, 19)).toBe(4);
    expect(utcWeekday(0, 22)).toBe(6);
    expect(istWeekday(4, 19)).toBe(5);
    expect(istWeekday(6, 22)).toBe(0);
    expect(istWeekday(5, 16)).toBe(5);
    // 11:30 PM IST is still the same day; any time of day is the UTC day
    expect(utcWeekday(5, 18)).toBe(5);
    expect(istWeekday(5, 18)).toBe(5);
    expect(utcWeekday(5, 0)).toBe(5);
  });
});

describe("HC-TR-278 the form as settings", () => {
  it("HC-TR-278 a new form is the evening strangle: daily, 9:30 to 10:30 PM IST, 2 % away, nothing else set", () => {
    expect(defOf(form())).toEqual({ assets: ["BTC"], venues: ["delta_india"], lots: 100, cadence: "daily", fromHourUtc: 16, toHourUtc: 17, oncePerExpiry: false, minDte: 0.5, maxDte: 1.5, legs: [{ kind: "put", side: "sell", by: "pct", value: 2 }, { kind: "call", side: "sell", by: "pct", value: 2 }], exits: {} });
    expect(LEG_PRESETS.wings.legs().map((l) => `${l.side} ${l.kind} ${l.value}`)).toEqual(["buy put 4", "sell put 2", "sell call 2", "buy call 4"]);
    expect(LEG_PRESETS.put.legs()).toHaveLength(1);
    expect(LEG_PRESETS.call.legs()[0]).toMatchObject({ kind: "call", side: "sell" });
  });

  it("HC-TR-278 weekly and chosen days are converted to UTC days; any time of day is the whole UTC day", () => {
    expect(defOf(form({ cadence: "weekly", weekday: 5, minDte: "6.5", maxDte: "7.5" }))).toMatchObject({ cadence: "weekly", weekdayUtc: 5 });
    expect(defOf(form({ cadence: "weekly", weekday: 5, fromHourUtc: 19, toHourUtc: 20, minDte: "6.5", maxDte: "7.5" }))).toMatchObject({ weekdayUtc: 4 });
    expect(defOf(form({ weekdays: [5, 1] })).weekdays).toEqual([1, 5]);
    expect(defOf(form({ weekdays: [1], fromHourUtc: 20, toHourUtc: 22 })).weekdays).toEqual([0]);
    expect(defOf(form({ weekdays: [] })).weekdays).toBeUndefined();
    expect(defOf(form({ anyTime: true, oncePerExpiry: true }))).toMatchObject({ fromHourUtc: 0, toHourUtc: 24, oncePerExpiry: true });
    // chosen days are a daily strategy's only
    expect(defOf(form({ cadence: "monthly", weekdays: [1], oncePerExpiry: true, minDte: "20", maxDte: "35" })).weekdays).toBeUndefined();
  });

  it("HC-TR-276 HC-TR-278 market conditions, one side after a move and every exit", () => {
    const d = defOf(
      form({
        smaOn: true, smaDays: "50", smaSide: "below", ivOn: true, ivMin: "60", ivMax: "", ivLookback: "90", moveOn: true, moveHours: "24", movePct: "2",
        legStop: "2", takeProfitPct: "55", takeTrailPct: "5", trailRestPct: "50", ladder: "25, 50,75", lockAtPct: "50", lockFloorPct: "20", exitHourUtc: "10", buyBackBy: "price", buyBackValue: "5",
      }),
    );
    expect(d.conditions).toEqual({ sma: { days: 50, side: "below" }, ivRank: { min: 60, lookbackDays: 90 } });
    expect(d.moveSide).toEqual({ hours: 24, pct: 2 });
    expect(d.exits).toEqual({ legStop: 2, takeProfitOfCredit: 0.55, takeTrailPct: 5, trailRestPct: 50, ladder: [25, 50, 75], lock: { at: 0.5, floor: 0.2 }, exitHourUtc: 10, legBuyBackAt: 5 });
    expect(defOf(form({ buyBackBy: "share", buyBackValue: "20" })).exits).toEqual({ legBuyBackShare: 0.2 });
    expect(defOf(form({ ivOn: true, ivMin: "", ivMax: "40" })).conditions).toEqual({ ivRank: { max: 40, lookbackDays: 90 } });
    expect(defOf(form({ smaOn: true })).conditions).toEqual({ sma: { days: 50, side: "above" } });
  });

  it("HC-TR-278 says the first thing wrong in the admin's words", () => {
    expect(errOf(form())).toBeNull();
    expect(errOf(form({ fromHourUtc: 22, toHourUtc: 2 }))).toContain("crosses 5:30 AM IST");
    expect(errOf(form({ fromHourUtc: 10, toHourUtc: 17 }))).toContain("longer than six hours");
    expect(errOf(form({ fromHourUtc: 10, toHourUtc: 17, oncePerExpiry: true }))).toBeNull();
    expect(errOf(form({ anyTime: true }))).toContain("any time of day");
    expect(errOf(form({ lockAtPct: "50" }))).toBe("A profit lock needs both its level and its floor.");
    expect(errOf(form({ buyBackBy: "price", buyBackValue: "" }))).toBe("The buy-back needs its level.");
    expect(errOf(form({ lots: "" }))).toBe("Lots: the value is missing or out of range.");
    expect(errOf(form({ lots: "abc" }))).toBe('Lots: "abc" is not a number.');
    expect(errOf(form({ legs: [{ kind: "put", side: "sell", by: "pct", value: "2" }, { kind: "call", side: "sell", by: "pct", value: "two" }] }))).toBe('Leg 2: "two" is not a number.');
    expect(errOf(form({ legs: [{ kind: "put", side: "sell", by: "pct", value: "2" }, { kind: "call", side: "sell", by: "pct", value: "60" }] }))).toBe("Leg 2: Per cent away is at most 50");
    expect(errOf(form({ ladder: "25, x" }))).toBe('The steps: "x" is not a number.');
    expect(errOf(form({ smaOn: true, smaDays: "many" }))).toBe('The days of the average: "many" is not a number.');
    expect(errOf(form({ ivOn: true, ivMin: "low" }))).toBe('The lowest rank: "low" is not a number.');
    expect(errOf(form({ moveOn: true, movePct: "big" }))).toBe('The move: "big" is not a number.');
    expect(errOf(form({ buyBackBy: "price", buyBackValue: "five" }))).toBe('The buy-back: "five" is not a number.');
    expect(errOf(form({ takeProfitPct: "100" }))).toContain("between 0 and 100 % of the premium");
    expect(errOf(form({ takeProfitPct: "0" }))).toContain("between 0 and 100 % of the premium");
    expect(errOf(form({ legStop: "1" }))).toBe("The stop on each sold option: the value is missing or out of range.");
    expect(errOf(form({ smaOn: true, smaDays: "1" }))).toBe("Market conditions: the value is missing or out of range.");
    expect(errOf(form({ minDte: "2", maxDte: "1" }))).toMatch(/^Furthest expiry: /);
    expect(errOf(form({ legs: [{ kind: "call", side: "buy", by: "pct", value: "2" }] }))).toBe("What to trade: A saved strategy sells at least one option");
    expect(errOf(form({ trailRestPct: "50" }))).toMatch(/^The trail of the rest: Trailing the rest/);
    expect(errOf(form({ assets: [] }))).toMatch(/^Coins: /);
    expect(errOf(form({ ladder: "50, 25" }))).toBe("The steps: The steps rise");
  });
});

describe("HC-TR-278 a saved strategy back into the form", () => {
  it("HC-TR-278 every setting comes back as it was typed, India days included", () => {
    const typed = form({
      assets: ["BTC", "ETH"], lots: "50", cadence: "weekly", weekday: 5, fromHourUtc: 19, toHourUtc: 20, minDte: "6.5", maxDte: "7.5", legs: LEG_PRESETS.wings.legs(),
      smaOn: true, smaDays: "20", smaSide: "below", ivOn: true, ivMin: "30", ivMax: "70", ivLookback: "120", moveOn: true, moveHours: "12", movePct: "1.5",
      legStop: "3", takeProfitPct: "55", takeTrailPct: "5", trailRestPct: "50", ladder: "25, 50", lockAtPct: "50", lockFloorPct: "20", exitHourUtc: "10", buyBackBy: "share", buyBackValue: "20",
    });
    const back = savedFormOf(strategy(typed, { audience: "plans", planIds: ["pln_pro"], userIds: ["usr_1"], backtest: { mean: 12.4, per: "week", positivePct: 71, worst: -180, samples: 51, basis: "weekly study" } }));
    expect(back).toMatchObject({ ...typed, audience: "plans", planIds: ["pln_pro"], userIds: ["usr_1"], btMean: "12.4", btPer: "week", btPositivePct: "71", btWorst: "-180", btSamples: "51", btBasis: "weekly study" });
    expect(sameDefinition(defOf(back), defOf(typed))).toBe(true);
  });

  it("HC-TR-278 a plain daily strategy, chosen days, any time of day and a buy-back by price", () => {
    const plain = savedFormOf(strategy(form()));
    expect(plain).toMatchObject({ anyTime: false, fromHourUtc: 16, toHourUtc: 17, weekday: 5, weekdays: [], smaOn: false, ivOn: false, moveOn: false, legStop: "", takeProfitPct: "", ladder: "", lockAtPct: "", exitHourUtc: "", buyBackBy: "none", buyBackValue: "", btMean: "", btPer: "day", btBasis: "" });
    expect(savedFormOf(strategy(form({ weekdays: [1, 5], fromHourUtc: 20, toHourUtc: 22 }))).weekdays).toEqual([1, 5]);
    expect(savedFormOf(strategy(form({ anyTime: true, oncePerExpiry: true })))).toMatchObject({ anyTime: true, fromHourUtc: 16, toHourUtc: 17, oncePerExpiry: true });
    expect(savedFormOf(strategy(form({ anyTime: true, oncePerExpiry: true, cadence: "weekly", weekday: 2, minDte: "6.5", maxDte: "7.5" }))).weekday).toBe(2);
    expect(savedFormOf(strategy(form({ buyBackBy: "price", buyBackValue: "5" })))).toMatchObject({ buyBackBy: "price", buyBackValue: "5" });
    expect(savedFormOf(strategy(form({ ivOn: true, ivMax: "40" })))).toMatchObject({ ivOn: true, ivMin: "", ivMax: "40", ivLookback: "90" });
  });

  it("HC-TR-271 HC-TR-278 backtest figures: none typed is none, all typed are the figures, some typed is said", () => {
    expect(savedBacktestOf(form())).toEqual({ ok: true, value: null });
    expect(savedBacktestOf(form({ btMean: "12.4", btPer: "day", btPositivePct: "71", btWorst: "-180", btSamples: "106", btBasis: " autopilot-study " }))).toEqual({ ok: true, value: { mean: 12.4, per: "day", positivePct: 71, worst: -180, samples: 106, basis: "autopilot-study" } });
    expect(savedBacktestOf(form({ btMean: "12.4" }))).toMatchObject({ ok: false });
    expect(savedBacktestOf(form({ btBasis: "only the source" }))).toMatchObject({ ok: false });
  });

  it("HC-TR-272 the same settings in another key order are the same settings", () => {
    const d = defOf(form({ legStop: "2" }));
    const { exits, legs, ...rest } = d;
    expect(sameDefinition(d, { legs, exits, ...rest })).toBe(true);
    expect(sameDefinition(d, defOf(form({ legStop: "3" })))).toBe(false);
  });
});
