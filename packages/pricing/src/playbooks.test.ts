// Playbooks as data (ADR-101; HC-TR-205): every playbook places on a ladder, the status rules read a record against the
// thresholds (the control inverted), losing years come from the closed trades, and the options carry the plan.
import { describe, expect, it } from "vitest";
import { type BacktestFold, type BacktestStats, type BacktestTrade, type EodDay, type EodRow, runBacktest } from "./backtest.js";
import { calendarFor, daysToExpiryOf } from "./calendar.js";
import { ALT_DAILY_PLAYBOOKS, ALT_MONTHLY_AGAIN_PLAYBOOKS, ALT_MONTHLY_PLAYBOOKS, ALT_PLAYBOOKS, ALT_WEEKLY_PLAYBOOKS, LAB_DAILY_PLAYBOOKS, LAB_WEEKLY_PLAYBOOKS, MOVE_DAILY_PLAYBOOKS, BUYBACK_DAILY_PLAYBOOKS, BUYBACK_SHARE_PLAYBOOKS, TAKE90_WEEKLY_PLAYBOOKS, TAKE90_DAILY_PLAYBOOKS, COMBO_DAILY_PLAYBOOKS, TRAIL15_DAILY_PLAYBOOKS, TRAIL15_XAUT_PLAYBOOKS, ONE_DAY_WEEKLY_PLAYBOOKS, CAUTIOUS_DAILY_PLAYBOOKS, WINGS_TRAIL_DAILY_PLAYBOOKS, sideAfterMove, LADDER_DAILY_PLAYBOOKS, LADDER_WEEKLY_PLAYBOOKS, AUTOPILOT_PLAYBOOKS, CLOCK_PLAYBOOKS, HERO_OR_ZERO_TEMPLATE, MONTHLY_PLAYBOOKS, isMonthEndExpiry, PLAYBOOKS, PLAYBOOK_CADENCES, PREMIUM_PLAYBOOKS, WEEKLY_PLAYBOOKS, playbookBacktest, playbookCadence, autopilotPlaybookById, losingYearsOf, playbookById, playbookOptions, playbookStatus, playbookTemplate, proposalFor } from "./playbooks.js";
import { materialiseTemplate } from "./templates.js";

const cal = calendarFor(12);
const DAY = 86_400_000;
const T0 = Date.UTC(2026, 8, 1, 12, 0, 0);
const day = (n: number) => new Date(T0 + n * DAY).toISOString().slice(0, 10);
const strikes = [76_000, 77_000, 78_000, 79_000, 80_000, 81_000, 82_000, 83_000, 84_000, 85_000];
function ladder(spot: number, iv: number): EodRow[] {
  return strikes.map((strike) => ({ strike, call: { mark: Math.max(spot - strike, 0) + 500 * iv * 2, iv }, put: { mark: Math.max(strike - spot, 0) + 500 * iv * 2, iv: iv + 0.02 } }));
}
function days(n = 5): EodDay[] {
  return Array.from({ length: n }, (_, i) => ({ day: day(i), ts: T0 + i * DAY, spot: 80_000 + i * 200, expiries: [{ expiry: day(4), rows: ladder(80_000 + i * 200, 0.4) }, { expiry: day(40), rows: ladder(80_000 + i * 200, 0.45) }] }));
}
const stats = (over: Partial<BacktestStats>): BacktestStats => ({ trades: 25, wins: 15, losses: 10, winRate: 0.6, total: 100, grossTotal: 110, totalFees: 10, average: 4, median: 3, best: 20, worst: -15, maxDrawdown: 30, profitFactor: 1.5, ...over });
const fold = (index: number, total: number, trades = 12): BacktestFold => ({ index, firstDay: day(index), lastDay: day(index + 1), entries: trades, stats: stats({ total, trades }) });

describe("HC-TR-205 playbooks as data", () => {
  it("every playbook names a catalogue template or carries an inline one, and it materialises on a ten-strike ladder", () => {
    expect(PLAYBOOKS.length).toBeGreaterThanOrEqual(6);
    expect(PLAYBOOKS.filter((p) => p.control)).toHaveLength(1);
    expect(new Set(PLAYBOOKS.map((p) => p.id)).size).toBe(PLAYBOOKS.length);
    const rows = ladder(80_000, 0.4);
    const chain = rows.map((r) => ({ strike: String(r.strike), call: { mark: String(r.call!.mark), markIv: r.call!.iv }, put: { mark: String(r.put!.mark), markIv: r.put!.iv } }));
    for (const p of PLAYBOOKS) {
      const tpl = playbookTemplate(p);
      expect(tpl, p.id).toBeDefined();
      const r = materialiseTemplate(tpl!, { asset: "BTC", expiry: day(40), expiries: [day(4), day(40)], rows: chain, atm: 4, lots: 10, spot: "80000", rowsByExpiry: { [day(4)]: { rows: chain, atm: 4 }, [day(40)]: { rows: chain, atm: 4 } } });
      expect(r.ok, p.id).toBe(true);
      expect(p.summary.length).toBeGreaterThan(20);
      expect(p.evidence.source.length).toBeGreaterThan(5);
      expect(p.trials.count).toBeGreaterThanOrEqual(1);
    }
    expect(playbookById("hero-or-zero")?.template).toBe(HERO_OR_ZERO_TEMPLATE);
    expect(playbookById("nope")).toBeUndefined();
  });

  it("the options carry the plan and two folds, and the hero-or-zero control runs through the engine", () => {
    const p = playbookById("trend-calls")!;
    const opts = playbookOptions(p, { unitsPerLot: 0.001, calendar: cal, fees: null });
    expect(opts).toMatchObject({ lots: 10, minDte: 14, folds: 2, conditions: { sma: { days: 50, side: "above" } }, exits: { targetPct: 0.5, stopPct: 0.5, timeStopDte: 2 } });
    const hero = playbookById("hero-or-zero")!;
    const r = runBacktest(playbookTemplate(hero)!, days(), playbookOptions(hero, { unitsPerLot: 0.001, calendar: cal, fees: null }));
    expect(r.trades.length).toBeGreaterThan(0);
    expect(r.trades[0]!.legs[0]!.strike).toBe(84_000); // four rows above the 80 000 ATM strike
    expect(r.folds).toHaveLength(2);
  });

  it("status is pass only with enough closed trades, a positive net total and a positive out-of-sample half; the control inverts", () => {
    const p = playbookById("trend-calls")!;
    expect(playbookStatus(p, stats({ trades: 19 }), [fold(0, 50), fold(1, 50)])).toBe("insufficient");
    expect(playbookStatus(p, stats({}), [fold(0, 50), fold(1, 50)])).toBe("pass");
    expect(playbookStatus(p, stats({ total: -5 }), [fold(0, 50), fold(1, 50)])).toBe("fail");
    expect(playbookStatus(p, stats({}), [fold(0, 150), fold(1, -50)])).toBe("fail"); // made money in-sample only
    expect(playbookStatus(p, stats({}), [fold(0, 100), fold(1, 0, 0)])).toBe("fail"); // nothing closed out of sample
    expect(playbookStatus(p, stats({}), undefined)).toBe("fail");
    const hero = playbookById("hero-or-zero")!;
    expect(playbookStatus(hero, stats({ total: -80 }), [fold(0, -40), fold(1, -40)])).toBe("control-ok");
    expect(playbookStatus(hero, stats({}), [fold(0, 50), fold(1, 50)])).toBe("control-alarm");
    expect(playbookStatus(hero, stats({ trades: 3 }), [fold(0, 50), fold(1, 50)])).toBe("insufficient");
  });

  it("HC-TR-207 proposalFor: the structure a plan would place on the latest day, through the same entry step as the backtest; the control and an empty history are refused; a plan that would not enter says why", () => {
    const base = { unitsPerLot: 0.001, calendar: cal };
    const hero = playbookById("hero-or-zero")!;
    expect(proposalFor(hero, days(), base)).toEqual({ ok: false, reason: "control" });
    const fly = playbookById("pin-butterfly")!;
    expect(proposalFor(fly, [], base)).toEqual({ ok: false, reason: "noDays" });
    // the butterfly needs one day to expiry and no signal: it enters on the last day, on the near expiry
    const r = proposalFor(fly, days(), base);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error("unreachable");
    expect(r.proposal.day).toBe(day(4));
    expect(r.proposal.spot).toBe(80_800);
    expect(r.proposal.expiry).toBe(day(40)); // the day-4 expiry has zero days left on day 4: the next one is taken
    expect(r.proposal.legs.length).toBeGreaterThanOrEqual(3);
    expect(r.proposal.legs.every((l) => l.expiry === day(40))).toBe(true);
    expect(Number.isFinite(r.proposal.maxLoss)).toBe(true);
    expect(r.proposal.maxLoss).toBeLessThan(0);
    expect(r.proposal.maxProfit).toBeGreaterThan(0);
    // the same entry the backtest takes on that day
    const bt = runBacktest(playbookTemplate(fly)!, days(), playbookOptions(fly, { ...base, fees: null }));
    const last = bt.trades.find((t) => t.entryDay === day(4))!;
    expect(last.legs.map((l) => [l.kind, l.side, l.strike])).toEqual(r.proposal.legs.map((l) => [l.kind, l.side, Number(l.strike)]));
    expect(last.entryCost).toBeCloseTo(r.proposal.entryCost, 6);
    // a plan with a trend filter has no signal on five days
    expect(proposalFor(playbookById("trend-calls")!, days(), base)).toEqual({ ok: false, reason: "noSignal" });
    // a plan that wants thirty days to expiry finds none on this ladder: the days given are sorted first
    const short = days().map((d) => ({ ...d, expiries: d.expiries.filter((e) => e.expiry === day(4)) }));
    expect(proposalFor(playbookById("covered-call")!, [...short].reverse(), base)).toEqual({ ok: false, reason: "noExpiry" });
  });

  it("losing years are the calendar years whose closed trades sum below zero, by exit day", () => {
    const t = (exitDay: string, pnl: number, status: BacktestTrade["status"] = "closed"): BacktestTrade => ({ entryDay: exitDay, exitDay, expiry: exitDay, legs: [], entryCost: 0, grossPnl: pnl, fees: 0, pnl, status, modelled: false, exitReason: "settled", ruleInert: false, daysHeld: 1 });
    const years = losingYearsOf([t("2025-03-01", 10), t("2025-06-01", -25), t("2026-01-10", 5), t("2026-02-10", -2), t("2026-03-10", 4), t("2024-12-31", -1, "open"), t("2024-11-30", -3)]);
    // 2024 comes first although its trade was given last: the list is in year order; the open 2024 trade does not count
    expect(years).toEqual([
      { year: 2024, total: -3 },
      { year: 2025, total: -15 },
    ]);
    expect(losingYearsOf([t("2026-01-10", 5)])).toEqual([]);
  });
});

describe("HC-TR-225 playbooks entered by the clock", () => {
  // 25 strikes, 200 apart, round the spot; time value falling away from the money, so a bought wing costs less than the option sold inside it
  const spot = 83_200;
  const rows: EodRow[] = Array.from({ length: 25 }, (_, i) => {
    const strike = spot + (i - 12) * 200;
    const tv = 400 * Math.exp(-Math.abs(strike - spot) / 1500);
    return { strike, call: { mark: Math.max(spot - strike, 0) + tv, iv: 0.4 }, put: { mark: Math.max(strike - spot, 0) + tv, iv: 0.4 } };
  });
  // 15:05 UTC (20:35 IST) on 25 September: that day's expiry settled at 12:00 UTC, the next one settles in about 21 hours
  const at = Date.UTC(2026, 8, 25, 15, 5, 0);
  const evening: EodDay[] = [{ day: "2026-09-25", ts: at, spot, expiries: ["2026-09-25", "2026-09-26", "2026-10-30"].map((expiry) => ({ expiry, rows })) }];
  const base = { unitsPerLot: 0.001, calendar: cal };

  it("HC-TR-225 six evening strangles: a window in UTC hours, the nearest expiry at least half a day out, BTC only, outside the recorded list", () => {
    expect(CLOCK_PLAYBOOKS).toHaveLength(6);
    // HC-TR-227: one of them takes its profit at half the premium, with the stops of the stop-at-double one
    expect(CLOCK_PLAYBOOKS.map((p) => [p.clock!.legStop, p.clock!.takeProfitOfCredit])).toEqual([[undefined, undefined], [undefined, undefined], [2, undefined], [3, undefined], [2, 0.5], [2, undefined]]);
    // HC-TR-228: the last one trails what is left after a stop; no other does
    expect(CLOCK_PLAYBOOKS.map((p) => p.clock!.trailRestPct)).toEqual([undefined, undefined, undefined, undefined, undefined, 50]);
    for (const p of CLOCK_PLAYBOOKS) {
      expect(p.clock).toMatchObject({ fromHourUtc: 16, toHourUtc: 17, window: "9:30 to 10:30 PM IST", maxDte: 1.5, venues: ["delta_india"] });
      expect(p.evidence.claim).toContain("entered 21:30 IST"); // the bar the window's first pass is
      expect(p).toMatchObject({ minDte: 0.5, lots: 100, assets: ["BTC"], control: false });
      expect(p.conditions).toBeUndefined();
      expect(p.exits).toBeUndefined();
      expect(p.evidence.source).toContain("docs/research/scripts/autopilot-study");
      expect(p.trials.note).toContain("in-sample"); // chosen after seeing the results: said on the card's source
      expect(PLAYBOOKS.includes(p)).toBe(false);
      expect(autopilotPlaybookById(p.id)).toBe(p);
    }
    expect(new Set(AUTOPILOT_PLAYBOOKS.map((p) => p.id)).size).toBe(AUTOPILOT_PLAYBOOKS.length);
    expect(AUTOPILOT_PLAYBOOKS.some((p) => p.control)).toBe(false);
    expect(autopilotPlaybookById("nope")).toBeUndefined();
  });

  it("HC-TR-225 the structures on tomorrow's expiry: sold three (or five) strikes out, wings eight (or ten) out, a credit; the naked ones have no maximum loss", () => {
    const placed = (id: string) => {
      const r = proposalFor(autopilotPlaybookById(id)!, evening, base);
      if (!r.ok) throw new Error(r.reason);
      return r.proposal;
    };
    const w3 = placed("evening-strangle-wings-3");
    expect(w3.expiry).toBe("2026-09-26"); // not the 25th, which has settled, and not the monthly
    expect(w3.legs.map((l) => `${l.side} ${l.kind} ${l.strike} x${l.lots}`)).toEqual(["buy put 81600 x100", "sell put 82600 x100", "sell call 83800 x100", "buy call 84800 x100"]);
    expect(w3.entryCost).toBeLessThan(0);
    expect(w3.maxProfit).toBeCloseTo(-w3.entryCost, 6); // the credit, kept when it settles between the sold strikes
    expect(w3.maxLoss).toBeCloseTo(-(1000 * 0.1) - w3.entryCost, 6); // the 1,000 between a sold strike and its wing on 0.1 BTC, less the credit
    expect(placed("evening-strangle-wings-5").legs.map((l) => l.strike)).toEqual(["81200", "82200", "84200", "85200"]);
    for (const id of ["evening-strangle-stop-2x", "evening-strangle-stop-3x", "evening-strangle-take-half", "evening-strangle-trail-rest"]) {
      const n = placed(id);
      expect(n.legs.map((l) => `${l.side} ${l.kind} ${l.strike}`)).toEqual(["sell put 82600", "sell call 83800"]);
      expect(n.maxLoss).toBe(-Infinity);
    }
    // a chain too narrow for the wings is no trade
    const narrow: EodDay[] = [{ ...evening[0]!, expiries: evening[0]!.expiries.map((e) => ({ ...e, rows: rows.slice(8, 17) })) }];
    expect(proposalFor(autopilotPlaybookById("evening-strangle-wings-5")!, narrow, base)).toEqual({ ok: false, reason: "noFit" });
  });
});

describe("HC-TR-227 the evening strangle that takes half", () => {
  it("HC-TR-227 the stop-at-double strangle with one more exit: the same structure, window and stop, and a profit take at half the premium", () => {
    const half = autopilotPlaybookById("evening-strangle-take-half")!;
    const twice = autopilotPlaybookById("evening-strangle-stop-2x")!;
    expect(half.clock).toEqual({ ...twice.clock, takeProfitOfCredit: 0.5 });
    expect(twice.clock!.takeProfitOfCredit).toBeUndefined();
    expect(playbookTemplate(half)!.legs).toEqual(playbookTemplate(twice)!.legs);
    expect(half).toMatchObject({ lots: twice.lots, minDte: twice.minDte, assets: twice.assets });
    expect(half.evidence.claim).toContain("closed at half the premium");
  });

  it("HC-TR-228 the trail-the-rest strangle is the stop-at-double one with a trail on what is left after a stop", () => {
    const trail = autopilotPlaybookById("evening-strangle-trail-rest")!;
    const twice = autopilotPlaybookById("evening-strangle-stop-2x")!;
    expect(trail.clock).toEqual({ ...twice.clock, trailRestPct: 50 });
    expect(playbookTemplate(trail)!.legs).toEqual(playbookTemplate(twice)!.legs);
    expect(trail.evidence.claim).toContain("worst day -42");
  });
});

describe("HC-TR-229 the weekly strangles", () => {
  // a weekly ladder 500 apart round 60,000; time value falling away from the money
  const spot = 60_200;
  const ladder = (centre: number): EodRow[] =>
    Array.from({ length: 41 }, (_, i) => {
      const strike = centre + (i - 20) * 500;
      const tv = 1500 * Math.exp(-Math.abs(strike - spot) / 2500);
      return { strike, call: { mark: Math.max(spot - strike, 0) + tv, iv: 0.5 }, put: { mark: Math.max(strike - spot, 0) + tv, iv: 0.5 } };
    });
  const base = { unitsPerLot: 0.001, calendar: cal };
  // Friday 20 November 2026 and Tuesday 24 November 2026, 16:05 UTC; dailies listed for the next days, weeklies on the Fridays
  const day = (iso: string, expiries: string[]): EodDay[] => [{ day: iso, ts: Date.parse(`${iso}T16:05:00Z`), spot, expiries: expiries.map((expiry) => ({ expiry, rows: ladder(60_000) })) }];
  // (a daily on the Thursday before and on the Saturday after the wanted Friday: 5.8 and 7.8 days out, both outside the bounds)
  const friday = day("2026-11-20", ["2026-11-21", "2026-11-22", "2026-11-23", "2026-11-26", "2026-11-27", "2026-11-28", "2026-12-04", "2026-12-25"]);
  const tuesday = day("2026-11-24", ["2026-11-25", "2026-11-26", "2026-11-27", "2026-12-04", "2026-12-25"]);

  it("HC-TR-229 ten weekly playbooks: five exits, each on a Friday and on a Tuesday, BTC on one venue, outside the recorded list", () => {
    expect(WEEKLY_PLAYBOOKS.map((p) => p.id)).toEqual(["fri", "tue"].flatMap((d) => ["wings", "stop-2x", "stop-3x", "take-half", "trail-rest"].map((x) => `weekly-${d}-strangle-${x}`)));
    for (const p of WEEKLY_PLAYBOOKS) {
      const fri = p.id.startsWith("weekly-fri");
      expect(p.clock).toMatchObject({ fromHourUtc: 16, toHourUtc: 17, weekdayUtc: fri ? 5 : 2, maxDte: fri ? 7.5 : 3.5, venues: ["delta_india"] });
      expect(p).toMatchObject({ minDte: fri ? 6.5 : 2.5, lots: 100, assets: ["BTC"], control: false });
      expect(p.clock!.window).toBe(`${fri ? "Friday" : "Tuesday"}s, 9:30 to 10:30 PM IST`);
      expect(p.clock!.describe).toContain(fri ? "each Friday" : "each Tuesday");
      expect(p.trials.note).toContain("in-sample");
      expect(p.evidence.source).toContain("results-weekly-2026-11-22.txt");
      expect(PLAYBOOKS.includes(p)).toBe(false);
      expect(autopilotPlaybookById(p.id)).toBe(p);
    }
    expect(WEEKLY_PLAYBOOKS.map((p) => [p.clock!.legStop, p.clock!.takeProfitOfCredit, p.clock!.trailRestPct]).slice(0, 5)).toEqual([[undefined, undefined, undefined], [2, undefined, undefined], [3, undefined, undefined], [2, 0.5, undefined], [2, undefined, 50]]);
    expect(CLOCK_PLAYBOOKS.every((p) => p.clock!.weekdayUtc === undefined && p.clock!.describe === "once an evening, 9:30 to 10:30 PM IST, on the next expiry")).toBe(true);
    expect(new Set(AUTOPILOT_PLAYBOOKS.map((p) => p.id)).size).toBe(AUTOPILOT_PLAYBOOKS.length);
    expect(AUTOPILOT_PLAYBOOKS).toHaveLength(PLAYBOOKS.filter((p) => !p.control).length + CLOCK_PLAYBOOKS.length + WEEKLY_PLAYBOOKS.length + PREMIUM_PLAYBOOKS.length + MONTHLY_PLAYBOOKS.length + ALT_PLAYBOOKS.length + ALT_MONTHLY_AGAIN_PLAYBOOKS.length + LADDER_DAILY_PLAYBOOKS.length + LADDER_WEEKLY_PLAYBOOKS.length + LAB_DAILY_PLAYBOOKS.length + LAB_WEEKLY_PLAYBOOKS.length + MOVE_DAILY_PLAYBOOKS.length + BUYBACK_DAILY_PLAYBOOKS.length + BUYBACK_SHARE_PLAYBOOKS.length + TAKE90_WEEKLY_PLAYBOOKS.length + TAKE90_DAILY_PLAYBOOKS.length + COMBO_DAILY_PLAYBOOKS.length + TRAIL15_DAILY_PLAYBOOKS.length + TRAIL15_XAUT_PLAYBOOKS.length + ONE_DAY_WEEKLY_PLAYBOOKS.length + CAUTIOUS_DAILY_PLAYBOOKS.length + WINGS_TRAIL_DAILY_PLAYBOOKS.length);
  });

  it("HC-TR-311 one more ETH monthly strangle beside the five: 12 % away, a stop at double, a take at 35 % of the premium after the entry fee, and the same expiry sold again after each take until 7 days before it settles", () => {
    expect(ALT_MONTHLY_AGAIN_PLAYBOOKS.map((p) => p.id)).toEqual(["eth-monthly-strangle-12pct-near-take-35-sell-again"]);
    const p = ALT_MONTHLY_AGAIN_PLAYBOOKS[0]!;
    expect(autopilotPlaybookById(p.id)).toBe(p);
    expect(AUTOPILOT_PLAYBOOKS.at(-1)).toBe(p); // the newest of the list, after everything that was there
    expect(ALT_PLAYBOOKS).not.toContain(p);
    expect(p).toMatchObject({ name: "ETH monthly 12 %, 1 month out, take 35 % and sell again", assets: ["ETH"], lots: 100, minDte: 30, control: false });
    expect(p.name.length).toBeLessThanOrEqual(68);
    expect(playbookCadence(p)).toBe("monthly");
    expect(p.clock).toMatchObject({ cadence: "monthly", oncePerExpiry: true, fromHourUtc: 16, toHourUtc: 17, venues: ["delta_india"], maxDte: 44, legStop: 2, takeProfitOfCredit: 0.35, sellAgain: { minDte: 7, withinHours: 24, maxPerExpiry: 8 }, takeAfterEntryFee: true });
    expect(p.clock!.describe).toBe("on the first evening a month-end expiry is 30 to 44 days out; after each take, again on the same expiry at once, until 7 days before it settles");
    // the same legs as the "take half" one beside it: a call and a put 12 % from the spot
    expect(playbookTemplate(p)!.legs).toEqual(playbookTemplate(autopilotPlaybookById("eth-monthly-strangle-12pct-near-take-half")!)!.legs);
    // what it rests on is said as it is: ten expiries, the research branch, the level chosen after seeing five
    expect(p.evidence.source).toContain("on branch research/exits");
    expect(p.evidence.claim).toContain("+36.60 an expiry on 10 expiries, 6 of them positive (60 %), worst expiry -31");
    expect(p.trials).toMatchObject({ count: 5 });
    expect(p.trials.note).toContain("chosen after seeing all five, on a sample of ten expiries");
    expect(playbookBacktest(p.id)).toMatchObject({ mean: 36.6, per: "expiry", positivePct: 60, worst: -31, samples: 10 });
    // no other playbook sells again or counts its take after a fee: the rest of the list is as it was
    expect(AUTOPILOT_PLAYBOOKS.filter((x) => x.clock?.sellAgain !== undefined || x.clock?.takeAfterEntryFee !== undefined)).toEqual([p]);
    expect(ALT_MONTHLY_PLAYBOOKS).toHaveLength(5);
  });

  it("HC-TR-229 the strikes are the listed ones nearest 3 % (wings 7 %) of the spot away, on the Friday expiry a week out from a Friday and three days out from a Tuesday", () => {
    const placed = (id: string, days: EodDay[]) => {
      const r = proposalFor(autopilotPlaybookById(id)!, days, base);
      if (!r.ok) throw new Error(r.reason);
      return r.proposal;
    };
    // 3 % of 60,200 is 1,806: 58,394 and 62,006, nearest listed 58,500 and 62,000; 7 % is 4,214: 55,986 and 64,414, nearest 56,000 and 64,500
    const fri = placed("weekly-fri-strangle-stop-3x", friday);
    expect(fri.expiry).toBe("2026-11-27"); // not a daily, not the week after
    expect(fri.legs.map((l) => `${l.side} ${l.kind} ${l.strike} x${l.lots}`)).toEqual(["sell put 58500 x100", "sell call 62000 x100"]);
    expect(fri.maxLoss).toBe(-Infinity);
    const wings = placed("weekly-fri-strangle-wings", friday);
    expect(wings.legs.map((l) => `${l.side} ${l.kind} ${l.strike}`)).toEqual(["buy put 56000", "sell put 58500", "sell call 62000", "buy call 64500"]);
    expect(wings.entryCost).toBeLessThan(0);
    expect(Number.isFinite(wings.maxLoss)).toBe(true);
    const tue = placed("weekly-tue-strangle-stop-2x", tuesday);
    expect(tue.expiry).toBe("2026-11-27"); // that week's Friday, three days out
    expect(tue.legs.map((l) => l.strike)).toEqual(["58500", "62000"]);
    // a Friday playbook asked on a day with no expiry a week out takes the next listed one: the engine's upper bound refuses it
    expect(placed("weekly-fri-strangle-stop-2x", day("2026-11-20", ["2026-11-21", "2026-12-25"])).expiry).toBe("2026-12-25");
    // a ladder that does not reach 7 % away has no wing to buy
    const short: EodDay[] = [{ ...friday[0]!, expiries: friday[0]!.expiries.map((e) => ({ ...e, rows: ladder(60_000).slice(15, 26) })) }];
    expect(proposalFor(autopilotPlaybookById("weekly-fri-strangle-wings")!, short, base)).toEqual({ ok: false, reason: "noFit" });
    expect(proposalFor(autopilotPlaybookById("weekly-fri-strangle-stop-2x")!, short, base).ok).toBe(true); // 3 % is on it
  });
});

describe("HC-TR-229 a template strike a percentage of the spot away", () => {
  const rows = [76_000, 77_000, 78_000, 79_000, 80_000, 81_000, 82_000, 83_000, 84_000].map((strike) => ({ strike: String(strike), call: { mark: "100", markIv: 0.4 }, put: { mark: "100", markIv: 0.4 } }));
  const input = { asset: "BTC" as const, expiry: "2026-11-27", expiries: ["2026-11-27"], rows, atm: 4, lots: 1 };
  const tpl = (pct: number) => ({ name: "t", category: "Neutral" as const, description: "t", legs: [{ kind: "call" as const, side: "sell" as const, k: 0, pct }], risk: "undefined" as const });

  it("HC-TR-229 takes the listed strike nearest the spot moved by the percentage; needs a spot; refuses a ladder that does not reach", () => {
    const strike = (pct: number, spot = "80200") => {
      const r = materialiseTemplate(tpl(pct), { ...input, spot });
      return r.ok ? r.legs[0]!.strike : r.reason;
    };
    expect(strike(3)).toBe("83000"); // 82,606: nearer 83,000 than 82,000
    expect(strike(-3)).toBe("78000"); // 77,794
    expect(strike(0)).toBe("80000");
    expect(strike(4.5)).toBe("84000"); // 83,809: the last strike, within its step
    expect(strike(-5)).toBe("76000"); // 76,190: the first strike, within its step
    expect(strike(7)).toBe("out-of-range"); // 85,814 is past the ladder by more than a step
    expect(strike(-8)).toBe("out-of-range"); // 73,784 likewise
    expect(materialiseTemplate(tpl(3), input)).toEqual({ ok: false, reason: "no-spot" });
    // one row is no ladder; two legs on one strike is not the structure (a wing on the strike it protects, a put on the call)
    expect(materialiseTemplate(tpl(3), { ...input, spot: "80200", rows: rows.slice(4, 5) })).toEqual({ ok: false, reason: "out-of-range" });
    const two = (a: number, b: number, kb: "call" | "put" = "call") => ({ ...tpl(a), legs: [{ kind: "call" as const, side: "sell" as const, k: 0, pct: a }, { kind: kb, side: "buy" as const, k: 0, pct: b }] });
    expect(materialiseTemplate(two(3, 3.4), { ...input, spot: "80200" })).toEqual({ ok: false, reason: "out-of-range" }); // 82,606 and 82,927: both 83,000
    expect(materialiseTemplate(two(0.2, -0.2, "put"), { ...input, spot: "80200" })).toEqual({ ok: false, reason: "out-of-range" }); // both 80,000
    expect(materialiseTemplate(two(2, 4), { ...input, spot: "80200" }).ok).toBe(true); // 82,000 and 83,000
    expect(strike(3, "0")).toBe("no-spot");
  });
});

describe("HC-TR-231 a playbook's cadence and its backtest as figures", () => {
  it("HC-TR-231 recorded playbooks trade on a condition, evening ones daily, the Friday and Tuesday ones weekly; a flag makes one monthly", () => {
    expect([...PLAYBOOK_CADENCES]).toEqual(["trend", "daily", "weekly", "monthly"]);
    expect(PLAYBOOKS.every((p) => playbookCadence(p) === "trend")).toBe(true);
    expect(CLOCK_PLAYBOOKS.every((p) => playbookCadence(p) === "daily")).toBe(true);
    expect(WEEKLY_PLAYBOOKS.every((p) => playbookCadence(p) === "weekly")).toBe(true);
    const weekly = WEEKLY_PLAYBOOKS[0]!;
    expect(playbookCadence({ ...weekly, clock: { ...weekly.clock!, cadence: "monthly" } })).toBe("monthly");
  });

  it("HC-TR-231 every playbook entered by the clock has its backtest as numbers, and they are the ones its evidence sentence quotes", () => {
    for (const p of AUTOPILOT_PLAYBOOKS.filter((x) => x.clock)) {
      const b = playbookBacktest(p.id)!;
      expect(b, p.id).toBeDefined();
      // ADR-150: a playbook that sells the same expiry again is counted per expiry (every strangle on it together)
      const again = p.clock!.sellAgain !== undefined;
      expect(b.per).toBe(again ? "expiry" : ({ daily: "day", weekly: "week", monthly: "trade", trend: "" } as const)[playbookCadence(p)]);
      if (playbookCadence(p) === "monthly" && !again) expect(b.basis, p.id).toMatch(new RegExp(`^${b.samples} entry days over 11 expiries, (\\d+) positive$`));
      if (again) expect(b.basis, p.id).toMatch(new RegExp(`^${b.samples} expiries, each with every strangle sold on it counted together \\(2\\.6 on average\\), (\\d+) positive; hourly prices$`));
      if (playbookCadence(p) === "monthly") expect(p.evidence.claim, p.id).toContain(`${b.basis!.match(/, (\d+) positive/)![1]} of them positive`);
      // the mean as the sentence prints it: two decimals, a sign
      expect(p.evidence.claim, p.id).toContain(`${b.mean >= 0 ? "+" : "-"}${Math.abs(b.mean).toFixed(2)} ${b.per === "expiry" ? "an" : "a"} ${b.per}`);
      expect(b.worst, p.id).toBeLessThan(0);
      expect(p.evidence.claim, p.id).toMatch(new RegExp(`worst (day|week|entry|expiry) -${Math.abs(b.worst)}(?![0-9])`));
      expect(p.evidence.claim, p.id).toMatch(new RegExp(`\\b${b.positivePct} %`));
      expect(p.evidence.claim, p.id).toMatch(new RegExp(`on ${b.samples} (days|weeks|entries|expiries)`));
    }
    expect(playbookBacktest("trend-calls")).toBeUndefined();
    // and nothing else has figures: a stale or misspelt key would be an id no playbook has
    for (const p of AUTOPILOT_PLAYBOOKS) expect(playbookBacktest(p.id) !== undefined, p.id).toBe(Boolean(p.clock));
  });
});

describe("HC-TR-233 strikes by premium, and the monthly strangles", () => {
  // marks falling away from the money on both sides of a spot of 80,200
  const rows = Array.from({ length: 21 }, (_, i) => 70_000 + i * 1000).map((strike) => {
    const tv = 3000 * Math.exp(-Math.abs(strike - 80_200) / 4000);
    return { strike: String(strike), call: { mark: String(Math.max(80_200 - strike, 0) + tv), markIv: 0.5 }, put: { mark: String(Math.max(strike - 80_200, 0) + tv), markIv: 0.5 } };
  });
  const input = { asset: "BTC" as const, expiry: "2027-01-29", expiries: ["2027-01-29"], rows, atm: 10, lots: 1, spot: "80200" };
  const sell = (kind: "call" | "put", premium: number) => ({ name: "t", category: "Neutral" as const, description: "t", legs: [{ kind, side: "sell" as const, k: 0, premium }], risk: "undefined" as const });

  it("HC-TR-233 a leg by premium takes the out-of-the-money strike priced nearest it; needs a spot; refuses a premium nothing is priced near", () => {
    const strike = (kind: "call" | "put", premium: number, over: object = {}) => {
      const r = materialiseTemplate(sell(kind, premium), { ...input, ...over });
      return r.ok ? r.legs[0]!.strike : r.reason;
    };
    // 3000 * exp(-d / 4000) = 1000 at d = 4,394: calls from 80,200 up, puts from 80,200 down
    expect(strike("call", 1000)).toBe("85000"); // 4,800 away: 903, nearer 1,000 than 84,000 (1,160)
    expect(strike("put", 1000)).toBe("76000"); // 4,200 away: 1,049
    expect(Number(strike("call", 2500))).toBeGreaterThan(80_200); // never the in-the-money side, however near its price
    expect(Number(strike("put", 2500))).toBeLessThan(80_200);
    expect(strike("call", 20)).toBe("out-of-range"); // the furthest call is still priced 250: not within half of 20
    expect(strike("call", 1000, { spot: undefined })).toBe("no-spot");
    expect(strike("call", 1000, { spot: "95000" })).toBe("out-of-range"); // no call above the spot on this ladder
    // two legs by premium on one strike are refused like two by percentage
    const twice = { ...sell("call", 1000), legs: [{ kind: "call" as const, side: "sell" as const, k: 0, premium: 1000 }, { kind: "call" as const, side: "buy" as const, k: 0, premium: 950 }] };
    expect(materialiseTemplate(twice, input)).toEqual({ ok: false, reason: "out-of-range" });
  });

  it("HC-TR-233 two strangles by premium beside the daily and weekly sets, and three monthly ones entered once per expiry", () => {
    expect(PREMIUM_PLAYBOOKS.map((p) => [p.id, playbookCadence(p)])).toEqual([["evening-strangle-premium-100", "daily"], ["weekly-fri-strangle-premium-200", "weekly"]]);
    expect(MONTHLY_PLAYBOOKS.map((p) => p.id)).toEqual(["monthly-strangle-premium-1000", "monthly-strangle-8pct", "monthly-strangle-12pct-near", "monthly-strangle-12pct-near-stop-2x", "monthly-strangle-12pct-near-stop-3x", "monthly-strangle-12pct-near-trail-rest", "monthly-strangle-12pct-near-wings", "monthly-strangle-12pct-near-wings-stop-3x", "monthly-strangle-12pct-near-wings-take-half", "monthly-strangle-8pct-near-wings-take-half"]);
    for (const p of MONTHLY_PLAYBOOKS) {
      expect(playbookCadence(p)).toBe("monthly");
      expect(p.clock).toMatchObject({ cadence: "monthly", oncePerExpiry: true, fromHourUtc: 16, toHourUtc: 17, venues: ["delta_india"] });
      expect(p.clock!.weekdayUtc).toBeUndefined();
      // held with no stop only where the wings bound the loss, and that one is on paper as a check: its backtest is negative
      if (p.clock!.legStop === undefined) expect([p.id, playbookBacktest(p.id)!.mean < 0, playbookTemplate(p)!.risk]).toEqual(["monthly-strangle-12pct-near-wings", true, "defined"]);
      expect(p).toMatchObject({ lots: 100, assets: ["BTC"], control: false });
      expect(p.trials.note).toContain("in-sample");
    }
    expect(MONTHLY_PLAYBOOKS.map((p) => [p.minDte, p.clock!.maxDte])).toEqual([[60, 75], [60, 75], ...Array.from({ length: 8 }, () => [30, 44])]);
    // the winged ones buy wings half as far again as the strikes they sell
    expect(playbookTemplate(autopilotPlaybookById("monthly-strangle-12pct-near-wings-stop-3x")!)!.legs.map((l) => ("pct" in l ? l.pct : null))).toEqual([-18, -12, 12, 18]);
    expect(autopilotPlaybookById("monthly-strangle-12pct-near-wings-stop-3x")!.clock).toMatchObject({ legStop: 3 });
    expect(autopilotPlaybookById("monthly-strangle-12pct-near-wings-stop-3x")!.clock!.takeProfitOfCredit).toBeUndefined();
    expect(autopilotPlaybookById("monthly-strangle-12pct-near-trail-rest")!.clock).toMatchObject({ legStop: 2, trailRestPct: 50 });
    expect(isMonthEndExpiry("2026-12-25")).toBe(true);
    expect([isMonthEndExpiry("2026-12-18"), isMonthEndExpiry("2026-12-31"), isMonthEndExpiry("2027-01-29"), isMonthEndExpiry("2027-01-22")]).toEqual([false, false, true, false]);
    // the cadences come out in the order of the list: trend, daily, weekly, monthly
    const order = AUTOPILOT_PLAYBOOKS.map(playbookCadence);
    expect(order).toEqual([...order].sort((a, b) => PLAYBOOK_CADENCES.indexOf(a) - PLAYBOOK_CADENCES.indexOf(b)));
  });

  it("HC-TR-233 a monthly playbook places on the month-end expiry in its range: two months out, or one", () => {
    const at = Date.parse("2026-11-22T16:05:00Z");
    const eod: EodRow[] = rows.map((r) => ({ strike: Number(r.strike), call: { mark: Number(r.call.mark), iv: 0.5 }, put: { mark: Number(r.put.mark), iv: 0.5 } }));
    // dailies, a weekly, the December month-end (33 days out) and the January one (68 days out)
    // (and two Fridays that are not month-ends inside the ranges, 2026-12-23 is a Wednesday: none of them is taken)
    const days: EodDay[] = [{ day: "2026-11-22", ts: at, spot: 80_200, expiries: ["2026-11-23", "2026-11-27", "2026-12-23", "2026-12-25", "2027-01-22", "2027-01-29"].map((expiry) => ({ expiry, rows: eod })) }];
    const placed = (id: string) => {
      const r = proposalFor(autopilotPlaybookById(id)!, days, { unitsPerLot: 0.001, calendar: cal });
      if (!r.ok) throw new Error(r.reason);
      return r.proposal;
    };
    const far = placed("monthly-strangle-premium-1000");
    expect(far.expiry).toBe("2027-01-29");
    expect(far.legs.map((l) => `${l.side} ${l.kind} ${l.strike} x${l.lots}`)).toEqual(["sell put 76000 x100", "sell call 85000 x100"]);
    expect(far.entryCost).toBeLessThan(0);
    expect(placed("monthly-strangle-8pct").legs.map((l) => l.strike)).toEqual(["74000", "87000"]); // 73,784 and 86,616
    const near = placed("monthly-strangle-12pct-near");
    expect(near.expiry).toBe("2026-12-25");
    expect(near.legs.map((l) => l.strike)).toEqual(["71000", "90000"]); // 70,576 and 89,824
    // on this ladder nothing is priced near 100: the daily premium strangle has no trade to place
    expect(proposalFor(autopilotPlaybookById("evening-strangle-premium-100")!, days, { unitsPerLot: 0.001, calendar: cal })).toEqual({ ok: false, reason: "noFit" });
  });
});

describe("HC-TR-235 the evening strangles on ETH and XAUT", () => {
  // strikes every 10, time value falling away from the money
  const chain = (spot: number, centre: number, tv0: number, width: number): EodRow[] =>
    Array.from({ length: 61 }, (_, i) => {
      const strike = centre + (i - 30) * 10;
      const tv = tv0 * Math.exp(-Math.abs(strike - spot) / width);
      return { strike, call: { mark: Math.max(spot - strike, 0) + tv, iv: 0.6 }, put: { mark: Math.max(strike - spot, 0) + tv, iv: 0.6 } };
    });
  const evening = (spot: number, rows: EodRow[]): EodDay[] => [{ day: "2026-11-22", ts: Date.parse("2026-11-22T16:05:00Z"), spot, expiries: ["2026-11-22", "2026-11-23", "2026-11-27"].map((expiry) => ({ expiry, rows })) }];
  const placed = (id: string, days: EodDay[], unitsPerLot: number, calendar = cal) => {
    const r = proposalFor(autopilotPlaybookById(id)!, days, { unitsPerLot, calendar });
    if (!r.ok) throw new Error(r.reason);
    return r.proposal;
  };

  it("HC-TR-235 ten playbooks, one coin each, the evening window of the BTC ones, every naked one with a stop", () => {
    expect(ALT_DAILY_PLAYBOOKS.map((p) => p.id)).toEqual([
      "eth-evening-strangle-wings", "eth-evening-strangle-stop-2x", "eth-evening-strangle-stop-3x", "eth-evening-strangle-take-half", "eth-evening-strangle-trail-rest", "eth-evening-strangle-wings-take-half",
      "xaut-evening-strangle-stop-2x", "xaut-evening-strangle-stop-3x", "xaut-evening-strangle-take-half", "xaut-evening-strangle-trail-rest",
    ]);
    expect(ALT_PLAYBOOKS).toEqual([...ALT_DAILY_PLAYBOOKS, ...ALT_WEEKLY_PLAYBOOKS, ...ALT_MONTHLY_PLAYBOOKS]);
    const btc = autopilotPlaybookById("evening-strangle-stop-2x")!.clock!;
    for (const p of ALT_DAILY_PLAYBOOKS) {
      expect(p.assets, p.id).toEqual([p.id.startsWith("eth-") ? "ETH" : "XAUT"]);
      expect(p).toMatchObject({ minDte: 0.5, lots: 100, control: false });
      expect(p.clock).toMatchObject({ fromHourUtc: btc.fromHourUtc, toHourUtc: btc.toHourUtc, maxDte: btc.maxDte, venues: ["delta_india"] });
      expect(playbookCadence(p)).toBe("daily");
      expect(p.evidence.claim.startsWith(`${p.assets[0]}, sold `), p.id).toBe(true);
      expect(p.trials.note).toContain("in-sample");
      expect(PLAYBOOKS.includes(p)).toBe(false);
      expect(autopilotPlaybookById(p.id)).toBe(p);
      // no stop only where bought wings bound the loss
      if (p.clock!.legStop === undefined) expect(playbookTemplate(p)!.risk, p.id).toBe("defined");
      // a strategy opened from it is named "<name> · Autopilot" and a strategy name holds 80 characters (GAPS #153)
      expect(p.name.length, p.id).toBeLessThanOrEqual(68);
    }
  });

  it("HC-TR-235 the strikes are the listed ones a percentage of that coin's spot away, on tomorrow's expiry, sized by that coin's lot", () => {
    // ETH at 2,304: 1 % is 23.04, so 2,280.96 and 2,327.04, nearest listed 2,280 and 2,330
    const eth = evening(2304, chain(2304, 2300, 30, 40));
    const naked = placed("eth-evening-strangle-stop-3x", eth, 0.01);
    expect(naked.expiry).toBe("2026-11-23");
    expect(naked.legs.map((l) => `${l.side} ${l.kind} ${l.strike} x${l.lots}`)).toEqual(["sell put 2280 x100", "sell call 2330 x100"]);
    expect(naked.entryCost).toBeLessThan(0);
    expect(naked.maxLoss).toBe(-Infinity);
    // 1.5 % is 34.56: 2,269.44 and 2,338.56, nearest 2,270 and 2,340; wings 3.75 % is 86.4: 2,217.6 and 2,390.4, nearest 2,220 and 2,390
    const wings = placed("eth-evening-strangle-wings", eth, 0.01);
    expect(wings.legs.map((l) => `${l.side} ${l.kind} ${l.strike}`)).toEqual(["buy put 2220", "sell put 2270", "sell call 2340", "buy call 2390"]);
    expect(wings.entryCost).toBeLessThan(0);
    // the 50 between a sold strike and its wing on 1 ETH, less the credit
    expect(wings.maxLoss).toBeCloseTo(-50 - wings.entryCost, 6);
    // XAUT at 4,203: 1 % is 42.03, so 4,160.97 and 4,245.03, nearest listed 4,160 and 4,250
    const gold = placed("xaut-evening-strangle-stop-2x", evening(4203, chain(4203, 4200, 12, 30)), 0.001);
    expect(gold.expiry).toBe("2026-11-23");
    expect(gold.legs.map((l) => `${l.side} ${l.kind} ${l.strike} x${l.lots}`)).toEqual(["sell put 4160 x100", "sell call 4250 x100"]);
    expect(gold.entryCost).toBeLessThan(0);
  });

  it("HC-TR-235 Gold on its own clock: settling at 16:00 UTC, today's expiry is never taken in the minutes round its settlement, and with no Sunday expiry the Saturday pick is Monday's", () => {
    const xaut = calendarFor(16);
    const rows = chain(4203, 4200, 12, 30);
    const at = (iso: string, expiries: string[]): EodDay[] => [{ day: iso.slice(0, 10), ts: Date.parse(iso), spot: 4203, expiries: expiries.map((expiry) => ({ expiry, rows })) }];
    // Monday 23 November 2026: two minutes before today's expiry settles, and five minutes after, with it still listed
    for (const t of ["2026-11-23T15:58:00Z", "2026-11-23T16:05:00Z"]) {
      const p = placed("xaut-evening-strangle-take-half", at(t, ["2026-11-23", "2026-11-24", "2026-11-27"]), 0.001, xaut);
      expect(p.expiry, t).toBe("2026-11-24");
      expect(daysToExpiryOf(xaut, Date.parse(t), p.expiry), t).toBeGreaterThan(0.99);
      expect(daysToExpiryOf(xaut, Date.parse(t), p.expiry), t).toBeLessThan(1.01);
    }
    // Saturday evening: nothing settles on Sunday, so the nearest expiry far enough out is Monday's, two days away:
    // beyond the playbook's 1.5 days, which is what makes the engine wait (apps/api autopilot.test.ts HC-TR-235)
    const sat = placed("xaut-evening-strangle-take-half", at("2026-11-21T16:05:00Z", ["2026-11-21", "2026-11-23", "2026-11-24"]), 0.001, xaut);
    expect(sat.expiry).toBe("2026-11-23");
    expect(daysToExpiryOf(xaut, Date.parse("2026-11-21T16:05:00Z"), sat.expiry)).toBeGreaterThan(autopilotPlaybookById("xaut-evening-strangle-take-half")!.clock!.maxDte);
    // Sunday evening: Monday's is a day out
    expect(placed("xaut-evening-strangle-take-half", at("2026-11-22T16:05:00Z", ["2026-11-23", "2026-11-24"]), 0.001, xaut).expiry).toBe("2026-11-23");
  });

  it("HC-TR-235 five ETH weekly playbooks on the Friday expiry, four entered on a Friday and one on a Tuesday; none on XAUT", () => {
    expect(ALT_WEEKLY_PLAYBOOKS.map((p) => p.id)).toEqual(["eth-weekly-fri-strangle-wings", "eth-weekly-fri-strangle-stop-2x", "eth-weekly-fri-strangle-stop-3x", "eth-weekly-fri-strangle-take-half", "eth-weekly-tue-strangle-stop-3x"]);
    const btc = { fri: autopilotPlaybookById("weekly-fri-strangle-stop-3x")!, tue: autopilotPlaybookById("weekly-tue-strangle-stop-3x")! };
    for (const p of ALT_WEEKLY_PLAYBOOKS) {
      const like = btc[p.id.includes("-fri-") ? "fri" : "tue"];
      expect(p.assets, p.id).toEqual(["ETH"]);
      expect(p).toMatchObject({ minDte: like.minDte, lots: 100, control: false });
      expect(p.clock).toMatchObject({ fromHourUtc: 16, toHourUtc: 17, weekdayUtc: like.clock!.weekdayUtc, maxDte: like.clock!.maxDte, venues: ["delta_india"] });
      expect(playbookCadence(p)).toBe("weekly");
      expect(p.trials.note).toContain("in-sample");
      expect(autopilotPlaybookById(p.id)).toBe(p);
      if (p.clock!.legStop === undefined) expect(playbookTemplate(p)!.risk, p.id).toBe("defined");
      expect(p.name.length, p.id).toBeLessThanOrEqual(68);
    }
    // ETH at 2,304 on a Friday: 4 % is 92.16, so 2,211.84 and 2,396.16, nearest listed 2,210 and 2,400, on next Friday's expiry
    const rows = chain(2304, 2300, 120, 150);
    const friday: EodDay[] = [{ day: "2026-11-20", ts: Date.parse("2026-11-20T16:05:00Z"), spot: 2304, expiries: ["2026-11-21", "2026-11-22", "2026-11-27", "2026-12-04"].map((expiry) => ({ expiry, rows })) }];
    const fri = placed("eth-weekly-fri-strangle-take-half", friday, 0.01);
    expect(fri.expiry).toBe("2026-11-27");
    expect(fri.legs.map((l) => `${l.side} ${l.kind} ${l.strike} x${l.lots}`)).toEqual(["sell put 2210 x100", "sell call 2400 x100"]);
    // the wings 9.3 % away: 214.27, so 2,089.73 and 2,518.27, nearest listed 2,090 and 2,520
    expect(placed("eth-weekly-fri-strangle-wings", friday, 0.01).legs.map((l) => `${l.side} ${l.kind} ${l.strike}`)).toEqual(["buy put 2090", "sell put 2210", "sell call 2400", "buy call 2520"]);
  });

  it("HC-TR-235 five ETH monthly playbooks: month-end expiries only, once per expiry, every one with a stop; none on XAUT", () => {
    expect(ALT_MONTHLY_PLAYBOOKS.map((p) => p.id)).toEqual(["eth-monthly-strangle-16pct-far-wings-stop-3x", "eth-monthly-strangle-16pct-far-wings-take-half", "eth-monthly-strangle-12pct-near-stop-2x", "eth-monthly-strangle-12pct-near-take-half", "eth-monthly-strangle-12pct-near-wings-stop-3x"]);
    for (const p of ALT_MONTHLY_PLAYBOOKS) {
      expect(p.assets, p.id).toEqual(["ETH"]);
      expect(playbookCadence(p)).toBe("monthly");
      expect(p.clock).toMatchObject({ cadence: "monthly", oncePerExpiry: true, fromHourUtc: 16, toHourUtc: 17, venues: ["delta_india"] });
      expect(p.clock!.legStop, p.id).toBeGreaterThanOrEqual(2);
      expect([p.minDte, p.clock!.maxDte], p.id).toEqual(p.id.includes("-far-") ? [60, 75] : [30, 44]);
      expect(p.trials.note).toContain("in-sample");
      expect(autopilotPlaybookById(p.id)).toBe(p);
      expect(p.name.length, p.id).toBeLessThanOrEqual(68);
    }
    // the winged ones buy wings half as far again as the strikes they sell
    expect(playbookTemplate(autopilotPlaybookById("eth-monthly-strangle-16pct-far-wings-stop-3x")!)!.legs.map((l) => ("pct" in l ? l.pct : null))).toEqual([-24, -16, 16, 24]);
    // ETH at 2,304, 22 November 2026: the month-end expiry 33 days out is 25 December; 12 % is 276.48, so 2,027.52 and 2,580.48, nearest listed 2,030 and 2,580
    const rows = Array.from({ length: 141 }, (_, i) => {
      const strike = 1600 + i * 10;
      const tv = 200 * Math.exp(-Math.abs(strike - 2304) / 300);
      return { strike, call: { mark: Math.max(2304 - strike, 0) + tv, iv: 0.7 }, put: { mark: Math.max(strike - 2304, 0) + tv, iv: 0.7 } };
    });
    const today: EodDay[] = [{ day: "2026-11-22", ts: Date.parse("2026-11-22T16:05:00Z"), spot: 2304, expiries: ["2026-11-23", "2026-11-27", "2026-12-04", "2026-12-25", "2027-01-29"].map((expiry) => ({ expiry, rows })) }];
    const near = placed("eth-monthly-strangle-12pct-near-take-half", today, 0.01);
    expect(near.expiry).toBe("2026-12-25");
    expect(near.legs.map((l) => `${l.side} ${l.kind} ${l.strike} x${l.lots}`)).toEqual(["sell put 2030 x100", "sell call 2580 x100"]);
    // the far ones take the month-end 68 days out: 29 January 2027
    expect(placed("eth-monthly-strangle-16pct-far-wings-stop-3x", today, 0.01).expiry).toBe("2027-01-29");
  });
});

describe("HC-TR-239 Autopilot strategies with a profit ladder (ADR-120)", () => {
  it("HC-TR-239 three playbooks carry the ladder 25 / 50 / 75 with a stop at triple and no single take: BTC and ETH daily, BTC Friday weekly, beside the ones without it", () => {
    const all = [...LADDER_DAILY_PLAYBOOKS, ...LADDER_WEEKLY_PLAYBOOKS];
    expect(all.map((p) => [p.id, p.assets.join(), playbookCadence(p)])).toEqual([["evening-strangle-steps", "BTC", "daily"], ["eth-evening-strangle-steps", "ETH", "daily"], ["weekly-fri-strangle-steps", "BTC", "weekly"]]);
    for (const p of all) {
      expect(p.clock).toMatchObject({ ladder: [25, 50, 75], legStop: 3, fromHourUtc: 16, toHourUtc: 17, venues: ["delta_india"] });
      expect(p.clock!.takeProfitOfCredit, p.id).toBeUndefined();
      expect(p).toMatchObject({ lots: 100, control: false });
      expect(p.trials.note).toContain("in-sample");
      expect(p.trials.note).toContain("after a stop the steps come sooner");
      expect(autopilotPlaybookById(p.id)).toBe(p);
      expect(p.name.length, p.id).toBeLessThanOrEqual(68);
      expect(playbookTemplate(p)!.legs.map((l) => ("pct" in l ? l.pct : null))).toEqual(p.id.startsWith("weekly") ? [-3, 3] : [-1, 1]);
    }
    expect(all[2]!.clock).toMatchObject({ weekdayUtc: 5, maxDte: 7.5 });
    expect(all[2]!.minDte).toBe(6.5);
    // no other playbook has a ladder
    expect(AUTOPILOT_PLAYBOOKS.filter((p) => p.clock?.ladder).map((p) => p.id).sort()).toEqual(all.map((p) => p.id).sort());
  });
});

describe("HC-TR-241 the lab's ideas as strategies of their own (ADR-121)", () => {
  const byId = (id: string) => autopilotPlaybookById(id)!;

  it("HC-TR-241 ten playbooks beside the existing ones: a profit lock (BTC daily and weekly), out by 1:30 AM (BTC, ETH), strikes half as far (BTC, ETH), half then trail (BTC, ETH), ETH with wings at 3 % and an afternoon entry (BTC)", () => {
    expect(LAB_DAILY_PLAYBOOKS.map((p) => `${p.id} ${p.assets.join()}`)).toEqual(["evening-strangle-lock BTC", "evening-strangle-out-early BTC", "eth-evening-strangle-out-early ETH", "evening-strangle-close BTC", "eth-evening-strangle-close ETH", "evening-strangle-half-trail BTC", "eth-evening-strangle-half-trail ETH", "eth-evening-strangle-wings-near ETH", "afternoon-strangle-take-half BTC"]);
    expect(LAB_WEEKLY_PLAYBOOKS.map((p) => `${p.id} ${p.assets.join()}`)).toEqual(["weekly-fri-strangle-lock BTC"]);
    for (const p of [...LAB_DAILY_PLAYBOOKS, ...LAB_WEEKLY_PLAYBOOKS]) {
      expect(p).toMatchObject({ lots: 100, control: false });
      // every one stops each sold option at triple, except the winged one, whose wings bound the loss and which has no stop
      const winged = p.id === "eth-evening-strangle-wings-near";
      expect(p.clock).toMatchObject({ venues: ["delta_india"] });
      expect(p.clock!.legStop, p.id).toBe(winged ? undefined : 3);
      expect(playbookTemplate(p)!.risk, p.id).toBe(winged ? "defined" : "undefined");
      expect(p.trials.note).toContain("in-sample");
      expect(autopilotPlaybookById(p.id)).toBe(p);
      expect(p.name.length, p.id).toBeLessThanOrEqual(68);
    }
    expect(LAB_DAILY_PLAYBOOKS.every((p) => playbookCadence(p) === "daily")).toBe(true);
    expect(playbookCadence(byId("weekly-fri-strangle-lock"))).toBe("weekly");
    // the lock: armed at half the premium, a floor at a quarter, on BTC only, and nothing else that takes profit
    for (const id of ["evening-strangle-lock", "weekly-fri-strangle-lock"]) {
      expect(byId(id).clock).toMatchObject({ lock: { at: 0.5, floor: 0.25 } });
      expect([byId(id).clock!.takeProfitOfCredit, byId(id).clock!.ladder, byId(id).clock!.exitHourUtc]).toEqual([undefined, undefined, undefined]);
    }
    expect(AUTOPILOT_PLAYBOOKS.filter((p) => p.clock?.lock).map((p) => p.id)).toEqual(["evening-strangle-lock", "evening-strangle-lock-buy-back", "weekly-fri-strangle-lock"]); // the middle one is HC-TR-259's
    // out early: 20:00 UTC is 01:30 IST, four hours after the evening window opens
    expect(byId("evening-strangle-out-early").clock).toMatchObject({ exitHourUtc: 20, fromHourUtc: 16, toHourUtc: 17 });
    expect(byId("eth-evening-strangle-out-early").clock!.exitHourUtc).toBe(20);
    // strikes half as far, held with the stop alone
    expect(playbookTemplate(byId("evening-strangle-close"))!.legs.map((l) => ("pct" in l ? l.pct : null))).toEqual([-0.5, 0.5]);
    expect(playbookTemplate(byId("eth-evening-strangle-close"))!.legs.map((l) => ("pct" in l ? l.pct : null))).toEqual([-0.5, 0.5]);
    // half then trail: the level is half the premium and from there a give-back of a fifth of the best
    for (const id of ["evening-strangle-half-trail", "eth-evening-strangle-half-trail"]) expect(byId(id).clock).toMatchObject({ takeProfitOfCredit: 0.5, takeTrailPct: 20, legStop: 3 });
    expect(AUTOPILOT_PLAYBOOKS.filter((p) => p.clock?.takeTrailPct === 20).map((p) => p.id)).toEqual(["evening-strangle-half-trail", "eth-evening-strangle-half-trail", "xaut-evening-strangle-trail-15", "eth-evening-strangle-cautious", "eth-evening-strangle-wings-trail"]); // the Gold trail is HC-TR-262's, the ETH cautious one HC-TR-265's, the winged one HC-TR-266's
    // the winged ETH one: sold 1 % away, wings three times as far
    expect(playbookTemplate(byId("eth-evening-strangle-wings-near"))!.legs.map((l) => ("pct" in l ? l.pct : null))).toEqual([-3, -1, 1, 3]);
    // the afternoon entry: 10:00 to 11:00 UTC on that day's expiry, a quarter per cent away, and the card says the evidence is weak
    const pm = byId("afternoon-strangle-take-half");
    expect(pm.clock).toMatchObject({ fromHourUtc: 10, toHourUtc: 11, maxDte: 0.3, takeProfitOfCredit: 0.5 });
    // the window's last minute is still an hour before the 12:00 UTC settlement: 0.0417 of a day
    expect(pm.minDte).toBe(0.04);
    expect(pm.trials.count).toBe(2150);
    expect(pm.rationale).toContain("One to watch, not a recommendation");
    expect(pm.evidence.claim).toContain("entered 15:30 IST, two hours before settlement");
  });

  it("HC-TR-241 the afternoon entry takes the expiry that settles in two hours, at the listed strikes a quarter per cent away", () => {
    // BTC at 83,200 at 10:05 UTC on 9 October 2026: 0.25 % is 208, so 82,992 and 83,408, nearest listed 83,000 and 83,400
    const rows = Array.from({ length: 61 }, (_, i) => {
      const strike = 83_200 + (i - 30) * 200;
      const tv = 300 * Math.exp(-Math.abs(strike - 83_200) / 400);
      return { strike, call: { mark: Math.max(83_200 - strike, 0) + tv, iv: 0.5 }, put: { mark: Math.max(strike - 83_200, 0) + tv, iv: 0.5 } };
    });
    const days: EodDay[] = [{ day: "2026-10-09", ts: Date.parse("2026-10-09T10:05:00Z"), spot: 83_200, expiries: ["2026-10-09", "2026-10-10"].map((expiry) => ({ expiry, rows })) }];
    const r = proposalFor(byId("afternoon-strangle-take-half"), days, { unitsPerLot: 0.001, calendar: cal });
    if (!r.ok) throw new Error(r.reason);
    expect(r.proposal.expiry).toBe("2026-10-09");
    expect(r.proposal.legs.map((l) => `${l.side} ${l.kind} ${l.strike} x${l.lots}`)).toEqual(["sell put 83000 x100", "sell call 83400 x100"]);
  });
});

describe("HC-TR-242 one side after a move (ADR-122)", () => {
  const byId = (id: string) => autopilotPlaybookById(id)!;

  it("HC-TR-242 the side behind the move: up by more than the threshold the put, down by more than it the call, otherwise both", () => {
    expect(sideAfterMove(101.5, 100, 1).side).toBe("put");
    expect(sideAfterMove(98.5, 100, 1).side).toBe("call");
    expect(sideAfterMove(100.4, 100, 1).side).toBe("both");
    // just inside the threshold is not "more than" it
    expect(sideAfterMove(100.99, 100, 1).side).toBe("both");
    expect(sideAfterMove(99.01, 100, 1).side).toBe("both");
    expect(sideAfterMove(84_500, 83_200, 1).movePct).toBeCloseTo(1.5625, 4);
  });

  it("HC-TR-242 two daily playbooks, BTC and ETH: 24 hours, 1 %, strikes 1 % away, a stop at triple on each sold option and nothing else", () => {
    expect(MOVE_DAILY_PLAYBOOKS.map((p) => `${p.id} ${p.assets.join()}`)).toEqual(["evening-strangle-one-side BTC", "eth-evening-strangle-one-side ETH"]);
    for (const p of MOVE_DAILY_PLAYBOOKS) {
      expect(p).toMatchObject({ lots: 100, control: false, minDte: 0.5 });
      expect(p.clock).toMatchObject({ fromHourUtc: 16, toHourUtc: 17, legStop: 3, moveSide: { hours: 24, pct: 1 }, venues: ["delta_india"] });
      expect([p.clock!.takeProfitOfCredit, p.clock!.ladder, p.clock!.lock, p.clock!.exitHourUtc]).toEqual([undefined, undefined, undefined, undefined]);
      expect(playbookCadence(p)).toBe("daily");
      expect(p.name.length, p.id).toBeLessThanOrEqual(68);
      expect(p.trials.count).toBe(72);
      expect(p.trials.note).toContain("in-sample");
      expect(p.evidence.source).toContain("results-trend-2026-11-22.txt");
      expect(p.rationale).toContain("both sides always");
      expect(playbookTemplate(p)!.legs.map((l) => ("pct" in l ? l.pct : null))).toEqual([-1, 1]);
    }
    expect(AUTOPILOT_PLAYBOOKS.filter((p) => p.clock?.moveSide).map((p) => p.id)).toEqual(["evening-strangle-one-side", "eth-evening-strangle-one-side"]);
    expect(byId("evening-strangle-one-side").evidence.claim).toContain("+10.73 a day on 105 days, 72 % of days positive, worst day -73.4");
  });

  it("HC-TR-242 the proposal holds the put alone after a rise, the call alone after a fall, both after a flat day, and nothing without the earlier spot", () => {
    // BTC at 83,200 at 16:05 UTC on 9 October 2026: 1 % away is 82,368 and 84,032, nearest listed 82,400 and 84,000
    const rows = Array.from({ length: 61 }, (_, i) => {
      const strike = 83_200 + (i - 30) * 200;
      const tv = 300 * Math.exp(-Math.abs(strike - 83_200) / 400);
      return { strike, call: { mark: Math.max(83_200 - strike, 0) + tv, iv: 0.5 }, put: { mark: Math.max(strike - 83_200, 0) + tv, iv: 0.5 } };
    });
    const days: EodDay[] = [{ day: "2026-10-09", ts: Date.parse("2026-10-09T16:05:00Z"), spot: 83_200, expiries: ["2026-10-10", "2026-10-11"].map((expiry) => ({ expiry, rows })) }];
    const p = byId("evening-strangle-one-side");
    const at = (spotBefore?: number | null) => proposalFor(p, days, { unitsPerLot: 0.001, calendar: cal, spotBefore });
    const legs = (spotBefore: number) => {
      const r = at(spotBefore);
      if (!r.ok) throw new Error(r.reason);
      return { legs: r.proposal.legs.map((l) => `${l.side} ${l.kind} ${l.strike} x${l.lots}`), side: r.proposal.move!.side, cost: r.proposal.entryCost, maxLoss: r.proposal.maxLoss };
    };
    const up = legs(82_000); // +1.46 %
    const down = legs(84_500); // -1.54 %
    const flat = legs(83_000); // +0.24 %
    expect([up.side, up.legs]).toEqual(["put", ["sell put 82400 x100"]]);
    expect([down.side, down.legs]).toEqual(["call", ["sell call 84000 x100"]]);
    expect([flat.side, flat.legs]).toEqual(["both", ["sell put 82400 x100", "sell call 84000 x100"]]);
    // the premium is that of what is sold: the two single sides add up to the strangle
    expect(up.cost).toBeLessThan(0);
    expect(up.cost + down.cost).toBeCloseTo(flat.cost, 6);
    // a sold put can lose at most its strike less the premium; a sold call has no such bound
    expect(Number.isFinite(up.maxLoss)).toBe(true);
    expect(Number.isFinite(down.maxLoss)).toBe(false);
    // no spot of 24 hours earlier: no entry, and the reason says so
    for (const none of [undefined, null, 0]) expect(at(none)).toEqual({ ok: false, reason: "noMove" });
    // a playbook without the rule ignores an earlier spot
    const plain = proposalFor(byId("evening-strangle-close"), days, { unitsPerLot: 0.001, calendar: cal, spotBefore: 80_000 });
    expect(plain.ok && plain.proposal.legs.length).toBe(2);
    expect(plain.ok && plain.proposal.move).toBeUndefined();
  });
});

describe("HC-TR-246 the evening strangle that buys a cheap option back (ADR-123)", () => {
  it("HC-TR-246 one BTC daily playbook: strikes 1 % away, a stop at triple and a buy-back at 5 dollars on each sold option; its card says it is protection and not income", () => {
    expect(BUYBACK_DAILY_PLAYBOOKS.map((p) => `${p.id} ${p.assets.join()}`)).toEqual(["evening-strangle-buy-back BTC"]);
    const p = autopilotPlaybookById("evening-strangle-buy-back")!;
    expect(p).toMatchObject({ lots: 100, control: false, minDte: 0.5 });
    expect(p.clock).toMatchObject({ fromHourUtc: 16, toHourUtc: 17, legStop: 3, legBuyBackAt: 5, venues: ["delta_india"] });
    expect([p.clock!.takeProfitOfCredit, p.clock!.ladder, p.clock!.lock, p.clock!.exitHourUtc, p.clock!.moveSide]).toEqual([undefined, undefined, undefined, undefined, undefined]);
    expect(playbookCadence(p)).toBe("daily");
    expect(p.name.length).toBeLessThanOrEqual(68);
    expect(playbookTemplate(p)!.legs.map((l) => ("pct" in l ? l.pct : null))).toEqual([-1, 1]);
    expect(p.trials).toMatchObject({ count: 50 });
    // the note owns up to the one row that did beat holding: 20 % of the entry price, which is not this rule
    expect(p.trials.note).toContain("No fixed price beat holding on BTC daily; a buy-back at 20 % of the entry price did (+13.34 against +11.75)");
    expect(p.evidence.source).toContain("results-cheap-leg-2026-11-22.txt");
    expect(p.evidence.claim).toContain("+11.30 a day on 106 days, 66 % of days positive, worst day -106.3");
    expect(p.rationale).toContain("Protection, not income");
    expect(p.rationale).toContain("often cannot be bought at 5");
    expect(AUTOPILOT_PLAYBOOKS.filter((x) => x.clock?.legBuyBackAt !== undefined).map((x) => x.id)).toEqual(["evening-strangle-buy-back", "evening-strangle-lock-buy-back", "evening-strangle-cautious", "eth-evening-strangle-cautious"]); // the lock one is HC-TR-259's, the cautious pair HC-TR-265's
    expect(p.clock!.legBuyBackShare).toBeUndefined();
  });
});

describe("HC-TR-248 the evening strangle that buys an option back at 20 % of its price (ADR-124)", () => {
  it("HC-TR-248 one BTC daily playbook: a stop at triple and a buy-back at a fifth of the price sold at; its card says it is one good row among poor ones", () => {
    expect(BUYBACK_SHARE_PLAYBOOKS.map((p) => `${p.id} ${p.assets.join()}`)).toEqual(["evening-strangle-buy-back-20pct BTC"]);
    const p = autopilotPlaybookById("evening-strangle-buy-back-20pct")!;
    expect(p).toMatchObject({ lots: 100, control: false, minDte: 0.5 });
    expect(p.clock).toMatchObject({ fromHourUtc: 16, toHourUtc: 17, legStop: 3, legBuyBackShare: 0.2, venues: ["delta_india"] });
    expect([p.clock!.legBuyBackAt, p.clock!.takeProfitOfCredit, p.clock!.ladder, p.clock!.lock, p.clock!.exitHourUtc, p.clock!.moveSide]).toEqual([undefined, undefined, undefined, undefined, undefined, undefined]);
    expect(playbookCadence(p)).toBe("daily");
    expect(p.name.length).toBeLessThanOrEqual(68);
    expect(playbookTemplate(p)!.legs.map((l) => ("pct" in l ? l.pct : null))).toEqual([-1, 1]);
    expect(p.trials.count).toBe(50);
    expect(p.trials.note).toContain("one good cell among poor ones");
    expect(p.evidence.source).toContain("results-cheap-leg-2026-11-22.txt");
    expect(p.evidence.source).toContain("the row at 20 % of its entry price");
    expect(p.evidence.claim).toContain("+13.34 a day on 106 days, 73 % of days positive, worst day -111.4");
    // the card names what argues against the figure: the neighbouring level and the other sets
    expect(p.rationale).toContain("buying back at 10 % instead earned less than holding (+11.12)");
    expect(p.rationale).toContain("ETH daily (+2.84 against +4.46)");
    expect(AUTOPILOT_PLAYBOOKS.filter((x) => x.clock?.legBuyBackShare !== undefined).map((x) => x.id)).toEqual(["evening-strangle-buy-back-20pct"]);
  });
});

describe("HC-TR-249 the BTC Friday weekly closed at 90 % of the premium (ADR-125)", () => {
  it("HC-TR-249 one weekly playbook: 3 % away on the next Friday, a stop at triple on each option and the whole trade closed at 90 % of the premium, through the existing take-profit", () => {
    expect(TAKE90_WEEKLY_PLAYBOOKS.map((p) => `${p.id} ${p.assets.join()}`)).toEqual(["weekly-fri-strangle-take-90 BTC"]);
    const p = autopilotPlaybookById("weekly-fri-strangle-take-90")!;
    const plain = autopilotPlaybookById("weekly-fri-strangle-stop-3x")!;
    expect(p).toMatchObject({ lots: 100, control: false, minDte: plain.minDte });
    // the same Friday window, expiry and strikes as the plain weekly it is compared with
    expect(p.clock).toMatchObject({ fromHourUtc: 16, toHourUtc: 17, weekdayUtc: 5, maxDte: plain.clock!.maxDte, legStop: 3, takeProfitOfCredit: 0.9, venues: ["delta_india"] });
    expect(playbookTemplate(p)!.legs.map((l) => ("pct" in l ? l.pct : null))).toEqual(playbookTemplate(plain)!.legs.map((l) => ("pct" in l ? l.pct : null)));
    expect(playbookTemplate(p)!.legs.map((l) => ("pct" in l ? l.pct : null))).toEqual([-3, 3]);
    expect([p.clock!.takeTrailPct, p.clock!.ladder, p.clock!.lock, p.clock!.exitHourUtc, p.clock!.legBuyBackAt, p.clock!.legBuyBackShare]).toEqual([undefined, undefined, undefined, undefined, undefined, undefined]);
    expect(playbookCadence(p)).toBe("weekly");
    expect(p.name.length).toBeLessThanOrEqual(68);
    expect(p.trials.count).toBe(112);
    // the note gives every level that was tried on this set, the ones that did worse included
    expect(p.trials.note).toContain("+43.58, +44.39, +43.16, +41.28 and +40.26 a week against +40.65 for holding");
    expect(p.evidence.source).toContain("results-cheap-leg-2026-11-22.txt");
    expect(p.evidence.source).toContain("results-tight-2026-11-22.txt");
    expect(p.evidence.claim).toContain("+44.39 a week on 51 weeks, 59 % of weeks positive, worst week -168.3");
    expect(p.rationale).toContain("+40.65 a week, 57 % of weeks");
    expect(p.rationale).toContain("waiting for 99 % earned less than holding (+40.26)");
  });
});

describe("HC-TR-258 the daily strangle closed at 90 % of the premium or trailed from it (ADR-129)", () => {
  it("HC-TR-258 four daily playbooks beside the others: BTC and ETH, 1 % away with a stop at triple, the whole trade closed at 90 % of the premium or trailed from there with a give-back of 5 %", () => {
    expect(TAKE90_DAILY_PLAYBOOKS.map((p) => `${p.id} ${p.assets.join()}`)).toEqual(["evening-strangle-take-90 BTC", "evening-strangle-trail-90 BTC", "eth-evening-strangle-take-90 ETH", "eth-evening-strangle-trail-90 ETH"]);
    const plain = autopilotPlaybookById("evening-strangle-half-trail")!;
    for (const p of TAKE90_DAILY_PLAYBOOKS) {
      expect(autopilotPlaybookById(p.id)).toBe(p);
      expect(p).toMatchObject({ lots: 100, control: false, minDte: plain.minDte });
      // the same evening window, expiry and strikes as the daily strangle it is compared with
      expect(p.clock).toMatchObject({ fromHourUtc: plain.clock!.fromHourUtc, toHourUtc: plain.clock!.toHourUtc, maxDte: plain.clock!.maxDte, describe: plain.clock!.describe, legStop: 3, takeProfitOfCredit: 0.9 });
      expect(p.clock!.weekdayUtc).toBeUndefined();
      expect(playbookTemplate(p)!.legs.map((l) => ("pct" in l ? l.pct : null))).toEqual([-1, 1]);
      expect([p.clock!.ladder, p.clock!.lock, p.clock!.exitHourUtc, p.clock!.legBuyBackAt, p.clock!.legBuyBackShare, p.clock!.trailRestPct]).toEqual([undefined, undefined, undefined, undefined, undefined, undefined]);
      expect(playbookCadence(p)).toBe("daily");
      expect(p.name.length).toBeLessThanOrEqual(68);
      expect(p.trials.count).toBe(12);
      expect(p.trials.note).toContain("No row can be told from another");
      expect(p.evidence.source).toContain("results-trail-from-90-2026-11-23.txt");
    }
    const byId = (id: string) => autopilotPlaybookById(id)!;
    // closing has no trail; the trail gives back 5 % of the best, and is the only one that tight
    expect(["evening-strangle-take-90", "eth-evening-strangle-take-90"].map((id) => byId(id).clock!.takeTrailPct)).toEqual([undefined, undefined]);
    expect(AUTOPILOT_PLAYBOOKS.filter((p) => p.clock?.takeTrailPct === 5).map((p) => p.id)).toEqual(["evening-strangle-trail-90", "eth-evening-strangle-trail-90"]);
    // the cards say what the study found, the rows that did worse than holding included
    expect(byId("evening-strangle-take-90").evidence.claim).toContain("+10.99 a day on 106 days, 66 % of days positive, worst day -105.8");
    expect(byId("evening-strangle-take-90").rationale).toContain("a little less than holding to settlement (+11.75 a day, 65 % of days)");
    expect(byId("evening-strangle-trail-90").evidence.claim).toContain("+11.23 a day on 106 days, 66 % of days positive, worst day -105.8");
    expect(byId("evening-strangle-trail-90").rationale).toContain("At 90 % the exit level is 85.5 % of the premium");
    expect(byId("eth-evening-strangle-take-90").evidence.claim).toContain("+4.57 a day on 106 days, 62 % of days positive, worst day -49.6");
    expect(byId("eth-evening-strangle-trail-90").evidence.claim).toContain("+4.22 a day on 106 days, 62 % of days positive, worst day -49.6");
    expect(byId("eth-evening-strangle-trail-90").rationale).toContain("less than closing at 90 % (+4.57) and than holding to settlement (+4.46)");
    expect(TAKE90_DAILY_PLAYBOOKS.map((p) => playbookBacktest(p.id)?.mean)).toEqual([10.99, 11.23, 4.57, 4.22]);
    // the weekly one it follows now says the daily one exists
    expect(byId("weekly-fri-strangle-take-90").rationale).toContain("it was built there later, beside a trail from 90 %");
  });
});

describe("HC-TR-259 the BTC evening strangle with the profit lock and the buy-back at 5 dollars together (ADR-130)", () => {
  it("HC-TR-259 one daily playbook: 1 % away, a stop at triple and a buy-back at 5 dollars on each option, and the lock 50 > 25 on the whole trade; the same lock and the same buy-back as the two it combines", () => {
    expect(COMBO_DAILY_PLAYBOOKS.map((p) => `${p.id} ${p.assets.join()}`)).toEqual(["evening-strangle-lock-buy-back BTC"]);
    const p = autopilotPlaybookById("evening-strangle-lock-buy-back")!;
    const lock = autopilotPlaybookById("evening-strangle-lock")!;
    const buyBack = autopilotPlaybookById("evening-strangle-buy-back")!;
    expect(p).toMatchObject({ lots: 100, control: false, minDte: lock.minDte });
    expect(p.clock).toMatchObject({ fromHourUtc: lock.clock!.fromHourUtc, toHourUtc: lock.clock!.toHourUtc, maxDte: lock.clock!.maxDte, describe: lock.clock!.describe, legStop: 3 });
    expect(p.clock!.lock).toEqual(lock.clock!.lock);
    expect(p.clock!.lock).toEqual({ at: 0.5, floor: 0.25 });
    expect(p.clock!.legBuyBackAt).toBe(buyBack.clock!.legBuyBackAt);
    expect(p.clock!.legBuyBackAt).toBe(5);
    expect(playbookTemplate(p)!.legs.map((l) => ("pct" in l ? l.pct : null))).toEqual([-1, 1]);
    expect([p.clock!.takeProfitOfCredit, p.clock!.takeTrailPct, p.clock!.ladder, p.clock!.exitHourUtc, p.clock!.legBuyBackShare, p.clock!.trailRestPct, p.clock!.weekdayUtc]).toEqual([undefined, undefined, undefined, undefined, undefined, undefined, undefined]);
    expect(playbookCadence(p)).toBe("daily");
    expect(p.name.length).toBeLessThanOrEqual(68);
    expect(p.trials.count).toBe(28);
    expect(p.trials.note).toContain("this one is 0.34 a day under the lock alone");
    expect(p.evidence.source).toContain("results-combo-2026-11-22.txt");
    expect(p.evidence.claim).toContain("+11.34 a day on 106 days, 71 % of days positive, worst day -69.6");
    // the card says it is behind the lock alone, and names the better row that was not built
    expect(p.rationale).toContain("less than the lock alone (+11.68 a day, worst day -69.2)");
    expect(p.rationale).toContain("a buy-back at 20 % of the price sold at earned more (+12.66) and is not built");
    expect(playbookBacktest(p.id)).toMatchObject({ mean: 11.34, per: "day", positivePct: 71, worst: -69.6, samples: 106 });
  });
});

describe("HC-TR-261 the daily strangle trailed from 15 % of the premium (ADR-132)", () => {
  it("HC-TR-261 two daily playbooks beside the others: BTC and ETH, 1 % away with a stop at triple, trailed from 15 % of the premium with a give-back of 30 % of the best", () => {
    expect(TRAIL15_DAILY_PLAYBOOKS.map((p) => `${p.id} ${p.assets.join()}`)).toEqual(["evening-strangle-trail-15 BTC", "eth-evening-strangle-trail-15 ETH"]);
    const plain = autopilotPlaybookById("evening-strangle-half-trail")!;
    for (const p of TRAIL15_DAILY_PLAYBOOKS) {
      expect(autopilotPlaybookById(p.id)).toBe(p);
      expect(p).toMatchObject({ lots: 100, control: false, minDte: plain.minDte });
      expect(p.clock).toMatchObject({ fromHourUtc: plain.clock!.fromHourUtc, toHourUtc: plain.clock!.toHourUtc, maxDte: plain.clock!.maxDte, describe: plain.clock!.describe, legStop: 3, takeProfitOfCredit: 0.15, takeTrailPct: 30 });
      expect(p.clock!.weekdayUtc).toBeUndefined();
      expect(playbookTemplate(p)!.legs.map((l) => ("pct" in l ? l.pct : null))).toEqual([-1, 1]);
      expect([p.clock!.ladder, p.clock!.lock, p.clock!.exitHourUtc, p.clock!.legBuyBackAt, p.clock!.legBuyBackShare, p.clock!.trailRestPct]).toEqual([undefined, undefined, undefined, undefined, undefined, undefined]);
      expect(playbookCadence(p)).toBe("daily");
      expect(p.name.length).toBeLessThanOrEqual(68);
      expect(p.trials.count).toBe(16);
      expect(p.trials.note).toContain("Every row earned less than holding on both coins");
      expect(p.trials.note).toContain("up to about 8 % of the premium");
      expect(p.evidence.source).toContain("results-trail-from-15-2026-11-23.txt");
    }
    // the only playbooks that start a trail this early or give this much back
    expect(AUTOPILOT_PLAYBOOKS.filter((p) => p.clock?.takeTrailPct === 30).map((p) => p.id)).toEqual(["evening-strangle-trail-15", "eth-evening-strangle-trail-15", "evening-strangle-cautious"]);
    expect(AUTOPILOT_PLAYBOOKS.filter((p) => p.clock?.takeProfitOfCredit === 0.15).map((p) => p.id)).toEqual(["evening-strangle-trail-15", "eth-evening-strangle-trail-15", "xaut-evening-strangle-trail-15"]); // Gold's is HC-TR-262's
    const byId = (id: string) => autopilotPlaybookById(id)!;
    // the cards say what it costs: a third of holding on BTC, two thirds on ETH, and that the ETH worst day is no better
    expect(byId("evening-strangle-trail-15").evidence.claim).toContain("+4.21 a day on 106 days, 78 % of days positive, worst day -37.5");
    expect(byId("evening-strangle-trail-15").rationale).toContain("about a third of holding to settlement (+11.75 a day, 65 % of days)");
    expect(byId("evening-strangle-trail-15").rationale).toContain("starting the trail at 25 % with the same give-back earned more (+6.34, worst day -50.5) and is not built");
    expect(byId("eth-evening-strangle-trail-15").evidence.claim).toContain("+2.97 a day on 106 days, 86 % of days positive, worst day -44.6");
    expect(byId("eth-evening-strangle-trail-15").rationale).toContain("The worst day is about the same as holding's (-49.6)");
    expect(TRAIL15_DAILY_PLAYBOOKS.map((p) => playbookBacktest(p.id))).toMatchObject([{ mean: 4.21, per: "day", positivePct: 78, worst: -37.5, samples: 106 }, { mean: 2.97, per: "day", positivePct: 86, worst: -44.6, samples: 106 }]);
  });
});

describe("HC-TR-262 the Gold daily strangle trailed from 15 % of the premium (ADR-133)", () => {
  it("HC-TR-262 one playbook at Gold's own entry, strikes and stop at double, trailed from 15 % with a give-back of 20 %, from the table at the hour it is traded", () => {
    expect(TRAIL15_XAUT_PLAYBOOKS.map((p) => `${p.id} ${p.assets.join()}`)).toEqual(["xaut-evening-strangle-trail-15 XAUT"]);
    const p = autopilotPlaybookById("xaut-evening-strangle-trail-15")!;
    const gold = autopilotPlaybookById("xaut-evening-strangle-stop-2x")!;
    expect(p.name).toBe("Gold evening strangle, trail from 15 %");
    expect(p).toMatchObject({ lots: gold.lots, control: false, minDte: gold.minDte, template: gold.template });
    // Gold's own window, expiry and stop; only the take and its trail are new, and the give-back is not BTC's 30
    expect(p.clock).toEqual({ ...gold.clock, takeProfitOfCredit: 0.15, takeTrailPct: 20 });
    expect(p.clock!.legStop).toBe(2);
    expect(playbookCadence(p)).toBe("daily");
    expect(p.summary).toContain("Each evening sell a Gold call and put 1 % away on the next expiry");
    expect(p.summary).toContain("gives back 20 % of its best");
    expect(p.trials.count).toBe(48);
    expect(p.trials.note).toContain("At this hour it earned less than holding (+0.15 against +0.19 a day)");
    // the table at the hour Autopilot enters Gold, not the first one, which was an hour late
    expect(p.evidence.source).toContain("results-trail-from-15-XAUT-24h-2026-11-23.txt");
    expect(p.evidence.source).toContain("entered 24 hours before the settlement as this strategy is");
    expect(p.evidence.claim).toContain("a day before its settlement");
    expect(p.evidence.claim).toContain("+0.15 a day on 91 days, 82 % of days positive, worst day -1.4");
    // the card says it costs income, that the money is cents, and names the better row that was not chosen
    expect(p.rationale).toContain("It costs a little income");
    expect(p.rationale).toContain("about 14 dollars over 91 days at 100 lots");
    expect(p.rationale).toContain("a trail started at 50 % of the premium earned more than holding (+0.23) and is not built");
    expect(playbookBacktest(p.id)).toMatchObject({ mean: 0.15, per: "day", positivePct: 82, worst: -1.4, samples: 91 });
    // BTC and ETH keep their own give-back
    expect(AUTOPILOT_PLAYBOOKS.filter((x) => x.clock?.takeTrailPct === 30).map((x) => x.id)).toEqual(["evening-strangle-trail-15", "eth-evening-strangle-trail-15", "evening-strangle-cautious"]);
  });
});

describe("HC-TR-263 the Friday weekly strangle held for its first day only (ADR-134)", () => {
  it("HC-TR-263 two weekly playbooks beside the others: the BTC and the ETH Friday strangle at their own distances, a stop at triple, and everything closed at 12:00 UTC, which after a Friday evening entry is Saturday 5:30 PM IST", () => {
    expect(ONE_DAY_WEEKLY_PLAYBOOKS.map((p) => `${p.id} ${p.assets.join()}`)).toEqual(["weekly-fri-strangle-one-day BTC", "eth-weekly-fri-strangle-one-day ETH"]);
    const byId = (id: string) => autopilotPlaybookById(id)!;
    for (const [id, plainId, pct] of [["weekly-fri-strangle-one-day", "weekly-fri-strangle-stop-3x", 3], ["eth-weekly-fri-strangle-one-day", "eth-weekly-fri-strangle-stop-3x", 4]] as const) {
      const p = byId(id);
      const plain = byId(plainId);
      expect(autopilotPlaybookById(id)).toBe(ONE_DAY_WEEKLY_PLAYBOOKS.find((x) => x.id === id));
      // the same Friday window, expiry and strikes as the weekly strangle it is the first day of; only the timed exit is new
      expect(p.clock).toEqual({ ...plain.clock, exitHourUtc: 12 });
      expect(p.clock).toMatchObject({ fromHourUtc: 16, toHourUtc: 17, weekdayUtc: 5, legStop: 3 });
      expect(p.clock!.exitHourUtc! < p.clock!.fromHourUtc).toBe(true); // an hour of the next day, not of the entry day
      expect(p).toMatchObject({ lots: 100, control: false, minDte: plain.minDte });
      expect(playbookTemplate(p)!.legs.map((l) => ("pct" in l ? l.pct : null))).toEqual([-pct, pct]);
      expect(playbookTemplate(p)!.legs.map((l) => ("pct" in l ? l.pct : null))).toEqual(playbookTemplate(plain)!.legs.map((l) => ("pct" in l ? l.pct : null)));
      expect(playbookCadence(p)).toBe("weekly");
      expect(p.name.length).toBeLessThanOrEqual(68);
      expect(p.trials.count).toBe(108);
      expect(p.trials.note).toContain("not whether the price can be had");
      expect(p.evidence.source).toContain("results-weekly-one-day-2026-11-24.txt");
      expect(p.summary).toContain("Saturday at 5:30 PM IST");
    }
    expect(byId("weekly-fri-strangle-one-day").name).toBe("Friday weekly strangle, one day");
    expect(byId("eth-weekly-fri-strangle-one-day").name).toBe("ETH Friday weekly strangle, one day");
    // the cards give the result and the three reasons to distrust it
    expect(byId("weekly-fri-strangle-one-day").evidence.claim).toContain("+15.63 a week on 51 weeks, 88 % of weeks positive, worst week -63.0");
    expect(byId("weekly-fri-strangle-one-day").rationale).toContain("the same one-day hold started on Saturday lost (-5.65 a week), on Sunday lost (-2.99) and on Monday earned about half (+8.05)");
    expect(byId("weekly-fri-strangle-one-day").rationale).toContain("sold two hours after the entry window it earned +8.92, four hours after +3.30, and eight hours after it lost (-1.30)");
    expect(byId("weekly-fri-strangle-one-day").rationale).toContain("It is one of the best of 108 rows");
    expect(byId("eth-weekly-fri-strangle-one-day").rationale).toContain("a hold of 8 hours earned +6.05 and of 12 hours +7.17");
    expect(byId("weekly-fri-strangle-one-day").rationale).toContain("Half of the gain came in the first four hours (+7.89)");
    expect(byId("eth-weekly-fri-strangle-one-day").evidence.claim).toContain("+6.77 a week on 51 weeks, 80 % of weeks positive, worst week -18.3");
    expect(byId("eth-weekly-fri-strangle-one-day").rationale).toContain("Started on Saturday the same hold lost (-1.82 a week)");
    expect(ONE_DAY_WEEKLY_PLAYBOOKS.map((p) => playbookBacktest(p.id))).toMatchObject([{ mean: 15.63, per: "week", positivePct: 88, worst: -63, samples: 51 }, { mean: 6.77, per: "week", positivePct: 80, worst: -18.3, samples: 51 }]);
    // the only weekly playbooks with a timed exit; the daily ones keep 20:00 UTC
    expect(AUTOPILOT_PLAYBOOKS.filter((p) => p.clock?.exitHourUtc !== undefined).map((p) => `${p.id} ${p.clock!.exitHourUtc}`)).toEqual(["evening-strangle-out-early 20", "eth-evening-strangle-out-early 20", "weekly-fri-strangle-one-day 12", "eth-weekly-fri-strangle-one-day 12"]);
  });
});

describe("HC-TR-265 the cautious daily strangles (ADR-136)", () => {
  it("HC-TR-265 two daily playbooks beside the others: strikes further away, a stop at double, each option bought back when nearly worthless, and the whole trade trailed, each coin with its own numbers", () => {
    expect(CAUTIOUS_DAILY_PLAYBOOKS.map((p) => `${p.id} ${p.assets.join()}`)).toEqual(["evening-strangle-cautious BTC", "eth-evening-strangle-cautious ETH"]);
    const plain = autopilotPlaybookById("evening-strangle-half-trail")!;
    const byId = (id: string) => autopilotPlaybookById(id)!;
    for (const [id, pct, clock] of [
      ["evening-strangle-cautious", 1.5, { legStop: 2, legBuyBackAt: 5, takeProfitOfCredit: 0.25, takeTrailPct: 30 }],
      ["eth-evening-strangle-cautious", 2, { legStop: 2, legBuyBackAt: 0.25, takeProfitOfCredit: 0.5, takeTrailPct: 20 }],
    ] as const) {
      const p = byId(id);
      expect(p).toBe(CAUTIOUS_DAILY_PLAYBOOKS.find((x) => x.id === id));
      expect(p).toMatchObject({ lots: 100, control: false, minDte: plain.minDte });
      // the daily strangle's own window and expiry; the stop, the buy-back and the trailing take, and nothing else
      expect(p.clock).toMatchObject({ fromHourUtc: plain.clock!.fromHourUtc, toHourUtc: plain.clock!.toHourUtc, maxDte: plain.clock!.maxDte, describe: plain.clock!.describe, ...clock });
      expect([p.clock!.ladder, p.clock!.lock, p.clock!.exitHourUtc, p.clock!.legBuyBackShare, p.clock!.trailRestPct, p.clock!.weekdayUtc, p.clock!.moveSide]).toEqual([undefined, undefined, undefined, undefined, undefined, undefined, undefined]);
      expect(playbookTemplate(p)!.legs.map((l) => ("pct" in l ? l.pct : null))).toEqual([-pct, pct]);
      expect(playbookCadence(p)).toBe("daily");
      expect(p.name.length).toBeLessThanOrEqual(68);
      expect(p.trials.count).toBe(162);
      expect(p.trials.note).toContain("rows with smaller losses existed and earned less");
      expect(p.trials.note).toContain("no cap as bought wings would give");
      expect(p.evidence.source).toContain("results-stack-slippage-2026-11-24.txt");
      expect(p.evidence.source).toContain("results-stack-2026-11-24.txt"); // and the same rows filled at the mark
      expect(p.trials.note).toContain("filled at the mark, as the lab's earlier tables and the other cards are, the same two rows read +5.30 and +2.59 a day");
    }
    // the cards say what it costs and that it still loses
    const btc = byId("evening-strangle-cautious");
    expect(btc.evidence.claim).toContain("sold 1.5 % away");
    expect(btc.evidence.claim).toContain("+4.12 a day on 108 days, 78 % of days positive, worst day -22.9, with fill costs");
    expect(btc.rationale).toContain("about a third of the 1 % strangle with the stop at triple (+11.63 a day, worst day -108.3, drawdown -189.7)");
    expect(btc.rationale).toContain("its drawdown was -42.2");
    expect(btc.rationale).toContain("Filled at the mark, as the other cards' figures are, the same row reads better: +5.30 a day, 81 % of days, a drawdown of -21.6");
    expect(btc.rationale).toContain("It is not a strategy without losses: about one day in five was not positive");
    // and how its exits meet: the buy-back did nothing on BTC, and a stop ends the trail's chance
    expect(btc.rationale).toContain("The buy-back made no measurable difference on BTC in the study (the same trade without it earned +4.19)");
    expect(btc.rationale).toContain("once an option has been stopped the trail can no longer start");
    const eth = byId("eth-evening-strangle-cautious");
    expect(eth.evidence.claim).toContain("sold 2 % away");
    expect(eth.evidence.claim).toContain("+2.28 a day on 108 days, 61 % of days positive, worst day -22.7, with fill costs");
    expect(eth.rationale).toContain("about two days in five were not positive");
    expect(eth.rationale).toContain("The fill cost is measured mostly on BTC orders and assumed for ETH");
    expect(eth.rationale).toContain("here the buy-back helped a little (+1.97 without it)");
    expect(eth.summary).toContain("its quoted price has fallen to 0.25 dollars");
    expect(CAUTIOUS_DAILY_PLAYBOOKS.map((p) => playbookBacktest(p.id))).toMatchObject([{ mean: 4.12, per: "day", positivePct: 78, worst: -22.9, samples: 108 }, { mean: 2.28, per: "day", positivePct: 61, worst: -22.7, samples: 108 }]);
    // the only playbooks that carry a stop, a buy-back and a trail on the whole trade together
    expect(AUTOPILOT_PLAYBOOKS.filter((p) => p.clock?.legBuyBackAt !== undefined && p.clock.takeTrailPct !== undefined).map((p) => p.id)).toEqual(["evening-strangle-cautious", "eth-evening-strangle-cautious"]);
  });
});

describe("HC-TR-266 the ETH daily strangle with wings and the trail alone (ADR-138)", () => {
  const chain = (spot: number, centre: number, tv0: number, width: number): EodRow[] =>
    Array.from({ length: 61 }, (_, i) => {
      const strike = centre + (i - 30) * 10;
      const tv = tv0 * Math.exp(-Math.abs(strike - spot) / width);
      return { strike, call: { mark: Math.max(spot - strike, 0) + tv, iv: 0.5 }, put: { mark: Math.max(strike - spot, 0) + tv, iv: 0.5 } };
    });
  const evening = (spot: number, rows: EodRow[]): EodDay[] => [{ day: "2026-11-22", ts: Date.parse("2026-11-22T16:05:00Z"), spot, expiries: ["2026-11-22", "2026-11-23", "2026-11-27"].map((expiry) => ({ expiry, rows })) }];
  const p = autopilotPlaybookById("eth-evening-strangle-wings-trail")!;

  it("HC-TR-266 one daily ETH playbook beside the others: sold 2 % away, wings 4 % away, no stop and no buy-back, the whole trade trailed from half the net premium with a give-back of a fifth", () => {
    expect(WINGS_TRAIL_DAILY_PLAYBOOKS.map((x) => `${x.id} ${x.assets.join()}`)).toEqual(["eth-evening-strangle-wings-trail ETH"]);
    expect(WINGS_TRAIL_DAILY_PLAYBOOKS[0]).toBe(p);
    const plain = autopilotPlaybookById("eth-evening-strangle-half-trail")!;
    expect(p).toMatchObject({ lots: 100, control: false, minDte: plain.minDte, name: "ETH evening strangle, wings and a trail" });
    // the daily strangle's own window and expiry; the trailing take and nothing else
    expect(p.clock).toMatchObject({ fromHourUtc: plain.clock!.fromHourUtc, toHourUtc: plain.clock!.toHourUtc, maxDte: plain.clock!.maxDte, describe: plain.clock!.describe, takeProfitOfCredit: 0.5, takeTrailPct: 20 });
    expect([p.clock!.legStop, p.clock!.legBuyBackAt, p.clock!.legBuyBackShare, p.clock!.ladder, p.clock!.lock, p.clock!.exitHourUtc, p.clock!.trailRestPct, p.clock!.weekdayUtc, p.clock!.moveSide]).toEqual([undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined]);
    expect(playbookTemplate(p)!.legs.map((l) => ("pct" in l ? l.pct : null))).toEqual([-4, -2, 2, 4]);
    expect(playbookTemplate(p)!.risk).toBe("defined");
    expect(playbookCadence(p)).toBe("daily");
    expect(p.name.length).toBeLessThanOrEqual(68);
    // the only playbook that trails the whole trade with no stop on its sold options
    expect(AUTOPILOT_PLAYBOOKS.filter((x) => x.clock?.takeTrailPct !== undefined && x.clock.legStop === undefined).map((x) => x.id)).toEqual(["eth-evening-strangle-wings-trail"]);
  });

  it("HC-TR-266 the card quotes the row with fill costs, the same row at the mark, what the wings cost and that it still loses", () => {
    expect(p.evidence.claim).toContain("ETH, sold 2 % away");
    expect(p.evidence.claim).toContain("wings 4 % away, no stop");
    expect(p.evidence.claim).toContain("+2.30 a day on 105 days, 90 % of days positive, worst day -34.0, with fill costs");
    expect(p.evidence.source).toContain("results-wings-stack-slippage-2026-11-24.txt");
    expect(p.evidence.source).toContain("results-wings-stack-2026-11-24.txt"); // and the same row filled at the mark
    expect(p.trials.count).toBe(38);
    expect(p.trials.note).toContain("this one was chosen after seeing them");
    expect(p.trials.note).toContain("its distance and its trail were themselves taken from the 162-row table of the cautious strangles on the same days");
    expect(p.rationale).toContain("The figures are after fees and the paper record is before them");
    expect(p.trials.note).toContain("2 had no priced wing, 1 no net premium");
    expect(p.trials.note).toContain("nothing in the study shows one can be bought at that price");
    expect(p.rationale).toContain("the most it could have lost on any day was 58.2 (41.5 on average)");
    expect(p.rationale).toContain("The same trade without wings earned +2.95 with a worst day of -77.6 and no cap");
    expect(p.rationale).toContain("It is not a strategy without losses: on 5 of the 105 days it lost more than a quarter of its net premium");
    expect(p.rationale).toContain("Filled at the mark, as the other cards' figures are, the same row reads +2.80 a day, 95 % of days, worst day -33.7");
    expect(p.rationale).toContain("assumed for ETH");
    expect(p.summary).toContain("half the net premium (collected less what the wings cost)");
    expect(playbookBacktest(p.id)).toMatchObject({ mean: 2.3, per: "day", positivePct: 90, worst: -34, samples: 105 });
  });

  it("HC-TR-266 the strikes are the listed ones nearest 2 % and 4 % of the spot away on tomorrow's expiry, for a net credit and a bounded loss; a ladder that does not reach the wings is no trade", () => {
    const base = { unitsPerLot: 0.01, calendar: cal };
    // ETH at 2,304: 2 % is 46.08, so 2,257.92 and 2,350.08, nearest 2,260 and 2,350; 4 % is 92.16: 2,211.84 and 2,396.16, nearest 2,210 and 2,400
    const r = proposalFor(p, evening(2304, chain(2304, 2300, 30, 40)), base);
    if (!r.ok) throw new Error(r.reason);
    expect(r.proposal.expiry).toBe("2026-11-23");
    expect(r.proposal.legs.map((l) => `${l.side} ${l.kind} ${l.strike} x${l.lots}`)).toEqual(["buy put 2210 x100", "sell put 2260 x100", "sell call 2350 x100", "buy call 2400 x100"]);
    expect(r.proposal.entryCost).toBeLessThan(0);
    // the 50 between a sold strike and its wing on 1 ETH, less the net credit
    expect(r.proposal.maxLoss).toBeCloseTo(-50 - r.proposal.entryCost, 6);
    const short = chain(2304, 2300, 30, 40).filter((x) => x.strike >= 2240 && x.strike <= 2370);
    expect(proposalFor(p, evening(2304, short), base)).toEqual({ ok: false, reason: "noFit" });
  });
});
