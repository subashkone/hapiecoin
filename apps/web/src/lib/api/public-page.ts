// Public trader page (ADR-075; HC-SH-127, HC-PB-066): the trader's own page settings behind the session, and the public
// page itself, which anyone can read by handle.
import { PublicPageSettings, PublicTraderPage } from "@hapiecoin/schema";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError, type ApiClient } from "./client";

export const publicPageKeys = {
  settings: ["public-page"] as const,
  trader: (handle: string) => ["public-trader", handle.toLowerCase()] as const,
};

export function publicPageFetchers(client: ApiClient = api) {
  return {
    settings: () => client.get("/v1/public-page", PublicPageSettings),
    update: (next: PublicPageSettings) => client.put("/v1/public-page", next, PublicPageSettings),
    trader: (handle: string) => client.get(`/v1/public/traders/${encodeURIComponent(handle)}`, PublicTraderPage),
  };
}
const f = publicPageFetchers();

export function usePublicPageSettings(enabled = true) {
  return useQuery({ queryKey: publicPageKeys.settings, queryFn: f.settings, enabled, staleTime: 60_000 });
}

export function useUpdatePublicPage() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: f.update, onSuccess: (data) => qc.setQueryData(publicPageKeys.settings, data) });
}

/** A visitor's read of a trader's page; a 404 (unknown handle or page off) is kept as the query error, not retried. */
export function usePublicTrader(handle: string, enabled = true) {
  return useQuery({
    queryKey: publicPageKeys.trader(handle),
    queryFn: () => f.trader(handle),
    enabled: enabled && handle !== "",
    staleTime: 60_000,
    retry: (count, e) => !(e instanceof ApiError && e.status === 404) && count < 2,
  });
}
