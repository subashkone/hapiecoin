"use client";
// The expiry the Vol and Structure tabs read (HC-WS-094, HC-WS-098): the workspace expiry when the trader chose
// one (the chain's strip or the term-structure chips), else the followed strategy's nearest expiry, else the
// nearest listed one; only listed expiries are ever subscribed, so an expired or unlisted leg never leaves a
// tab waiting for a chain that will not come.
import { useMemo } from "react";
import { nearestExpiry } from "@/lib/chain/expiries";
import { useExpiries } from "@/lib/chain/useExpiries";
import { useUiStore } from "@/lib/store";
import { type StrategyAnalysis, useStrategyAnalysis } from "@/lib/strategy/useStrategyAnalysis";

export interface ShownExpiry {
  asset: StrategyAnalysis["asset"];
  expiries: string[];
  expiry: string | null;
  /** The followed strategy's nearest listed expiry, when it has option legs. */
  legsExpiry: string | null;
  a: StrategyAnalysis;
}

export function useShownExpiry(): ShownExpiry {
  const a = useStrategyAnalysis();
  const expiries = useExpiries(a.asset);
  const storeExpiry = useUiStore((s) => s.expiry[a.asset] ?? null);
  const legsExpiry = useMemo(() => {
    const own = a.legs.filter((l) => l.kind !== "future").map((l) => l.expiry).sort();
    return own.find((e) => expiries.includes(e)) ?? null;
  }, [a.legs, expiries]);
  const expiry = storeExpiry && expiries.includes(storeExpiry) ? storeExpiry : (legsExpiry ?? nearestExpiry(expiries));
  return { asset: a.asset, expiries, expiry, legsExpiry, a };
}
