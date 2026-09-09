/**
 * Strategies and their legs (Phase 3, ADR-024): the contract between apps/api and apps/web for drafts,
 * paper trades and, later, live trades. Money and premiums are decimal strings; quantities are integer lots.
 */
import { z } from "zod";
import { Id } from "./accounts.js";
import { DecimalString, IsoDateTime, Underlying, isNonNegativeDecimal, isPositiveDecimal } from "./primitives.js";

const NonNegativeDecimal = DecimalString.refine(isNonNegativeDecimal, { message: "must not be negative" });
const PositiveDecimal = DecimalString.refine(isPositiveDecimal, { message: "must be greater than zero" });

export const STRATEGY_STATUSES = ["draft", "paper", "live", "archived"] as const;
export const StrategyStatus = z.enum(STRATEGY_STATUSES);
export type StrategyStatus = z.infer<typeof StrategyStatus>;

export const TradingMode = z.enum(["paper", "live"]);
export type TradingMode = z.infer<typeof TradingMode>;

export const StrategyLegKind = z.enum(["call", "put", "future"]);
export type StrategyLegKind = z.infer<typeof StrategyLegKind>;
export const StrategyLegSide = z.enum(["buy", "sell"]);
export type StrategyLegSide = z.infer<typeof StrategyLegSide>;
export const StrategyLegStatus = z.enum(["open", "squared_off"]);
export type StrategyLegStatus = z.infer<typeof StrategyLegStatus>;

/** "YYYY-MM-DD" for options and dated futures, "PERP" for the perpetual. */
export const LegExpiry = z.string().regex(/^(\d{4}-\d{2}-\d{2}|PERP)$/, "expected YYYY-MM-DD or PERP");
export type LegExpiry = z.infer<typeof LegExpiry>;

/** Limits (HC-TR-017): 8 legs on a new strategy, 10 open legs on an active one. */
export const MAX_NEW_LEGS = 8;
export const MAX_OPEN_LEGS = 10;
export const MAX_STRATEGY_NAME = 80;

/** A leg as the client submits it (draft legs and adjustments). Strikes are venue-listed values (ADR-006). */
export const StrategyLegInput = z
  .strictObject({
    kind: StrategyLegKind,
    side: StrategyLegSide,
    /** Empty string for futures. */
    strike: z.union([NonNegativeDecimal, z.literal("")]),
    expiry: LegExpiry,
    symbol: z.string().min(1).max(64),
    lots: z.number().int().min(1).max(100_000),
    /** Price per underlying unit at the time of adding (mark or custom). */
    price: NonNegativeDecimal,
    iv: z.number().min(0).max(10).optional(),
  })
  .superRefine((leg, ctx) => {
    if (leg.kind === "future") {
      if (leg.strike !== "") ctx.addIssue({ code: "custom", path: ["strike"], message: "futures have no strike" });
    } else {
      if (leg.strike === "") ctx.addIssue({ code: "custom", path: ["strike"], message: "options need a strike" });
      if (leg.expiry === "PERP") ctx.addIssue({ code: "custom", path: ["expiry"], message: "options need a dated expiry" });
    }
  });
export type StrategyLegInput = z.infer<typeof StrategyLegInput>;

export const StrategyLeg = z.strictObject({
  id: Id,
  kind: StrategyLegKind,
  side: StrategyLegSide,
  strike: z.string(),
  expiry: LegExpiry,
  symbol: z.string(),
  lots: z.number().int().min(1),
  /** Price stored when the leg was added (draft) and the entry premium once the strategy started. */
  price: NonNegativeDecimal,
  entryPrice: NonNegativeDecimal.nullable(),
  exitPrice: NonNegativeDecimal.nullable(),
  iv: z.number().nullable(),
  status: StrategyLegStatus,
  isAdjustment: z.boolean(),
  position: z.number().int().nonnegative(),
  openedAt: IsoDateTime.nullable(),
  closedAt: IsoDateTime.nullable(),
  /** Venue order id (live only, Phase 3 item 2). */
  orderId: z.string().nullable(),
});
export type StrategyLeg = z.infer<typeof StrategyLeg>;

export const OrderState = z.enum(["pending", "filled", "failed", "cancelled", "closed"]);
/** How an entry is sent to the venue: at market, or as a limit at the reviewed mark (ADR-044). Exits are always market, reduce-only. */
export const OrderType = z.enum(["market", "limit"]);
export type OrderType = z.infer<typeof OrderType>;
export type OrderState = z.infer<typeof OrderState>;

/** A venue order behind a live leg (ADR-025). */
export const StrategyOrder = z.strictObject({
  id: Id,
  legId: Id,
  purpose: z.enum(["entry", "exit", "adjustment"]),
  /** Placement batch (the idempotency key of the placement or adjustment) so history can show each batch's fills. */
  batchId: z.string(),
  orderType: OrderType,
  /** The resting price of a limit order (on the product's tick), null for market orders. */
  limitPrice: DecimalString.nullable(),
  clientOrderId: z.string(),
  venueOrderId: z.string().nullable(),
  symbol: z.string(),
  side: StrategyLegSide,
  size: z.number().int().nonnegative(),
  state: OrderState,
  fillPrice: DecimalString.nullable(),
  error: z.string().nullable(),
  attempts: z.number().int().min(1),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type StrategyOrder = z.infer<typeof StrategyOrder>;

export const PnlPoint = z.strictObject({ day: z.iso.date(), pnl: DecimalString });
export type PnlPoint = z.infer<typeof PnlPoint>;

/** What one adjustment batch did, kept with the strategy (Details → Adjustment history, the journal hook). */
export const StrategyAdjustment = z.strictObject({
  id: Id,
  at: IsoDateTime,
  reason: z.string().nullable(),
  added: z.number().int().nonnegative(),
  trimmed: z.number().int().nonnegative(),
  closed: z.number().int().nonnegative(),
  /** Realised P&L of the closed lots in this batch, USD. */
  realizedPnl: DecimalString,
  batchId: z.string().nullable(),
});
export type StrategyAdjustment = z.infer<typeof StrategyAdjustment>;

export const Strategy = z.strictObject({
  id: Id,
  name: z.string().min(1).max(MAX_STRATEGY_NAME),
  asset: Underlying,
  status: StrategyStatus,
  tradingMode: TradingMode.nullable(),
  templateName: z.string().max(80),
  brokerId: Id.nullable(),
  legs: z.array(StrategyLeg),
  /** Sum of (exit − entry) × lots × lot size × side over squared-off legs, in USD. */
  realizedPnl: DecimalString,
  pnlHistory: z.array(PnlPoint),
  notes: z.string().max(2_000),
  tags: z.array(z.string().min(1).max(32)).max(20),
  orderBatchId: z.string().nullable(),
  /** Venue orders (live strategies); empty for drafts and paper. */
  orders: z.array(StrategyOrder).default([]),
  /** Adjustment batches, oldest first (ADR-044). */
  adjustments: z.array(StrategyAdjustment).default([]),
  startedAt: IsoDateTime.nullable(),
  closedAt: IsoDateTime.nullable(),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type Strategy = z.infer<typeof Strategy>;

export const StrategyList = z.object({ items: z.array(Strategy) });
export type StrategyList = z.infer<typeof StrategyList>;

export const StrategyCreate = z.strictObject({
  name: z.string().trim().min(1, "Strategy name is required").max(MAX_STRATEGY_NAME),
  asset: Underlying,
  templateName: z.string().trim().max(80).default("Custom"),
  legs: z.array(StrategyLegInput).min(1, "Add at least one leg").max(MAX_NEW_LEGS, `Maximum ${MAX_NEW_LEGS} legs allowed for a new strategy`),
});
export type StrategyCreate = z.infer<typeof StrategyCreate>;

/** Draft edits: rename, replace legs (draft only), notes and tags. */
export const StrategyPatch = z.strictObject({
  name: z.string().trim().min(1).max(MAX_STRATEGY_NAME).optional(),
  templateName: z.string().trim().max(80).optional(),
  legs: z.array(StrategyLegInput).min(1).max(MAX_NEW_LEGS).optional(),
  notes: z.string().max(2_000).optional(),
  tags: z.array(z.string().trim().min(1).max(32)).max(20).optional(),
});
export type StrategyPatch = z.infer<typeof StrategyPatch>;

/** Entry premiums per leg id (paper: the client's live mark or custom price). */
export const PriceMap = z.record(Id, NonNegativeDecimal);
export type PriceMap = z.infer<typeof PriceMap>;

export const StrategyStart = z.strictObject({
  mode: TradingMode,
  brokerId: Id,
  entries: PriceMap,
});
export type StrategyStart = z.infer<typeof StrategyStart>;

export const AddLegsBody = z.strictObject({ legs: z.array(StrategyLegInput).min(1).max(MAX_OPEN_LEGS) });
export type AddLegsBody = z.infer<typeof AddLegsBody>;

/** One open leg's lots after the adjustment: fewer trims, 0 closes; `price` is the paper exit (client mark), ignored live. */
export const AdjustChange = z.strictObject({
  legId: Id,
  lotsAfter: z.number().int().min(0).max(100_000),
  price: NonNegativeDecimal,
});
export type AdjustChange = z.infer<typeof AdjustChange>;
export const MAX_ADJUST_REASON = 280;
/**
 * One atomic adjustment batch (ADR-044): new legs (or more lots on a contract already held), trims / closes of open
 * legs, the marks shown at Review (per symbol, live band), an idempotency key and the trader's reason (journal).
 */
export const AdjustBody = z
  .strictObject({
    adds: z.array(StrategyLegInput).max(MAX_OPEN_LEGS).default([]),
    changes: z.array(AdjustChange).max(MAX_OPEN_LEGS).default([]),
    expected: z.record(z.string(), PositiveDecimal).default({}),
    /** Entries at market, or as limits at the `expected` mark of their symbol (a leg without one goes at market). */
    orderType: OrderType.default("market"),
    idempotencyKey: z.string().min(8).max(80).optional(),
    reason: z.string().trim().max(MAX_ADJUST_REASON).optional(),
  })
  .refine((b) => b.adds.length + b.changes.length > 0, { message: "Nothing to adjust", path: ["adds"] });
export type AdjustBody = z.infer<typeof AdjustBody>;


/** Close a leg fully (lots omitted) or partially (lots < the leg's lots); the closed part becomes its own leg row. */
export const CloseLegBody = z.strictObject({
  exitPrice: NonNegativeDecimal,
  lots: z.number().int().min(1).optional(),
});
export type CloseLegBody = z.infer<typeof CloseLegBody>;

export const CloseAllBody = z.strictObject({ exits: PriceMap });
export type CloseAllBody = z.infer<typeof CloseAllBody>;

/** Stop paper trading (HC-TR-081): archive (legs closed at `exits`) or back to draft (legs kept). */
export const StopBody = z.strictObject({
  archive: z.boolean(),
  exits: PriceMap.default({}),
});
export type StopBody = z.infer<typeof StopBody>;

export const PnlUpsert = PnlPoint;

/** Realised P&L of one closed leg in USD: (exit − entry) × lots × lot size × (+1 buy / −1 sell), 2 dp. */
export function realizedPnl(leg: { side: StrategyLegSide; lots: number; entryPrice: string | null; exitPrice: string | null }, lotSize: string): string {
  if (leg.entryPrice === null || leg.exitPrice === null) return "0";
  const sign = leg.side === "buy" ? 1 : -1;
  const pnl = (Number(leg.exitPrice) - Number(leg.entryPrice)) * leg.lots * Number(lotSize) * sign;
  return toDecimal(pnl);
}

/** Format a computed number as a decimal string with 2 decimals, "-0.00" normalised to "0". */
export function toDecimal(n: number, digits = 2): string {
  if (!Number.isFinite(n)) return "0";
  const s = n.toFixed(digits);
  const trimmed = s.includes(".") ? s.replace(/0+$/, "").replace(/\.$/, "") : s;
  return trimmed === "-0" || trimmed === "" ? "0" : trimmed;
}

export { PositiveDecimal as PositiveDecimalString };

/** Live placement preview (ADR-025): what the executor would send and every safeguard verdict. */
export const LivePreviewLeg = z.strictObject({
  legId: Id,
  symbol: z.string(),
  side: StrategyLegSide,
  lots: z.number().int().min(1),
  contracts: z.number().int().min(1).nullable(),
  contractValue: DecimalString,
  productState: z.string(),
  mark: DecimalString.nullable(),
  /** contracts × contract value × mark, USD. */
  notional: DecimalString,
});
export type LivePreviewLeg = z.infer<typeof LivePreviewLeg>;

export const LivePreview = z.strictObject({
  ok: z.boolean(),
  reasons: z.array(z.string()),
  legs: z.array(LivePreviewLeg),
  notional: DecimalString,
  available: DecimalString.nullable(),
  availableAsset: z.string().nullable(),
  /** Margin the exchange currently holds against open positions (sum of position margins); null when unknown. Delta has no pre-trade margin estimate endpoint (ADR-029). */
  marginUsed: DecimalString.nullable(),
  limits: z.strictObject({ maxLegs: z.number().int(), maxNotionalUsd: z.number(), markBandPct: z.number() }),
});
export type LivePreview = z.infer<typeof LivePreview>;

export const LivePlaceBody = z.strictObject({
  brokerId: Id,
  /** Idempotency key chosen by the client; a repeat returns the stored outcome. */
  idempotencyKey: z.string().min(8).max(80),
  /** Marks shown in the preview, per leg id; the placement is refused when the venue mark moved past the band. */
  expected: z.record(Id, DecimalString).default({}),
});
export type LivePlaceBody = z.infer<typeof LivePlaceBody>;

/** Preview the open legs, or (adjustment workbench) the proposed batch: `adds` as entries and `changes` as exits. */
export const LivePreviewBody = z.strictObject({
  brokerId: Id,
  adds: z.array(StrategyLegInput).max(MAX_OPEN_LEGS).optional(),
  changes: z.array(AdjustChange).max(MAX_OPEN_LEGS).optional(),
});
export type LivePreviewBody = z.infer<typeof LivePreviewBody>;

export const LiveBatchBody = z.strictObject({
  ids: z.array(Id).min(1).max(20),
  brokerId: Id,
  idempotencyKey: z.string().min(8).max(80),
});
export type LiveBatchBody = z.infer<typeof LiveBatchBody>;

export const LiveBatchResult = z.strictObject({
  placed: z.array(Id),
  failed: z.strictObject({ id: Id, error: z.string() }).nullable(),
  skipped: z.array(Id),
});
export type LiveBatchResult = z.infer<typeof LiveBatchResult>;

export const LivePosition = z.strictObject({
  productId: z.number().int(),
  symbol: z.string().nullable(),
  size: z.number(),
  entryPrice: DecimalString.nullable(),
  realizedPnl: DecimalString.nullable(),
  margin: DecimalString.nullable(),
  /** Units of underlying per contract (from the product) so the client can size lots and P&L; null when the product is unknown. */
  contractValue: DecimalString.nullable(),
  /** Current venue mark, null when the venue has none. */
  mark: DecimalString.nullable(),
});
export type LivePosition = z.infer<typeof LivePosition>;
export const LivePositions = z.strictObject({
  positions: z.array(LivePosition),
  balances: z.array(z.strictObject({ asset: z.string(), balance: DecimalString, availableBalance: DecimalString })),
});
export type LivePositions = z.infer<typeof LivePositions>;

/** Square off exchange positions from the Live tab's net-positions table (HC-TR-145): reduce-only market orders. */
export const LivePositionsExitBody = z.strictObject({
  brokerId: Id,
  productIds: z.array(z.number().int()).min(1).max(20),
  idempotencyKey: z.string().min(8).max(80),
});
export type LivePositionsExitBody = z.infer<typeof LivePositionsExitBody>;
export const LivePositionsExitResult = z.strictObject({
  closed: z.array(z.strictObject({ productId: z.number().int(), fillPrice: DecimalString.nullable(), state: OrderState })),
  failed: z.array(z.strictObject({ productId: z.number().int(), error: z.string() })),
});
export type LivePositionsExitResult = z.infer<typeof LivePositionsExitResult>;

