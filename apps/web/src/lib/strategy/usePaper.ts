"use client";
// Live P&L for every strategy of the user (HC-TR-059, 061, 073): one quote subscription per asset, prices
// from the same gateway state the chain uses, lot sizes from settings, money format from settings.
import type { Strategy, StrategyLeg as ServerLeg, Underlying } from "@hapiecoin/schema";
import { UNDERLYINGS } from "@hapiecoin/schema";
import { useMemo } from "react";
import { useBrokers, useSettings } from "@/lib/api/queries";
import { useSpot } from "@/lib/gateway/hooks";
import { DEFAULT_VENUE, type VenueId } from "@hapiecoin/venues/core";
import { lotSizeFor } from "@/lib/venue";
import { useLegQuotes } from "@/lib/gateway/useLegQuotes";
import { type MoneyFormat, USD } from "@/lib/money";
import { type StrategyPnl, serverLegToLocal, strategyPnl } from "./paper";

const DEFAULT_LOTS: Record<Underlying, string> = { BTC: "0.001", ETH: "0.01", XAUT: "0.001" };

export interface PaperBook {
  /** Current price of a leg (live mark, spot for futures) or null when no quote yet. */
  priceOf: (s: Strategy, leg: ServerLeg) => number | null;
  pnlOf: (s: Strategy) => StrategyPnl;
  spotOf: (asset: Underlying) => number | null;
  /** Units per lot on `venue` (the strategy's; the default venue when omitted). */
  lotSizeOf: (asset: Underlying, venue?: string) => string;
  money: MoneyFormat;
  brokerName: (id: string | null) => string;
  /** Bumps when any subscribed quote changes, so memoised rows recompute. */
  version: number;
}

export function usePaperBook(strategies: readonly Strategy[]): PaperBook {
  const { data: settings } = useSettings();
  const { data: brokers } = useBrokers();
  // one subscription set per venue and asset (ADR-069): a strategy's quotes come from its own venue's chain
  const legsBy = useMemo(() => {
    const empty = (): Record<Underlying, ReturnType<typeof serverLegToLocal>[]> => ({ BTC: [], ETH: [], XAUT: [] });
    const out: Record<VenueId, Record<Underlying, ReturnType<typeof serverLegToLocal>[]>> = { delta_india: empty(), deribit: empty() };
    for (const s of strategies) for (const l of s.legs) if (l.status === "open" && (s.status === "paper" || s.status === "live")) out[s.venue][s.asset].push(serverLegToLocal(l, s.asset));
    return out;
  }, [strategies]);
  // the hook count is static: one call per venue and asset (the `Record<VenueId, ...>` above fails to compile when VENUES grows)
  const dBtc = useLegQuotes("BTC", legsBy.delta_india.BTC, "delta_india");
  const dEth = useLegQuotes("ETH", legsBy.delta_india.ETH, "delta_india");
  const dXaut = useLegQuotes("XAUT", legsBy.delta_india.XAUT, "delta_india");
  const rBtc = useLegQuotes("BTC", legsBy.deribit.BTC, "deribit");
  const rEth = useLegQuotes("ETH", legsBy.deribit.ETH, "deribit");
  const rXaut = useLegQuotes("XAUT", legsBy.deribit.XAUT, "deribit");
  const spotBtc = useSpot("BTC");
  const spotEth = useSpot("ETH");
  const spotXaut = useSpot("XAUT");
  const quotes: Record<VenueId, Record<Underlying, ReturnType<typeof useLegQuotes>>> = { delta_india: { BTC: dBtc, ETH: dEth, XAUT: dXaut }, deribit: { BTC: rBtc, ETH: rEth, XAUT: rXaut } };
  const spots = { BTC: spotBtc, ETH: spotEth, XAUT: spotXaut };
  const version = dBtc.version + dEth.version + dXaut.version + rBtc.version + rEth.version + rXaut.version;
  const money: MoneyFormat = settings ? { currency: settings.currency === "INR" ? "INR" : "USD", rate: settings.conversionRate } : USD;

  return useMemo(() => {
    void version; // quote change counter: the gateway state behind quoteFor is read on demand
    const spotOf = (asset: Underlying) => {
      const p = spots[asset]?.price;
      return p !== undefined && Number.isFinite(Number(p)) ? Number(p) : null;
    };
    const lotSizeOf = (asset: Underlying, venue: string = DEFAULT_VENUE) => lotSizeFor(venue, asset, settings) ?? DEFAULT_LOTS[asset];
    const priceOf = (s: Strategy, leg: ServerLeg) => {
      if (leg.kind === "future") return spotOf(s.asset);
      const q = quotes[s.venue][s.asset].quoteFor(serverLegToLocal(leg, s.asset));
      return q?.mark !== undefined && Number.isFinite(Number(q.mark)) ? Number(q.mark) : null;
    };
    return {
      priceOf,
      pnlOf: (s: Strategy) => strategyPnl(s, (l) => priceOf(s, l), lotSizeOf(s.asset, s.venue)),
      spotOf,
      lotSizeOf,
      money,
      brokerName: (id: string | null) => brokers?.find((b) => b.id === id)?.name ?? "Delta Exchange",
      version,
    };
  }, [version, quotes, spots, settings, brokers, money]);
}

export const ASSETS = UNDERLYINGS;
