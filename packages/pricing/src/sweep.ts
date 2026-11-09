/**
 * Bounded parameter sweep over the backtest (ADR-100; HC-TR-204): one or two of the rule parameters the Backtest tab
 * exposes, run over a small grid with a hard cap on trials, every trial reported with its net result and a plateau
 * reading (how many of its grid neighbours keep the same sign and at least half its result). The cap and the trial
 * count travel with the result, because a search over parameters is where a lucky peak is born: Bailey and López de
 * Prado show that a few dozen configurations on a few years of data all but guarantee an in-sample winner that fails
 * out of sample. This is the only place the product searches parameters, and it says how many it tried. Pure.
 */
import { type BacktestOptions, type BacktestStats, type EodDay, runBacktest } from "./backtest.js";
import type { StrategyTemplate } from "./templates.js";

export const SWEEP_AXES = ["smaDays", "minDte", "targetPct", "stopPct", "timeStopDte"] as const;
export type SweepAxis = (typeof SWEEP_AXES)[number];
/** Hard cap on trials per sweep. */
export const SWEEP_MAX_TRIALS = 48;
/** Most values on the first and second axis (8 × 6 = the cap). */
export const SWEEP_MAX_VALUES: readonly [number, number] = [8, 6];
/** A neighbour keeps the cell's result when its total has the same sign and at least this share of the cell's size. */
export const PLATEAU_KEEP_SHARE = 0.5;

export interface SweepAxisSpec {
  axis: SweepAxis;
  /** The values tried, as the tab shows them (percent for target and stop, days for the rest). */
  values: readonly number[];
}

export interface SweepTrial {
  /** The value of each swept axis in this trial. */
  values: Partial<Record<SweepAxis, number>>;
  trades: number;
  /** Net of fees. */
  total: number;
  grossTotal: number;
  totalFees: number;
  winRate: number | null;
  maxDrawdown: number;
  profitFactor: number | null;
  /** Share of this trial's grid neighbours that keep its result (same sign, at least half the size); null when the trial made nothing or has no neighbours. */
  plateau: number | null;
}

export interface SweepResult {
  axes: SweepAxisSpec[];
  /** Row-major: the first axis outer, the second inner. */
  trials: SweepTrial[];
  /** Index of the trial with the highest net total among those with a closed trade; null when none closed. */
  best: number | null;
  cap: number;
}

/** The options of a trial: the base options with one axis set to `value`. */
export function applyAxis(opts: BacktestOptions, axis: SweepAxis, value: number): BacktestOptions {
  switch (axis) {
    case "smaDays":
      return { ...opts, conditions: { ...opts.conditions, sma: { days: value, side: opts.conditions?.sma?.side ?? "above" } } };
    case "minDte":
      return { ...opts, minDte: value };
    case "targetPct":
      return { ...opts, exits: { ...opts.exits, targetPct: value / 100 } };
    case "stopPct":
      return { ...opts, exits: { ...opts.exits, stopPct: value / 100 } };
    case "timeStopDte":
      return { ...opts, exits: { ...opts.exits, timeStopDte: value } };
  }
}

/**
 * Plateau reading of every cell of a grid of scores laid out row-major with `shape` (one or two axes): the share of
 * its existing neighbours along each axis (one step either way) whose score has the same sign and at least
 * `PLATEAU_KEEP_SHARE` of the cell's size. A cell scoring 0, or with no neighbours, reads null.
 */
export function plateauOf(scores: readonly number[], shape: readonly [number, number?]): (number | null)[] {
  const n1 = shape[0];
  const n2 = shape[1] ?? 1;
  return scores.map((score, idx) => {
    if (score === 0) return null;
    const i1 = Math.floor(idx / n2);
    const i2 = idx % n2;
    const neighbours: number[] = [];
    if (i1 > 0) neighbours.push(scores[(i1 - 1) * n2 + i2]!);
    if (i1 < n1 - 1) neighbours.push(scores[(i1 + 1) * n2 + i2]!);
    if (n2 > 1 && i2 > 0) neighbours.push(scores[i1 * n2 + i2 - 1]!);
    if (n2 > 1 && i2 < n2 - 1) neighbours.push(scores[i1 * n2 + i2 + 1]!);
    if (neighbours.length === 0) return null;
    const keep = neighbours.filter((v) => Math.sign(v) === Math.sign(score) && Math.abs(v) >= PLATEAU_KEEP_SHARE * Math.abs(score)).length;
    return keep / neighbours.length;
  });
}

/** Refuses a grid the cap does not allow; returns the shape otherwise. */
export function sweepShape(axes: readonly SweepAxisSpec[]): [number, number?] {
  if (axes.length < 1 || axes.length > 2) throw new RangeError("a sweep takes one or two axes");
  if (axes.length === 2 && axes[0]!.axis === axes[1]!.axis) throw new RangeError("the two axes must differ");
  for (const [i, a] of axes.entries()) {
    if (a.values.length === 0) throw new RangeError(`${a.axis} needs at least one value`);
    if (a.values.length > SWEEP_MAX_VALUES[i]!) throw new RangeError(`${a.axis} takes at most ${SWEEP_MAX_VALUES[i]} values`);
    if (new Set(a.values).size !== a.values.length) throw new RangeError(`${a.axis} repeats a value`);
    if (a.values.some((v, i) => i > 0 && !(v > a.values[i - 1]!))) throw new RangeError(`${a.axis} values must increase, so that grid neighbours are one step apart`);
  }
  const n1 = axes[0]!.values.length;
  const n2 = axes[1]?.values.length;
  if (n1 * (n2 ?? 1) > SWEEP_MAX_TRIALS) throw new RangeError(`a sweep runs at most ${SWEEP_MAX_TRIALS} trials`);
  return n2 === undefined ? [n1] : [n1, n2];
}

const pick = (s: BacktestStats) => ({ trades: s.trades, total: s.total, grossTotal: s.grossTotal, totalFees: s.totalFees, winRate: s.winRate, maxDrawdown: s.maxDrawdown, profitFactor: s.profitFactor });

/** Run the grid: every combination of the axes' values applied to `base`, row-major, with the plateau reading over the net totals. */
export function sweepBacktest(tpl: StrategyTemplate, days: readonly EodDay[], base: BacktestOptions, axes: readonly SweepAxisSpec[]): SweepResult {
  const shape = sweepShape(axes);
  const trials: Omit<SweepTrial, "plateau">[] = [];
  const [a1, a2] = axes;
  for (const v1 of a1!.values) {
    const opts1 = applyAxis(base, a1!.axis, v1);
    for (const v2 of a2?.values ?? [undefined]) {
      const opts = v2 === undefined ? opts1 : applyAxis(opts1, a2!.axis, v2);
      const values: Partial<Record<SweepAxis, number>> = { [a1!.axis]: v1 };
      if (a2 && v2 !== undefined) values[a2.axis] = v2;
      trials.push({ values, ...pick(runBacktest(tpl, days, opts).stats) });
    }
  }
  const plateau = plateauOf(trials.map((t) => t.total), shape);
  let best: number | null = null;
  trials.forEach((t, i) => {
    if (t.trades > 0 && (best === null || t.total > trials[best]!.total)) best = i;
  });
  return { axes: axes.map((a) => ({ axis: a.axis, values: [...a.values] })), trials: trials.map((t, i) => ({ ...t, plateau: plateau[i] ?? null })), best, cap: SWEEP_MAX_TRIALS };
}
