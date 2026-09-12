// Verified P&L (ADR-073; HC-TR-180): the trader's realised P&L from the exchange's own fills, per account and in
// total, and the Refresh that re-reads the accounts now. Read-only against the exchange.
import { VerifiedPnl, VerifiedRefreshResult } from "@hapiecoin/schema";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type ApiClient } from "./client";

export const verifiedKeys = { pnl: ["verified", "pnl"] as const };

export function verifiedFetchers(client: ApiClient = api) {
  return {
    pnl: () => client.get("/v1/verified/pnl", VerifiedPnl),
    refresh: () => client.post("/v1/verified/refresh", {}, VerifiedRefreshResult),
  };
}
const f = verifiedFetchers();

/** The figures; polled slowly (the server's job re-reads every few minutes, the button reads now). */
export function useVerifiedPnl(enabled = true) {
  return useQuery({ queryKey: verifiedKeys.pnl, queryFn: f.pnl, enabled, staleTime: 60_000, refetchInterval: 120_000 });
}

export function useVerifiedRefresh() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: f.refresh, onSuccess: () => void qc.invalidateQueries({ queryKey: verifiedKeys.pnl }) });
}
