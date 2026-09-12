// Strategy backtest through TanStack Query (ADR-077; HC-TR-185): a template entered at every recorded end of day and
// held to expiry, computed by the API over the venue's recorded chains. A 503 means no day has been recorded yet.
import { BacktestResult, type Underlying } from "@hapiecoin/schema";
import { DEFAULT_VENUE } from "@hapiecoin/venues/core";
import { useQuery } from "@tanstack/react-query";
import { useVenueId } from "@/lib/useVenue";
import { ApiError, api, type ApiClient } from "./client";

export interface BacktestParams {
  asset: Underlying;
  template: string;
  lots: number;
  minDte: number;
  from?: string | undefined;
  to?: string | undefined;
}

export const backtestKeys = {
  run: (p: BacktestParams, venue: string = DEFAULT_VENUE) => ["backtest", venue, p.asset, p.template, p.lots, p.minDte, p.from ?? "", p.to ?? ""] as const,
};

export function backtestQuery(p: BacktestParams, venue: string = DEFAULT_VENUE): string {
  const q = new URLSearchParams({ asset: p.asset, template: p.template, lots: String(p.lots), minDte: String(p.minDte) });
  if (p.from) q.set("from", p.from);
  if (p.to) q.set("to", p.to);
  if (venue !== DEFAULT_VENUE) q.set("venue", venue);
  return `/v1/backtest?${q.toString()}`;
}

export function backtestFetchers(client: ApiClient = api) {
  return { run: (p: BacktestParams, venue: string = DEFAULT_VENUE) => client.get(backtestQuery(p, venue), BacktestResult) };
}
const f = backtestFetchers();

/** Retry once on a transport error; never on the API's honest "nothing recorded yet" 503 or a 400. */
const notYet = (count: number, error: unknown) => count < 2 && !(error instanceof ApiError && (error.status === 503 || error.status === 400));

export function useBacktest(p: BacktestParams, enabled = true) {
  const venue = useVenueId();
  return useQuery({ queryKey: backtestKeys.run(p, venue), queryFn: () => f.run(p, venue), enabled: enabled && p.template !== "", staleTime: 5 * 60_000, retry: notYet });
}
