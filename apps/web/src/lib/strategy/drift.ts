// Out of sync with the exchange (ADR-059 §2.2; HC-TR-160): the exchange's net position per contract against the sum
// of the open live legs HapieCoin tracks for it. They differ when something changed the position without the app: an
// exchange-level stop, a manual close on the exchange, a liquidation, an expiry. Every strategy holding the contract
// is flagged, because the exchange cannot say whose lots went.
import { type LivePosition, type Strategy, type Underlying, settlementMsOf } from "@hapiecoin/schema";
import { lotsFor } from "./positions";

export interface DriftRow {
  symbol: string;
  /** Signed lots (buy +, sell −) the open live legs add up to. */
  expected: number;
  /** Signed lots the exchange holds (0 when it holds nothing). */
  held: number;
  /** Ids of the live strategies holding the contract. */
  strategies: string[];
}

const sign = (side: "buy" | "sell") => (side === "buy" ? 1 : -1);

/** How long after its settlement instant a leg is the settler's business; after that an unsettled leg is out of sync again. */
export const SETTLING_WINDOW_MS = 15 * 60_000;

/** True while a leg past its settlement instant is inside the settling window. */
export function isSettling(expiry: string, asset: Underlying, nowMs: number): boolean {
  const settle = settlementMsOf(expiry, asset);
  return settle !== null && settle <= nowMs && nowMs - settle <= SETTLING_WINDOW_MS;
}

/** Drift rows by strategy id; empty when everything matches. Contracts the app does not track are ignored. */
export function driftFor(positions: readonly LivePosition[], strategies: readonly Strategy[], lotSizeOf: (asset: Underlying) => string, nowMs = Date.now()): Map<string, DriftRow[]> {
  const expected = new Map<string, { lots: number; ids: string[]; asset: Underlying }>();
  for (const s of strategies) {
    if (s.status !== "live") continue;
    for (const l of s.legs) {
      // a leg whose entry never filled (a resting limit, a refused order) is not at the exchange yet: nothing to expect
      if (l.status !== "open" || l.entryPrice === null) continue;
      // a leg just past its settlement instant is the settler's business (ADR-059 §2.4): the exchange removes it at
      // settlement and the API books it as expired within minutes; one still open after the window is out of sync
      if (isSettling(l.expiry, s.asset, nowMs)) continue;
      const e = expected.get(l.symbol) ?? { lots: 0, ids: [], asset: s.asset };
      e.lots += sign(l.side) * l.lots;
      if (!e.ids.includes(s.id)) e.ids.push(s.id);
      expected.set(l.symbol, e);
    }
  }
  const held = new Map<string, number>();
  // a position the client cannot size (no product data, a lot size that is not a multiple of the contract) is unknown:
  // its contract is left out of the check rather than read as "the exchange holds nothing"
  const unknown = new Set<string>();
  for (const p of positions) {
    if (!p.symbol || p.size === 0) continue;
    const e = expected.get(p.symbol);
    if (!e) continue;
    const lots = p.contractValue ? lotsFor(Math.abs(p.size), p.contractValue, lotSizeOf(e.asset)) : null;
    if (lots === null) {
      unknown.add(p.symbol);
      continue;
    }
    held.set(p.symbol, (held.get(p.symbol) ?? 0) + Math.sign(p.size) * lots);
  }
  const out = new Map<string, DriftRow[]>();
  for (const [symbol, e] of expected) {
    if (unknown.has(symbol)) continue;
    const h = held.get(symbol) ?? 0;
    if (h === e.lots) continue;
    const row: DriftRow = { symbol, expected: e.lots, held: h, strategies: e.ids };
    for (const id of e.ids) out.set(id, [...(out.get(id) ?? []), row]);
  }
  return out;
}

/** Lots of this strategy's leg that are no longer at the exchange (its share of the shortfall on that contract), 0 when the exchange holds at least as much on that side. */
export function shortfallFor(row: DriftRow, leg: { side: "buy" | "sell"; lots: number }): number {
  const missing = row.expected - row.held; // signed: negative when sold lots are gone
  if (missing === 0 || Math.sign(missing) !== sign(leg.side)) return 0;
  return Math.min(leg.lots, Math.abs(missing));
}
