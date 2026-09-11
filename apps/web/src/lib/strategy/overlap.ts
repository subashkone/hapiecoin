// Overlapping contracts across strategies (ADR-059 §2.2; HC-TR-159): the exchange keeps one net position per contract
// per account, HapieCoin keeps lots per strategy. Before an order goes out, name every other open strategy that holds
// the same contract and what the exchange will hold afterwards, so an exchange-level stop or close on that contract
// is understood to act on all of it.
import type { Strategy } from "@hapiecoin/schema";
import type { LegSide } from "./legs";

export interface OverlapHold {
  id: string;
  name: string;
  side: LegSide;
  lots: number;
}

export interface OverlapRow {
  symbol: string;
  /** Human label of the contract, as the caller shows it. */
  label: string;
  held: OverlapHold[];
  /** Signed lots (buy +, sell −) other strategies hold now. */
  heldNet: number;
  /** Signed lots this order adds. */
  thisNet: number;
  /** Signed lots the exchange holds after this order, if everything fills. */
  afterNet: number;
}

export interface ProposedLeg {
  symbol: string;
  side: LegSide;
  lots: number;
  label: string;
}

const sign = (side: LegSide) => (side === "buy" ? 1 : -1);

/** Rows for the contracts in `proposed` that other strategies of the same mode already hold; `excludeId` is the strategy being traded. */
export function overlapsFor(proposed: readonly ProposedLeg[], others: readonly Strategy[], mode: "paper" | "live", excludeId: string | null): OverlapRow[] {
  const rows = new Map<string, OverlapRow>();
  for (const p of proposed) {
    const seen = rows.get(p.symbol);
    if (seen) {
      seen.thisNet += sign(p.side) * p.lots;
      continue;
    }
    const held: OverlapHold[] = [];
    for (const s of others) {
      if (s.status !== mode || s.id === excludeId) continue;
      for (const l of s.legs) if (l.status === "open" && l.symbol === p.symbol) held.push({ id: s.id, name: s.name, side: l.side, lots: l.lots });
    }
    if (held.length === 0) continue;
    const heldNet = held.reduce((a, h) => a + sign(h.side) * h.lots, 0);
    rows.set(p.symbol, { symbol: p.symbol, label: p.label, held, heldNet, thisNet: sign(p.side) * p.lots, afterNet: 0 });
  }
  return [...rows.values()].map((r) => ({ ...r, afterNet: r.heldNet + r.thisNet }));
}

/** "800 sold" / "200 bought" / "flat". */
export function lotsWord(net: number): string {
  return net === 0 ? "flat" : `${Math.abs(net).toLocaleString("en-US")} ${net > 0 ? "bought" : "sold"}`;
}
