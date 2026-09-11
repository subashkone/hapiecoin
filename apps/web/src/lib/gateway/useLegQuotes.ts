"use client";
// Live quotes for the legs of a strategy, which may sit on several expiries: one gateway subscription per
// distinct expiry, one frame-batched re-render per burst of ticks (HC-TR-018, HC-TR-019).
import { type Quote, chainTopic } from "@hapiecoin/schema";
import type { Underlying } from "@hapiecoin/schema";
import { CURRENT_VENUE } from "@/lib/venue";
import { useEffect, useMemo, useState } from "react";
import type { ChainState } from "@/lib/gateway/reducer";
import type { StrategyLeg } from "@/lib/strategy/legs";
import { useGateway } from "./hooks";

export type QuoteLookup = (leg: StrategyLeg) => Quote | undefined;

export function useLegQuotes(asset: Underlying, legs: readonly StrategyLeg[]): { chains: Map<string, ChainState>; quoteFor: QuoteLookup; version: number } {
  const gw = useGateway();
  const expiries = useMemo(() => [...new Set(legs.filter((l) => l.kind !== "future").map((l) => l.expiry))].sort(), [legs]);
  const key = expiries.join(",");
  const [version, setVersion] = useState(0);
  useEffect(() => {
    if (expiries.length === 0) return;
    const topics = expiries.map((e) => chainTopic(CURRENT_VENUE, asset, e));
    const offs = topics.map((t) => gw.subscribe(t));
    let frame: number | null = null;
    const bump = () => {
      if (frame !== null) return;
      const schedule = typeof requestAnimationFrame === "function" ? requestAnimationFrame : (cb: () => void) => setTimeout(cb, 16) as unknown as number;
      frame = schedule(() => {
        frame = null;
        setVersion((v) => v + 1);
      });
    };
    const offChain = gw.on("chain", (t) => {
      if (topics.includes(t)) bump();
    });
    bump();
    return () => {
      offs.forEach((off) => off());
      offChain();
      if (frame !== null && typeof cancelAnimationFrame === "function") cancelAnimationFrame(frame);
    };
    // `key` is the sorted expiry list; `asset` and `gw` complete the subscription identity.
  }, [gw, asset, key]);
  const chains = useMemo(() => {
    const m = new Map<string, ChainState>();
    for (const e of expiries) {
      const c = gw.getChain(chainTopic(CURRENT_VENUE, asset, e));
      if (c) m.set(e, c);
    }
    return m;
    // `version` is the change counter for the gateway state read here.
  }, [gw, asset, key, version]);
  const quoteFor: QuoteLookup = useMemo(
    () => (leg) => {
      if (leg.kind === "future") return undefined;
      const chain = chains.get(leg.expiry);
      if (!chain) return undefined;
      const row = chain.rows.find((r) => Number(r.strike) === Number(leg.strike));
      return leg.kind === "call" ? row?.call : row?.put;
    },
    [chains],
  );
  return { chains, quoteFor, version };
}
