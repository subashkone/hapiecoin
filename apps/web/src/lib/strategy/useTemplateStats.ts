"use client";
// Template cards priced at the live chain (HC-TR-106, 107): every template is materialised on the venue ladder and
// analysed in the pricing worker once per chain snapshot, giving POP, reward:risk and the outlook it actually
// expresses at ±6 % (the "Recommended for outlook" filter reads the payoff, not the template's label).
import type { AnalyzeResult } from "@hapiecoin/pricing";
import type { Underlying } from "@hapiecoin/schema";
import { useEffect, useRef, useState } from "react";
import { getPricingClient } from "@/lib/pricing/client";
import { settlementHourUtc } from "@/lib/pricing/legs";
import { venueCalendar } from "@/lib/venue";
import { nearestExpiryValuationMs, pnlAt } from "./analysis";
import { placeTemplate } from "./placeTemplate";
import type { ChainStrike, MaterialiseInput, StrategyTemplate } from "./templates";

export const OUTLOOKS = ["Bullish", "Bearish", "Neutral", "Volatile"] as const;
export type Outlook = (typeof OUTLOOKS)[number];

/** Outlook from the expiry payoff: profit at +6 % / −6 % / spot decides the bucket; null when nothing is clear. */
export function classifyOutlook(points: readonly AnalyzeResult["points"][number][], spot: number): Outlook | null {
  if (points.length === 0 || !(spot > 0)) return null;
  const up = pnlAt(points, spot * 1.06) > 0;
  const down = pnlAt(points, spot * 0.94) > 0;
  const flat = pnlAt(points, spot) > 0;
  if (up && !down) return "Bullish";
  if (down && !up) return "Bearish";
  if (up && down && !flat) return "Volatile";
  if (flat && !up && !down) return "Neutral";
  if (flat) return "Neutral";
  return null;
}

export interface TemplateStat {
  pop: number | null;
  rr: number | null;
  maxProfit: number;
  maxLoss: number;
  outlook: Outlook | null;
}

export interface TemplateStatsInput {
  asset: Underlying;
  expiry: string | null;
  expiries: readonly string[];
  rows: readonly ChainStrike[];
  atm: number;
  /** Chains of later expiries (calendar-family templates); without the far chain those templates stay unpriced. */
  rowsByExpiry?: MaterialiseInput["rowsByExpiry"];
  lots: number;
  spot: number | null;
  lotSize: string | undefined;
  nowMs: number;
  /** Anything that changes when the chain moves (e.g. the snapshot seq); stats recompute when it does. */
  version: number | string;
}

/** POP, R:R and outlook per template name; empty until the chain, spot and lot size exist. */
export function useTemplateStats(templates: readonly StrategyTemplate[], input: TemplateStatsInput, enabled = true): Map<string, TemplateStat> {
  const [stats, setStats] = useState<Map<string, TemplateStat>>(new Map());
  const seq = useRef(0);
  const far = input.rowsByExpiry ? Object.keys(input.rowsByExpiry).sort().join(",") : "";
  const key = enabled && input.expiry && input.spot && input.lotSize && input.rows.length ? `${input.asset}|${input.expiry}|${input.lots}|${input.lotSize}|${input.version}|${far}` : "";
  useEffect(() => {
    if (key === "") {
      seq.current += 1;
      setStats(new Map());
      return;
    }
    const id = (seq.current += 1);
    const client = getPricingClient();
    const spot = input.spot!;
    const mat: MaterialiseInput = { asset: input.asset, expiry: input.expiry!, expiries: input.expiries, rows: input.rows, atm: input.atm, lots: input.lots, spot: String(spot), ...(input.rowsByExpiry ? { rowsByExpiry: input.rowsByExpiry } : {}) };
    const run = async () => {
      const out = new Map<string, TemplateStat>();
      for (const tpl of templates) {
        // GAPS #76: a calendar-family template refuses (`no-chain`) until the far expiry's rows are passed in, so its
        // card shows no figures rather than figures priced off the near expiry
        const placed = placeTemplate(tpl, mat, input.lotSize);
        if (!placed) continue;
        const { legs, priced } = placed;
        try {
          // ADR-059: a calendar-family template values its expiry figures at the nearest expiry, later legs keep time value
          const valuationMs = nearestExpiryValuationMs(legs, settlementHourUtc(input.asset), input.nowMs);
          const res = await client.analyze(priced, { spot, nowMs: input.nowMs, defaultIv: 0.5, calendar: venueCalendar(input.asset), points: 81, ...(valuationMs !== undefined ? { valuationMs } : {}) });
          if (id !== seq.current) return;
          out.set(tpl.name, { pop: Number.isFinite(res.pop) ? res.pop : null, rr: Number.isFinite(res.rewardRisk) ? res.rewardRisk : Number.isFinite(res.maxProfit) ? null : Number.POSITIVE_INFINITY, maxProfit: res.maxProfit, maxLoss: res.maxLoss, outlook: classifyOutlook(res.points, spot) });
        } catch {
          /* a template that cannot be priced shows no figures */
        }
      }
      if (id === seq.current) setStats(out);
    };
    void run();
    // the key captures every input by value; `templates` is a module constant
  }, [key]);
  return stats;
}
