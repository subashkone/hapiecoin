// Market Analytics snapshots through TanStack Query (Phase 5 item 5, ADR-038): one hook per dataset, each keyed
// by dataset + symbol and refreshed on the snapshot's own TTL. Every payload keeps its source and as-of stamp.
import { type AnalyticsDataset, AnalyticsSnapshot, type SnapshotOf } from "@hapiecoin/schema";
import { useQueries, useQuery } from "@tanstack/react-query";
import { api, type ApiClient } from "./client";

export const analyticsKeys = {
  snapshot: (dataset: AnalyticsDataset, symbol?: string) => ["analytics", dataset, symbol ?? "-"] as const,
};

export function analyticsFetchers(client: ApiClient = api) {
  return {
    snapshot: <D extends AnalyticsDataset>(dataset: D, symbol?: string) =>
      client.get(`/v1/analytics/${dataset}${symbol ? `?symbol=${encodeURIComponent(symbol)}` : ""}`, AnalyticsSnapshot).then((s) => {
        if (s.dataset !== dataset) throw new Error(`expected ${dataset}, got ${s.dataset}`);
        return s as SnapshotOf<D>;
      }),
  };
}
const f = analyticsFetchers();

/** One dataset snapshot; refetches on its TTL (never faster than 15 s) and keeps the previous data while refreshing. */
export function useAnalytics<D extends AnalyticsDataset>(dataset: D, symbol?: string, enabled = true) {
  return useQuery({
    queryKey: analyticsKeys.snapshot(dataset, symbol),
    queryFn: () => f.snapshot(dataset, symbol),
    enabled,
    staleTime: 15_000,
    refetchInterval: (q) => Math.max(15_000, q.state.data?.ttlMs ?? 60_000),
    retry: (count, error) => count < 2 && !(error instanceof Error && /UNAVAILABLE|503/.test(error.message)),
  });
}
export const useOverview = () => useAnalytics("overview");
export const useMarkets = () => useAnalytics("markets");
export const useLiquidations = () => useAnalytics("liquidations");

/** One dataset for several symbols at once (the funding-arbitrage table); missing symbols come back as undefined. */
export function useAnalyticsMany<D extends AnalyticsDataset>(dataset: D, symbols: readonly string[]) {
  return useQueries({
    queries: symbols.map((symbol) => ({
      queryKey: analyticsKeys.snapshot(dataset, symbol),
      queryFn: () => f.snapshot(dataset, symbol),
      staleTime: 15_000,
      refetchInterval: 60_000,
      retry: false,
    })),
    combine: (results) => ({ data: results.map((r) => r.data).filter((d): d is SnapshotOf<D> => d !== undefined), pending: results.some((r) => r.isPending), settled: results.length > 0 && results.every((r) => !r.isPending) }),
  });
}
