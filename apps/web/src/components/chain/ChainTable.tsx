"use client";
// Options chain table (HC-WS-015..020, HC-WS-022, HC-WS-108; GAPS #1, #2; design: docs/design/options-chain.md).
// One vertical scroller virtualises the rows (TanStack Virtual) for three aligned row lists: the calls
// track, the fixed centre strike column and the puts track. The two tracks are translated by a shared
// horizontal offset (useMirroredScroll), so a scroll on one side moves the other the mirrored amount and
// the header parts stay aligned with the body. Rows are exactly the gateway snapshot (ADR-006); the
// range control only slices them around the ATM row.
import { cn, toast } from "@hapiecoin/ui";
import type { ChainRow, Quote } from "@hapiecoin/schema";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ChainLayout } from "@/lib/chain/layout";
import { type ChainRange, chainTotals, itmSide, maxOpenInterest, oiBarPercent, sliceAroundAtm } from "@/lib/chain/range";
import { fmtChange, fmtDelta, fmtGamma, fmtIv, fmtOiFull, fmtPrice, fmtQty, fmtStrike, fmtTheta, fmtVega } from "@/lib/format";
import { atmIndex, type ChainState } from "@/lib/gateway/reducer";
import { chainStats, nearestDelta } from "@/lib/chain/structure";
import { type LegKind, type LegSide, type RowMarks, type StrategyLeg, rowMarks } from "@/lib/strategy/legs";
import { ChainHeader } from "./ChainHeader";
import { RowControls } from "./RowControls";
import { ChainFooter, ChainTools, rangeLabel } from "./ChainTools";
import type { FeedState } from "./ChainTools";
import {
  COLUMN_PX,
  type ChainColumn,
  NARROW_BREAKPOINT_PX,
  ROW_PX,
  STRIKE_COL_PX,
  callColumns,
  gridTemplate,
  putColumns,
  trackWidth as layoutTrackWidth,
} from "./columns";
import { useMirroredScroll } from "./useMirroredScroll";

type Sides = "both" | "calls" | "puts";

interface CellProps {
  col: "ask" | "mark" | "bid";
  price: string | undefined;
  iv: number | undefined;
  flash?: string | undefined;
  align: "right" | "left";
}

function PriceIv({ col, price, iv, flash, align }: CellProps) {
  return (
    <div className={cn("num flex flex-col justify-center px-2 leading-tight", align === "right" ? "items-end" : "items-start", flash)} data-col={col}>
      <span>{fmtPrice(price)}</span>
      <span className="text-3xs text-muted-foreground">{fmtIv(iv)}</span>
    </div>
  );
}

/** One cell of one side, by column id (HC-WS-021); the cell content is display-only formatting. */
function Cell({ col, q, flashes, side, maxOi, markTone }: { col: ChainColumn; q: Quote | undefined; flashes: ReturnType<typeof quoteFlashes>; side: "calls" | "puts"; maxOi: number; markTone: "buy" | "sell" | null }) {
  const align = side === "calls" ? "right" : "left";
  const plain = (text: string, extra?: string) => (
    <div className={cn("num flex items-center px-2", align === "right" ? "justify-end" : "justify-start", extra)} data-col={col.id}>
      {text}
    </div>
  );
  switch (col.id) {
    case "ask":
      return <PriceIv col="ask" price={q?.ask} iv={q?.askIv} flash={flashes.ask} align={align} />;
    case "mark":
      return (
        <PriceIv
          col="mark"
          price={q?.mark}
          iv={q?.markIv}
          flash={cn(flashes.mark, markTone === "buy" && "legcell-buy", markTone === "sell" && "legcell-sell") || undefined}
          align={align}
        />
      );
    case "bid":
      return <PriceIv col="bid" price={q?.bid} iv={q?.bidIv} flash={flashes.bid} align={align} />;
    case "oi": {
      const pct = oiBarPercent(q?.oi, maxOi);
      return (
        <div className={cn("num relative flex items-center px-2", align === "right" ? "justify-end" : "justify-start")} data-testid="chain-oi" data-pct={pct} data-col="oi">
          {pct > 0 ? <i className={cn("oi-bar", side === "calls" ? "left-0" : "right-0")} style={{ width: `${pct}%` }} aria-hidden /> : null}
          <span className="relative">{fmtOiFull(q?.oi)}</span>
        </div>
      );
    }
    case "delta":
      return plain(fmtDelta(q?.greeks?.delta));
    case "gamma":
      return plain(fmtGamma(q?.greeks?.gamma));
    case "theta":
      return plain(fmtTheta(q?.greeks?.theta));
    case "vega":
      return plain(fmtVega(q?.greeks?.vega));
    case "volume":
      return plain(fmtQty(q?.volume24h));
    case "bidQty":
      return plain(fmtQty(q?.bidQty));
    case "askQty":
      return plain(fmtQty(q?.askQty));
    case "chg24": {
      const c = fmtChange(q?.change24hPct);
      return plain(c.text, c.dir === "up" ? "text-profit" : c.dir === "down" ? "text-loss" : undefined);
    }
    case "last":
      return plain(fmtPrice(q?.last));
  }
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

function SideCells({ cols, q, flashes, side, maxOi, markTone }: { cols: readonly ChainColumn[]; q: Quote | undefined; flashes: ReturnType<typeof quoteFlashes>; side: "calls" | "puts"; maxOi: number; markTone: "buy" | "sell" | null }) {
  if (cols.length === 0) {
    return <div className={cn("micro flex items-center px-2 text-muted-foreground", side === "calls" ? "justify-end" : "justify-start")}>no columns</div>;
  }
  return (
    <>
      {cols.map((col) => (
        <Cell key={col.id} col={col} q={q} flashes={flashes} side={side} maxOi={maxOi} markTone={markTone} />
      ))}
    </>
  );
}

const NO_MARKS: RowMarks = { call: { buyLots: 0, sellLots: 0, tone: null }, put: { buyLots: 0, sellLots: 0, tone: null }, pills: [] };

export interface ChainTableProps {
  chain: ChainState;
  spot: string | undefined;
  rowHeight?: number;
  /** Height of the whole table (tools, header, rows, footer) in px. */
  height?: number;
  range: ChainRange;
  onRange: (range: ChainRange) => void;
  /** Which columns show and in what order from the strike outward (HC-WS-021). */
  layout: ChainLayout;
  /** Gear button: open the Column Settings dialog (HC-WS-010). */
  onOpenColumns?: () => void;
  /** Bumped by the store when something asks to recentre on ATM. */
  recentreSignal?: number;
  /** Step the expiry (E / Shift+E). */
  onExpiryStep?: (delta: 1 | -1) => void;
  expiryLabel: string;
  daysLeft: number | null;
  lotLabel: string;
  live: boolean;
  feed?: FeedState | undefined;
  /** Time label shown in the footer while stale, or null. */
  asOf: string | null;
  /** Panel width override for tests (jsdom has no layout). */
  initialWidth?: number;
  /** Legs of this asset and expiry (HC-WS-027). */
  legs?: readonly StrategyLeg[];
  /** Lots the B / S buttons add (HC-WS-025) and the "Lots × size" tooltip. */
  lots?: number;
  lotsTitle?: string;
  /** True when the strategy holds the maximum active legs (HC-TR-017). */
  atLimit?: boolean;
  onAddLeg?: (kind: LegKind, side: LegSide, strike: string, quote: Quote | undefined) => void;
  onLots?: (delta: 1 | -1) => void;
  onInfo?: (kind: LegKind, strike: string) => void;
}

const CHROME_PX = 34 + 46 + 40; // tools + header + footer

export function ChainTable({
  chain,
  spot,
  rowHeight = ROW_PX,
  height = 520,
  range,
  onRange,
  layout,
  onOpenColumns,
  recentreSignal = 0,
  onExpiryStep,
  expiryLabel,
  daysLeft,
  lotLabel,
  live,
  feed,
  asOf,
  initialWidth = 1200,
  legs = [],
  lots = 10,
  lotsTitle = "Lots",
  atLimit = false,
  onAddLeg,
  onLots,
  onInfo,
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
  // Columns from the persisted layout: puts read inboard → outboard, calls are the mirror (HC-WS-021).
  const putCols = useMemo(() => putColumns(layout), [layout]);
  const callCols = useMemo(() => callColumns(layout), [layout]);
  const SIDE_TRACK_PX = useMemo(() => layoutTrackWidth(layout), [layout]);
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
  // footer stats read the whole chain, not the slice: max pain and the 25Δ skew live in the wings (HC-WS-029, 080)
  const spotNum = spot === undefined ? null : Number(spot);
  const stats = useMemo(() => chainStats(fullRows, spotNum !== null && Number.isFinite(spotNum) ? spotNum : null), [fullRows, spotNum]);
  // the spot hairline sits between the two strikes bracketing spot (HC-WS-075); on a listed strike the ATM band alone marks it
  const spotBoundary = useMemo(() => {
    if (spotNum === null || !Number.isFinite(spotNum) || rows.length < 2) return -1;
    const above = rows.findIndex((r) => Number(r.strike) > spotNum);
    if (above <= 0) return -1;
    return Number(rows[above - 1]!.strike) === spotNum ? -1 : above;
  }, [rows, spotNum]);
  // Δ chips (HC-WS-074): remember the hit until the rows (possibly widened to "all") contain it, then scroll + pulse
  const [pulse, setPulse] = useState<{ call: string; put: string } | null>(null);
  const pendingDelta = useRef<{ call: string; put: string } | null>(null);

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

  // Leg marks per strike (HC-WS-027), recomputed only when the legs or rows change.
  const marksByStrike = useMemo(() => {
    const m = new Map<string, RowMarks>();
    if (legs.length === 0) return m;
    for (const r of rows) m.set(r.strike, rowMarks(legs, r.strike));
    return m;
  }, [legs, rows]);
  const marksOf = (strike: string): RowMarks => marksByStrike.get(strike) ?? NO_MARKS;

  // Roving keyboard focus over the visible rows (HC-WS-016 / design §6) and the hovered row for the controls.
  const [focus, setFocus] = useState<number>(-1);
  const [rowsTick, setRowsTick] = useState(0); // re-runs the Δ effect when the hit already sits in the slice
  const [hover, setHover] = useState<number>(-1);
  const active = hover >= 0 ? hover : focus;
  const addFromKey = (kind: LegKind, side: LegSide) => {
    const row = rows[focus];
    if (!row || !onAddLeg) return;
    onAddLeg(kind, side, row.strike, kind === "call" ? row.call : row.put);
  };
  // `highlight` moves the keyboard highlight onto the ATM row (A key, palette); the automatic centring on
  // load or expiry change only scrolls, so no row control appears before the trader asks for one.
  const recentre = useCallback((highlight = false) => {
    if (atm < 0 || !rows.length) return;
    virtualizer.scrollToIndex(atm, { align: "center" });
    if (highlight) setFocus(atm);
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
      recentre(true);
    }
  }, [recentreSignal, recentre]);
  useEffect(() => {
    if (focus >= 0 && focus < rows.length) virtualizer.scrollToIndex(focus, { align: "auto" });
  }, [focus, rows.length, virtualizer]);
  useEffect(() => {
    const p = pendingDelta.current;
    if (!p) return;
    const ci = rows.findIndex((r) => r.strike === p.call);
    const pi = rows.findIndex((r) => r.strike === p.put);
    if (ci < 0 || pi < 0) return;
    pendingDelta.current = null;
    virtualizer.scrollToIndex(Math.round((ci + pi) / 2), { align: "center" });
    setFocus(ci);
    setPulse(p);
    const t = setTimeout(() => setPulse(null), 1600);
    return () => clearTimeout(t);
  }, [rows, rowsTick, virtualizer]);
  const findDelta = useCallback(
    (pct: number) => {
      const hit = nearestDelta(fullRows, pct / 100);
      if (!hit.call || !hit.put) {
        toast.error("No Δ on this chain yet", { description: "Greeks arrive with the first quotes" });
        return;
      }
      const inSlice = (strike: string) => rows.some((r) => r.strike === strike);
      pendingDelta.current = { call: hit.call.strike, put: hit.put.strike };
      if (range !== 0 && (!inSlice(hit.call.strike) || !inSlice(hit.put.strike))) onRange(0); // widen so both rows exist
      else setRowsTick((t) => t + 1);
      toast(`${pct}Δ strikes`, { description: `Call ${fmtStrike(hit.call.strike)} (Δ ${fmtDelta(hit.call.delta)}) · Put ${fmtStrike(hit.put.strike)} (Δ ${fmtDelta(hit.put.delta)})` });
    },
    [fullRows, rows, range, onRange],
  );

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
        return recentre(true);
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
      // Legs (HC-WS-028): B / S on the calls side, Shift for puts; Enter details; Esc clears; + / − lots.
      case "b":
        e.preventDefault();
        return addFromKey("call", "buy");
      case "s":
        e.preventDefault();
        return addFromKey("call", "sell");
      case "B":
        e.preventDefault();
        return addFromKey("put", "buy");
      case "S":
        e.preventDefault();
        return addFromKey("put", "sell");
      case "Enter": {
        e.preventDefault();
        const row = rows[focus];
        if (row && onInfo) onInfo(e.shiftKey ? "put" : "call", row.strike);
        return undefined;
      }
      case "Escape":
        e.preventDefault();
        setFocus(-1);
        setHover(-1);
        return undefined;
      case "+":
      case "=":
        e.preventDefault();
        return onLots?.(1);
      case "-":
      case "_":
        e.preventDefault();
        return onLots?.(-1);
      default:
        return undefined;
    }
  };

  const controlsFor = (side: "calls" | "puts", row: ChainRow, marks: RowMarks) =>
    onAddLeg ? (
      <RowControls
        side={side}
        strike={row.strike}
        lots={lots}
        lotsTitle={lotsTitle}
        marks={side === "calls" ? marks.call : marks.put}
        atLimit={atLimit}
        onAdd={(kind, legSide) => onAddLeg(kind, legSide, row.strike, side === "calls" ? row.call : row.put)}
        onLots={(delta) => onLots?.(delta)}
        onInfo={(kind) => onInfo?.(kind, row.strike)}
      />
    ) : null;

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
  const callsGrid: React.CSSProperties = { gridTemplateColumns: gridTemplate(callCols) };
  const putsGrid: React.CSSProperties = { gridTemplateColumns: gridTemplate(putCols) };

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
      data-columns={putCols.map((c) => c.id).join(",")}
      data-active={active}
      data-hover={hover}
      data-focus-index={focus}
      data-pulse={pulse ? `${pulse.call}|${pulse.put}` : undefined}
    >
      <ChainTools
        range={range}
        onRange={onRange}
        live={live}
        feed={feed}
        sides={sides}
        narrow={narrow}
        onSide={setNarrowSide}
        onRecentre={() => recentre(true)}
        onOpenColumns={onOpenColumns}
        columnsShown={putCols.length}
        onFindDelta={findDelta}
      />
      <ChainHeader
        x={scroll.x}
        putsX={scroll.putsX}
        trackWidth={SIDE_TRACK_PX}
        callCols={callCols}
        putCols={putCols}
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
        <div className="relative grid" style={{ gridTemplateColumns: gridCols, height: total }} onMouseLeave={() => setHover(-1)}>
          {spotBoundary > 0 ? (
            <div className="pointer-events-none absolute left-0 right-0 z-10 h-0" style={{ transform: `translateY(${spotBoundary * rowHeight}px)` }} data-testid="spot-hairline" data-y={spotBoundary * rowHeight}>
              <div className="border-t border-dashed border-spot/80" />
              <span className="absolute left-1/2 top-0 -translate-x-1/2 -translate-y-1/2 rounded-[2px] bg-spot px-1.5 font-mono text-[9px] font-medium leading-[14px] text-background">SPOT {fmtPrice(spot)}</span>
            </div>
          ) : null}
          {sides !== "puts" ? (
            <div ref={callsRef} className="relative min-w-0 overflow-hidden" data-testid="chain-calls" data-x={scroll.x}>
              <div style={trackStyle(scroll.x)}>
                {items.map((v) => {
                  const row = rows[v.index];
                  if (!row) return null;
                  const prev = prevSnapshot[v.index];
                  const flashes = quoteFlashes(prev?.call, row.call, row.call ? chain.changed.get(row.call.instrumentId) : undefined);
                  const isAtm = v.index === atm;
                  const marks = marksOf(row.strike);
                  return (
                    <div
                      key={row.strike}
                      data-testid="chain-row-calls"
                      data-strike={row.strike}
                      data-leg={marks.call.tone ?? undefined}
                      onMouseEnter={() => setHover(v.index)}
                      className={cn(
                        "absolute left-0 grid w-full border-b border-border text-xs",
                        itmSide(row.strike, spot) === "call" && "itm-tint",
                        isAtm && "atm-band",
                        v.index === focus && "chain-focus",
                        pulse?.call === row.strike && "chain-pulse",
                        marks.call.tone === "buy" && "leg-stripe-buy",
                        marks.call.tone === "sell" && "leg-stripe-sell",
                      )}
                      style={{ ...callsGrid, height: v.size, transform: `translateY(${v.start}px)` }}
                    >
                      <SideCells cols={callCols} q={row.call} flashes={flashes} side="calls" maxOi={maxOi} markTone={marks.call.tone} />
                      {v.index === active && row.call ? controlsFor("calls", row, marks) : null}
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
              const marks = marksOf(row.strike);
              return (
                <div
                  key={row.strike}
                  role="row"
                  aria-rowindex={v.index + 1}
                  data-testid="chain-row"
                  data-strike={row.strike}
                  data-atm={isAtm || undefined}
                  data-focus={v.index === focus || undefined}
                  data-legs={marks.pills.length > 0 ? marks.pills.map((p) => p.text).join("|") : undefined}
                  data-pulse={pulse && (pulse.call === row.strike || pulse.put === row.strike) ? "true" : undefined}
                  onClick={() => setFocus(v.index)}
                  onMouseEnter={() => setHover(v.index)}
                  className={cn(
                    "num absolute left-0 right-0 flex flex-col items-center justify-center border-b border-border text-[12.5px] font-medium",
                    isAtm && "atm-band text-spot",
                    v.index === focus && "chain-focus",
                    pulse && (pulse.call === row.strike || pulse.put === row.strike) && "chain-pulse",
                  )}
                  style={{ height: v.size, transform: `translateY(${v.start}px)` }}
                >
                  <span className="whitespace-nowrap">{fmtStrike(row.strike)}</span>
                  {marks.pills.length > 0 ? (
                    <span className="flex max-w-full gap-1 truncate text-[9.5px] font-medium leading-none tracking-[0.04em]" data-testid="leg-pills">
                      {marks.pills.map((p) => (
                        <b key={p.text} className={p.tone === "buy" ? "text-buy" : "text-sell"} title={p.title}>
                          {p.text}
                        </b>
                      ))}
                    </span>
                  ) : isAtm ? (
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
                  const marks = marksOf(row.strike);
                  return (
                    <div
                      key={row.strike}
                      data-testid="chain-row-puts"
                      data-strike={row.strike}
                      data-leg={marks.put.tone ?? undefined}
                      onMouseEnter={() => setHover(v.index)}
                      className={cn(
                        "absolute left-0 grid w-full border-b border-border text-xs",
                        itmSide(row.strike, spot) === "put" && "itm-tint",
                        isAtm && "atm-band",
                        v.index === focus && "chain-focus",
                        pulse?.put === row.strike && "chain-pulse",
                        marks.put.tone === "buy" && "leg-stripe-buy-r",
                        marks.put.tone === "sell" && "leg-stripe-sell-r",
                      )}
                      style={{ ...putsGrid, height: v.size, transform: `translateY(${v.start}px)` }}
                    >
                      <SideCells cols={putCols} q={row.put} flashes={flashes} side="puts" maxOi={maxOi} markTone={marks.put.tone} />
                      {v.index === active && row.put ? controlsFor("puts", row, marks) : null}
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}
        </div>
      </div>
      <ChainFooter shown={rows.length} total={fullRows.length} totals={totals} scroll={scroll} trackWidth={SIDE_TRACK_PX} sides={sides} asOf={asOf} stats={stats} />
    </div>
  );
}
