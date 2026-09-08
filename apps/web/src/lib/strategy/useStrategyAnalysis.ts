"use client";
// One hook the Builder and the analysis pane share (HC-TR-090): the asset's open legs, their live quotes,
// the engine legs and the analysis result, re-priced at most once per frame and once per 30 s clock tick.
import type { AnalyzeOptions, AnalyzeResult, Leg as PricingLeg } from "@hapiecoin/pricing";
import type { Quote, Underlying } from "@hapiecoin/schema";
import { useEffect, useMemo, useState } from "react";
import { useSettings } from "@/lib/api/queries";
import { useSpot } from "@/lib/gateway/hooks";
import { useLegQuotes } from "@/lib/gateway/useLegQuotes";
import { type MoneyFormat, USD } from "@/lib/money";
import { useAnalysis } from "@/lib/pricing/client";
import { settlementHourUtc, toPricingLegs } from "@/lib/pricing/legs";
import { useUiStore } from "@/lib/store";
import type { StrategyLeg } from "./legs";

export interface StrategyAnalysis {
  asset: Underlying;
  legs: StrategyLeg[];
  pricingLegs: PricingLeg[];
  result: AnalyzeResult | null;
  error: string | null;
  pending: boolean;
  spot: number | null;
  spotText: string | undefined;
  lotSize: string | undefined;
  money: MoneyFormat;
  quoteFor: (leg: StrategyLeg) => Quote | undefined;
  /** Price used for a leg right now: live mark in live mode, stored price in custom mode. */
  priceFor: (leg: StrategyLeg) => string;
  targetPrice: number;
  targetDays: number;
  nowMs: number;
}

/** A clock that ticks every 30 s so time-to-expiry moves without re-pricing on every render. */
function useClock(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Math.floor(Date.now() / intervalMs) * intervalMs);
  useEffect(() => {
    const id = setInterval(() => setNow(Math.floor(Date.now() / intervalMs) * intervalMs), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

export function useStrategyAnalysis(): StrategyAnalysis {
  const asset = useUiStore((s) => s.asset);
  const allLegs = useUiStore((s) => s.legs[s.asset]);
  const meta = useUiStore((s) => s.strategy[s.asset]);
  const targetPriceState = useUiStore((s) => s.targetPrice);
  const targetDays = useUiStore((s) => s.targetDays);
  const legs = useMemo(() => allLegs.filter((l) => l.status === "open"), [allLegs]);
  const { quoteFor } = useLegQuotes(asset, legs);
  const spotState = useSpot(asset);
  const { data: settings } = useSettings();
  const lotSize = settings?.lotSizes[asset];
  const money: MoneyFormat = settings ? { currency: settings.currency === "INR" ? "INR" : "USD", rate: settings.conversionRate } : USD;
  const nowMs = useClock();
  const spot = spotState?.price !== undefined && Number.isFinite(Number(spotState.price)) ? Number(spotState.price) : null;

  const priceFor = useMemo(
    () => (leg: StrategyLeg): string => {
      if (meta.priceMode === "custom") return leg.price;
      if (leg.kind === "future") return spotState?.price ?? leg.price;
      return quoteFor(leg)?.mark ?? leg.price;
    },
    [meta.priceMode, quoteFor, spotState?.price],
  );
  const pricingLegs = useMemo(
    () =>
      toPricingLegs(legs, lotSize, {
        mark: meta.priceMode === "custom" ? undefined : (l) => quoteFor(l)?.mark,
        iv: (l) => quoteFor(l)?.markIv,
        spot: spotState?.price,
      }),
    [legs, lotSize, meta.priceMode, quoteFor, spotState?.price],
  );
  const targetPrice = targetPriceState ?? spot ?? 0;
  const options: AnalyzeOptions | null = useMemo(
    () =>
      spot === null || pricingLegs.length === 0
        ? null
        : { spot, nowMs, targetDays, targetSpot: targetPrice, settlementHourUtc: settlementHourUtc(asset), defaultIv: 0.5 },
    [spot, pricingLegs.length, nowMs, targetDays, targetPrice, asset],
  );
  const { result, error, pending } = useAnalysis(pricingLegs, options);
  return { asset, legs, pricingLegs, result, error, pending, spot, spotText: spotState?.price, lotSize, money, quoteFor, priceFor, targetPrice, targetDays, nowMs };
}
