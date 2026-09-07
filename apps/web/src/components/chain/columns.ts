// Column model for the chain (HC-WS-015, HC-WS-018, HC-WS-021 later adds optional columns). The calls
// side lists outer → inner (Δ, OI, Bid, Mark, Ask) and the puts side is the mirror (Ask, Mark, Bid, OI, Δ)
// so the columns nearest the strike are the prices on both sides.

export type ColumnId = "delta" | "oi" | "bid" | "mark" | "ask";

export interface ChainColumn {
  id: ColumnId;
  label: string;
  title: string;
}

export const CALL_COLUMNS: readonly ChainColumn[] = [
  { id: "delta", label: "Δ", title: "Delta per contract (2 dp)" },
  { id: "oi", label: "OI", title: "Open interest, contracts; bar relative to the largest OI in this expiry" },
  { id: "bid", label: "Bid/IV", title: "Best bid, USD per contract, with its implied volatility" },
  { id: "mark", label: "Mark/IV", title: "Mark price, USD per contract, with its implied volatility" },
  { id: "ask", label: "Ask/IV", title: "Best ask, USD per contract, with its implied volatility" },
];

export const PUT_COLUMNS: readonly ChainColumn[] = [...CALL_COLUMNS].reverse();

/** Fixed width of one price/greek column in px (5 columns = 340 px per side). */
export const COLUMN_PX = 68;
/** Width of the fixed centre strike column in px. */
export const STRIKE_COL_PX = 92;
/** Width of one side's track in px. */
export const SIDE_TRACK_PX = COLUMN_PX * CALL_COLUMNS.length;
/** Below this panel width the chain shows one side at a time. */
export const NARROW_BREAKPOINT_PX = 560;
/** Default row height in px (comfortable density). */
export const ROW_PX = 36;
