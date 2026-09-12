"use client";
// The workspace venue as React state (ADR-069): components subscribe here; plain modules read `currentVenue()`.
import { type VenueCore, type VenueId, getVenueCore } from "@hapiecoin/venues/core";
import { useUiStore } from "@/lib/store";

export function useVenueId(): VenueId {
  return useUiStore((s) => s.venue);
}

export function useVenueCore(): VenueCore {
  return getVenueCore(useVenueId());
}
