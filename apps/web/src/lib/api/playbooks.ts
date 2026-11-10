// Playbook records through TanStack Query (ADR-101; HC-WS-119): the stored record of every playbook on the venue's
// recorded chain history. The playbook definitions are data in the pricing package; this joins them to their records.
// A 503 means no record exists yet (no day recorded, or the records job has not run).
import { PlaybookRecords, type PlaybookRecord, type Underlying } from "@hapiecoin/schema";
import { DEFAULT_VENUE } from "@hapiecoin/venues/core";
import { useQuery } from "@tanstack/react-query";
import { useVenueId } from "@/lib/useVenue";
import { ApiError, api, type ApiClient } from "./client";

export const playbookKeys = {
  records: (venue: string = DEFAULT_VENUE) => ["playbooks", "records", venue] as const,
};

export function playbookFetchers(client: ApiClient = api) {
  return {
    records: (venue: string = DEFAULT_VENUE) => client.get(venue === DEFAULT_VENUE ? "/v1/playbooks" : `/v1/playbooks?venue=${encodeURIComponent(venue)}`, PlaybookRecords),
  };
}
const f = playbookFetchers();

/** Retry once on a transport error; never on the API's honest "no record yet" 503. */
const notYet = (count: number, error: unknown) => count < 2 && !(error instanceof ApiError && error.status === 503);

export function usePlaybookRecords(enabled = true) {
  const venue = useVenueId();
  return useQuery({ queryKey: playbookKeys.records(venue), queryFn: () => f.records(venue), enabled, staleTime: 5 * 60_000, retry: notYet });
}

/** The record of one playbook for one asset out of the venue's list, or null. */
export function recordFor(records: PlaybookRecords | undefined, playbookId: string, asset: Underlying): PlaybookRecord | null {
  return records?.records.find((r) => r.playbookId === playbookId && r.asset === asset)?.record ?? null;
}
