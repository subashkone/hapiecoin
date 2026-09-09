"use client";
// Tools row above the chain (HC-WS-016 range control, live dot, narrow-mode side toggle) and the footer
// below it (n of N strikes, Σ call OI, Σ put OI, PCR) with the two detached horizontal scrollbars that
// expose the mirrored offset to the mouse (GAPS #2).
import { cn } from "@hapiecoin/ui";
import { useEffect, useRef } from "react";
import { CHAIN_RANGES, type ChainRange, type ChainTotals } from "@/lib/chain/range";
import { type ChainStats, DELTA_CHIPS } from "@/lib/chain/structure";
import { fmtOiFull, fmtPrice, fmtStrike } from "@/lib/format";
import { STRIKE_COL_PX } from "./columns";
import type { MirroredScroll } from "./useMirroredScroll";

export function rangeLabel(range: ChainRange): string {
  return range === 0 ? "all strikes" : `strikes ±${range}`;
}

export type FeedState = "live" | "connecting" | "stale" | "paused";
const FEED_LABEL: Record<FeedState, string> = { live: "Live", connecting: "Connecting", stale: "Stale", paused: "Paused" };
const FEED_TITLE: Record<FeedState, string> = {
  live: "Quotes stream from the gateway",
  connecting: "Connecting to the market-data gateway…",
  stale: "A frame was missed; the chain shows the last snapshot until it resubscribes",
  paused: "Feed paused from the header",
};

export interface ChainToolsProps {
  range: ChainRange;
  onRange: (range: ChainRange) => void;
  live: boolean;
  /** Pill state (HC-WS-009); derived from `live` when absent. */
  feed?: FeedState | undefined;
  sides: "both" | "calls" | "puts";
  narrow: boolean;
  onSide: (side: "calls" | "puts") => void;
  onRecentre: () => void;
  /** Gear: open the Column Settings dialog (HC-WS-010). */
  onOpenColumns?: (() => void) | undefined;
  columnsShown?: number;
  /** Find-by-Δ chips (HC-WS-074): scroll to the call and put strikes nearest that delta (percent of a unit). */
  onFindDelta?: ((pct: number) => void) | undefined;
}

export function ChainTools({ range, onRange, live, feed, sides, narrow, onSide, onRecentre, onOpenColumns, columnsShown, onFindDelta }: ChainToolsProps) {
  const state: FeedState = feed ?? (live ? "live" : "stale");
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
      {onFindDelta ? (
        <div className="inline-flex h-[22px] items-center gap-0.5 overflow-hidden rounded-[3px] border border-input" role="group" aria-label="Find strike by delta" data-testid="chain-deltas">
          <span className="pl-1.5 pr-0.5 font-mono text-3xs uppercase tracking-[0.06em] text-muted-foreground">Find Δ</span>
          {DELTA_CHIPS.map((d) => (
            <button key={d} type="button" onClick={() => onFindDelta(d)} className="px-1.5 font-mono text-3xs text-muted-foreground hover:text-foreground" title={`Scroll to the call and put strikes nearest ${d}Δ`} data-testid={`chain-delta-${d}`}>
              {d}Δ
            </button>
          ))}
        </div>
      ) : null}
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
      <span className="inline-flex items-center gap-1.5 font-mono text-3xs uppercase tracking-[0.06em] text-muted-foreground" title={FEED_TITLE[state]} data-testid="chain-live" data-live={live} data-feed={state}>
        <i className={cn("inline-block h-1.5 w-1.5 rounded-full", state === "live" ? "live-dot" : state === "connecting" ? "animate-pulse bg-warning" : "bg-muted-foreground/50")} />
        {FEED_LABEL[state]}
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
  /** Max pain, 25Δ skew and forward over the whole chain (HC-WS-029, 080). */
  stats?: ChainStats | undefined;
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

export function ChainFooter({ shown, total, totals, scroll, trackWidth, sides, asOf, stats }: ChainFooterProps) {
  const cols = sides === "both" ? `minmax(0,1fr) ${STRIKE_COL_PX}px minmax(0,1fr)` : `minmax(0,1fr) ${STRIKE_COL_PX}px`;
  return (
    <div className="shrink-0 border-t border-border" data-testid="chain-footer">
      <div className="grid" style={{ gridTemplateColumns: cols }}>
        {sides !== "puts" ? <DetachedScrollbar side="calls" scroll={scroll} trackWidth={trackWidth} /> : null}
        <div />
        {sides !== "calls" ? <DetachedScrollbar side="puts" scroll={scroll} trackWidth={trackWidth} /> : null}
      </div>
      <div className="flex h-[30px] items-center gap-x-4 overflow-x-auto whitespace-nowrap px-3 font-mono text-3xs uppercase tracking-[0.08em] text-muted-foreground" data-testid="chain-stats">
        <span>Σ Call OI <b className="font-medium text-foreground">{fmtOiFull(String(totals.callOi))}</b></span>
        <span>Σ Put OI <b className="font-medium text-foreground">{fmtOiFull(String(totals.putOi))}</b></span>
        <span>PCR <b className="font-medium text-foreground">{totals.pcr === null ? "—" : totals.pcr.toFixed(2)}</b></span>
        <span title="The strike where the total option value at expiry is smallest">Max pain <b className="font-medium text-foreground" data-testid="chain-max-pain">{stats?.maxPain === null || stats?.maxPain === undefined ? "—" : fmtStrike(String(Math.round(stats.maxPain)))}</b></span>
        <span title="IV of the 25Δ put minus the IV of the 25Δ call, in vol points">Skew 25Δ <b className="font-medium text-foreground" data-testid="chain-skew">{stats?.skewPts === null || stats?.skewPts === undefined ? "—" : `${stats.skewPts >= 0 ? "+" : ""}${stats.skewPts.toFixed(1)}`}</b></span>
        <span title="Forward from ATM put-call parity: strike + call − put">Fwd <b className="font-medium text-foreground" data-testid="chain-fwd">{stats?.fwd === null || stats?.fwd === undefined ? "—" : fmtPrice(stats.fwd, 1)}</b></span>
        <span data-testid="chain-count">
          {shown} of {total} strikes
        </span>
        <span className="hidden normal-case tracking-normal 2xl:inline">hover a row for B / S</span>
        {asOf ? (
          <span className="ml-auto" data-testid="chain-asof">
            as of {asOf}
          </span>
        ) : null}
      </div>
    </div>
  );
}
