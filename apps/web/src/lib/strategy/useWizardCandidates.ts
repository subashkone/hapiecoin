"use client";
// The wizard's pricing pass (ADR-072; HC-TR-177): every eligible template is placed on the venue ladder at the chosen
// expiry and analysed in the pricing worker, one pass per chain snapshot. A pass is never abandoned: while one runs a
// newer chain waits and one more pass follows, at most one pass every MIN_PASS_GAP_MS, so a fast feed cannot keep the
// first result from landing or flicker the cards. The thesis figures (P&L if right, fit, rank) derive from each
// result's expiry curve in `wizard.ts`, so a change of view or move never reprices.
import type { Underlying } from "@hapiecoin/schema";
import { useEffect, useRef, useState } from "react";
import { getPricingClient } from "@/lib/pricing/client";
import { venueCalendar } from "@/lib/venue";
import { placeTemplate } from "./placeTemplate";
import type { ChainStrike, MaterialiseInput, StrategyTemplate } from "./templates";
import type { WizardCandidate } from "./wizard";

/** The least time between the starts of two passes (a coalesced feed can bump the chain seq four times a second). */
export const MIN_PASS_GAP_MS = 2000;

export interface WizardPricingInput {
  venue: string;
  asset: Underlying;
  expiry: string | null;
  expiries: readonly string[];
  rows: readonly ChainStrike[];
  atm: number;
  lots: number;
  spot: number | null;
  lotSize: string | undefined;
  nowMs: number;
  /** Anything that changes when the chain moves (the snapshot seq); a pass follows when it does. */
  version: number | string;
}

export interface WizardPricing {
  candidates: readonly WizardCandidate[];
  /** waiting: no chain, spot or lot size yet · pricing: the first pass has not landed · ready: candidates exist. */
  state: "waiting" | "pricing" | "ready";
  /** A pass is in flight (the shown candidates are the previous pass's while `ready`). */
  running: boolean;
  /** When the shown candidates were priced (ms), null before the first pass lands. */
  pricedAt: number | null;
}

interface Job {
  key: string;
  input: WizardPricingInput;
}

export function useWizardCandidates(templates: readonly StrategyTemplate[], input: WizardPricingInput, enabled = true): WizardPricing {
  const [out, setOut] = useState<{ candidates: readonly WizardCandidate[]; pricedAt: number | null }>({ candidates: [], pricedAt: null });
  const [running, setRunning] = useState(false);
  const latest = useRef<Job | null>(null);
  const busy = useRef(false);
  const lastStart = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Bumped when the inputs go away or the hook unmounts: a pass that finishes afterwards writes nothing. */
  const generation = useRef(0);
  const key = enabled && input.expiry && input.spot && input.lotSize && input.rows.length ? `${input.venue}|${input.asset}|${input.expiry}|${input.lots}|${input.lotSize}|${input.version}` : "";

  useEffect(() => {
    if (key === "") {
      latest.current = null;
      generation.current += 1;
      busy.current = false;
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
      setOut({ candidates: [], pricedAt: null });
      setRunning(false);
      return;
    }
    latest.current = { key, input };
    const gen = generation.current;
    const client = getPricingClient();

    const pass = async (job: Job): Promise<WizardCandidate[]> => {
      const { input: i } = job;
      const spot = i.spot!;
      const mat: MaterialiseInput = { asset: i.asset, expiry: i.expiry!, expiries: i.expiries, rows: i.rows, atm: i.atm, lots: i.lots, spot: String(spot) };
      const calendar = venueCalendar(i.asset, i.venue);
      const found: WizardCandidate[] = [];
      for (const tpl of templates) {
        // a template that reaches past the listed ladder (`out-of-range`) or meets an unquoted strike drops out silently:
        // the panel says how many of the three fit this ladder
        const placed = placeTemplate(tpl, mat, i.lotSize);
        if (!placed) continue;
        try {
          const result = await client.analyze(placed.priced, { spot, nowMs: i.nowMs, defaultIv: 0.5, calendar, points: 81 });
          found.push({ template: tpl, legs: placed.legs, result });
        } catch {
          /* a template that cannot be priced is not offered */
        }
      }
      return found;
    };
    const start = async () => {
      const job = latest.current;
      if (!job || busy.current || gen !== generation.current) return;
      busy.current = true;
      lastStart.current = Date.now();
      setRunning(true);
      const found = await pass(job);
      busy.current = false;
      if (gen !== generation.current) return;
      setOut({ candidates: found, pricedAt: Date.now() });
      if (latest.current && latest.current.key !== job.key) schedule();
      else setRunning(false);
    };
    const schedule = () => {
      if (timer.current) return;
      const wait = Math.max(0, MIN_PASS_GAP_MS - (Date.now() - lastStart.current));
      timer.current = setTimeout(() => {
        timer.current = null;
        void start();
      }, wait);
    };
    // a running pass schedules the next one itself when it lands
    if (!busy.current) schedule();
    // the key captures every input by value; `templates` is a module constant
  }, [key]);

  useEffect(
    () => () => {
      generation.current += 1;
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  return { candidates: out.candidates, state: key === "" ? "waiting" : out.pricedAt === null ? "pricing" : "ready", running, pricedAt: out.pricedAt };
}
