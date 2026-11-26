// The editor of a saved Autopilot strategy as data (HC-TR-278): India time and weekdays to the engine's UTC hours and
// days and back, every field to its setting, and the first thing wrong said in the admin's words.
import { AUTOPILOT_PLAYBOOKS, playbookTemplate } from "@hapiecoin/pricing";
import { type SavedStrategy, savedPlaybookOf } from "@hapiecoin/schema";
import { describe, expect, it } from "vitest";
import { FROM_HOURS, LEG_PRESETS, type SavedForm, TREND_COPY_NOTES, emptySavedForm, istClock, istWeekday, sameDefinition, SAVED_NAME_MAX, savedBacktestOf, savedDefinitionOf, savedFormFromBuiltIn, savedFormOf, trendCopyNotes, utcWeekday } from "./saved-form";

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
  id: "sv_1", familyId: "sv_1", version: 1, name: f.name, summary: f.summary, definition: defOf(f), stage: "draft", audience: "admins", userIds: [], planIds: [], backtest: null, backtestAt: null, approval: null, traded: false, lossCapped: false, entryText: "", createdBy: null, createdAt: "2026-11-25T10:00:00.000Z", updatedAt: "2026-11-25T10:00:00.000Z", publishedAt: null, retiredAt: null, ...over,
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

describe("HC-TR-280 a built-in strategy as a draft of the admin's own", () => {
  const clockOnes = AUTOPILOT_PLAYBOOKS.filter((p) => p.clock);
  const trendOnes = AUTOPILOT_PLAYBOOKS.filter((p) => !p.clock);

  it("HC-TR-280 every built-in strategy entered by the clock can be copied, and the copy is the same strategy: the same entry, legs, conditions and exits", () => {
    expect(clockOnes.map((p) => [p.id, savedFormFromBuiltIn(p)] as const).filter(([, r]) => !r.ok).map(([id, r]) => `${id}: ${r.ok ? "" : r.why}`)).toEqual([]);
    for (const p of clockOnes) {
      const copied = savedFormFromBuiltIn(p);
      if (!copied.ok) throw new Error(copied.why);
      const definition = defOf(copied.form);
      const q = savedPlaybookOf({ id: "sv_copy", name: copied.form.name, summary: copied.form.summary, definition, backtest: null });
      const c = p.clock!;
      // what the engine reads, key for key: every key the built-in clock, its legs and its conditions carry, whatever
      // is added to them later (the words of the window and of the card are the copy's own)
      const plain = (o: object | undefined) => JSON.parse(JSON.stringify(o ?? {})) as Record<string, unknown>;
      const { window: _w, describe: _d, ...mine } = plain(q.clock);
      const { window: _bw, describe: _bd, ...theirs } = plain(c);
      void [_w, _d, _bw, _bd];
      expect({ ...mine, oncePerExpiry: Boolean(mine["oncePerExpiry"]) }, p.id).toEqual({ ...theirs, oncePerExpiry: Boolean(theirs["oncePerExpiry"]) });
      expect(q.template.legs.map((l) => plain(l)), p.id).toEqual(playbookTemplate(p)!.legs.map((l) => plain(l)));
      expect(plain(q.conditions), p.id).toEqual(plain(p.conditions));
      expect({ minDte: q.minDte, lots: q.lots, assets: q.assets, control: q.control, risk: q.template.risk }, p.id).toEqual({ minDte: p.minDte, lots: p.lots, assets: [...p.assets], control: p.control, risk: playbookTemplate(p)!.risk });
    }
  });

  it("HC-TR-280 a copy's name is the built-in name with (copy), never cut: one too long is left for the admin to write, and no two copies share a name; a description too long is cut after a whole sentence, and both are said", () => {
    const copies = clockOnes.map((p) => {
      const r = savedFormFromBuiltIn(p);
      if (!r.ok) throw new Error(r.why);
      return { p, form: r.form, notes: r.notes };
    });
    const named = copies.filter((x) => x.form.name !== "");
    expect(named.every((x) => x.form.name === `${x.p.name} (copy)` && x.form.name.length <= SAVED_NAME_MAX)).toBe(true);
    expect(new Set(named.map((x) => x.form.name)).size).toBe(named.length);
    const unnamed = copies.filter((x) => x.form.name === "");
    expect(unnamed.length).toBeGreaterThan(0);
    expect(unnamed.every((x) => `${x.p.name} (copy)`.length > SAVED_NAME_MAX && x.notes.some((n) => n.startsWith("Its name is too long to copy")))).toBe(true);
    const cut = copies.filter((x) => x.form.summary !== x.p.summary);
    expect(cut.length).toBeGreaterThan(0);
    for (const x of cut) {
      expect(x.form.summary.length, x.p.id).toBeLessThanOrEqual(300);
      expect(x.form.summary.endsWith("."), x.p.id).toBe(true);
      expect(x.p.summary.startsWith(x.form.summary), x.p.id).toBe(true);
      expect(x.notes, x.p.id).toContain("Its description was too long to copy whole and was cut after a full sentence: read it and complete it.");
    }
    expect(copies.filter((x) => x.form.summary === x.p.summary && x.form.name !== "").every((x) => x.notes.length === 0)).toBe(true);
    // one sentence that does not fit at all is left empty, for the admin to write
    const long = savedFormFromBuiltIn({ ...clockOnes[0]!, summary: "x".repeat(400) });
    expect(long.ok && long.form.summary).toBe("");
  });

  it("HC-TR-285 a strategy entered on a market condition is copied as one that may enter at any time of day, once per expiry: the same legs, conditions, size and exits on the whole trade, and what differs is said", () => {
    const plain = (o: object | undefined) => JSON.parse(JSON.stringify(o ?? {})) as Record<string, unknown>;
    const copied = trendOnes.filter((p) => savedFormFromBuiltIn(p).ok);
    expect(copied.map((p) => p.id)).toEqual(["trend-calls", "trend-puts", "premium-harvest", "expiry-week-credit", "pin-butterfly"]);
    for (const p of copied) {
      const r = savedFormFromBuiltIn(p);
      if (!r.ok) throw new Error(r.why);
      expect(r.form).toMatchObject({ name: `${p.name} (copy)`, summary: p.summary, anyTime: true, oncePerExpiry: true, cadence: "daily", minDte: String(p.minDte), maxDte: "400", lots: String(p.lots) });
      // what differs is said, and that Autopilot gets out of the built-in one at 10 %, not at the target its description names
      expect(r.notes, p.id).toEqual([...TREND_COPY_NOTES, `Autopilot takes the built-in one's profit at 10 % of the most it can make. This copy starts with the target its description names, ${p.id === "pin-butterfly" ? 75 : 50} %: set the target to 10 if it should get out where the built-in one does.`]);
      const q = savedPlaybookOf({ id: "sv_copy", name: r.form.name, summary: r.form.summary, definition: defOf(r.form), backtest: null });
      expect(q.template.legs.map((l) => plain(l)), p.id).toEqual(playbookTemplate(p)!.legs.map((l) => plain(l)));
      expect(plain(q.exits), p.id).toEqual(plain(p.exits));
      expect(plain(q.conditions), p.id).toEqual(plain(p.conditions));
      expect({ minDte: q.minDte, lots: q.lots, assets: q.assets, risk: q.template.risk }, p.id).toEqual({ minDte: p.minDte, lots: p.lots, assets: [...p.assets], risk: playbookTemplate(p)!.risk });
      expect(q.clock).toMatchObject({ fromHourUtc: 0, toHourUtc: 24, oncePerExpiry: true, maxDte: 400, venues: ["delta_india"] });
      // none of the exits a clock strategy has: only the ones the built-in strategy carries
      expect(Object.keys(plain(q.clock)).sort(), p.id).toEqual(["describe", "fromHourUtc", "maxDte", "oncePerExpiry", "toHourUtc", "venues", "window"]);
    }
    // the butterfly: one in the money, two at it, one out
    const fly = savedFormFromBuiltIn(trendOnes.find((p) => p.id === "pin-butterfly")!);
    expect(fly.ok && fly.form.legs).toEqual([{ kind: "call", side: "buy", by: "strikes", value: "2", itm: true }, { kind: "call", side: "sell", by: "strikes", value: "0", ratio: "2" }, { kind: "call", side: "buy", by: "strikes", value: "2" }]);
    expect(fly.ok && [fly.form.targetOfMaxPct, fly.form.stopOfMaxPct, fly.form.timeStopDte]).toEqual(["75", "", ""]);
    const calls = savedFormFromBuiltIn(trendOnes.find((p) => p.id === "trend-calls")!);
    expect(calls.ok && [calls.form.targetOfMaxPct, calls.form.stopOfMaxPct, calls.form.timeStopDte, calls.form.smaOn, calls.form.smaDays, calls.form.smaSide]).toEqual(["50", "50", "2", true, "50", "above"]);
    // the one that holds the perpetual stays out, and one that names weekdays without a clock
    expect(trendOnes.filter((p) => !savedFormFromBuiltIn(p).ok).map((p) => [p.id, savedFormFromBuiltIn(p)])).toEqual([["covered-call", { ok: false, why: "It holds a futures leg, which a saved strategy cannot." }]]);
    expect(savedFormFromBuiltIn({ ...copied[0]!, conditions: { weekdays: [1] } })).toEqual({ ok: false, why: "It chooses its weekdays without a window by the clock, which the editor cannot hold." });
    expect(TREND_COPY_NOTES).toHaveLength(4);
    expect(trendCopyNotes({ ...copied[0]!, exits: { targetPct: 0.1 } })).toEqual([...TREND_COPY_NOTES]);
    expect(trendCopyNotes({ ...copied[0]!, exits: { stopPct: 0.5 } })).toEqual([...TREND_COPY_NOTES]);
    // one with no exits of its own comes through with none (whether its prices let it trade is judged at the entry)
    const bare = savedFormFromBuiltIn({ ...copied[0]!, exits: undefined });
    expect(bare.ok && [bare.form.targetOfMaxPct, bare.form.stopOfMaxPct, bare.form.timeStopDte]).toEqual(["", "", ""]);
  });

  it("HC-TR-280 what the editor cannot hold is said: another exchange, a futures leg, legs of another size or expiry, a leg at the money, a window the rules refuse", () => {
    const base = clockOnes[0]!;
    const withLegs = (legs: object[]) => ({ ...base, template: { name: "T", category: "Neutral", description: "d", legs, risk: "undefined" } }) as never;
    const why = (p: never) => {
      const r = savedFormFromBuiltIn(p);
      return r.ok ? null : r.why;
    };
    expect(why({ ...base, clock: { ...base.clock!, venues: ["deribit"] } } as never)).toBe("It trades on another exchange than Delta Exchange India.");
    expect(why(withLegs([{ kind: "future", side: "sell" }]))).toBe("It holds a futures leg, which a saved strategy cannot.");
    expect(why(withLegs([{ kind: "call", side: "sell", k: 2, lots: 6 }]))).toBe("It has a leg of more than 5 times the lots, or of a part of them, which the editor cannot hold.");
    expect(why(withLegs([{ kind: "call", side: "sell", k: 2, lots: 0.5 }]))).toBe("It has a leg of more than 5 times the lots, or of a part of them, which the editor cannot hold.");
    expect(why(withLegs([{ kind: "call", side: "sell", k: 2, expiryOffset: 1 }]))).toBe("Its legs differ in expiry, which the editor cannot hold.");
    expect(why(withLegs([{ kind: "put", side: "sell", k: 0, pct: 2 }]))).toBe("It has a leg by per cent at or in the money, which the editor cannot hold.");
    expect(why(withLegs([{ kind: "call", side: "sell", k: 0, pct: 0 }]))).toBe("It has a leg by per cent at or in the money, which the editor cannot hold.");
    // HC-TR-285: by listed strikes a leg may sit at the money or in it, and be several times the lots
    const held = savedFormFromBuiltIn(withLegs([{ kind: "call", side: "sell", k: 0, lots: 2 }, { kind: "put", side: "sell", k: 1 }, { kind: "put", side: "sell", k: -1, lots: 1 }]));
    expect(held.ok && held.form.legs).toEqual([{ kind: "call", side: "sell", by: "strikes", value: "0", ratio: "2" }, { kind: "put", side: "sell", by: "strikes", value: "1", itm: true }, { kind: "put", side: "sell", by: "strikes", value: "1" }]);
    expect(why(withLegs([{ kind: "call", side: "buy", k: 2 }]))).toBe("The editor cannot hold it as it is. What to trade: A saved strategy sells at least one option");
    expect(why({ ...base, template: "No such template" } as never)).toMatch(/^The editor cannot hold it as it is\. /);
    // a day the editor has no field for is a reason, not a silent drop
    expect(why({ ...base, clock: { ...base.clock!, cadence: "monthly", weekdayUtc: 5 } } as never)).toBe("It is monthly and tied to one weekday, which the editor cannot hold.");
    expect(why({ ...base, conditions: { weekdays: [1] }, clock: { ...base.clock!, weekdayUtc: 5 } } as never)).toBe("It chooses its weekdays without being a daily strategy, which the editor cannot hold.");
    // a whole-day window, chosen days and conditions come through
    const allDay = savedFormFromBuiltIn({ ...base, conditions: { sma: { days: 20, side: "below" }, ivRank: { min: 40, lookbackDays: 120 }, weekdays: [1, 5] }, clock: { ...base.clock!, fromHourUtc: 0, toHourUtc: 24, oncePerExpiry: true, moveSide: { hours: 12, pct: 1.5 } } } as never);
    expect(allDay.ok && allDay.form).toMatchObject({ anyTime: true, oncePerExpiry: true, weekdays: [1, 5], smaOn: true, smaDays: "20", smaSide: "below", ivOn: true, ivMin: "40", ivLookback: "120", moveOn: true, moveHours: "12", movePct: "1.5" });
  });
});

describe("HC-TR-284 the editor holds a structure that pays premium (ADR-143)", () => {
  const spread = (over: Partial<SavedForm> = {}): SavedForm => form({ anyTime: true, oncePerExpiry: true, minDte: "14", maxDte: "400", legs: LEG_PRESETS.callSpread.legs(), targetOfMaxPct: "50", ...over });

  it("HC-TR-284 the presets: a bought call spread, a bought put spread and a call butterfly, by listed strikes, each with the target it needs", () => {
    expect([LEG_PRESETS.callSpread.target, LEG_PRESETS.putSpread.target, LEG_PRESETS.butterfly.target, LEG_PRESETS.strangle.target]).toEqual(["50", "50", "75", undefined]);
    expect(LEG_PRESETS.callSpread.legs()).toEqual([{ kind: "call", side: "buy", by: "strikes", value: "0" }, { kind: "call", side: "sell", by: "strikes", value: "2" }]);
    expect(LEG_PRESETS.putSpread.legs()).toEqual([{ kind: "put", side: "buy", by: "strikes", value: "0" }, { kind: "put", side: "sell", by: "strikes", value: "2" }]);
    expect(defOf(spread({ legs: LEG_PRESETS.butterfly.legs(), targetOfMaxPct: "75" })).legs).toEqual([{ kind: "call", side: "buy", by: "strikes", value: 2, itm: true }, { kind: "call", side: "sell", by: "strikes", value: 0, ratio: 2 }, { kind: "call", side: "buy", by: "strikes", value: 2 }]);
    expect(defOf(spread({ legs: LEG_PRESETS.putSpread.legs() })).legs).toEqual([{ kind: "put", side: "buy", by: "strikes", value: 0 }, { kind: "put", side: "sell", by: "strikes", value: 2 }]);
  });

  it("HC-TR-284 the three exits on the whole trade go to the settings as shares and whole days, and come back as typed; a trail may start from the target", () => {
    const d = defOf(spread({ targetOfMaxPct: "50", stopOfMaxPct: "55", timeStopDte: "2", takeTrailPct: "10" }));
    expect(d.exits).toEqual({ targetOfMax: 0.5, stopOfMax: 0.55, timeStopDte: 2, takeTrailPct: 10 });
    const back = savedFormOf(strategy(spread({ targetOfMaxPct: "50", stopOfMaxPct: "55", timeStopDte: "2", takeTrailPct: "10", legs: LEG_PRESETS.butterfly.legs() })));
    expect([back.targetOfMaxPct, back.stopOfMaxPct, back.timeStopDte, back.takeTrailPct]).toEqual(["50", "55", "2", "10"]);
    expect(back.legs).toEqual(LEG_PRESETS.butterfly.legs());
    // a strategy with none of them is as it was
    expect(defOf(form()).exits).toEqual({});
    expect([savedFormOf(strategy(form())).targetOfMaxPct, savedFormOf(strategy(form())).stopOfMaxPct, savedFormOf(strategy(form())).timeStopDte]).toEqual(["", "", ""]);
  });

  it("HC-TR-284 a leg in the money is by listed strikes only, and a size of once is not written", () => {
    // in the money is dropped when the leg is no longer by strikes; "1" and "" are once
    expect(defOf(form({ legs: [{ kind: "put", side: "sell", by: "pct", value: "2", itm: true, ratio: "1" }, { kind: "call", side: "sell", by: "pct", value: "2", ratio: "" }] })).legs).toEqual([{ kind: "put", side: "sell", by: "pct", value: 2 }, { kind: "call", side: "sell", by: "pct", value: 2 }]);
    expect(defOf(form({ legs: [{ kind: "put", side: "sell", by: "strikes", value: "1", itm: true, ratio: "3" }] })).legs).toEqual([{ kind: "put", side: "sell", by: "strikes", value: 1, itm: true, ratio: 3 }]);
  });

  it("HC-TR-284 what is wrong is said in the admin's words: the ranges, a size, a level without its most, an exit too near the entry", () => {
    expect(errOf(spread({ targetOfMaxPct: "100" }))).toBe("The target is between 0 and 100 % of the most the trade can make (the whole of it is only reached at settlement).");
    expect(errOf(spread({ targetOfMaxPct: "0" }))).toBe("The target is between 0 and 100 % of the most the trade can make (the whole of it is only reached at settlement).");
    expect(errOf(spread({ stopOfMaxPct: "0" }))).toBe("The stop is above 0 and at most 100 % of the most the trade can lose.");
    expect(errOf(spread({ stopOfMaxPct: "101" }))).toBe("The stop is above 0 and at most 100 % of the most the trade can lose.");
    expect(errOf(spread({ stopOfMaxPct: "100" }))).toBeNull();
    expect(errOf(spread({ targetOfMaxPct: "half" }))).toBe('The target on the most it can make: "half" is not a number.');
    expect(errOf(spread({ stopOfMaxPct: "x" }))).toBe('The stop on the most it can lose: "x" is not a number.');
    expect(errOf(spread({ timeStopDte: "soon" }))).toBe('The exit before expiry: "soon" is not a number.');
    const sized = (ratio: string) => spread({ legs: [{ kind: "call", side: "buy", by: "strikes", value: "0" }, { kind: "call", side: "sell", by: "strikes", value: "2", ratio }] });
    expect(errOf(sized("6"))).toBe("The size of a leg is a whole number of times the lots, from 1 to 5.");
    expect(errOf(sized("1.5"))).toBe("The size of a leg is a whole number of times the lots, from 1 to 5.");
    expect(errOf(sized("0"))).toBe("The size of a leg is a whole number of times the lots, from 1 to 5.");
    expect(errOf(sized("two"))).toBe('The size of leg 2: "two" is not a number.');
    // the schema's own rules, by the name of the part of the form
    expect(errOf(spread({ legs: [{ kind: "call", side: "buy", by: "strikes", value: "0", ratio: "2" }, { kind: "call", side: "sell", by: "strikes", value: "2" }] }))).toBe("When to exit: A target on the most the trade can make needs that most to be limited: do not buy more calls than you sell, or more puts");
    expect(errOf(form({ stopOfMaxPct: "50" }))).toBe("When to exit: A stop on the most the trade can lose needs a limited loss: cover every sold option with a bought one of its kind");
    expect(errOf(spread({ takeProfitPct: "50" }))).toBe("The target on the most it can make: A profit level is a share of the premium or of the most the trade can make, not both");
    expect(errOf(spread({ timeStopDte: "14" }))).toBe("When to exit: The exit before expiry is at least a day nearer than the nearest expiry it enters");
    expect(errOf(spread({ timeStopDte: "0" }))).toBe("The exit before expiry is in whole days, at least 1.");
    expect(errOf(spread({ timeStopDte: "2.5" }))).toBe("The exit before expiry is in whole days, at least 1.");
    expect(errOf(spread({ legs: [{ kind: "call", side: "buy", by: "strikes", value: "0", itm: true }, { kind: "call", side: "sell", by: "strikes", value: "2" }] }))).toBe("Leg 1: In the money is for a leg by strikes, at least one strike in");
  });
});
