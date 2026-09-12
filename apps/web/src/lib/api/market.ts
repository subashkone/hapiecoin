// Market history through TanStack Query (ADR-056; GAPS #62, #32): the IV history of an underlying and one option's
// mark history. Both are public venue data; a 503 means the snapshotter has not recorded anything yet.
import { IvHistory, MarkHistory, type Underlying } from "@hapiecoin/schema";
import { DEFAULT_VENUE } from "@hapiecoin/venues/core";
import { useQuery } from "@tanstack/react-query";
import { useVenueId } from "@/lib/useVenue";
import { ApiError, api, type ApiClient } from "./client";

export const marketKeys = {
  all: ["market"] as const,
  iv: (asset: Underlying, venue: string = DEFAULT_VENUE) => ["market", "iv", venue, asset] as const,
  marks: (symbol: string, hours: number, venue: string = DEFAULT_VENUE) => ["market", "marks", venue, symbol, hours] as const,
};

/** `&venue=` only off the default: the API defaults to it (ADR-065), and the default venue's URLs stay as they were. */
const venueParam = (venue: string) => (venue === DEFAULT_VENUE ? "" : `&venue=${encodeURIComponent(venue)}`);

export function marketFetchers(client: ApiClient = api) {
  return {
    iv: (asset: Underlying, venue: string = DEFAULT_VENUE) => client.get(`/v1/market/iv?asset=${asset}${venueParam(venue)}`, IvHistory),
    marks: (symbol: string, hours: number, venue: string = DEFAULT_VENUE) => client.get(`/v1/market/marks/${encodeURIComponent(symbol)}?hours=${hours}${venueParam(venue)}`, MarkHistory),
  };
}
const f = marketFetchers();

/** Retry once on a transport error; never on the API's honest "no history yet" 503. */
const notYet = (count: number, error: unknown) => count < 2 && !(error instanceof ApiError && (error.status === 503 || error.code === "UNAVAILABLE"));

/** IV history for the underlying; `isError` with an UNAVAILABLE message means "no history yet". */
export function useIvHistory(asset: Underlying, enabled = true) {
  const venue = useVenueId();
  return useQuery({ queryKey: marketKeys.iv(asset, venue), queryFn: () => f.iv(asset, venue), enabled, staleTime: 60_000, refetchInterval: 5 * 60_000, retry: notYet });
}

export function useMarkHistory(symbol: string | null, hours = 24) {
  const venue = useVenueId();
  return useQuery({ queryKey: marketKeys.marks(symbol ?? "", hours, venue), queryFn: () => f.marks(symbol ?? "", hours, venue), enabled: symbol !== null, staleTime: 60_000, retry: notYet });
}
