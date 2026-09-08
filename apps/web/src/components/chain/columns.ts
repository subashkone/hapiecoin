// Column model for the chain (HC-WS-015, HC-WS-018, HC-WS-021). Columns are listed in the persisted
// layout order "from the strike outward": the first visible column touches the strike on the puts side
// and the same list is mirrored on the calls side, so the price triplet sits inboard on both sides.
import type { ChainLayout } from "@/lib/chain/layout";

export type ColumnId =
  | "ask"
  | "mark"
  | "bid"
  | "oi"
  | "delta"
  | "gamma"
  | "theta"
  | "vega"
  | "volume"
  | "bidQty"
  | "askQty"
  | "chg24"
  | "last";

export type ColumnGroup = "Market Data" | "Greeks" | "Activity";

export interface ChainColumn {
  id: ColumnId;
  /** Full name used in the settings dialog. */
  label: string;
  /** Short header text. */
  header: string;
  group: ColumnGroup;
  /** Unit / basis shown as the header tooltip. */
  title: string;
  /** Fixed width in px (header and body share it). */
  width: number;
}

export const COLUMNS: readonly ChainColumn[] = [
  { id: "ask", label: "Ask (Price/IV)", header: "Ask/IV", group: "Market Data", title: "Best ask, USD per underlying unit, with its implied volatility", width: 68 },
  { id: "mark", label: "Mark (Price/IV)", header: "Mark/IV", group: "Market Data", title: "Mark price, USD per underlying unit, with its implied volatility", width: 68 },
  { id: "bid", label: "Bid (Price/IV)", header: "Bid/IV", group: "Market Data", title: "Best bid, USD per underlying unit, with its implied volatility", width: 68 },
  { id: "oi", label: "OI", header: "OI", group: "Market Data", title: "Open interest, contracts; bar relative to the largest OI in this expiry", width: 68 },
  { id: "delta", label: "Delta", header: "Δ", group: "Greeks", title: "Delta per unit (2 dp)", width: 56 },
  { id: "gamma", label: "Gamma", header: "Γ", group: "Greeks", title: "Gamma per unit (6 dp)", width: 72 },
  { id: "theta", label: "Theta", header: "Θ/d", group: "Greeks", title: "Theta, USD per unit per day (1 dp)", width: 60 },
  { id: "vega", label: "Vega", header: "ν", group: "Greeks", title: "Vega, USD per unit per IV point (1 dp)", width: 60 },
  { id: "volume", label: "Volume", header: "Vol", group: "Market Data", title: "24 h volume, contracts", width: 64 },
  { id: "bidQty", label: "Bid Qty", header: "Bid qty", group: "Market Data", title: "Size at the best bid, contracts", width: 64 },
  { id: "askQty", label: "Ask Qty", header: "Ask qty", group: "Market Data", title: "Size at the best ask, contracts", width: 64 },
  { id: "chg24", label: "24hr Chg", header: "24h", group: "Activity", title: "24 h change of the mark, percent", width: 60 },
  { id: "last", label: "Last", header: "Last", group: "Activity", title: "Last traded price, USD per underlying unit", width: 64 },
];

export const COLUMN_GROUPS: readonly ColumnGroup[] = ["Market Data", "Greeks", "Activity"];

/** Shown muted in the dialog: the gateway quote carries no candle fields yet (GAPS #31). */
export const OHLC_PLACEHOLDER = { group: "OHLC", labels: ["Open", "High", "Low"], note: "arrives with candle data (Phase 5)" } as const;

export const COLUMN_IDS: readonly ColumnId[] = COLUMNS.map((c) => c.id);
export const DEFAULT_ORDER: readonly ColumnId[] = COLUMN_IDS;
/** The v2 default: price triplet, OI and Δ. */
export const ESSENTIALS: readonly ColumnId[] = ["ask", "mark", "bid", "oi", "delta"];
export const GREEK_EXTRA: readonly ColumnId[] = ["gamma", "theta", "vega"];

export function columnById(id: ColumnId): ChainColumn {
  const c = COLUMNS.find((x) => x.id === id);
  if (!c) throw new Error(`unknown chain column ${id}`);
  return c;
}

/** Visible columns in layout order (nearest the strike first). */
export function visibleColumns(layout: ChainLayout): ChainColumn[] {
  return layout.order.filter((id) => layout.visible.includes(id)).map(columnById);
}

/** Puts side reads inboard → outboard (layout order); calls side is the mirror. */
export function putColumns(layout: ChainLayout): ChainColumn[] {
  return visibleColumns(layout);
}
export function callColumns(layout: ChainLayout): ChainColumn[] {
  return [...visibleColumns(layout)].reverse();
}

/** Width of one side's track in px; a side with no columns keeps one cell for the "no columns" note. */
export function trackWidth(layout: ChainLayout): number {
  const cols = visibleColumns(layout);
  return cols.length === 0 ? NO_COLUMNS_PX : cols.reduce((w, c) => w + c.width, 0);
}

/** CSS grid template for one side's row, in that side's reading order. */
export function gridTemplate(cols: readonly ChainColumn[]): string {
  return cols.length === 0 ? `${NO_COLUMNS_PX}px` : cols.map((c) => `${c.width}px`).join(" ");
}

/** Width of the fixed centre strike column in px. */
export const STRIKE_COL_PX = 92;
/** Width of the placeholder cell when every column is hidden. */
export const NO_COLUMNS_PX = 96;
/** One keyboard step (← / →) in px. */
export const COLUMN_PX = 68;
/** Below this panel width the chain shows one side at a time. */
export const NARROW_BREAKPOINT_PX = 560;
/** Default row height in px (comfortable density). */
export const ROW_PX = 36;
