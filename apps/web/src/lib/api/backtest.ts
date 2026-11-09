// Strategy backtest through TanStack Query (ADR-077; HC-TR-185): a template entered at every recorded end of day and
// held to expiry or to its exit rule (ADR-099), computed by the API over the venue's recorded chains. A 503 means no
// day has been recorded yet.
import { type BacktestFees, BacktestResult, type SweepAxis, SweepResult, type Underlying } from "@hapiecoin/schema";
import { DEFAULT_VENUE } from "@hapiecoin/venues/core";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useVenueId } from "@/lib/useVenue";
import { ApiError, api, type ApiClient } from "./client";

export interface BacktestParams {
  asset: Underlying;
  template: string;
  lots: number;
  minDte: number;
  from?: string | undefined;
  to?: string | undefined;
  /** ADR-099 rules; the API defaults fees to the venue's rule. */
  fees?: BacktestFees | undefined;
  smaDays?: number | undefined;
  smaSide?: "above" | "below" | undefined;
  ivRankMin?: number | undefined;
  ivRankMax?: number | undefined;
  /** UTC weekdays 0..6. */
  weekdays?: readonly number[] | undefined;
  targetPct?: number | undefined;
  stopPct?: number | undefined;
  timeStopDte?: number | undefined;
  /** ADR-100: walk-forward periods (2 or 3). */
  folds?: number | undefined;
}

/** ADR-100: the sweep adds one or two axes with their values to the single run's parameters. */
export interface SweepParams extends Omit<BacktestParams, "folds"> {
  axis1: SweepAxis;
  values1: readonly number[];
  axis2?: SweepAxis | undefined;
  values2?: readonly number[] | undefined;
}

/** The rule fields as query parameters, in a fixed order so the key and the URL agree. */
function ruleParams(p: BacktestParams): [string, string][] {
  const out: [string, string][] = [];
  if (p.fees) out.push(["fees", p.fees]);
  if (p.smaDays !== undefined && p.smaSide) out.push(["smaDays", String(p.smaDays)], ["smaSide", p.smaSide]);
  if (p.ivRankMin !== undefined) out.push(["ivRankMin", String(p.ivRankMin)]);
  if (p.ivRankMax !== undefined) out.push(["ivRankMax", String(p.ivRankMax)]);
  if (p.weekdays && p.weekdays.length > 0) out.push(["weekdays", [...p.weekdays].sort().join(",")]);
  if (p.targetPct !== undefined) out.push(["targetPct", String(p.targetPct)]);
  if (p.stopPct !== undefined) out.push(["stopPct", String(p.stopPct)]);
  if (p.timeStopDte !== undefined) out.push(["timeStopDte", String(p.timeStopDte)]);
  if (p.folds !== undefined) out.push(["folds", String(p.folds)]);
  return out;
}

function sweepParams(p: SweepParams): [string, string][] {
  const out: [string, string][] = [["axis1", p.axis1], ["values1", p.values1.join(",")]];
  if (p.axis2 && p.values2) out.push(["axis2", p.axis2], ["values2", p.values2.join(",")]);
  return out;
}

export function sweepQuery(p: SweepParams, venue: string = DEFAULT_VENUE): string {
  const q = new URLSearchParams({ asset: p.asset, template: p.template, lots: String(p.lots), minDte: String(p.minDte) });
  if (p.from) q.set("from", p.from);
  if (p.to) q.set("to", p.to);
  for (const [k, v] of ruleParams(p)) q.set(k, v);
  for (const [k, v] of sweepParams(p)) q.set(k, v);
  if (venue !== DEFAULT_VENUE) q.set("venue", venue);
  return `/v1/backtest/sweep?${q.toString()}`;
}

export const backtestKeys = {
  run: (p: BacktestParams, venue: string = DEFAULT_VENUE) => ["backtest", venue, p.asset, p.template, p.lots, p.minDte, p.from ?? "", p.to ?? "", ruleParams(p).map(([k, v]) => `${k}=${v}`).join("&")] as const,
  sweep: (p: SweepParams, venue: string = DEFAULT_VENUE) =>
    ["backtest", "sweep", venue, p.asset, p.template, p.lots, p.minDte, p.from ?? "", p.to ?? "", ruleParams(p).map(([k, v]) => `${k}=${v}`).join("&"), sweepParams(p).map(([k, v]) => `${k}=${v}`).join("&")] as const,
};

export function backtestQuery(p: BacktestParams, venue: string = DEFAULT_VENUE): string {
  const q = new URLSearchParams({ asset: p.asset, template: p.template, lots: String(p.lots), minDte: String(p.minDte) });
  if (p.from) q.set("from", p.from);
  if (p.to) q.set("to", p.to);
  for (const [k, v] of ruleParams(p)) q.set(k, v);
  if (venue !== DEFAULT_VENUE) q.set("venue", venue);
  return `/v1/backtest?${q.toString()}`;
}

export function backtestFetchers(client: ApiClient = api) {
  return {
    run: (p: BacktestParams, venue: string = DEFAULT_VENUE) => client.get(backtestQuery(p, venue), BacktestResult),
    sweep: (p: SweepParams, venue: string = DEFAULT_VENUE) => client.get(sweepQuery(p, venue), SweepResult),
  };
}
const f = backtestFetchers();

/** Retry once on a transport error; never on the API's honest "nothing recorded yet" 503 or a 400. */
const notYet = (count: number, error: unknown) => count < 2 && !(error instanceof ApiError && (error.status === 503 || error.status === 400));

export function useBacktest(p: BacktestParams, enabled = true) {
  const venue = useVenueId();
  return useQuery({ queryKey: backtestKeys.run(p, venue), queryFn: () => f.run(p, venue), enabled: enabled && p.template !== "", staleTime: 5 * 60_000, retry: notYet });
}

export function useBacktestSweep(p: SweepParams, enabled = true) {
  const venue = useVenueId();
  return useQuery({
    queryKey: backtestKeys.sweep(p, venue),
    queryFn: () => f.sweep(p, venue),
    enabled: enabled && p.template !== "",
    staleTime: 5 * 60_000,
    retry: notYet,
    // the grid stays while a changed axis runs, instead of vanishing behind "Running…"
    placeholderData: keepPreviousData,
  });
}
