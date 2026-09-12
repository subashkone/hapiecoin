"use client";
// The chain picker's body (HC-TR-027, 028, 031..034; reused inline by the adjustment workbench, HC-TR-148):
// an expiry strip and a compact live chain with B / S per side. The caller owns the selection state and
// says what each cell shows: a pick, a held position (lots now → after) or nothing. With `keyboard` on,
// the table takes focus: ↑ ↓ (j k) move, b / s pick the call, B / S the put, Enter reviews, Esc clears.
import { cn } from "@hapiecoin/ui";
import { useEffect, useMemo, useState } from "react";
import type { Underlying } from "@hapiecoin/schema";
import { nearestExpiry } from "@/lib/chain/expiries";
import { useExpiriesQuery } from "@/lib/chain/useExpiries";
import { maxOpenInterest, oiBarPercent, sliceAroundAtm } from "@/lib/chain/range";
import { daysToExpiry, fmtExpiry, fmtIv, fmtOi, fmtPrice, fmtStrike, fmtDelta } from "@/lib/format";
import { useChain, useSpot } from "@/lib/gateway/hooks";
import type { ChainState } from "@/lib/gateway/reducer";
import { atmIndex } from "@/lib/gateway/reducer";
import type { LegSide } from "@/lib/strategy/legs";
import { ExpiryStrip } from "@/components/chain/ExpiryStrip";

export type PickerRow = ChainState["rows"][number];
export type PickerKind = "call" | "put";

export interface ChainCellState {
  /** A pick on this contract (not held by the position). */
  picked?: LegSide | undefined;
  /** The position holds this contract: side, lots now and lots after the draft. */
  held?: { side: LegSide; lots: number; after: number } | undefined;
}

/** Expiries, the chosen expiry and the chain window around ATM for one asset; `open` gates the subscriptions. */
export function usePickerChain(asset: Underlying, open: boolean, preferredExpiry: string | null | undefined) {
  const expiries = useExpiriesQuery(asset, { enabled: open }); // keyed by venue (ADR-069)
  const list = useMemo(() => expiries.data?.expiries ?? [], [expiries.data]);
  const [expiry, setExpiry] = useState<string | null>(null);
  useEffect(() => {
    if (open) setExpiry(preferredExpiry && list.includes(preferredExpiry) ? preferredExpiry : nearestExpiry(list));
  }, [open, preferredExpiry, list]);
  const chain = useChain(asset, open ? expiry : null);
  const spot = useSpot(asset);
  const rows = chain?.rows ?? [];
  const atm = useMemo(() => atmIndex(rows, spot?.price), [rows, spot?.price]);
  const shown = useMemo(() => sliceAroundAtm(rows, atm, 12), [rows, atm]);
  return { expiries: list, expiry, setExpiry, rows: shown.rows, atm: shown.atm, spot };
}

export interface ChainPickerBodyProps {
  asset: Underlying;
  expiries: readonly string[];
  expiry: string | null;
  onExpiry: (expiry: string) => void;
  rows: readonly PickerRow[];
  atm: number;
  stateOf: (strike: string, kind: PickerKind) => ChainCellState;
  onToggle: (kind: PickerKind, side: LegSide, row: PickerRow) => void;
  keyboard?: boolean | undefined;
  onEnter?: (() => void) | undefined;
  onEscape?: (() => void) | undefined;
  /** Height class of the scrolling table box. */
  boxClass?: string | undefined;
  testId?: string | undefined;
}

export function ChainPickerBody({ asset, expiries, expiry, onExpiry, rows, atm, stateOf, onToggle, keyboard = false, onEnter, onEscape, boxClass = "max-h-[46vh]", testId = "picker" }: ChainPickerBodyProps) {
  const [focus, setFocus] = useState(-1);
  useEffect(() => setFocus(-1), [expiry]);
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (!keyboard || e.altKey || e.ctrlKey || e.metaKey) return;
    const last = rows.length - 1;
    const move = (i: number) => {
      e.preventDefault();
      setFocus(Math.max(0, Math.min(last, i)));
    };
    const pickKey = (kind: PickerKind, side: LegSide) => {
      e.preventDefault();
      const row = rows[focus < 0 ? atm : focus];
      if (row && (kind === "call" ? row.call : row.put)) onToggle(kind, side, row);
    };
    switch (e.key) {
      case "ArrowDown":
      case "j":
        return move((focus < 0 ? atm : focus) + 1);
      case "ArrowUp":
      case "k":
        return move((focus < 0 ? atm : focus) - 1);
      case "Home":
        return move(0);
      case "End":
        return move(last);
      case "b":
        return pickKey("call", "buy");
      case "s":
        return pickKey("call", "sell");
      case "B":
        return pickKey("put", "buy");
      case "S":
        return pickKey("put", "sell");
      case "Enter":
        if (e.target !== e.currentTarget) return undefined; // Enter on a focused B / S button is that button's click
        e.preventDefault();
        return onEnter?.();
      case "Escape":
        if (e.target !== e.currentTarget) return undefined;
        e.preventDefault();
        setFocus(-1);
        return onEscape?.();
      default:
        return undefined;
    }
  };
  const maxOi = useMemo(() => maxOpenInterest(rows), [rows]); // HC-TR-127: OI bars grow toward the strike
  const bs = (kind: PickerKind, r: PickerRow) => {
    const q = kind === "call" ? r.call : r.put;
    const st = stateOf(r.strike, kind);
    return (
      <span className="inline-flex items-center gap-1">
        {(["buy", "sell"] as const).map((side) => {
          const on = st.picked === side || (st.held?.side === side && st.held.after > 0);
          const title = st.held ? (st.held.side === side ? `Add lots to the held ${side} ${kind}` : `Trim or close the held ${st.held.side} ${kind}`) : `${side === "buy" ? "Buy" : "Sell"} ${kind} ${fmtStrike(r.strike)}`;
          return (
            <button
              key={side}
              type="button"
              disabled={!q}
              aria-pressed={on}
              onClick={() => onToggle(kind, side, r)}
              className={cn("grid h-[18px] w-5 place-items-center rounded-[2px] border text-[10.5px] font-bold disabled:opacity-40", side === "buy" ? "border-buy text-buy" : "border-sell text-sell", on && (side === "buy" ? "bg-buy text-white" : "bg-sell text-white"))}
              aria-label={title}
              title={title}
              data-testid={`${testId}-${side}-${kind}`}
              data-strike={r.strike}
            >
              {side === "buy" ? "B" : "S"}
            </button>
          );
        })}
        {st.held ? (
          <span className={cn("micro rounded border px-1", st.held.after === 0 ? "border-loss text-loss line-through" : st.held.after !== st.held.lots ? "border-warning text-warning" : "border-border text-muted-foreground")} title={`Held: ${st.held.lots} lots → ${st.held.after} after`} data-testid={`${testId}-held`} data-after={st.held.after}>
            {st.held.after === st.held.lots ? st.held.lots : `${st.held.lots}→${st.held.after}`}
          </span>
        ) : null}
      </span>
    );
  };
  return (
    <div className="flex min-h-0 flex-col">
      <ExpiryStrip className="pb-1" testId={`${testId}-strip`}>
        {expiries.map((e) => (
          <button key={e} type="button" role="tab" aria-selected={e === expiry} onClick={() => onExpiry(e)} className={cn("shrink-0 rounded px-2 py-1 text-xs", e === expiry ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground")} data-testid={`${testId}-expiry`} data-expiry={e}>
            {fmtExpiry(e)} <span className="font-mono text-3xs">{daysToExpiry(e)}d</span>
          </button>
        ))}
      </ExpiryStrip>
      <div className={cn("mt-2 overflow-auto rounded border border-border outline-none focus-visible:ring-1 focus-visible:ring-ring", boxClass)} tabIndex={keyboard ? 0 : undefined} onKeyDown={onKeyDown} aria-label={keyboard ? `${asset} chain: arrows move, B / S pick the call, Shift+B / Shift+S the put, Enter reviews` : undefined} data-testid={`${testId}-box`}>
        <table className="w-full text-xs" data-testid={`${testId}-table`} data-rows={rows.length} data-atm={atm}>
          <thead className="sticky top-0 bg-surface-1">
            <tr className="micro">
              <th className="py-1 pl-2 text-left">Calls</th>
              <th className="py-1 text-right">Δ</th>
              <th className="py-1 text-right">OI</th>
              <th className="py-1 text-right">Mark/IV</th>
              <th className="py-1 text-center">Strike</th>
              <th className="py-1 text-left">Mark/IV</th>
              <th className="py-1 text-left">OI</th>
              <th className="py-1 text-left">Δ</th>
              <th className="py-1 pr-2 text-right">Puts</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const isAtm = i === atm;
              const callItm = atm >= 0 && i < atm; // HC-TR-127: calls are in the money below ATM, puts above
              const putItm = atm >= 0 && i > atm;
              const cOi = oiBarPercent(r.call?.oi, maxOi);
              const pOi = oiBarPercent(r.put?.oi, maxOi);
              return (
                <tr key={r.strike} className={cn("border-t border-border", isAtm && "atm-band", i === focus && "outline outline-1 -outline-offset-1 outline-ring")} data-testid={`${testId}-row`} data-strike={r.strike} data-focused={i === focus ? "true" : undefined}>
                  <td className={cn("py-1 pl-2", callItm && "itm-tint")}>{bs("call", r)}</td>
                  <td className={cn("num py-1 text-right text-muted-foreground", callItm && "itm-tint")} data-testid="picker-delta-call">{fmtDelta(r.call?.greeks?.delta)}</td>
                  <td className={cn("num relative py-1 text-right", callItm && "itm-tint")} data-testid="picker-oi-call" data-pct={cOi}>
                    {cOi > 0 ? <i className="oi-bar right-0" style={{ width: `${cOi}%` }} aria-hidden /> : null}
                    <span className="relative">{fmtOi(r.call?.oi)}</span>
                  </td>
                  <td className={cn("num py-1 text-right", callItm && "itm-tint")}>
                    {fmtPrice(r.call?.mark)} <span className="text-3xs text-muted-foreground">{fmtIv(r.call?.markIv)}</span>
                  </td>
                  <td className={cn("num py-1 text-center font-medium", isAtm && "text-spot")}>{fmtStrike(r.strike)}</td>
                  <td className={cn("num py-1 text-left", putItm && "itm-tint")}>
                    {fmtPrice(r.put?.mark)} <span className="text-3xs text-muted-foreground">{fmtIv(r.put?.markIv)}</span>
                  </td>
                  <td className={cn("num relative py-1 text-left", putItm && "itm-tint")} data-testid="picker-oi-put" data-pct={pOi}>
                    {pOi > 0 ? <i className="oi-bar left-0" style={{ width: `${pOi}%` }} aria-hidden /> : null}
                    <span className="relative">{fmtOi(r.put?.oi)}</span>
                  </td>
                  <td className={cn("num py-1 text-left text-muted-foreground", putItm && "itm-tint")} data-testid="picker-delta-put">{fmtDelta(r.put?.greeks?.delta)}</td>
                  <td className={cn("py-1 pr-2 text-right", putItm && "itm-tint")}>{bs("put", r)}</td>
                </tr>
              );
            })}
            {rows.length === 0 ? (
              <tr>
                <td colSpan={9} className="py-6 text-center text-muted-foreground">
                  {expiry ? "Waiting for the chain…" : "No expiry"}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
