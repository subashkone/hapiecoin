/**
 * Playbook records (ADR-101; HC-TR-205, HC-TR-206): the stored fact about a playbook's performance on the recorded
 * chain history, net of fees, with its in-sample / out-of-sample halves, its losing years and the trial count behind
 * its parameters, and the status the thresholds give it. The playbook definitions themselves live in the pricing
 * package as data; the API serves only the records and the web joins them.
 */
import { z } from "zod";
import { BacktestFold, BacktestStats } from "./backtest.js";
import { toDecimal } from "./strategies.js";
import { DecimalString, IsoDate, IsoDateTime, Underlying, Venue } from "./primitives.js";

export const PlaybookStatus = z.enum(["pass", "fail", "insufficient", "control-ok", "control-alarm"]);
export type PlaybookStatus = z.infer<typeof PlaybookStatus>;

export const PlaybookRecord = z.strictObject({
  computedAt: IsoDateTime,
  /** The recorded range the record covers (first and last recorded day), null when nothing is recorded. */
  firstDay: IsoDate.nullable(),
  lastDay: IsoDate.nullable(),
  /** Recorded days the record covers. */
  days: z.number().int().nonnegative(),
  /** Of those, reconstructed from the venue's candle history (ADR-098). */
  reconstructedDays: z.number().int().nonnegative(),
  entries: z.number().int().nonnegative(),
  /** Entry days skipped for want of a signal. */
  noSignal: z.number().int().nonnegative(),
  stats: BacktestStats,
  /** The in-sample and out-of-sample halves (ADR-100). */
  folds: z.array(BacktestFold),
  /** Calendar years, by exit day, whose closed trades lost money. */
  losingYears: z.array(z.strictObject({ year: z.number().int(), total: DecimalString })),
  exits: z.strictObject({ settled: z.number().int().nonnegative(), target: z.number().int().nonnegative(), stop: z.number().int().nonnegative(), time: z.number().int().nonnegative(), inert: z.number().int().nonnegative() }),
  /** Parameter configurations examined before the playbook's were fixed. */
  trials: z.number().int().positive(),
  status: PlaybookStatus,
  /** "venue" when the venue's fee rule was charged, "none" when the venue publishes no rule (the record is then before fees). */
  fees: z.enum(["venue", "none"]),
});
export type PlaybookRecord = z.infer<typeof PlaybookRecord>;

export const PlaybookRecordRow = z.strictObject({
  playbookId: z.string().min(1),
  asset: Underlying,
  record: PlaybookRecord,
});
export type PlaybookRecordRow = z.infer<typeof PlaybookRecordRow>;

export const PlaybookRecords = z.strictObject({
  venue: Venue,
  records: z.array(PlaybookRecordRow),
});
export type PlaybookRecords = z.infer<typeof PlaybookRecords>;

/** The engine's numbers for one record, before money is rounded to cents at the edge. */
export interface PlaybookRecordInput {
  computedAt: string;
  firstDay: string | null;
  lastDay: string | null;
  days: number;
  reconstructedDays: number;
  entries: number;
  noSignal: number;
  stats: { trades: number; wins: number; losses: number; winRate: number | null; total: number; grossTotal: number; totalFees: number; average: number | null; median: number | null; best: number | null; worst: number | null; maxDrawdown: number; profitFactor: number | null };
  folds: { index: number; firstDay: string | null; lastDay: string | null; entries: number; stats: PlaybookRecordInput["stats"] }[];
  losingYears: { year: number; total: number }[];
  exits: { settled: number; target: number; stop: number; time: number; inert: number };
  trials: number;
  status: PlaybookStatus;
  fees: "venue" | "none";
}

const money = (n: number) => toDecimal(n, 2);
const opt = (n: number | null) => (n === null ? null : money(n));
const statsOut = (s: PlaybookRecordInput["stats"]): BacktestStats => ({
  trades: s.trades,
  wins: s.wins,
  losses: s.losses,
  winRate: s.winRate,
  total: money(s.total),
  grossTotal: money(s.grossTotal),
  totalFees: money(s.totalFees),
  average: opt(s.average),
  median: opt(s.median),
  best: opt(s.best),
  worst: opt(s.worst),
  maxDrawdown: money(s.maxDrawdown),
  profitFactor: s.profitFactor,
});

/** Money to cents, everything else as computed: the one projection the API and the mock share. */
export function projectPlaybookRecord(r: PlaybookRecordInput): PlaybookRecord {
  return {
    computedAt: r.computedAt,
    firstDay: r.firstDay,
    lastDay: r.lastDay,
    days: r.days,
    reconstructedDays: r.reconstructedDays,
    entries: r.entries,
    noSignal: r.noSignal,
    stats: statsOut(r.stats),
    folds: r.folds.map((f) => ({ index: f.index, firstDay: f.firstDay, lastDay: f.lastDay, entries: f.entries, stats: statsOut(f.stats) })),
    losingYears: r.losingYears.map((y) => ({ year: y.year, total: money(y.total) })),
    exits: r.exits,
    trials: r.trials,
    status: r.status,
    fees: r.fees,
  };
}
