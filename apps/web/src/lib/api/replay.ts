// Replay of an expiry's chain through TanStack Query (ADR-079; HC-WS-114): the recorded expiries, the instants one was
// recorded at, and the ladder at an instant. A 503 means nothing has been recorded yet; a 404 an instant with no record.
import { ReplayChain, ReplayExpiries, ReplaySteps, type Underlying } from "@hapiecoin/schema";
import { DEFAULT_VENUE } from "@hapiecoin/venues/core";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useVenueId } from "@/lib/useVenue";
import { ApiError, api, type ApiClient } from "./client";

export const replayKeys = {
  expiries: (asset: Underlying, venue: string = DEFAULT_VENUE) => ["replay", "expiries", venue, asset] as const,
  steps: (asset: Underlying, expiry: string, venue: string = DEFAULT_VENUE) => ["replay", "steps", venue, asset, expiry] as const,
  chain: (asset: Underlying, expiry: string, at: string, venue: string = DEFAULT_VENUE) => ["replay", "chain", venue, asset, expiry, at] as const,
};

const venueParam = (venue: string) => (venue === DEFAULT_VENUE ? "" : `&venue=${encodeURIComponent(venue)}`);

export function replayFetchers(client: ApiClient = api) {
  return {
    expiries: (asset: Underlying, venue: string = DEFAULT_VENUE) => client.get(`/v1/replay/expiries?asset=${asset}${venueParam(venue)}`, ReplayExpiries),
    steps: (asset: Underlying, expiry: string, venue: string = DEFAULT_VENUE) => client.get(`/v1/replay/steps?asset=${asset}&expiry=${expiry}${venueParam(venue)}`, ReplaySteps),
    chain: (asset: Underlying, expiry: string, at: string, venue: string = DEFAULT_VENUE) => client.get(`/v1/replay/chain?asset=${asset}&expiry=${expiry}&at=${encodeURIComponent(at)}${venueParam(venue)}`, ReplayChain),
  };
}
const f = replayFetchers();

/** Retry once on a transport error; never on the API's honest 503 / 404. */
const notYet = (count: number, error: unknown) => count < 2 && !(error instanceof ApiError && (error.status === 503 || error.status === 404));

export function useReplayExpiries(asset: Underlying, enabled = true) {
  const venue = useVenueId();
  return useQuery({ queryKey: replayKeys.expiries(asset, venue), queryFn: () => f.expiries(asset, venue), enabled, staleTime: 60_000, retry: notYet });
}

export function useReplaySteps(asset: Underlying, expiry: string | null) {
  const venue = useVenueId();
  return useQuery({ queryKey: replayKeys.steps(asset, expiry ?? "", venue), queryFn: () => f.steps(asset, expiry ?? "", venue), enabled: expiry !== null, staleTime: 60_000, retry: notYet });
}

/** The ladder at an instant; the previous ladder stays on screen while the next loads, so scrubbing never blanks. */
export function useReplayChain(asset: Underlying, expiry: string | null, at: string | null) {
  const venue = useVenueId();
  return useQuery({
    queryKey: replayKeys.chain(asset, expiry ?? "", at ?? "", venue),
    queryFn: () => f.chain(asset, expiry ?? "", at ?? "", venue),
    enabled: expiry !== null && at !== null,
    staleTime: 5 * 60_000,
    placeholderData: keepPreviousData,
    retry: notYet,
  });
}
