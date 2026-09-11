"use client";
// Live P&L for every strategy of the user (HC-TR-059, 061, 073): one quote subscription per asset, prices
// from the same gateway state the chain uses, lot sizes from settings, money format from settings.
import type { Strategy, StrategyLeg as ServerLeg, Underlying } from "@hapiecoin/schema";
import { UNDERLYINGS } from "@hapiecoin/schema";
import { useMemo } from "react";
import { useBrokers, useCredential, useSettings } from "@/lib/api/queries";
import { useSpot } from "@/lib/gateway/hooks";
import { useLegQuotes } from "@/lib/gateway/useLegQuotes";
import { type MoneyFormat, USD } from "@/lib/money";
import { type StrategyPnl, serverLegToLocal, strategyPnl } from "./paper";

const DEFAULT_LOTS: Record<Underlying, string> = { BTC: "0.001", ETH: "0.01", XAUT: "0.001" };

export interface PaperBook {
  /** Current price of a leg (live mark, spot for futures) or null when no quote yet. */
  priceOf: (s: Strategy, leg: ServerLeg) => number | null;
  pnlOf: (s: Strategy) => StrategyPnl;
  spotOf: (asset: Underlying) => number | null;
  lotSizeOf: (asset: Underlying) => string;
  money: MoneyFormat;
  brokerName: (id: string | null) => string;
  /** The label of the key a strategy trades through (ADR-068), or null when unknown. */
  accountLabel: (id: string | null | undefined) => string | null;
  /** Bumps when any subscribed quote changes, so memoised rows recompute. */
  version: number;
}

export function usePaperBook(strategies: readonly Strategy[]): PaperBook {
  const { data: settings } = useSettings();
  const { data: brokers } = useBrokers();
  const { data: credential } = useCredential();
  const legsBy = useMemo(() => {
    const out: Record<Underlying, ReturnType<typeof serverLegToLocal>[]> = { BTC: [], ETH: [], XAUT: [] };
    for (const s of strategies) for (const l of s.legs) if (l.status === "open" && (s.status === "paper" || s.status === "live")) out[s.asset].push(serverLegToLocal(l, s.asset));
    return out;
  }, [strategies]);
  const btc = useLegQuotes("BTC", legsBy.BTC);
  const eth = useLegQuotes("ETH", legsBy.ETH);
  const xaut = useLegQuotes("XAUT", legsBy.XAUT);
  const spotBtc = useSpot("BTC");
  const spotEth = useSpot("ETH");
  const spotXaut = useSpot("XAUT");
  const quotes = { BTC: btc, ETH: eth, XAUT: xaut };
  const spots = { BTC: spotBtc, ETH: spotEth, XAUT: spotXaut };
  const version = btc.version + eth.version + xaut.version;
  const money: MoneyFormat = settings ? { currency: settings.currency === "INR" ? "INR" : "USD", rate: settings.conversionRate } : USD;

  return useMemo(() => {
    void version; // quote change counter: the gateway state behind quoteFor is read on demand
    const spotOf = (asset: Underlying) => {
      const p = spots[asset]?.price;
      return p !== undefined && Number.isFinite(Number(p)) ? Number(p) : null;
    };
    const lotSizeOf = (asset: Underlying) => settings?.lotSizes[asset] ?? DEFAULT_LOTS[asset];
    const priceOf = (s: Strategy, leg: ServerLeg) => {
      if (leg.kind === "future") return spotOf(s.asset);
      const q = quotes[s.asset].quoteFor(serverLegToLocal(leg, s.asset));
      return q?.mark !== undefined && Number.isFinite(Number(q.mark)) ? Number(q.mark) : null;
    };
    return {
      priceOf,
      pnlOf: (s: Strategy) => strategyPnl(s, (l) => priceOf(s, l), lotSizeOf(s.asset)),
      spotOf,
      lotSizeOf,
      money,
      brokerName: (id: string | null) => brokers?.find((b) => b.id === id)?.name ?? "Delta Exchange",
      accountLabel: (id: string | null | undefined) => (id ? (credential?.items.find((i) => i.id === id)?.label ?? null) : null),
      version,
    };
  }, [version, quotes, spots, settings, brokers, credential, money]);
}

export const ASSETS = UNDERLYINGS;
