// Playbooks as data (ADR-101; HC-TR-205): every playbook places on a ladder, the status rules read a record against the
// thresholds (the control inverted), losing years come from the closed trades, and the options carry the plan.
import { describe, expect, it } from "vitest";
import { type BacktestFold, type BacktestStats, type BacktestTrade, type EodDay, type EodRow, runBacktest } from "./backtest.js";
import { calendarFor } from "./calendar.js";
import { HERO_OR_ZERO_TEMPLATE, PLAYBOOKS, losingYearsOf, playbookById, playbookOptions, playbookStatus, playbookTemplate } from "./playbooks.js";
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
