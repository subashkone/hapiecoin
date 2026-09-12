"use client";
// Floating row control for one side of the chain (HC-WS-023..025): [B] [S] [− lots +] [ⓘ]. Shown on the
// hovered or keyboard-highlighted row only; B / S fill when the row already holds that side.
import { cn } from "@hapiecoin/ui";
import type { LegKind, LegSide, SideMarks } from "@/lib/strategy/legs";
import { fmtStrike } from "@/lib/format";

export interface RowControlsProps {
  side: "calls" | "puts";
  strike: string;
  lots: number;
  /** "Lots × 0.001 BTC" tooltip text (HC-WS-025). */
  lotsTitle: string;
  marks: SideMarks;
  /** True when the strategy already holds the maximum active legs (HC-TR-017). */
  atLimit: boolean;
  onAdd: (kind: LegKind, side: LegSide) => void;
  onLots: (delta: 1 | -1) => void;
  onInfo: (kind: LegKind) => void;
  /** finger-sized targets on a touch screen (ADR-080); the table owns the media query */
  coarse?: boolean;
}

export function RowControls({ side, strike, lots, lotsTitle, marks, atLimit, onAdd, onLots, onInfo, coarse = false }: RowControlsProps) {
  const kind: LegKind = side === "calls" ? "call" : "put";
  const label = `${kind} ${fmtStrike(strike)}`;
  const btn = cn("grid place-items-center rounded-[2px] border font-bold leading-none disabled:cursor-not-allowed disabled:opacity-40", coarse ? "h-9 w-9 text-sm" : "h-[18px] w-5 text-[10.5px]");
  return (
    <div
      className={cn(
        "absolute top-1/2 z-[5] flex -translate-y-1/2 items-center rounded-[3px] border border-input bg-popover shadow-sm",
        coarse ? "gap-1.5 p-1.5" : "gap-[3px] p-[3px]",
        side === "calls" ? "right-1" : "left-1",
      )}
      data-testid={`row-controls-${side}`}
      data-strike={strike}
      data-coarse={coarse || undefined}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        className={cn(btn, "border-buy text-buy", marks.buyLots > 0 ? "bg-buy text-white" : "bg-buy-bg hover:bg-buy hover:text-white")}
        title={atLimit ? "Maximum 10 legs" : `Buy ${label} (${side === "calls" ? "B" : "Shift+B"})`}
        aria-label={`Buy ${label}`}
        aria-pressed={marks.buyLots > 0}
        disabled={atLimit}
        onClick={() => onAdd(kind, "buy")}
        data-testid={`row-buy-${side}`}
      >
        B
      </button>
      <button
        type="button"
        className={cn(btn, "border-sell text-sell", marks.sellLots > 0 ? "bg-sell text-white" : "bg-sell-bg hover:bg-sell hover:text-white")}
        title={atLimit ? "Maximum 10 legs" : `Sell ${label} (${side === "calls" ? "S" : "Shift+S"})`}
        aria-label={`Sell ${label}`}
        aria-pressed={marks.sellLots > 0}
        disabled={atLimit}
        onClick={() => onAdd(kind, "sell")}
        data-testid={`row-sell-${side}`}
      >
        S
      </button>
      <span className={cn("inline-flex items-center rounded-[2px] border border-input font-mono", coarse ? "h-9 text-sm" : "h-[18px] text-[10.5px]")} title={lotsTitle} data-testid={`row-lots-${side}`}>
        <button type="button" className={cn("text-muted-foreground hover:text-foreground", coarse ? "px-2.5" : "px-1")} aria-label="Fewer lots" onClick={() => onLots(-1)} data-testid={`row-lots-down-${side}`}>
          −
        </button>
        <span className="min-w-[22px] text-center" data-testid={`row-lots-value-${side}`}>
          {lots}
        </span>
        <button type="button" className={cn("text-muted-foreground hover:text-foreground", coarse ? "px-2.5" : "px-1")} aria-label="More lots" onClick={() => onLots(1)} data-testid={`row-lots-up-${side}`}>
          +
        </button>
      </span>
      <button
        type="button"
        className={cn("grid place-items-center rounded-[2px] border border-input text-muted-foreground hover:text-foreground", coarse ? "h-9 w-9 text-sm" : "h-[18px] w-[18px] text-[10px]")}
        title={`Details for ${label} (Enter)`}
        aria-label={`Details for ${label}`}
        onClick={() => onInfo(kind)}
        data-testid={`row-info-${side}`}
      >
        i
      </button>
    </div>
  );
}
