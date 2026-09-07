"use client";
// Tools row above the chain (HC-WS-016 range control, live dot, narrow-mode side toggle) and the footer
// below it (n of N strikes, Σ call OI, Σ put OI, PCR) with the two detached horizontal scrollbars that
// expose the mirrored offset to the mouse (GAPS #2).
import { cn } from "@hapiecoin/ui";
import { useEffect, useRef } from "react";
import { CHAIN_RANGES, type ChainRange, type ChainTotals } from "@/lib/chain/range";
import { fmtOi } from "@/lib/format";
import { STRIKE_COL_PX } from "./columns";
import type { MirroredScroll } from "./useMirroredScroll";

export function rangeLabel(range: ChainRange): string {
  return range === 0 ? "all strikes" : `strikes ±${range}`;
}

export interface ChainToolsProps {
  range: ChainRange;
  onRange: (range: ChainRange) => void;
  live: boolean;
  sides: "both" | "calls" | "puts";
  narrow: boolean;
  onSide: (side: "calls" | "puts") => void;
  onRecentre: () => void;
  /** Gear: open the Column Settings dialog (HC-WS-010). */
  onOpenColumns?: (() => void) | undefined;
  columnsShown?: number;
}

export function ChainTools({ range, onRange, live, sides, narrow, onSide, onRecentre, onOpenColumns, columnsShown }: ChainToolsProps) {
  return (
    <div className="flex h-[34px] shrink-0 items-center gap-2 border-b border-border px-2" data-testid="chain-tools">
      <div className="inline-flex h-[22px] overflow-hidden rounded-[3px] border border-input" role="group" aria-label="Strike range" data-testid="chain-range">
        {CHAIN_RANGES.map((r) => (
          <button
            key={r}
            type="button"
            aria-pressed={r === range}
            data-testid={`chain-range-${r}`}
            onClick={() => onRange(r)}
            className={cn(
              "px-2 font-mono text-3xs uppercase tracking-[0.06em]",
              r === range ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {r === 0 ? "all" : `±${r}`}
          </button>
        ))}
      </div>
      <button
        type="button"
        onClick={onRecentre}
        className="font-mono text-3xs uppercase tracking-[0.06em] text-muted-foreground hover:text-foreground"
        title="Scroll the ATM row into the middle (A)"
        data-testid="chain-recentre"
      >
        ATM
      </button>
      {narrow ? (
        <div className="inline-flex h-[22px] overflow-hidden rounded-[3px] border border-input" role="group" aria-label="Side" data-testid="chain-side">
          {(["calls", "puts"] as const).map((s) => (
            <button
              key={s}
              type="button"
              aria-pressed={sides === s}
              data-testid={`chain-side-${s}`}
              onClick={() => onSide(s)}
              className={cn("px-2 font-mono text-3xs uppercase tracking-[0.06em]", sides === s ? "bg-muted text-foreground" : "text-muted-foreground")}
            >
              {s}
            </button>
          ))}
        </div>
      ) : null}
      <span className="flex-1" />
      <span className="inline-flex items-center gap-1.5 font-mono text-3xs uppercase tracking-[0.06em] text-muted-foreground" data-testid="chain-live" data-live={live}>
        <i className={cn("inline-block h-1.5 w-1.5 rounded-full", live ? "live-dot" : "bg-muted-foreground/50")} />
        {live ? "Live" : "Stale"}
      </span>
      {onOpenColumns ? (
        <button
          type="button"
          onClick={onOpenColumns}
          className="inline-flex h-[22px] items-center gap-1 rounded-[3px] border border-input px-1.5 font-mono text-3xs uppercase tracking-[0.06em] text-muted-foreground hover:text-foreground"
          title="Column settings"
          aria-label="Column settings"
          data-testid="chain-columns"
        >
          <span aria-hidden>⚙</span>
          {columnsShown !== undefined ? <span>{columnsShown}</span> : null}
        </button>
      ) : null}
    </div>
  );
}

export interface ChainFooterProps {
  shown: number;
  total: number;
  totals: ChainTotals;
  scroll: MirroredScroll;
  trackWidth: number;
  sides: "both" | "calls" | "puts";
  /** Time of the last applied frame for the stale state, or null when live. */
  asOf: string | null;
}

/** A thin native scrollbar whose inner spacer is the track width; its scrollLeft mirrors the shared offset. */
function DetachedScrollbar({ side, scroll, trackWidth }: { side: "calls" | "puts"; scroll: MirroredScroll; trackWidth: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const target = side === "calls" ? scroll.x : scroll.putsX;
  useEffect(() => {
    const el = ref.current;
    if (el && Math.abs(el.scrollLeft - target) > 0.5) el.scrollLeft = target;
  }, [target]);
  return (
    <div
      ref={ref}
      className={cn("h-2 min-w-0 overflow-x-auto overflow-y-hidden", scroll.max <= 0 && "invisible")}
      data-testid={`chain-scrollbar-${side}`}
      aria-label={`${side} columns scroll`}
      onScroll={(e) => {
        const left = e.currentTarget.scrollLeft;
        // Ignore the echo of our own programmatic set (the browser may clamp it to its integer maximum).
        if (Math.abs(left - target) < 1.5) return;
        scroll.setX(side === "calls" ? left : scroll.max - left);
      }}
    >
      <div style={{ width: trackWidth, height: 1 }} />
    </div>
  );
}

export function ChainFooter({ shown, total, totals, scroll, trackWidth, sides, asOf }: ChainFooterProps) {
  const cols = sides === "both" ? `minmax(0,1fr) ${STRIKE_COL_PX}px minmax(0,1fr)` : `minmax(0,1fr) ${STRIKE_COL_PX}px`;
  return (
    <div className="shrink-0 border-t border-border" data-testid="chain-footer">
      <div className="grid" style={{ gridTemplateColumns: cols }}>
        {sides !== "puts" ? <DetachedScrollbar side="calls" scroll={scroll} trackWidth={trackWidth} /> : null}
        <div />
        {sides !== "calls" ? <DetachedScrollbar side="puts" scroll={scroll} trackWidth={trackWidth} /> : null}
      </div>
      <div className="flex h-[30px] items-center gap-4 px-3 font-mono text-3xs uppercase tracking-[0.08em] text-muted-foreground">
        <span data-testid="chain-count">
          {shown} of {total} strikes
        </span>
        <span>Σ Call OI <b className="font-medium text-foreground">{fmtOi(String(totals.callOi))}</b></span>
        <span>Σ Put OI <b className="font-medium text-foreground">{fmtOi(String(totals.putOi))}</b></span>
        <span>PCR <b className="font-medium text-foreground">{totals.pcr === null ? "—" : totals.pcr.toFixed(2)}</b></span>
        {asOf ? (
          <span className="ml-auto" data-testid="chain-asof">
            as of {asOf}
          </span>
        ) : null}
      </div>
    </div>
  );
}
