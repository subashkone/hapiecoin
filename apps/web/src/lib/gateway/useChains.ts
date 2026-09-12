"use client";
// Several expiries of one asset at once (HC-WS-095 term structure): one gateway subscription per expiry and
// one frame-batched re-render per burst of ticks, like useLegQuotes.
import { type Underlying, chainTopic } from "@hapiecoin/schema";
import { useVenueId } from "@/lib/useVenue";
import { useEffect, useMemo, useState } from "react";
import type { ChainState } from "@/lib/gateway/reducer";
import { useGateway } from "./hooks";

export function useChains(asset: Underlying, expiries: readonly string[]): Map<string, ChainState> {
  const gw = useGateway();
  const venue = useVenueId();
  const key = [...expiries].sort().join(",");
  const [version, setVersion] = useState(0);
  useEffect(() => {
    if (expiries.length === 0) return;
    const topics = expiries.map((e) => chainTopic(venue, asset, e));
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
    // `key` is the sorted expiry list; `venue`, `asset` and `gw` complete the subscription identity.
  }, [gw, venue, asset, key]);
  return useMemo(() => {
    const m = new Map<string, ChainState>();
    for (const e of key ? key.split(",") : []) {
      const c = gw.getChain(chainTopic(venue, asset, e));
      if (c) m.set(e, c);
    }
    return m;
    // `version` is the change counter for the gateway state read here.
  }, [gw, venue, asset, key, version]);
}
