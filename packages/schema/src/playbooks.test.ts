// Playbook records (ADR-101; HC-TR-205): the one projection the API and the mock share rounds money to cents at the
// edge, keeps counts and ratios as computed, carries nulls through, and yields a record the schema accepts.
import { describe, expect, it } from "vitest";
import { PlaybookRecord, type PlaybookRecordInput, PlaybookRecords, projectPlaybookRecord } from "./playbooks.js";

const stats = (over: Partial<PlaybookRecordInput["stats"]> = {}): PlaybookRecordInput["stats"] => ({ trades: 25, wins: 15, losses: 10, winRate: 0.6, total: 123.456, grossTotal: 130.004, totalFees: 6.548, average: 4.9382, median: 3.456, best: 20.1, worst: -15.557, maxDrawdown: 30.129, profitFactor: 1.5, ...over });

const input: PlaybookRecordInput = {
  computedAt: "2026-11-10T12:00:00.000Z",
  firstDay: "2025-11-10",
  lastDay: "2026-11-09",
  days: 366,
  reconstructedDays: 300,
  entries: 40,
  noSignal: 12,
  stats: stats(),
  folds: [
    { index: 0, firstDay: "2025-11-10", lastDay: "2026-05-10", entries: 20, stats: stats({ trades: 13, total: 80.111 }) },
    { index: 1, firstDay: "2026-05-11", lastDay: "2026-11-09", entries: 20, stats: stats({ trades: 12, total: 43.346 }) },
  ],
  losingYears: [{ year: 2025, total: -12.347 }],
  exits: { settled: 5, target: 12, stop: 6, time: 2, inert: 0 },
  trials: 3,
  status: "pass",
  fees: "venue",
};

describe("HC-TR-205 projectPlaybookRecord", () => {
  it("rounds every money figure to cents and keeps counts, ratios and days as computed", () => {
    const r = projectPlaybookRecord(input);
    expect(r.stats.total).toBe("123.46");
    expect(r.stats.grossTotal).toBe("130");
    expect(r.stats.totalFees).toBe("6.55");
    expect(r.stats.average).toBe("4.94");
    expect(r.stats.median).toBe("3.46");
    expect(r.stats.best).toBe("20.1");
    expect(r.stats.worst).toBe("-15.56");
    expect(r.stats.maxDrawdown).toBe("30.13");
    expect(r.stats.winRate).toBe(0.6);
    expect(r.stats.profitFactor).toBe(1.5);
    expect(r.stats.trades).toBe(25);
    expect(r.days).toBe(366);
    expect(r.reconstructedDays).toBe(300);
    expect(r.entries).toBe(40);
    expect(r.noSignal).toBe(12);
    expect(r.folds.map((f) => [f.index, f.entries, f.stats.total, f.stats.trades])).toEqual([
      [0, 20, "80.11", 13],
      [1, 20, "43.35", 12],
    ]);
    expect(r.losingYears).toEqual([{ year: 2025, total: "-12.35" }]);
    expect(r.exits).toEqual(input.exits);
    expect(r.trials).toBe(3);
    expect(r.status).toBe("pass");
    expect(r.fees).toBe("venue");
    expect(r.computedAt).toBe(input.computedAt);
    expect(PlaybookRecord.parse(r)).toEqual(r);
  });

  it("carries nulls through: an empty history has no days, no averages and no folds, and still validates", () => {
    const empty = projectPlaybookRecord({
      ...input,
      firstDay: null,
      lastDay: null,
      days: 0,
      reconstructedDays: 0,
      entries: 0,
      noSignal: 0,
      stats: stats({ trades: 0, wins: 0, losses: 0, winRate: null, total: 0, grossTotal: 0, totalFees: 0, average: null, median: null, best: null, worst: null, maxDrawdown: 0, profitFactor: null }),
      folds: [],
      losingYears: [],
      exits: { settled: 0, target: 0, stop: 0, time: 0, inert: 0 },
      status: "insufficient",
      fees: "none",
    });
    expect(empty.firstDay).toBeNull();
    expect(empty.lastDay).toBeNull();
    expect(empty.stats.winRate).toBeNull();
    expect(empty.stats.average).toBeNull();
    expect(empty.stats.median).toBeNull();
    expect(empty.stats.best).toBeNull();
    expect(empty.stats.worst).toBeNull();
    expect(empty.stats.profitFactor).toBeNull();
    expect(empty.stats.total).toBe("0");
    expect(empty.folds).toEqual([]);
    expect(PlaybookRecord.parse(empty)).toEqual(empty);
    expect(PlaybookRecords.parse({ venue: "deribit", records: [{ playbookId: "trend-puts", asset: "ETH", record: empty }] }).records).toHaveLength(1);
  });

  it("the record schema is strict: an unknown field or an unknown status is refused", () => {
    const r = projectPlaybookRecord(input);
    expect(PlaybookRecord.safeParse({ ...r, extra: 1 }).success).toBe(false);
    expect(PlaybookRecord.safeParse({ ...r, status: "maybe" }).success).toBe(false);
    expect(PlaybookRecord.safeParse({ ...r, fees: "half" }).success).toBe(false);
  });
});
