"use client";
// The workbench's chain in the approved H2 form (ADR-058; HC-TR-148, 150): two columns per side (B / S, Mark · IV),
// a wide strike column with the ATM tag, a filled pill on strikes the position already holds, delta and open
// interest on hover only, the cap line above and the legend below. Same keyboard contract as the Builder picker:
// ↓ ↑ / J K move, B / S buy or sell the call, Shift+B / Shift+S the put, Enter reviews, Esc resets.
import { cn } from "@hapiecoin/ui";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { daysToExpiry, fmtDelta, fmtExpiry, fmtIv, fmtOi, fmtPrice, fmtStrike } from "@/lib/format";
import { ExpiryStrip } from "@/components/chain/ExpiryStrip";
import type { ChainCellState, PickerKind, PickerRow } from "@/components/builder/ChainPickerBody";
import type { LegSide } from "@/lib/strategy/legs";
import type { ChainRange } from "@/lib/chain/range";

export interface WorkbenchChainProps {
  expiries: readonly string[];
  expiry: string | null;
  onExpiry: (expiry: string) => void;
  rows: readonly PickerRow[];
  atm: number;
  /** Strikes each side of ATM (12) or every listed strike (0); HC-TR-193. */
  range: ChainRange;
  onRange: (range: ChainRange) => void;
  spot: number | null;
  /** "5 more open legs allowed after netting" (or the cap line). */
  capLine: string;
  lotsPerClick: number;
  stateOf: (strike: string, kind: PickerKind) => ChainCellState;
  onToggle: (kind: PickerKind, side: LegSide, row: PickerRow) => void;
  onEnter: () => void;
  onEscape: () => void;
  testId?: string | undefined;
}

export function WorkbenchChain({ expiries, expiry, onExpiry, rows, atm, range, onRange, spot, capLine, lotsPerClick, stateOf, onToggle, onEnter, onEscape, testId = "wb-chain" }: WorkbenchChainProps) {
  const [focus, setFocus] = useState(-1);
  const box = useRef<HTMLDivElement>(null);
  const centred = useRef<string | null>(null);
  // the focus is a row index: a new expiry or a new range re-slices the rows under it, so it starts over rather than
  // land on another strike (B / S act on the focused row)
  useEffect(() => setFocus(-1), [expiry, range]);
  // the focused row stays in view: Home, End and a run of arrows reach strikes far outside the box on a whole ladder
  useEffect(() => {
    if (focus < 0) return;
    box.current?.querySelector<HTMLElement>("tr[data-focused]")?.scrollIntoView?.({ block: "nearest" });
  }, [focus]);
  // each expiry, and each range, opens with the ATM row in the middle of the box: the list is every listed strike
  // by default (HC-TR-193), so the view starts where the market is and scrolls out to the held strikes and the wings
  useLayoutEffect(() => {
    const el = box.current;
    const view = `${expiry}|${range}`;
    // a box with no height yet keeps the key, so the centre is retried once it has one
    if (!el || el.clientHeight <= 0 || rows.length === 0 || atm < 0 || centred.current === view) return;
    centred.current = view;
    const row = el.querySelector<HTMLElement>("tr[data-atm]");
    if (row) el.scrollTop = Math.max(0, row.offsetTop - el.clientHeight / 2 + row.offsetHeight / 2);
  }, [rows, atm, expiry, range]);
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
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
        return onEnter();
      case "Escape":
        if (e.target !== e.currentTarget) return undefined;
        e.preventDefault();
        setFocus(-1);
        return onEscape();
      default:
        return undefined;
    }
  };

  const bs = (kind: PickerKind, r: PickerRow) => {
    const q = kind === "call" ? r.call : r.put;
    const st = stateOf(r.strike, kind);
    return (
      <span className={cn("inline-flex items-center gap-1", kind === "put" && "flex-row-reverse")}>
        {(["buy", "sell"] as const).map((side) => {
          const on = st.picked === side || (st.held?.side === side && st.held.after > 0);
          const title = st.held ? (st.held.side === side ? `Add ${lotsPerClick} lots to the held ${side} ${kind}` : `Trim or close the held ${st.held.side} ${kind}`) : `${side === "buy" ? "Buy" : "Sell"} ${kind} ${fmtStrike(r.strike)} · ${lotsPerClick} lots at mark`;
          return (
            <button
              key={side}
              type="button"
              disabled={!q}
              aria-pressed={on}
              onClick={() => onToggle(kind, side, r)}
              className={cn("grid h-[20px] w-[22px] place-items-center rounded-[2px] border text-[10.5px] font-bold disabled:opacity-40", side === "buy" ? "border-buy text-buy" : "border-sell text-sell", on && (side === "buy" ? "bg-buy text-white" : "bg-sell text-white"))}
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
          <span className={cn("micro rounded border px-1", st.held.after === 0 ? "border-loss text-loss line-through" : st.held.after !== st.held.lots ? "border-warning text-warning" : "border-foreground/40 text-foreground")} title={`You hold ${st.held.lots} lots ${st.held.side} · after this change ${st.held.after}`} data-testid={`${testId}-held`} data-side={st.held.side} data-lots={st.held.lots} data-after={st.held.after}>
            {st.held.after === st.held.lots ? st.held.lots : `${st.held.lots}→${st.held.after}`}
          </span>
        ) : null}
      </span>
    );
  };
  const markCell = (q: PickerRow["call"]) =>
    q ? (
      <span className="inline-flex items-baseline gap-1" title={`Δ ${fmtDelta(q.greeks?.delta)} · OI ${fmtOi(q.oi)} · bid ${fmtPrice(q.bid)} / ask ${fmtPrice(q.ask)}`}>
        <span>{fmtPrice(q.mark)}</span>
        <span className="text-3xs text-muted-foreground">{fmtIv(q.markIv)}</span>
      </span>
    ) : (
      <span className="text-muted-foreground">—</span>
    );

  return (
    <div className="flex min-h-0 flex-col" data-testid={testId}>
      <div className="flex flex-wrap items-center gap-2 text-2xs">
        <span className="micro">Chain · pick adjustment legs</span>
        <span className="text-muted-foreground" data-testid={`${testId}-cap`}>{capLine}</span>
        <span className="inline-flex overflow-hidden rounded border border-border" role="group" aria-label="Strike range" data-testid={`${testId}-range`} data-range={range}>
          {([12, 0] as const).map((r) => (
            <button key={r} type="button" aria-pressed={range === r} onClick={() => onRange(r)} className={cn("px-2 py-1 font-mono text-3xs uppercase focus-visible:outline focus-visible:outline-1 focus-visible:-outline-offset-1 focus-visible:outline-ring", range === r ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground")} title={r === 0 ? "Every listed strike of this expiry" : "12 strikes either side of ATM"} data-testid={`${testId}-range-${r}`}>
              {r === 0 ? "All" : "±12"}
            </button>
          ))}
        </span>
        <span className="micro text-muted-foreground" data-testid={`${testId}-count`}>{rows.length} strikes</span>
        <span className="micro ml-auto">spot <b className="num text-foreground">{spot === null ? "—" : fmtPrice(spot)}</b></span>
      </div>
      <ExpiryStrip className="pb-1 pt-1" testId={`${testId}-strip`}>
        {expiries.map((e) => (
          <button key={e} type="button" role="tab" aria-selected={e === expiry} onClick={() => onExpiry(e)} className={cn("shrink-0 rounded px-2 py-1 text-xs", e === expiry ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground")} data-testid={`${testId}-expiry`} data-expiry={e}>
            {fmtExpiry(e)} <span className="font-mono text-3xs">{daysToExpiry(e)}d</span>
          </button>
        ))}
      </ExpiryStrip>
      <div ref={box} className="mt-1 max-h-[52vh] overflow-auto rounded border border-border outline-none focus-visible:ring-1 focus-visible:ring-ring" tabIndex={0} onKeyDown={onKeyDown} aria-label="Adjustment chain · arrows move, B / S buy or sell the call, Shift+B / Shift+S the put, Enter reviews, Escape resets" data-testid={`${testId}-box`}>
        <table className="w-full text-xs [&_td]:h-9" data-testid={`${testId}-table`} data-rows={rows.length} data-atm={atm}>
          <thead className="sticky top-0 bg-surface-1">
            <tr className="micro">
              <th className="py-1 pl-2 text-left">Calls</th>
              <th className="py-1 pr-3 text-right">Mark · IV</th>
              <th className="py-1 text-center">Strike</th>
              <th className="py-1 pl-3 text-left">Mark · IV</th>
              <th className="py-1 pr-2 text-right">Puts</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const isAtm = i === atm;
              const callItm = atm >= 0 && i < atm;
              const putItm = atm >= 0 && i > atm;
              return (
                <tr key={r.strike} className={cn("border-t border-border", isAtm && "atm-band", i === focus && "outline outline-1 -outline-offset-1 outline-ring")} data-testid={`${testId}-row`} data-strike={r.strike} data-atm={isAtm ? "true" : undefined} data-focused={i === focus ? "true" : undefined}>
                  <td className={cn("pl-2", callItm && "itm-tint")}>{bs("call", r)}</td>
                  <td className={cn("num pr-3 text-right", callItm && "itm-tint")}>{markCell(r.call)}</td>
                  <td className={cn("num w-[104px] text-center font-medium", isAtm && "text-spot")}>
                    {fmtStrike(r.strike)}
                    {isAtm ? <span className="micro ml-1 text-spot">ATM</span> : null}
                  </td>
                  <td className={cn("num pl-3 text-left", putItm && "itm-tint")}>{markCell(r.put)}</td>
                  <td className={cn("pr-2 text-right", putItm && "itm-tint")}>{bs("put", r)}</td>
                </tr>
              );
            })}
            {rows.length === 0 ? (
              <tr>
                <td colSpan={5} className="py-6 text-center text-muted-foreground">
                  {expiry ? "Waiting for the chain…" : "No expiry"}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      <p className="mt-1 text-2xs text-muted-foreground">
        <kbd className="rounded border border-border px-1 font-mono">B</kbd> buy · <kbd className="rounded border border-border px-1 font-mono">S</kbd> sell · a filled pill on a row means you already hold that contract; the opposite side trims or closes it · {lotsPerClick} lots per click · hover a mark for Δ, OI and bid / ask
      </p>
    </div>
  );
}
