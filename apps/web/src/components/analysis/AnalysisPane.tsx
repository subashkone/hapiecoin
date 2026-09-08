"use client";
// Right pane of the workspace (HC-WS-030..032): the analysis tabs. Payoff, Greeks and Ladder are live in
// Phase 2; Scenarios, Vol and Structure say what arrives in Phase 5 rather than showing an empty box.
import { EmptyState, Tabs, TabsContent, TabsList, TabsTrigger } from "@hapiecoin/ui";
import { type AnalysisTab, useUiStore } from "@/lib/store";
import { GreeksPanel } from "./GreeksPanel";
import { LadderPanel } from "./LadderPanel";
import { PayoffPanel } from "./PayoffPanel";

export const ANALYSIS_TABS: { id: AnalysisTab; label: string; phase?: number; blurb?: string }[] = [
  { id: "payoff", label: "Payoff" },
  { id: "scenarios", label: "Scenarios", phase: 5, blurb: "Price × date P&L matrix with IV shift and delta / theta views." },
  { id: "greeks", label: "Greeks" },
  { id: "vol", label: "Vol", phase: 5, blurb: "IV smile and term structure across the listed strikes." },
  { id: "structure", label: "Structure", phase: 5, blurb: "Open interest and volume by strike with max-pain." },
  { id: "ladder", label: "Ladder" },
];

export function AnalysisPane() {
  const tab = useUiStore((s) => s.analysisTab);
  const setTab = useUiStore((s) => s.setAnalysisTab);
  return (
    <Tabs value={tab} onValueChange={(v) => setTab(v as AnalysisTab)} className="flex h-full min-h-0 flex-col gap-0" data-testid="analysis-pane">
      <TabsList className="px-2">
        {ANALYSIS_TABS.map((t) => (
          <TabsTrigger key={t.id} value={t.id} title={t.phase ? `Arrives in Phase ${t.phase}` : undefined} data-testid={`analysis-tab-${t.id}`}>
            {t.label}
          </TabsTrigger>
        ))}
      </TabsList>
      {ANALYSIS_TABS.map((t) => (
        <TabsContent key={t.id} value={t.id} className="min-h-0 flex-1 overflow-auto">
          {t.id === "payoff" ? <PayoffPanel /> : t.id === "greeks" ? <GreeksPanel /> : t.id === "ladder" ? <LadderPanel /> : <EmptyState title={`${t.label} arrives in Phase ${t.phase}`} description={t.blurb} className="py-16" data-testid={`analysis-placeholder-${t.id}`} />}
        </TabsContent>
      ))}
    </Tabs>
  );
}
