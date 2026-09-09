"use client";
// Portfolio aggregation (HC-TR-113, 116, 138): every active strategy of a kind priced in the worker at the live
// marks, summed into net greeks and the margin estimate. Recomputes when the strategies or the quotes change,
// throttled (trailing) so a busy feed re-prices at most once per window yet always settles.
import type { AnalyzeResult } from "@hapiecoin/pricing";
import type { Strategy } from "@hapiecoin/schema";
import { useEffect, useRef, useState } from "react";
import { getPricingClient } from "@/lib/pricing/client";
import { settlementHourUtc, toPricingLegs } from "@/lib/pricing/legs";
import { marginEstimate } from "./analysis";
import { openLegs, serverLegToLocal } from "./paper";
import type { PaperBook } from "./usePaper";

export interface StrategyFigures {
  greeks: AnalyzeResult["greeks"];
  /** Worst expiry loss for defined-risk strategies; null when the loss is unbounded. */
  margin: number | null;
  result: AnalyzeResult;
}
export interface Portfolio {
  open: number;
  netDelta: number;
  netGamma: number;
  netTheta: number;
  netVega: number;
  /** Σ margin estimates of the defined-risk strategies. */
  marginUsed: number;
  /** Strategies whose risk is unbounded (excluded from marginUsed). */
  undefinedRisk: number;
  byStrategy: Map<string, StrategyFigures>;
  pending: boolean;
}
export const EMPTY_PORTFOLIO: Portfolio = { open: 0, netDelta: 0, netGamma: 0, netTheta: 0, netVega: 0, marginUsed: 0, undefinedRisk: 0, byStrategy: new Map(), pending: false };

/** Sum the per-strategy figures. */
export function foldPortfolio(figures: ReadonlyMap<string, StrategyFigures>, pending = false): Portfolio {
  let d = 0;
  let g = 0;
  let t = 0;
  let v = 0;
  let margin = 0;
  let undefinedRisk = 0;
  for (const f of figures.values()) {
    d += f.greeks.delta;
    g += f.greeks.gamma;
    t += f.greeks.theta;
    v += f.greeks.vega;
    if (f.margin === null) undefinedRisk += 1;
    else margin += f.margin;
  }
  return { open: figures.size, netDelta: d, netGamma: g, netTheta: t, netVega: v, marginUsed: margin, undefinedRisk, byStrategy: new Map(figures), pending };
}

export function usePortfolio(strategies: readonly Strategy[] | undefined, book: PaperBook, kind: "paper" | "live", debounceMs = 400): Portfolio {
  const [portfolio, setPortfolio] = useState<Portfolio>(EMPTY_PORTFOLIO);
  const seq = useRef(0);
  const lastRun = useRef(0);
  const active = (strategies ?? []).filter((s) => s.status === kind && openLegs(s).length > 0);
  const key = active.map((s) => `${s.id}:${s.updatedAt}:${s.legs.length}`).join("|");
  useEffect(() => {
    if (!key) {
      seq.current += 1;
      setPortfolio(EMPTY_PORTFOLIO);
      return;
    }
    const id = (seq.current += 1);
    setPortfolio((p) => ({ ...p, pending: true }));
    // a feed that ticks faster than the window must not starve the run: wait only for what is left of the window
    const wait = Math.max(0, debounceMs - (Date.now() - lastRun.current));
    const timer = setTimeout(() => {
      lastRun.current = Date.now();
      const client = getPricingClient();
      const run = async () => {
        const out = new Map<string, StrategyFigures>();
        for (const s of active) {
          const spot = book.spotOf(s.asset);
          if (spot === null) continue;
          const legs = openLegs(s).map((l) => serverLegToLocal(l, s.asset));
          const priced = toPricingLegs(legs, book.lotSizeOf(s.asset), {
            mark: (leg) => {
              const server = openLegs(s).find((l) => l.id === leg.id);
              const p = server ? book.priceOf(s, server) : null;
              return p === null ? undefined : String(p);
            },
            spot: String(spot),
          });
          if (priced.length === 0) continue;
          try {
            const result = await client.analyze(priced, { spot, nowMs: Date.now(), defaultIv: 0.5, settlementHourUtc: settlementHourUtc(s.asset), points: 81 });
            if (id !== seq.current) return;
            out.set(s.id, { greeks: result.greeks, margin: marginEstimate(result), result });
          } catch {
            /* a strategy that cannot be priced is left out of the sums */
          }
        }
        if (id === seq.current) setPortfolio(foldPortfolio(out));
      };
      void run();
    }, wait);
    return () => clearTimeout(timer);
    // `key` captures the strategies; `book.version` bumps on every quote change and re-prices the same legs
  }, [key, book.version, kind, debounceMs]);
  return portfolio;
}
