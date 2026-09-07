// Pure state for one chain topic: applies `snap` (replace) and `q` (deltas) frames from @hapiecoin/schema.
// Strikes are exactly the rows the gateway sent (ADR-006); nothing here generates a strike.
import type { ChainRow, Quote, QuoteDelta, ServerMessage } from "@hapiecoin/schema";

export type Side = "call" | "put";

export interface ChainState {
  topic: string;
  seq: number;
  /** Rows in gateway order (ascending strike). */
  rows: ChainRow[];
  /** instrumentId → row index + side, rebuilt on every snapshot. */
  index: Map<string, { row: number; side: Side }>;
  /** Timestamp of the last applied frame (ms). */
  updatedAt: number;
  /** Set when a `q` arrives with a seq gap; the client must resubscribe for a fresh snapshot. */
  stale: boolean;
  /** instrumentId → fields changed by the last frame, for flash rendering. Cleared on the next frame. */
  changed: Map<string, Set<keyof Quote>>;
}

export function emptyChain(topic: string): ChainState {
  return { topic, seq: -1, rows: [], index: new Map(), updatedAt: 0, stale: false, changed: new Map() };
}

function buildIndex(rows: ChainRow[]): ChainState["index"] {
  const index = new Map<string, { row: number; side: Side }>();
  rows.forEach((r, i) => {
    if (r.call) index.set(r.call.instrumentId, { row: i, side: "call" });
    if (r.put) index.set(r.put.instrumentId, { row: i, side: "put" });
  });
  return index;
}

export function applySnapshot(state: ChainState, seq: number, rows: ChainRow[], now = Date.now()): ChainState {
  return { ...state, seq, rows, index: buildIndex(rows), updatedAt: now, stale: false, changed: new Map() };
}

/** Numeric-ish quote fields compared for flash direction. */
const FLASH_FIELDS = ["mark", "bid", "ask", "last", "oi"] as const;

export function applyDeltas(state: ChainState, seq: number, deltas: QuoteDelta[], now = Date.now()): ChainState {
  if (state.seq < 0) return state; // no snapshot yet: ignore until one arrives
  if (seq !== state.seq + 1) return { ...state, stale: true };
  const rows = state.rows.slice();
  const changed = new Map<string, Set<keyof Quote>>();
  for (const d of deltas) {
    const hit = state.index.get(d.i);
    if (!hit) continue;
    const row = rows[hit.row];
    if (!row) continue;
    const current = row[hit.side];
    if (!current) continue;
    const fields: Partial<Quote> = { ...(d as Partial<Quote> & { i?: string }) };
    delete (fields as { i?: string }).i;
    const next: Quote = { ...current, ...fields };
    const set = new Set<keyof Quote>();
    for (const k of Object.keys(fields) as (keyof Quote)[]) {
      if (current[k] !== next[k]) set.add(k);
    }
    if (set.size) changed.set(d.i, set);
    rows[hit.row] = { ...row, [hit.side]: next };
  }
  return { ...state, seq, rows, updatedAt: now, changed };
}

export function applyServerMessage(state: ChainState, msg: ServerMessage, now = Date.now()): ChainState {
  if (msg.t === "snap" && msg.topic === state.topic) return applySnapshot(state, msg.seq, msg.rows, now);
  if (msg.t === "q" && msg.topic === state.topic) return applyDeltas(state, msg.seq, msg.d, now);
  return state;
}

/** Direction of a price move for flash colour: compares decimal strings numerically. */
export function flashDirection(prev: string | undefined, next: string | undefined): "up" | "down" | null {
  if (prev === undefined || next === undefined || prev === next) return null;
  const a = Number(prev);
  const b = Number(next);
  if (!Number.isFinite(a) || !Number.isFinite(b) || a === b) return null;
  return b > a ? "up" : "down";
}

export { FLASH_FIELDS };

/**
 * Index of the strike row that brackets spot: the last row whose strike ≤ spot. With rows [79000, 79500, 80000]
 * and spot 79521 → 79500 (index 1). Returns -1 for an empty chain; 0 when spot is below every strike.
 */
export function atmIndex(rows: readonly { strike: string }[], spot: string | undefined): number {
  if (!rows.length || spot === undefined) return -1;
  const s = Number(spot);
  if (!Number.isFinite(s)) return -1;
  let idx = 0;
  for (let i = 0; i < rows.length; i++) {
    if (Number(rows[i]?.strike) <= s) idx = i;
    else break;
  }
  return idx;
}

export interface SpotState {
  price: string;
  prev: string | undefined;
  c24: number | undefined;
  updatedAt: number;
  dir: "up" | "down" | null;
  /** Session high / low seen by this tab (for the landing tiles). */
  high: string;
  low: string;
  /** Last N prices (newest last) for a sparkline. */
  history: string[];
}

export const SPOT_HISTORY = 40;

export function applySpot(prev: SpotState | undefined, price: string, c24: number | undefined, now = Date.now()): SpotState {
  const p = Number(price);
  const high = prev && Number(prev.high) > p ? prev.high : price;
  const low = prev && Number(prev.low) < p ? prev.low : price;
  const history = [...(prev?.history ?? []), price].slice(-SPOT_HISTORY);
  return {
    price,
    prev: prev?.price,
    c24: c24 ?? prev?.c24,
    updatedAt: now,
    dir: flashDirection(prev?.price, price),
    high,
    low,
    history,
  };
}
