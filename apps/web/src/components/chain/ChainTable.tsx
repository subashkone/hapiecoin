"use client";
// Options chain table (HC-WS-015..020, HC-WS-022, HC-WS-108; GAPS #1, #2; design: docs/design/options-chain.md).
// One vertical scroller virtualises the rows (TanStack Virtual) for three aligned row lists: the calls
// track, the fixed centre strike column and the puts track. The two tracks are translated by a shared
// horizontal offset (useMirroredScroll), so a scroll on one side moves the other the mirrored amount and
// the header parts stay aligned with the body. Rows are exactly the gateway snapshot (ADR-006); the
// range control only slices them around the ATM row.
import { cn } from "@hapiecoin/ui";
import type { ChainRow, Quote } from "@hapiecoin/schema";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { type ChainRange, chainTotals, itmSide, maxOpenInterest, oiBarPercent, sliceAroundAtm } from "@/lib/chain/range";
import { fmtDelta, fmtIv, fmtOi, fmtPrice, fmtStrike } from "@/lib/format";
import { atmIndex, type ChainState } from "@/lib/gateway/reducer";
import { ChainHeader } from "./ChainHeader";
import { ChainFooter, ChainTools, rangeLabel } from "./ChainTools";
import { COLUMN_PX, NARROW_BREAKPOINT_PX, ROW_PX, SIDE_TRACK_PX, STRIKE_COL_PX } from "./columns";
import { useMirroredScroll } from "./useMirroredScroll";

type Sides = "both" | "calls" | "puts";

interface CellProps {
  price: string | undefined;
  iv: number | undefined;
  flash?: string;
  align: "right" | "left";
}

function PriceIv({ price, iv, flash, align }: CellProps) {
  return (
    <div className={cn("num flex flex-col justify-center px-2 leading-tight", align === "right" ? "items-end" : "items-start", flash)}>
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

function SideCells({ q, flashes, side, maxOi }: { q: Quote | undefined; flashes: ReturnType<typeof quoteFlashes>; side: "calls" | "puts"; maxOi: number }) {
  const align = side === "calls" ? "right" : "left";
  const pct = oiBarPercent(q?.oi, maxOi);
  const cells = [
    <div key="delta" className={cn("num flex items-center px-2", align === "right" ? "justify-end" : "justify-start")}>
      {fmtDelta(q?.greeks?.delta)}
    </div>,
    <div key="oi" className={cn("num relative flex items-center px-2", align === "right" ? "justify-end" : "justify-start")} data-testid="chain-oi" data-pct={pct}>
      {pct > 0 ? <i className={cn("oi-bar", side === "calls" ? "left-0" : "right-0")} style={{ width: `${pct}%` }} aria-hidden /> : null}
      <span className="relative">{fmtOi(q?.oi)}</span>
    </div>,
    <PriceIv key="bid" price={q?.bid} iv={q?.bidIv} flash={flashes.bid} align={align} />,
    <PriceIv key="mark" price={q?.mark} iv={q?.markIv} flash={flashes.mark} align={align} />,
    <PriceIv key="ask" price={q?.ask} iv={q?.askIv} flash={flashes.ask} align={align} />,
  ];
  return <>{side === "calls" ? cells : cells.reverse()}</>;
}

export interface ChainTableProps {
  chain: ChainState;
  spot: string | undefined;
  rowHeight?: number;
  /** Height of the whole table (tools, header, rows, footer) in px. */
  height?: number;
  range: ChainRange;
  onRange: (range: ChainRange) => void;
  /** Bumped by the store when something asks to recentre on ATM. */
  recentreSignal?: number;
  /** Step the expiry (E / Shift+E). */
  onExpiryStep?: (delta: 1 | -1) => void;
  expiryLabel: string;
  daysLeft: number | null;
  lotLabel: string;
  live: boolean;
  /** Time label shown in the footer while stale, or null. */
  asOf: string | null;
  /** Panel width override for tests (jsdom has no layout). */
  initialWidth?: number;
}

const CHROME_PX = 34 + 46 + 40; // tools + header + footer

export function ChainTable({
  chain,
  spot,
  rowHeight = ROW_PX,
  height = 520,
  range,
  onRange,
  recentreSignal = 0,
  onExpiryStep,
  expiryLabel,
  daysLeft,
  lotLabel,
  live,
  asOf,
  initialWidth = 1200,
}: ChainTableProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const callsRef = useRef<HTMLDivElement>(null);
  const putsRef = useRef<HTMLDivElement>(null);

  // Panel width → narrow mode (one side at a time) and the side viewport width for the mirrored scroll.
  const [width, setWidth] = useState(initialWidth);
  const narrow = width < NARROW_BREAKPOINT_PX;
  const [narrowSide, setNarrowSide] = useState<"calls" | "puts">("calls");
  const sides: Sides = narrow ? narrowSide : "both";
  const sideViewport = Math.max(0, Math.floor(sides === "both" ? (width - STRIKE_COL_PX) / 2 : width - STRIKE_COL_PX));
  const scroll = useMirroredScroll(SIDE_TRACK_PX, sideViewport);
  useEffect(() => {
    const el = rootRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      // Whole pixels: a fractional width would make the max offset flicker between two values.
      const w = Math.floor(entries[0]?.contentRect.width ?? 0);
      if (w > 0) setWidth(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  useEffect(() => {
    scroll.setViewportWidth(sideViewport);
  }, [scroll, sideViewport]);

  // Rows: the venue list sliced around ATM by the range control.
  const fullRows = chain.rows;
  const atmFull = useMemo(() => atmIndex(fullRows, spot), [fullRows, spot]);
  const slice = useMemo(() => sliceAroundAtm(fullRows, atmFull, range), [fullRows, atmFull, range]);
  const rows = slice.rows;
  const atm = slice.atm;
  const maxOi = useMemo(() => maxOpenInterest(rows), [rows]);
  const totals = useMemo(() => chainTotals(rows), [rows]);

  // Keep the previous rows to compute flash direction for changed cells.
  const prevRows = useRef<ChainRow[]>(rows);
  const [prevSnapshot, setPrevSnapshot] = useState<ChainRow[]>(rows);
  useEffect(() => {
    setPrevSnapshot(prevRows.current);
    prevRows.current = rows;
  }, [rows]);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => viewportRef.current,
    estimateSize: () => rowHeight,
    overscan: 8,
    // jsdom (tests) has no layout; the real browser replaces this on the first ResizeObserver callback.
    initialRect: { width: initialWidth, height: Math.max(120, height - CHROME_PX) },
  });

  // Roving keyboard focus over the visible rows (HC-WS-016 / design §6).
  const [focus, setFocus] = useState<number>(-1);
  const recentre = useCallback(() => {
    if (atm < 0 || !rows.length) return;
    virtualizer.scrollToIndex(atm, { align: "center" });
    setFocus(atm);
    // The virtualiser may not have measured the viewport yet on first data; settle the exact centre next frame.
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(() => {
        const el = viewportRef.current;
        if (!el || el.clientHeight <= 0) return;
        el.scrollTop = Math.max(0, atm * rowHeight - (el.clientHeight - rowHeight) / 2);
      });
    }
  }, [atm, rows.length, rowHeight, virtualizer]);
  // Centre on first data, on a new topic, and when asked.
  const lastTopic = useRef<string | null>(null);
  useLayoutEffect(() => {
    if (!rows.length || atm < 0) return;
    if (lastTopic.current !== chain.topic) {
      lastTopic.current = chain.topic;
      recentre();
    }
  }, [rows.length, atm, chain.topic, recentre]);
  const lastSignal = useRef(recentreSignal);
  useEffect(() => {
    if (recentreSignal !== lastSignal.current) {
      lastSignal.current = recentreSignal;
      recentre();
    }
  }, [recentreSignal, recentre]);
  useEffect(() => {
    if (focus >= 0 && focus < rows.length) virtualizer.scrollToIndex(focus, { align: "auto" });
  }, [focus, rows.length, virtualizer]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const last = rows.length - 1;
    const move = (idx: number) => {
      e.preventDefault();
      setFocus(Math.max(0, Math.min(last, idx)));
    };
    switch (e.key) {
      case "j":
      case "ArrowDown":
        return move((focus < 0 ? atm : focus) + 1);
      case "k":
      case "ArrowUp":
        return move((focus < 0 ? atm : focus) - 1);
      case "Home":
        return move(0);
      case "End":
        return move(last);
      case "a":
      case "A":
        e.preventDefault();
        return recentre();
      case "e":
        e.preventDefault();
        return onExpiryStep?.(1);
      case "E":
        e.preventDefault();
        return onExpiryStep?.(-1);
      case "ArrowRight":
        e.preventDefault();
        return scroll.scrollBy(COLUMN_PX, "calls");
      case "ArrowLeft":
        e.preventDefault();
        return scroll.scrollBy(-COLUMN_PX, "calls");
      default:
        return undefined;
    }
  };

  // Wheel on either track moves the shared offset (non-passive so the page does not also scroll sideways).
  useEffect(() => {
    const bind = (el: HTMLDivElement | null, side: "calls" | "puts") => {
      if (!el) return () => undefined;
      const handler = (e: WheelEvent) => {
        if (scroll.onWheel(e, side)) e.preventDefault();
      };
      el.addEventListener("wheel", handler, { passive: false });
      return () => el.removeEventListener("wheel", handler);
    };
    const offCalls = bind(callsRef.current, "calls");
    const offPuts = bind(putsRef.current, "puts");
    return () => {
      offCalls();
      offPuts();
    };
  }, [scroll, sides]);

  const items = virtualizer.getVirtualItems();
  const total = virtualizer.getTotalSize();
  const gridCols = sides === "both" ? `minmax(0,1fr) ${STRIKE_COL_PX}px minmax(0,1fr)` : `minmax(0,1fr) ${STRIKE_COL_PX}px`;
  const trackStyle = (x: number): React.CSSProperties => ({ width: SIDE_TRACK_PX, height: total, transform: `translateX(-${x}px)`, position: "relative" });
  const rowGrid: React.CSSProperties = { gridTemplateColumns: `repeat(5, ${COLUMN_PX}px)` };

  return (
    <div
      ref={rootRef}
      className={cn("flex flex-col overflow-hidden", chain.stale && "opacity-60")}
      style={{ height }}
      data-testid="chain-table"
      data-rows={rows.length}
      data-total={fullRows.length}
      data-visible={items.length}
      data-range={range}
      data-sides={sides}
      data-x={scroll.x}
      data-puts-x={scroll.putsX}
    >
      <ChainTools
        range={range}
        onRange={onRange}
        live={live}
        sides={sides}
        narrow={narrow}
        onSide={setNarrowSide}
        onRecentre={recentre}
      />
      <ChainHeader
        x={scroll.x}
        putsX={scroll.putsX}
        trackWidth={SIDE_TRACK_PX}
        expiryLabel={expiryLabel}
        daysLeft={daysLeft}
        sides={sides}
        rangeLabel={rangeLabel(range)}
        lotLabel={lotLabel}
      />
      <div
        ref={viewportRef}
        className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden outline-none focus-visible:ring-1 focus-visible:ring-ring"
        data-testid="chain-scroll"
        tabIndex={0}
        role="grid"
        aria-label="Options chain (J / K or arrows move the highlighted strike, A recentres on ATM, E cycles expiry)"
        aria-rowcount={rows.length}
        onKeyDown={onKeyDown}
      >
        <div className="grid" style={{ gridTemplateColumns: gridCols, height: total }}>
          {sides !== "puts" ? (
            <div ref={callsRef} className="relative min-w-0 overflow-hidden" data-testid="chain-calls" data-x={scroll.x}>
              <div style={trackStyle(scroll.x)}>
                {items.map((v) => {
                  const row = rows[v.index];
                  if (!row) return null;
                  const prev = prevSnapshot[v.index];
                  const flashes = quoteFlashes(prev?.call, row.call, row.call ? chain.changed.get(row.call.instrumentId) : undefined);
                  const isAtm = v.index === atm;
                  return (
                    <div
                      key={row.strike}
                      data-testid="chain-row-calls"
                      data-strike={row.strike}
                      className={cn(
                        "absolute left-0 grid w-full border-b border-border text-xs",
                        itmSide(row.strike, spot) === "call" && "itm-tint",
                        isAtm && "atm-band",
                        v.index === focus && "chain-focus",
                      )}
                      style={{ ...rowGrid, height: v.size, transform: `translateY(${v.start}px)` }}
                    >
                      <SideCells q={row.call} flashes={flashes} side="calls" maxOi={maxOi} />
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}
          <div className="relative border-x border-border">
            {items.map((v) => {
              const row = rows[v.index];
              if (!row) return null;
              const isAtm = v.index === atm;
              return (
                <div
                  key={row.strike}
                  role="row"
                  aria-rowindex={v.index + 1}
                  data-testid="chain-row"
                  data-strike={row.strike}
                  data-atm={isAtm || undefined}
                  data-focus={v.index === focus || undefined}
                  onClick={() => setFocus(v.index)}
                  className={cn(
                    "num absolute left-0 right-0 flex flex-col items-center justify-center border-b border-border text-[12.5px] font-medium",
                    isAtm && "atm-band text-spot",
                    v.index === focus && "chain-focus",
                  )}
                  style={{ height: v.size, transform: `translateY(${v.start}px)` }}
                >
                  <span className="whitespace-nowrap">{fmtStrike(row.strike)}</span>
                  {isAtm ? (
                    <span className="max-w-full truncate text-3xs font-normal leading-none text-spot" title={`At the money · spot ${fmtPrice(spot)}`}>
                      ATM · {fmtPrice(spot)}
                    </span>
                  ) : null}
                </div>
              );
            })}
          </div>
          {sides !== "calls" ? (
            <div ref={putsRef} className="relative min-w-0 overflow-hidden" data-testid="chain-puts" data-x={scroll.putsX}>
              <div style={trackStyle(scroll.putsX)}>
                {items.map((v) => {
                  const row = rows[v.index];
                  if (!row) return null;
                  const prev = prevSnapshot[v.index];
                  const flashes = quoteFlashes(prev?.put, row.put, row.put ? chain.changed.get(row.put.instrumentId) : undefined);
                  const isAtm = v.index === atm;
                  return (
                    <div
                      key={row.strike}
                      data-testid="chain-row-puts"
                      data-strike={row.strike}
                      className={cn(
                        "absolute left-0 grid w-full border-b border-border text-xs",
                        itmSide(row.strike, spot) === "put" && "itm-tint",
                        isAtm && "atm-band",
                        v.index === focus && "chain-focus",
                      )}
                      style={{ ...rowGrid, height: v.size, transform: `translateY(${v.start}px)` }}
                    >
                      <SideCells q={row.put} flashes={flashes} side="puts" maxOi={maxOi} />
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}
        </div>
      </div>
      <ChainFooter shown={rows.length} total={fullRows.length} totals={totals} scroll={scroll} trackWidth={SIDE_TRACK_PX} sides={sides} asOf={asOf} />
    </div>
  );
}
