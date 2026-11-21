// Playbooks as data (ADR-101; HC-TR-205): every playbook places on a ladder, the status rules read a record against the
// thresholds (the control inverted), losing years come from the closed trades, and the options carry the plan.
import { describe, expect, it } from "vitest";
import { type BacktestFold, type BacktestStats, type BacktestTrade, type EodDay, type EodRow, runBacktest } from "./backtest.js";
import { calendarFor } from "./calendar.js";
import { AUTOPILOT_PLAYBOOKS, CLOCK_PLAYBOOKS, HERO_OR_ZERO_TEMPLATE, MONTHLY_PLAYBOOKS, isMonthEndExpiry, PLAYBOOKS, PLAYBOOK_CADENCES, PREMIUM_PLAYBOOKS, WEEKLY_PLAYBOOKS, playbookBacktest, playbookCadence, autopilotPlaybookById, losingYearsOf, playbookById, playbookOptions, playbookStatus, playbookTemplate, proposalFor } from "./playbooks.js";
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
    expect(AUTOPILOT_PLAYBOOKS).toHaveLength(PLAYBOOKS.filter((p) => !p.control).length + CLOCK_PLAYBOOKS.length + WEEKLY_PLAYBOOKS.length + PREMIUM_PLAYBOOKS.length + MONTHLY_PLAYBOOKS.length);
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
      expect(b.per).toBe(({ daily: "day", weekly: "week", monthly: "trade", trend: "" } as const)[playbookCadence(p)]);
      if (playbookCadence(p) === "monthly") expect(b.basis, p.id).toMatch(new RegExp(`^${b.samples} entry days over 11 expiries, (\\d+) positive$`));
      if (playbookCadence(p) === "monthly") expect(p.evidence.claim, p.id).toContain(`${b.basis!.match(/, (\d+) positive/)![1]} of them positive`);
      // the mean as the sentence prints it: two decimals, a sign
      expect(p.evidence.claim, p.id).toContain(`${b.mean >= 0 ? "+" : "-"}${Math.abs(b.mean).toFixed(2)} a ${b.per}`);
      expect(b.worst, p.id).toBeLessThan(0);
      expect(p.evidence.claim, p.id).toMatch(new RegExp(`worst (day|week|entry) -${Math.abs(b.worst)}(?![0-9])`));
      expect(p.evidence.claim, p.id).toMatch(new RegExp(`\\b${b.positivePct} %`));
      expect(p.evidence.claim, p.id).toMatch(new RegExp(`on ${b.samples} (days|weeks|entries)`));
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
