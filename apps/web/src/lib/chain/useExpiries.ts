"use client";
// The venue's listed expiries for an asset, cached for five minutes (shared by the chain panel, the templates loader
// and the per-leg expiry select, HC-TR-147). Keyed by venue (ADR-069).
import type { Underlying } from "@hapiecoin/schema";
import { useQuery } from "@tanstack/react-query";
import { publicEnv } from "@/lib/env";
import type { VenueId } from "@hapiecoin/venues/core";
import { useVenueId } from "@/lib/useVenue";
import { type ExpirySource, discoverExpiries } from "./expiries";

export const expiriesQueryKey = (venue: string, asset: Underlying) => ["expiries", venue, asset] as const;

/** The expiries query of `asset` on the workspace venue; `enabled: false` parks it (the chain picker while closed). */
export function useExpiriesQuery(asset: Underlying, opts: { enabled?: boolean; venue?: VenueId } = {}) {
  const env = publicEnv();
  const current = useVenueId();
  const venue = opts.venue ?? current;
  return useQuery<ExpirySource>({
    queryKey: expiriesQueryKey(venue, asset),
    queryFn: () => discoverExpiries(asset, { gatewayWsUrl: env.NEXT_PUBLIC_GATEWAY_URL, defaultsCsv: env.NEXT_PUBLIC_DEFAULT_EXPIRIES, venue }),
    staleTime: 5 * 60_000,
    enabled: opts.enabled ?? true,
  });
}

export function useExpiries(asset: Underlying): string[] {
  return useExpiriesQuery(asset).data?.expiries ?? [];
}
