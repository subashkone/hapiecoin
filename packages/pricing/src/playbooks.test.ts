// Playbooks as data (ADR-101; HC-TR-205): every playbook places on a ladder, the status rules read a record against the
// thresholds (the control inverted), losing years come from the closed trades, and the options carry the plan.
import { describe, expect, it } from "vitest";
import { type BacktestFold, type BacktestStats, type BacktestTrade, type EodDay, type EodRow, runBacktest } from "./backtest.js";
import { calendarFor } from "./calendar.js";
import { AUTOPILOT_PLAYBOOKS, CLOCK_PLAYBOOKS, HERO_OR_ZERO_TEMPLATE, PLAYBOOKS, autopilotPlaybookById, losingYearsOf, playbookById, playbookOptions, playbookStatus, playbookTemplate, proposalFor } from "./playbooks.js";
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

  it("HC-TR-225 four evening strangles: a window in UTC hours, the nearest expiry at least half a day out, BTC only, outside the recorded list", () => {
    expect(CLOCK_PLAYBOOKS).toHaveLength(4);
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
    for (const id of ["evening-strangle-stop-2x", "evening-strangle-stop-3x"]) {
      const n = placed(id);
      expect(n.legs.map((l) => `${l.side} ${l.kind} ${l.strike}`)).toEqual(["sell put 82600", "sell call 83800"]);
      expect(n.maxLoss).toBe(-Infinity);
    }
    // a chain too narrow for the wings is no trade
    const narrow: EodDay[] = [{ ...evening[0]!, expiries: evening[0]!.expiries.map((e) => ({ ...e, rows: rows.slice(8, 17) })) }];
    expect(proposalFor(autopilotPlaybookById("evening-strangle-wings-5")!, narrow, base)).toEqual({ ok: false, reason: "noFit" });
  });
});
