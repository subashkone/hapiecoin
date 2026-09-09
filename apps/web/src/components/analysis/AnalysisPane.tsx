"use client";
// Right pane of the workspace (HC-WS-030..032): the analysis tabs. Payoff, Greeks, Ladder (Phase 2) and the
// Phase 5 Scenarios, Vol and Structure tabs (HC-WS-088..100).
import { Tabs, TabsContent, TabsList, TabsTrigger, cn } from "@hapiecoin/ui";
import { type ReactElement, useEffect } from "react";
import { useStrategies } from "@/lib/api/strategies";
import { type AnalysisTab, useUiStore } from "@/lib/store";
import { ModePill } from "@/components/trading/StrategyDetailsDialog";
import { GreeksPanel } from "./GreeksPanel";
import { LadderPanel } from "./LadderPanel";
import { PayoffPanel } from "./PayoffPanel";
import { ScenariosPanel } from "./ScenariosPanel";
import { StructurePanel } from "./StructurePanel";
import { VolPanel } from "./VolPanel";

export const ANALYSIS_TABS: { id: AnalysisTab; label: string; title: string }[] = [
  { id: "payoff", label: "Payoff", title: "P&L at expiry and on the target date" },
  { id: "scenarios", label: "Scenarios", title: "Price × date matrix of P&L, delta or theta with an IV shift" },
  { id: "greeks", label: "Greeks", title: "Net and per-leg Greeks" },
  { id: "vol", label: "Vol", title: "IV smile and term structure across the listed strikes" },
  { id: "structure", label: "Structure", title: "Open interest, put / call ratio and gamma exposure by strike with max pain" },
  { id: "ladder", label: "Ladder", title: "P&L per price step" },
];

const PANELS: Record<AnalysisTab, () => ReactElement> = { payoff: PayoffPanel, scenarios: ScenariosPanel, greeks: GreeksPanel, vol: VolPanel, structure: StructurePanel, ladder: LadderPanel };

/** Whose legs the pane shows (HC-TR-143, ADR-026): Builder, a followed strategy, or ticked positions, with the way back. */
export function PaneSourceBar() {
  const source = useUiStore((s) => s.paneSource);
  const adjusting = useUiStore((s) => s.adjust);
  const followStrategy = useUiStore((s) => s.followStrategy);
  const setWorkspaceTab = useUiStore((s) => s.setWorkspaceTab);
  const { data: strategies } = useStrategies();
  const followed = source?.kind === "strategy" ? strategies?.find((s) => s.id === source.id && (s.status === "paper" || s.status === "live")) : undefined;
  // a followed strategy that was archived or deleted: back to the Builder legs without a stale pill
  useEffect(() => {
    if (source?.kind === "strategy" && strategies && !followed) followStrategy(null);
  }, [source, strategies, followed, followStrategy]);
  if (!source) return null;
  const label = source.kind === "positions" ? `${source.productIds.length} exchange ${source.productIds.length === 1 ? "position" : "positions"}` : (followed?.name ?? "…");
  return (
    <div className={cn("flex items-center gap-2 border-b border-border px-3 py-1 text-2xs", source.kind === "strategy" && followed?.status === "live" ? "bg-loss/5" : "bg-muted/40")} data-testid="pane-source" data-kind={source.kind}>
      <span className="micro">Following</span>
      <span className="truncate font-medium">{label}</span>
      {followed ? <ModePill status={followed.status} /> : null}
      {followed && adjusting?.strategyId === followed.id ? <span className="micro rounded border border-warning px-1 text-warning" data-testid="pane-adjusting">adjusting · after the change</span> : null}
      <button
        type="button"
        className="ml-auto rounded border border-border px-1.5 py-0.5 text-2xs hover:border-foreground/40"
        onClick={() => {
          followStrategy(null);
          setWorkspaceTab("builder");
        }}
        data-testid="pane-back-to-builder"
      >
        Back to Builder
      </button>
    </div>
  );
}

export function AnalysisPane() {
  const tab = useUiStore((s) => s.analysisTab);
  const setTab = useUiStore((s) => s.setAnalysisTab);
  return (
    <Tabs value={tab} onValueChange={(v) => setTab(v as AnalysisTab)} className="flex h-full min-h-0 flex-col gap-0" data-testid="analysis-pane">
      <PaneSourceBar />
      <TabsList className="px-2">
        {ANALYSIS_TABS.map((t) => (
          <TabsTrigger key={t.id} value={t.id} title={t.title} data-testid={`analysis-tab-${t.id}`}>
            {t.label}
          </TabsTrigger>
        ))}
      </TabsList>
      {ANALYSIS_TABS.map((t) => {
        const P = PANELS[t.id];
        return (
          <TabsContent key={t.id} value={t.id} className="min-h-0 flex-1 overflow-auto">
            {tab === t.id ? <P /> : null}
          </TabsContent>
        );
      })}
    </Tabs>
  );
}
