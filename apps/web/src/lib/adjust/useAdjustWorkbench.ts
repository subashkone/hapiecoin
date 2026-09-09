"use client";
// Everything the workbench screens read (ADR-044, HC-TR-148..151): the followed strategy under adjustment,
// its open legs, the draft, the pane's before / after analysis, the marks and their age, the ticket figures
// (effects, cashflow, cap, summary and guard rails) and the actions that change the draft.
import type { Strategy, StrategyLeg as ServerLeg, Underlying } from "@hapiecoin/schema";
import { useEffect, useMemo, useRef, useState } from "react";
import { useStrategies } from "@/lib/api/strategies";
import { useSettings } from "@/lib/api/queries";
import { useUiStore } from "@/lib/store";
import { openLegs } from "@/lib/strategy/paper";
import { type StrategyAnalysis, useStrategyAnalysis } from "@/lib/strategy/useStrategyAnalysis";
import { type AdjustDraft, type ChangeSummary, type Effect, type PickInput, addsZeroDte, cashflow, combinedExpiries, effects, isEmptyDraft, loadPlan, openCountAfter, overCap, pickOnDraft, removePick, removePlan, savePlan, setLotsAfter, setPickLots, setValuation, summarize } from "./model";

/** Marks older than this are called stale in the guard rails (Review re-reads them anyway). */
export const STALE_MARKS_MS = 60_000;
const DEFAULT_LOTS: Record<Underlying, string> = { BTC: "0.001", ETH: "0.01", XAUT: "0.001" };

export interface AdjustWorkbench {
  a: StrategyAnalysis;
  draft: AdjustDraft;
  strategy: Strategy;
  /** The strategy's open legs (server shape): the one list the ticket, the chain and the body are built from. */
  open: ServerLeg[];
  lotSize: string;
  effects: Effect[];
  empty: boolean;
  /** Premium the change moves, USD: positive received, negative paid. */
  cash: number;
  countAfter: number;
  overCap: boolean;
  expiries: string[];
  /** Seconds since the last quote tick for the legs the draft touches. */
  markAgeSec: number;
  stale: boolean;
  summary: ChangeSummary;
  pick: (input: PickInput) => void;
  setLotsAfter: (legId: string, lots: number) => void;
  setPickLots: (pickId: string, lots: number) => void;
  removePick: (pickId: string) => void;
  setValuation: (expiry: string | null) => void;
  reset: () => void;
  exit: () => void;
  /** Replace the working changes with another draft's (a quick fix), keeping the saved plans. */
  applyDraft: (next: AdjustDraft) => void;
  savePlan: () => void;
  loadPlan: (planId: string) => void;
  removePlan: (planId: string) => void;
}

/** Seconds since `version` last changed (or since `startedAt` before the first tick), ticking once a second. */
function useAgeSeconds(version: number, startedAt: number): number {
  const [last, setLast] = useState(startedAt);
  const [now, setNow] = useState(() => Date.now());
  const first = useRef(true);
  useEffect(() => {
    // the mount run is not a tick: until a quote arrives the age counts from when the draft opened
    if (first.current) {
      first.current = false;
      return;
    }
    setLast(Date.now());
  }, [version]);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  return Math.max(0, Math.floor((now - last) / 1000));
}

export function useAdjustWorkbench(): AdjustWorkbench | null {
  const draft = useUiStore((s) => s.adjust);
  const updateAdjust = useUiStore((s) => s.updateAdjust);
  const closeAdjust = useUiStore((s) => s.closeAdjust);
  const { data: strategies } = useStrategies();
  const { data: settings } = useSettings();
  const a = useStrategyAnalysis();
  const strategy = useMemo(() => (draft ? strategies?.find((s) => s.id === draft.strategyId && (s.status === "paper" || s.status === "live")) : undefined), [draft, strategies]);
  const open = useMemo(() => (strategy ? openLegs(strategy) : []), [strategy]);
  const markAgeSec = useAgeSeconds(a.quoteVersion, draft?.startedAt ?? 0);
  const asset = strategy?.asset ?? "BTC";
  const lotSize = settings?.lotSizes[asset] ?? DEFAULT_LOTS[asset];
  return useMemo(() => {
    if (!draft || !strategy) return null;
    const cash = cashflow(draft, open, a.markOf, lotSize);
    const stale = markAgeSec * 1000 > STALE_MARKS_MS;
    const cap = overCap(draft, open);
    return {
      a,
      draft,
      strategy,
      open,
      lotSize,
      effects: effects(draft, open),
      empty: isEmptyDraft(draft, open),
      cash,
      countAfter: openCountAfter(draft, open),
      overCap: cap,
      expiries: combinedExpiries(draft, open),
      markAgeSec,
      stale,
      summary: summarize(a.before, a.result, cash, a.money, { zeroDte: addsZeroDte(draft, open, a.nowMs), overCap: cap, staleMarks: stale }),
      pick: (input) => updateAdjust((d) => pickOnDraft(d, open, asset, input)),
      setLotsAfter: (legId, lots) => updateAdjust((d) => setLotsAfter(d, legId, lots)),
      setPickLots: (pickId, lots) => updateAdjust((d) => setPickLots(d, pickId, lots)),
      removePick: (pickId) => updateAdjust((d) => removePick(d, pickId)),
      setValuation: (expiry) => updateAdjust((d) => setValuation(d, expiry)),
      reset: () => updateAdjust((d) => ({ ...d, lotsAfter: {}, picks: [] })),
      exit: closeAdjust,
      applyDraft: (next) => updateAdjust((d) => ({ ...d, lotsAfter: { ...next.lotsAfter }, picks: next.picks.map((p) => ({ ...p })), valuation: next.valuation })),
      savePlan: () => updateAdjust((d) => savePlan(d)),
      loadPlan: (planId) => updateAdjust((d) => loadPlan(d, planId)),
      removePlan: (planId) => updateAdjust((d) => removePlan(d, planId)),
    };
  }, [draft, strategy, open, a, lotSize, markAgeSec, updateAdjust, closeAdjust]);
}
