// Market history through TanStack Query (ADR-056; GAPS #62, #32): the IV history of an underlying and one option's
// mark history. Both are public venue data; a 503 means the snapshotter has not recorded anything yet.
import { IvHistory, MarkHistory, type Underlying } from "@hapiecoin/schema";
import { useQuery } from "@tanstack/react-query";
import { ApiError, api, type ApiClient } from "./client";

export const marketKeys = {
  all: ["market"] as const,
  iv: (asset: Underlying) => ["market", "iv", asset] as const,
  marks: (symbol: string, hours: number) => ["market", "marks", symbol, hours] as const,
};

export function marketFetchers(client: ApiClient = api) {
  return {
    iv: (asset: Underlying) => client.get(`/v1/market/iv?asset=${asset}`, IvHistory),
    marks: (symbol: string, hours: number) => client.get(`/v1/market/marks/${encodeURIComponent(symbol)}?hours=${hours}`, MarkHistory),
  };
}
const f = marketFetchers();

/** Retry once on a transport error; never on the API's honest "no history yet" 503. */
const notYet = (count: number, error: unknown) => count < 2 && !(error instanceof ApiError && (error.status === 503 || error.code === "UNAVAILABLE"));

/** IV history for the underlying; `isError` with an UNAVAILABLE message means "no history yet". */
export function useIvHistory(asset: Underlying, enabled = true) {
  return useQuery({ queryKey: marketKeys.iv(asset), queryFn: () => f.iv(asset), enabled, staleTime: 60_000, refetchInterval: 5 * 60_000, retry: notYet });
}

export function useMarkHistory(symbol: string | null, hours = 24) {
  return useQuery({ queryKey: marketKeys.marks(symbol ?? "", hours), queryFn: () => f.marks(symbol ?? "", hours), enabled: symbol !== null, staleTime: 60_000, retry: notYet });
}
