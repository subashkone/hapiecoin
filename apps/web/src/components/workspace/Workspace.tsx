"use client";
// Two-pane workspace under the analyse header (HC-WS-001..006, HC-WS-029..032): left tabs Chain | Builder
// (with a leg-count pill) | Paper | Live | Journal, the analysis pane on the right, a draggable divider
// (35–70 % for the left pane, remembered per browser) and a stacked Chain | Analysis toggle under 1000 px.
import { EmptyState, Tabs, TabsContent, TabsList, TabsTrigger, cn } from "@hapiecoin/ui";
import { useCallback, useEffect, useRef, useState } from "react";
import { AnalysisPane } from "@/components/analysis/AnalysisPane";
import { BuilderPanel } from "@/components/builder/BuilderPanel";
import { ChainPanel } from "@/components/chain/ChainPanel";
import { PaperPanel } from "@/components/trading/PaperPanel";
import { StrategyDetailsDialog } from "@/components/trading/StrategyDetailsDialog";
import { TradeFlow } from "@/components/trading/TradeFlow";
import { useStrategies } from "@/lib/api/strategies";
import { useConnectionStatus } from "@/lib/gateway/hooks";
import { usePaperBook } from "@/lib/strategy/usePaper";
import { usePnlWriter } from "@/lib/strategy/usePnlWriter";
import { type WorkspaceTab, useUiStore } from "@/lib/store";

export const LEFT_TABS: { id: WorkspaceTab; label: string; phase?: number; blurb?: string }[] = [
  { id: "chain", label: "Chain" },
  { id: "builder", label: "Builder" },
  { id: "paper", label: "Paper" },
  { id: "live", label: "Live" },
  { id: "journal", label: "Journal", phase: 4, blurb: "Closed trades, notes and the performance log." },
];

const SPLIT_KEY = "hapiecoin.split";
export const SPLIT_MIN = 0.35;
export const SPLIT_MAX = 0.7;
export const STACK_BELOW_PX = 1000;
/** Left-pane share of the width when nothing is stored, and after a double-click on the divider (HC-WS-002). */
export const SPLIT_DEFAULT = 0.55;

export function clampSplit(v: number): number {
  return Number.isFinite(v) ? Math.round(Math.min(SPLIT_MAX, Math.max(SPLIT_MIN, v)) * 100) / 100 : SPLIT_DEFAULT;
}

function readSplit(): number {
  try {
    const raw = localStorage.getItem(SPLIT_KEY);
    return raw === null ? SPLIT_DEFAULT : clampSplit(Number(raw));
  } catch {
    return SPLIT_DEFAULT;
  }
}

/** True when the viewport is narrower than `px`; false during SSR. */
function useNarrow(px: number): boolean {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${px - 1}px)`);
    const on = () => setNarrow(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [px]);
  return narrow;
}

export function Workspace() {
  const tab = useUiStore((s) => s.workspaceTab);
  const setTab = useUiStore((s) => s.setWorkspaceTab);
  const legCount = useUiStore((s) => s.legs[s.asset].filter((l) => l.status === "open").length);
  const { data: strategies } = useStrategies();
  const book = usePaperBook(strategies ?? []);
  const feedLive = useConnectionStatus() === "open";
  usePnlWriter(strategies, book, feedLive); // GAPS #38: today's P&L point for every active strategy, from the browser that prices them
  const paperCount = (strategies ?? []).filter((s) => s.status === "paper").length;
  const liveCount = (strategies ?? []).filter((s) => s.status === "live").length;
  const [split, setSplit] = useState(SPLIT_DEFAULT);
  const [dragging, setDragging] = useState(false);
  const [stacked, setStacked] = useState<"left" | "analysis">("left");
  const narrow = useNarrow(STACK_BELOW_PX);
  const grid = useRef<HTMLDivElement>(null);
  useEffect(() => setSplit(readSplit()), []);

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    setDragging(true);
  }, []);
  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!dragging || !grid.current) return;
      const r = grid.current.getBoundingClientRect();
      setSplit(clampSplit((e.clientX - r.left) / r.width));
    },
    [dragging],
  );
  const onPointerUp = useCallback(() => {
    setDragging(false);
    try {
      localStorage.setItem(SPLIT_KEY, String(split));
    } catch {
      /* storage unavailable */
    }
  }, [split]);
  const commit = (v: number) => {
    setSplit(v);
    try {
      localStorage.setItem(SPLIT_KEY, String(v));
    } catch {
      /* storage unavailable */
    }
  };
  const onKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const d = e.key === "ArrowLeft" ? -0.02 : e.key === "ArrowRight" ? 0.02 : e.key === "Home" ? Number.NaN : 0;
    if (d === 0) return;
    e.preventDefault();
    commit(Number.isNaN(d) ? SPLIT_DEFAULT : clampSplit(split + d));
  };

  const left = (
    <Tabs value={tab} onValueChange={(v) => setTab(v as WorkspaceTab)} className="flex h-full min-h-0 min-w-0 flex-col gap-0" data-testid="left-pane">
      <TabsList className="px-2">
        {LEFT_TABS.map((t) => (
          <TabsTrigger key={t.id} value={t.id} title={t.phase ? `Arrives in Phase ${t.phase}` : undefined} data-testid={`tab-${t.id}`} data-tour={t.id === "chain" ? "options-chain" : t.id === "paper" ? "paper-tab" : undefined}>
            {t.label}
            {t.id === "builder" && legCount > 0 ? (
              <span className="ml-1 rounded-full bg-muted px-1.5 font-mono text-3xs text-foreground" data-testid="builder-count">
                {legCount}
              </span>
            ) : null}
            {t.id === "paper" && paperCount > 0 ? (
              <span className="ml-1 rounded-full bg-muted px-1.5 font-mono text-3xs text-foreground" data-testid="paper-count">
                {paperCount}
              </span>
            ) : null}
            {t.id === "live" && liveCount > 0 ? (
              <span className="ml-1 inline-flex items-center gap-1 rounded-full bg-loss px-1.5 font-mono text-3xs text-white" data-testid="live-count">
                <i className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-white" />
                {liveCount}
              </span>
            ) : null}
          </TabsTrigger>
        ))}
        <span className="ml-auto self-center pr-2 font-mono text-3xs uppercase tracking-[0.1em] text-muted-foreground">Lot · basis mark</span>
      </TabsList>
      <TabsContent value="chain" className="min-h-0 flex-1">
        <ChainPanel />
      </TabsContent>
      <TabsContent value="builder" className="min-h-0 flex-1">
        <BuilderPanel />
      </TabsContent>
      <TabsContent value="paper" className="min-h-0 flex-1">
        <PaperPanel book={book} feedLive={feedLive} />
      </TabsContent>
      <TabsContent value="live" className="min-h-0 flex-1">
        <PaperPanel book={book} feedLive={feedLive} kind="live" />
      </TabsContent>
      {LEFT_TABS.filter((t) => t.phase).map((t) => (
        <TabsContent key={t.id} value={t.id} className="min-h-0 flex-1">
          <EmptyState title={`${t.label} arrives in Phase ${t.phase}`} description={t.blurb} className="py-24" data-testid={`placeholder-${t.id}`} />
        </TabsContent>
      ))}
    </Tabs>
  );

  const overlays = (
    <>
      <TradeFlow book={book} />
      <StrategyDetailsDialog book={book} feedLive={feedLive} />
    </>
  );

  if (narrow) {
    return (
      <div className="flex min-h-[calc(100vh-50px)] flex-col" data-testid="workspace" data-layout="stacked">
        {overlays}
        <div className="flex border-b border-border" role="tablist" aria-label="Pane">
          {(["left", "analysis"] as const).map((k) => (
            <button key={k} type="button" role="tab" aria-selected={stacked === k} onClick={() => setStacked(k)} className={cn("flex-1 py-2 text-xs", stacked === k ? "border-b-2 border-foreground text-foreground" : "text-muted-foreground")} data-testid={`stack-${k}`}>
              {k === "left" ? "Chain & Builder" : "Analysis"}
            </button>
          ))}
        </div>
        <div className="min-h-0 flex-1">{stacked === "left" ? left : <AnalysisPane />}</div>
      </div>
    );
  }

  return (
    <div ref={grid} className="grid min-h-[calc(100vh-50px)]" style={{ gridTemplateColumns: `minmax(0, ${split}fr) 6px minmax(360px, ${1 - split}fr)` }} data-testid="workspace" data-layout="split" data-split={split.toFixed(2)}>
      {overlays}
      <div className="min-w-0 border-r border-border">{left}</div>
      <div
        role="separator"
        aria-orientation="vertical"
        aria-valuenow={Math.round(split * 100)}
        aria-valuemin={SPLIT_MIN * 100}
        aria-valuemax={SPLIT_MAX * 100}
        tabIndex={0}
        title="Drag to resize · ← → keys · double-click resets"
        onDoubleClick={() => commit(SPLIT_DEFAULT)}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onKeyDown={onKey}
        className={cn("cursor-col-resize bg-transparent hover:bg-muted focus-visible:bg-muted", dragging && "bg-muted")}
        data-testid="workspace-divider"
      />
      <aside className="min-w-0" data-testid="right-pane">
        <AnalysisPane />
      </aside>
    </div>
  );
}
