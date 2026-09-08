"use client";
// Sticky two-row chain header (HC-WS-015): band labels with their basis, then the column labels. The
// calls and puts parts are tracks translated by the shared horizontal offset, so they always line up
// with the body columns (GAPS #2). Lives outside the vertical scroller, so it never scrolls away.
import { cn } from "@hapiecoin/ui";
import { type ChainColumn, STRIKE_COL_PX, gridTemplate } from "./columns";

export interface ChainHeaderProps {
  /** Calls track offset in px (from useMirroredScroll). */
  x: number;
  /** Puts track offset in px. */
  putsX: number;
  trackWidth: number;
  /** Calls columns in reading order (outboard → inboard). */
  callCols: readonly ChainColumn[];
  /** Puts columns in reading order (inboard → outboard). */
  putCols: readonly ChainColumn[];
  expiryLabel: string;
  daysLeft: number | null;
  /** Which sides are shown (narrow layout shows one). */
  sides: "both" | "calls" | "puts";
  rangeLabel: string;
  lotLabel: string;
}

function Track({ x, width, cols, side }: { x: number; width: number; cols: readonly ChainColumn[]; side: "calls" | "puts" }) {
  return (
    <div className="min-w-0 overflow-hidden" data-testid={`chain-head-${side}`} data-x={x}>
      <div className="grid" style={{ width, gridTemplateColumns: gridTemplate(cols), transform: `translateX(-${x}px)` }}>
        {cols.length === 0 ? (
          <div className={cn("micro px-2 py-1", side === "calls" ? "text-right" : "text-left")}>no columns</div>
        ) : (
          cols.map((c) => (
            <div key={c.id} className={cn("micro truncate px-2 py-1", side === "calls" ? "text-right" : "text-left")} title={c.title} data-col={c.id}>
              {c.header}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export function ChainHeader({ x, putsX, trackWidth, callCols, putCols, expiryLabel, daysLeft, sides, rangeLabel, lotLabel }: ChainHeaderProps) {
  const showCalls = sides !== "puts";
  const showPuts = sides !== "calls";
  const cols = sides === "both" ? `minmax(0,1fr) ${STRIKE_COL_PX}px minmax(0,1fr)` : `minmax(0,1fr) ${STRIKE_COL_PX}px`;
  return (
    <div className="sticky top-0 z-[6] border-b border-border bg-surface-1" data-testid="chain-header">
      <div className="grid items-stretch" style={{ gridTemplateColumns: cols }}>
        {showCalls ? (
          <div className="micro flex min-w-0 items-center justify-between gap-2 px-2 py-1" data-testid="chain-band-calls">
            <span className="truncate">Calls · ITM shaded · {rangeLabel}</span>
            <span className="hidden truncate 2xl:inline">{lotLabel}</span>
          </div>
        ) : null}
        <div className="micro flex items-center justify-center gap-1 whitespace-nowrap border-x border-border py-1 text-foreground" data-testid="chain-band-expiry">
          <span>{expiryLabel}</span>
          {daysLeft !== null ? <span className="text-muted-foreground">· {daysLeft}d</span> : null}
        </div>
        {showPuts ? (
          <div className="micro flex min-w-0 items-center justify-between gap-2 px-2 py-1" data-testid="chain-band-puts">
            <span className="hidden truncate 2xl:inline">{lotLabel}</span>
            <span className={cn("truncate", sides === "puts" && "ml-auto")}>Δ per unit · Puts</span>
          </div>
        ) : null}
      </div>
      <div className="grid items-stretch border-t border-border" style={{ gridTemplateColumns: cols }}>
        {showCalls ? <Track x={x} width={trackWidth} cols={callCols} side="calls" /> : null}
        <div className="micro border-x border-border py-1 text-center">Strike</div>
        {showPuts ? <Track x={putsX} width={trackWidth} cols={putCols} side="puts" /> : null}
      </div>
    </div>
  );
}
