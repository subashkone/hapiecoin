"use client";
// One hook the Builder and the analysis pane share (HC-TR-090): the open legs, their live quotes, the engine
// legs and the analysis result, re-priced at most once per frame and once per 30 s clock tick.
// The pane can follow a paper / live strategy or ticked exchange positions (HC-TR-143, HC-TR-144, ADR-026):
// those legs are priced at their entry premiums, so the payoff is the position's, not a re-quote of it.
// While the adjustment workbench holds a draft for the followed strategy (ADR-044, HC-TR-149) the pane shows the
// position *after* the change (kept lots at entry, adds at the mark) and keeps the *before* result for the ghost
// curve and the before → after strip; both are valued at the draft's "value at" date.
import type { AnalyzeOptions, AnalyzeResult, Leg as PricingLeg } from "@hapiecoin/pricing";
import type { Quote, Strategy, StrategyLeg as ServerLeg, Underlying } from "@hapiecoin/schema";
import { useEffect, useMemo, useState } from "react";
import { type AdjustDraft, type MarkOf, afterLegs, beforeLegs, pickToLeg, valuationMsOf } from "@/lib/adjust/model";
import { nearestExpiryValuationMs } from "@/lib/strategy/analysis";
import { useLivePositions } from "@/lib/api/live";
import { useCredential, useSettings } from "@/lib/api/queries";
import { useStrategies } from "@/lib/api/strategies";
import { useSpot } from "@/lib/gateway/hooks";
import { useLegQuotes } from "@/lib/gateway/useLegQuotes";
import { type MoneyFormat, USD } from "@/lib/money";
import { useAnalysis } from "@/lib/pricing/client";
import { settlementHourUtc, toPricingLegs } from "@/lib/pricing/legs";
import { type PaneSource, useUiStore } from "@/lib/store";
import { venueCalendar } from "@/lib/venue";
import type { StrategyLeg } from "./legs";

import { positionToLeg } from "./positions";

export type AnalysisSource = { kind: "builder" } | { kind: "strategy"; id: string; name: string; status: Strategy["status"] } | { kind: "positions"; count: number };

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
  /** Whose legs these are (ADR-026). */
  source: AnalysisSource;
  /** The workbench draft when the pane shows a position being adjusted (ADR-044), else null. */
  adjusting: AdjustDraft | null;
  /** The followed strategy's open legs (server shape) while adjusting; empty otherwise. */
  openLegs: ServerLeg[];
  /** The position before the change (same options and valuation date) while adjusting; null otherwise. */
  before: AnalyzeResult | null;
  /** Live mark per venue symbol for any leg or pick the pane prices. */
  markOf: MarkOf;
  /** Bumps when a subscribed quote changes (mark freshness). */
  quoteVersion: number;
  /** The instant the "expiry" figures are valued at while adjusting (the "value at" chip), else undefined. */
  valuationMs: number | undefined;
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

const DEFAULT_LOTS: Record<Underlying, string> = { BTC: "0.001", ETH: "0.01", XAUT: "0.001" };
const NO_LEGS: StrategyLeg[] = [];

/** The followed strategy (paper or live) when the pane source names one that still exists. */
function useFollowedStrategy(source: PaneSource): Strategy | undefined {
  const id = source?.kind === "strategy" ? source.id : null;
  const { data } = useStrategies();
  return useMemo(() => (id === null ? undefined : data?.find((s) => s.id === id && (s.status === "paper" || s.status === "live"))), [data, id]);
}

/** Ticked exchange positions as legs (all on one asset: the first parsable position's). */
function usePositionLegs(source: PaneSource, lotSizes: Record<Underlying, string> | undefined): { legs: StrategyLeg[]; asset: Underlying | null } {
  const ids = source?.kind === "positions" ? source.productIds : null;
  const { data: credential } = useCredential();
  const brokerId = credential?.items[0]?.brokerId ?? null;
  const { data } = useLivePositions(brokerId, ids !== null);
  return useMemo(() => {
    if (ids === null || !data) return { legs: NO_LEGS, asset: null };
    const legs: StrategyLeg[] = [];
    let asset: Underlying | null = null;
    for (const p of data.positions) {
      if (!ids.includes(p.productId) || !p.symbol) continue;
      const probe = positionToLeg(p, "1");
      if (!probe) continue;
      const leg = positionToLeg(p, lotSizes?.[probe.asset] ?? DEFAULT_LOTS[probe.asset]);
      if (!leg) continue;
      asset ??= leg.asset;
      if (leg.asset === asset) legs.push(leg);
    }
    return { legs, asset };
  }, [ids, data, lotSizes]);
}

/**
 * @param scope "pane" (default) honours the pane source; "builder" always analyses the Builder's own legs
 *   (the Builder ticket and the trade flow must never read a followed strategy's figures).
 */
export function useStrategyAnalysis(scope: "pane" | "builder" = "pane"): StrategyAnalysis {
  const builderAsset = useUiStore((s) => s.asset);
  const allLegs = useUiStore((s) => s.legs[s.asset]);
  const meta = useUiStore((s) => s.strategy[s.asset]);
  const targetPriceState = useUiStore((s) => s.targetPrice);
  const targetDays = useUiStore((s) => s.targetDays);
  const paneSource = useUiStore((s) => (scope === "pane" ? s.paneSource : null));
  const draft = useUiStore((s) => (scope === "pane" ? s.adjust : null));
  const { data: settings } = useSettings();
  const followed = useFollowedStrategy(paneSource);
  const positions = usePositionLegs(paneSource, settings?.lotSizes);
  const adjusting = draft !== null && followed !== undefined && draft.strategyId === followed.id ? draft : null;

  const source: AnalysisSource = followed ? { kind: "strategy", id: followed.id, name: followed.name, status: followed.status } : positions.asset ? { kind: "positions", count: positions.legs.length } : { kind: "builder" };
  const asset = followed?.asset ?? positions.asset ?? builderAsset;
  const openLegs = useMemo(() => (followed ? followed.legs.filter((l) => l.status === "open") : []), [followed]);
  const heldLegs = useMemo(() => {
    if (followed) return beforeLegs(openLegs, followed.asset);
    if (positions.asset) return positions.legs;
    return allLegs.filter((l) => l.status === "open" && l.enabled !== false);
  }, [followed, openLegs, positions, allLegs]);
  // while adjusting, subscribe to every contract the draft touches so the adds are priced at the live mark
  const quoteLegs = useMemo(() => (adjusting ? [...heldLegs, ...adjusting.picks.map((p) => pickToLeg(p, asset))] : heldLegs), [adjusting, heldLegs, asset]);
  // a followed position keeps its entry premiums (like custom prices); the Builder follows its own price mode
  const priceMode = source.kind === "builder" ? meta.priceMode : "custom";

  const { quoteFor, version: quoteVersion } = useLegQuotes(asset, quoteLegs);
  const markOf = useMemo<MarkOf>(() => {
    const bySymbol = new Map(quoteLegs.map((l) => [l.symbol, l] as const));
    return (symbol) => {
      const l = bySymbol.get(symbol);
      return l ? quoteFor(l)?.mark : undefined;
    };
  }, [quoteLegs, quoteFor]);
  const legs = useMemo(() => (adjusting ? afterLegs(adjusting, openLegs, asset, markOf) : heldLegs), [adjusting, openLegs, asset, markOf, heldLegs]);
  const spotState = useSpot(asset);
  const lotSize = settings?.lotSizes[asset];
  const money: MoneyFormat = settings ? { currency: settings.currency === "INR" ? "INR" : "USD", rate: settings.conversionRate } : USD;
  const nowMs = useClock();
  // ADR-059: a calendar or diagonal values its expiry curve at the nearest expiry (later legs keep time value); the
  // workbench's own valuation rule takes over while adjusting
  const valuationMs = useMemo(() => (adjusting ? valuationMsOf(adjusting, openLegs, asset, nowMs) : nearestExpiryValuationMs(legs, settlementHourUtc(asset), nowMs)), [adjusting, openLegs, asset, nowMs, legs]);
  const spot = spotState?.price !== undefined && Number.isFinite(Number(spotState.price)) ? Number(spotState.price) : null;

  const priceFor = useMemo(
    () => (leg: StrategyLeg): string => {
      if (priceMode === "custom") return leg.price;
      if (leg.kind === "future") return spotState?.price ?? leg.price;
      return quoteFor(leg)?.mark ?? leg.price;
    },
    [priceMode, quoteFor, spotState?.price],
  );
  const pricingLegs = useMemo(
    () =>
      toPricingLegs(legs, lotSize, {
        mark: priceMode === "custom" ? undefined : (l) => quoteFor(l)?.mark,
        iv: (l) => quoteFor(l)?.markIv,
        spot: spotState?.price,
      }),
    [legs, lotSize, priceMode, quoteFor, spotState?.price],
  );
  const targetPrice = targetPriceState ?? spot ?? 0;
  const options: AnalyzeOptions | null = useMemo(
    () =>
      spot === null || pricingLegs.length === 0
        ? null
        : { spot, nowMs, targetDays, targetSpot: targetPrice, calendar: venueCalendar(asset), defaultIv: 0.5, ...(valuationMs === undefined ? {} : { valuationMs }) },
    [spot, pricingLegs.length, nowMs, targetDays, targetPrice, asset, valuationMs],
  );
  const { result, error, pending } = useAnalysis(pricingLegs, options);
  // the position before the change, on the same axis and date, for the ghost curve and the before → after strip
  const beforePricing = useMemo(() => (adjusting ? toPricingLegs(heldLegs, lotSize, { iv: (l) => quoteFor(l)?.markIv, spot: spotState?.price }) : []), [adjusting, heldLegs, lotSize, quoteFor, spotState?.price]);
  const beforeOptions = useMemo(() => (adjusting && spot !== null && beforePricing.length ? { spot, nowMs, targetDays, targetSpot: targetPrice, calendar: venueCalendar(asset), defaultIv: 0.5, ...(valuationMs === undefined ? {} : { valuationMs }) } : null), [adjusting, spot, beforePricing.length, nowMs, targetDays, targetPrice, asset, valuationMs]);
  const { result: before } = useAnalysis(beforePricing, beforeOptions);
  return { asset, legs, pricingLegs, result, error, pending, spot, spotText: spotState?.price, lotSize, money, quoteFor, priceFor, targetPrice, targetDays, nowMs, source, adjusting, openLegs, before: adjusting ? before : null, markOf, quoteVersion, valuationMs };
}
