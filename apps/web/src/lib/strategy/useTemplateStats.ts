"use client";
// Template cards priced at the live chain (HC-TR-106, 107): every template is materialised on the venue ladder and
// analysed in the pricing worker once per chain snapshot, giving POP, reward:risk and the outlook it actually
// expresses at ±6 % (the "Recommended for outlook" filter reads the payoff, not the template's label).
import type { AnalyzeResult } from "@hapiecoin/pricing";
import type { Underlying } from "@hapiecoin/schema";
import { useEffect, useRef, useState } from "react";
import { getPricingClient } from "@/lib/pricing/client";
import { settlementHourUtc, toPricingLegs } from "@/lib/pricing/legs";
import { pnlAt } from "./analysis";
import { type StrategyLeg, addLeg as addLegPure } from "./legs";
import { type ChainStrike, type MaterialiseInput, type StrategyTemplate, materialiseTemplate } from "./templates";

export const OUTLOOKS = ["Bullish", "Bearish", "Neutral", "Volatile"] as const;
export type Outlook = (typeof OUTLOOKS)[number];

/** Outlook from the expiry payoff: profit at +6 % / −6 % / spot decides the bucket; null when nothing is clear. */
export function classifyOutlook(points: AnalyzeResult["points"], spot: number): Outlook | null {
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
  const key = enabled && input.expiry && input.spot && input.lotSize && input.rows.length ? `${input.asset}|${input.expiry}|${input.lots}|${input.lotSize}|${input.version}` : "";
  useEffect(() => {
    if (key === "") {
      seq.current += 1;
      setStats(new Map());
      return;
    }
    const id = (seq.current += 1);
    const client = getPricingClient();
    const spot = input.spot!;
    const mat: MaterialiseInput = { asset: input.asset, expiry: input.expiry!, expiries: input.expiries, rows: input.rows, atm: input.atm, lots: input.lots };
    const run = async () => {
      const out = new Map<string, TemplateStat>();
      for (const tpl of templates) {
        const r = materialiseTemplate(tpl, mat);
        if (!r.ok) continue;
        let legs: StrategyLeg[] = [];
        let ok = true;
        for (const l of r.legs) {
          const a = addLegPure(legs, l);
          if (!a.ok) {
            ok = false;
            break;
          }
          legs = a.legs;
        }
        if (!ok) continue;
        const priced = toPricingLegs(legs, input.lotSize);
        if (priced.length === 0) continue;
        try {
          const res = await client.analyze(priced, { spot, nowMs: input.nowMs, defaultIv: 0.5, settlementHourUtc: settlementHourUtc(input.asset), points: 81 });
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
