"use client";
// Virtualised option chain (TanStack Virtual). Mirrored columns around a fixed centre strike column:
// Δ · OI · Bid/IV · Mark/IV · Ask/IV | Strike | Ask/IV · Mark/IV · Bid/IV · OI · Δ. Rows are exactly the
// gateway snapshot (ADR-006); the ATM band sits on the strike bracketing spot; changed cells flash.
import { cn } from "@hapiecoin/ui";
import type { ChainRow, Quote } from "@hapiecoin/schema";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useEffect, useMemo, useRef, useState } from "react";
import { fmtDelta, fmtIv, fmtOi, fmtPrice, fmtStrike } from "@/lib/format";
import { atmIndex, type ChainState } from "@/lib/gateway/reducer";

const CALL_COLS = ["Δ", "OI", "Bid/IV", "Mark/IV", "Ask/IV"] as const;
const PUT_COLS = ["Ask/IV", "Mark/IV", "Bid/IV", "OI", "Δ"] as const;

interface CellProps {
  price: string | undefined;
  iv: number | undefined;
  flash?: string;
}

function PriceIv({ price, iv, flash }: CellProps) {
  return (
    <div className={cn("num flex flex-col items-end leading-tight", flash)}>
      <span>{fmtPrice(price)}</span>
      <span className="text-3xs text-muted-foreground">{fmtIv(iv)}</span>
    </div>
  );
}

/** Which of the previous frame's flash directions apply to this quote (keyed by field). */
export function quoteFlashes(prev: Quote | undefined, next: Quote | undefined, changed: Set<keyof Quote> | undefined) {
  const dir = (k: "bid" | "ask" | "mark"): string => {
    if (!prev || !next || !changed?.has(k)) return "";
    const a = Number(prev[k]);
    const b = Number(next[k]);
    if (!Number.isFinite(a) || !Number.isFinite(b) || a === b) return "";
    return b > a ? "flash-up" : "flash-down";
  };
  return { bid: dir("bid"), ask: dir("ask"), mark: dir("mark") };
}

function Side({ q, flashes, mirrored }: { q: Quote | undefined; flashes: ReturnType<typeof quoteFlashes>; mirrored: boolean }) {
  const cells = [
    <div key="delta" className="num text-right">{fmtDelta(q?.greeks?.delta)}</div>,
    <div key="oi" className="num text-right">{fmtOi(q?.oi)}</div>,
    <PriceIv key="bid" price={q?.bid} iv={q?.bidIv} flash={flashes.bid} />,
    <PriceIv key="mark" price={q?.mark} iv={q?.markIv} flash={flashes.mark} />,
    <PriceIv key="ask" price={q?.ask} iv={q?.askIv} flash={flashes.ask} />,
  ];
  return <>{mirrored ? cells.reverse() : cells}</>;
}

export interface ChainTableProps {
  chain: ChainState;
  spot: string | undefined;
  rowHeight?: number;
  /** Height of the scroll viewport in px; the parent normally passes its measured height. */
  height?: number;
}

export function ChainTable({ chain, spot, rowHeight = 36, height = 520 }: ChainTableProps) {
  const parentRef = useRef<HTMLDivElement>(null);
  const rows = chain.rows;
  const atm = useMemo(() => atmIndex(rows, spot), [rows, spot]);
  // Keep the previous rows to compute flash direction for changed cells.
  const prevRows = useRef<ChainRow[]>(rows);
  const [prevSnapshot, setPrevSnapshot] = useState<ChainRow[]>(rows);
  useEffect(() => {
    setPrevSnapshot(prevRows.current);
    prevRows.current = rows;
  }, [rows]);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => rowHeight,
    overscan: 8,
    // jsdom (tests) has no layout; the real browser replaces this on the first ResizeObserver callback.
    initialRect: { width: 1200, height },
  });

  // Centre the ATM row on first data.
  const centred = useRef(false);
  useEffect(() => {
    if (centred.current || atm < 0 || !rows.length) return;
    centred.current = true;
    virtualizer.scrollToIndex(atm, { align: "center" });
  }, [atm, rows.length, virtualizer]);

  const gridCols = "grid grid-cols-[repeat(5,minmax(64px,1fr))_92px_repeat(5,minmax(64px,1fr))] items-center";
  const items = virtualizer.getVirtualItems();

  return (
    <div className="flex h-full flex-col" data-testid="chain-table" data-rows={rows.length} data-visible={items.length}>
      <div className={cn(gridCols, "border-b border-border px-2 text-right")}>
        {CALL_COLS.map((c) => (
          <div key={"c" + c} className="micro py-1.5 text-right">{c}</div>
        ))}
        <div className="micro py-1.5 text-center">Strike</div>
        {PUT_COLS.map((c) => (
          <div key={"p" + c} className="micro py-1.5 text-right">{c}</div>
        ))}
      </div>
      <div className="flex justify-between px-2 py-1 font-mono text-3xs uppercase tracking-[0.1em] text-muted-foreground">
        <span>Calls · mark, USD per contract</span>
        <span>Puts · mark, USD per contract</span>
      </div>
      <div ref={parentRef} className="overflow-auto" style={{ height }} data-testid="chain-scroll">
        <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
          {items.map((v) => {
            const row = rows[v.index];
            if (!row) return null;
            const prev = prevSnapshot[v.index];
            const cf = quoteFlashes(prev?.call, row.call, row.call ? chain.changed.get(row.call.instrumentId) : undefined);
            const pf = quoteFlashes(prev?.put, row.put, row.put ? chain.changed.get(row.put.instrumentId) : undefined);
            const isAtm = v.index === atm;
            return (
              <div
                key={row.strike}
                data-testid="chain-row"
                data-strike={row.strike}
                data-atm={isAtm || undefined}
                className={cn(gridCols, "absolute left-0 right-0 border-b border-border px-2 text-xs hover:bg-muted/50", isAtm && "atm-band")}
                style={{ height: `${v.size}px`, transform: `translateY(${v.start}px)` }}
              >
                <Side q={row.call} flashes={cf} mirrored={false} />
                <div className={cn("num text-center font-medium", isAtm && "text-spot")}>
                  {fmtStrike(row.strike)}
                  {isAtm ? <div className="text-3xs font-normal text-spot">ATM · spot {fmtPrice(spot)}</div> : null}
                </div>
                <Side q={row.put} flashes={pf} mirrored />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
