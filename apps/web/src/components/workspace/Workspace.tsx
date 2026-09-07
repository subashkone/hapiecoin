"use client";
// Two-pane workspace shell under the analyse header. Phase 1: only the Chain tab is live; Builder / Paper /
// Live / Journal are disabled placeholders and the right pane says what arrives in Phase 2.
import { EmptyState, Tabs, TabsContent, TabsList, TabsTrigger } from "@hapiecoin/ui";
import { ChainPanel } from "@/components/chain/ChainPanel";

const LEFT_TABS = [
  { id: "chain", label: "Chain", enabled: true },
  { id: "builder", label: "Builder", enabled: false },
  { id: "paper", label: "Paper", enabled: false },
  { id: "live", label: "Live", enabled: false },
  { id: "journal", label: "Journal", enabled: false },
] as const;

export function Workspace() {
  return (
    <div className="grid min-h-[calc(100vh-50px)] grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(360px,42%)]" data-testid="workspace">
      <Tabs defaultValue="chain" className="min-w-0 gap-0 border-r border-border">
        <TabsList className="px-2">
          {LEFT_TABS.map((t) => (
            <TabsTrigger key={t.id} value={t.id} disabled={!t.enabled} title={t.enabled ? undefined : "Arrives in Phase 2"} data-testid={`tab-${t.id}`}>
              {t.label}
            </TabsTrigger>
          ))}
          <span className="ml-auto self-center pr-2 font-mono text-3xs uppercase tracking-[0.1em] text-muted-foreground">
            Lot · basis mark
          </span>
        </TabsList>
        <TabsContent value="chain" className="min-h-0">
          <ChainPanel />
        </TabsContent>
      </Tabs>
      <aside className="hidden lg:block" data-testid="right-pane">
        <div className="flex h-10 items-center gap-4 border-b border-border px-3 text-[12.5px] text-muted-foreground">
          <span className="border-b-2 border-transparent py-2 text-foreground">Payoff</span>
          <span>Scenarios</span>
          <span>Greeks</span>
          <span>Vol</span>
          <span>Structure</span>
          <span>Ladder</span>
        </div>
        <EmptyState title="Payoff arrives in Phase 2" description="Strategy builder, payoff chart and scenario matrix land with the next phase. The live chain on the left proves the data pipe today." className="py-24" />
      </aside>
    </div>
  );
}
