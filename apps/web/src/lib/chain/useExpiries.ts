"use client";
// The venue's listed expiries for an asset, cached for five minutes (shared by the templates loader and the
// per-leg expiry select, HC-TR-147).
import type { Underlying } from "@hapiecoin/schema";
import { useQuery } from "@tanstack/react-query";
import { publicEnv } from "@/lib/env";
import { discoverExpiries } from "./expiries";

export function useExpiries(asset: Underlying): string[] {
  const env = publicEnv();
  const q = useQuery({
    queryKey: ["expiries", asset],
    queryFn: () => discoverExpiries(asset, { gatewayWsUrl: env.NEXT_PUBLIC_GATEWAY_URL, defaultsCsv: env.NEXT_PUBLIC_DEFAULT_EXPIRIES }),
    staleTime: 5 * 60_000,
  });
  return q.data?.expiries ?? [];
}
