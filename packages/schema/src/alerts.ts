// Alerts (Phase 5 item 2, ADR-052; docs/design/alerts.md): a trader's price, ATM IV and strategy P&L alerts.
// The server stores and delivers them; the client evaluates them on every quote while the app is open and
// posts the trigger (HC-SH-094..100, HC-TR-114, 117, 120, 139).
import { z } from "zod";
import { Id } from "./accounts.js";
import { DecimalString, IsoDateTime, Underlying, VENUES, Venue } from "./primitives.js";

export const ALERT_KINDS = ["price", "iv", "pnl"] as const;
export const AlertKind = z.enum(ALERT_KINDS);
export type AlertKind = z.infer<typeof AlertKind>;
export const ALERT_KIND_LABELS: Record<AlertKind, string> = { price: "Price", iv: "ATM IV", pnl: "Strategy P&L" };
/** The unit the value is typed in: futures price in USD, ATM IV in vol points (%), P&L in USD. */
export const ALERT_KIND_UNITS: Record<AlertKind, string> = { price: "USD", iv: "%", pnl: "USD P&L" };

export const AlertOp = z.enum([">=", "<="]);
export type AlertOp = z.infer<typeof AlertOp>;
export const ALERT_OP_LABELS: Record<AlertOp, string> = { ">=": "≥ at or above", "<=": "≤ at or below" };

/** Delivery channels. `push` is the in-app toast plus a browser notification when permitted; `email` goes through the mailer; `telegram` needs a linked chat (ADR-057). */
export const ALERT_CHANNELS = ["push", "email", "telegram"] as const;
export const AlertChannel = z.enum(ALERT_CHANNELS);
export type AlertChannel = z.infer<typeof AlertChannel>;

export const AlertState = z.enum(["armed", "triggered", "paused"]);
export type AlertState = z.infer<typeof AlertState>;

export const MAX_ALERTS = 50;

export const Alert = z.strictObject({
  id: Id,
  kind: AlertKind,
  asset: Underlying,
  /** The venue whose prices, IV or strategy the alert watches (ADR-065). */
  venue: Venue,
  /** The strategy a P&L alert watches; null for price and IV alerts. */
  strategyId: Id.nullable(),
  /** The strategy name when the alert was set (kept so the row still reads after the strategy is archived). */
  strategyName: z.string().nullable(),
  op: AlertOp,
  value: DecimalString,
  channels: z.array(AlertChannel).min(1),
  state: AlertState,
  /** The reading that fired the alert (null until it fires). */
  lastValue: DecimalString.nullable(),
  triggeredAt: IsoDateTime.nullable(),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type Alert = z.infer<typeof Alert>;
export const AlertList = z.strictObject({ items: z.array(Alert) });
export type AlertList = z.infer<typeof AlertList>;

const Channels = z.array(AlertChannel).min(1, "Pick at least one channel").max(ALERT_CHANNELS.length);

function checkValue(kind: AlertKind, value: string, ctx: z.RefinementCtx): void {
  const n = Number(value);
  if (!Number.isFinite(n)) return; // the regex already rejected it
  if (kind === "price" && n <= 0) ctx.addIssue({ code: "custom", path: ["value"], message: "Price must be greater than 0" });
  if (kind === "iv" && (n <= 0 || n > 500)) ctx.addIssue({ code: "custom", path: ["value"], message: "ATM IV must be between 0 and 500 %" });
}

export const AlertCreate = z
  .strictObject({
    kind: AlertKind,
    asset: Underlying,
    /** Defaults to the only venue; a P&L alert takes its strategy's venue on the server (ADR-065). */
    venue: Venue.default(VENUES[0]),
    strategyId: Id.optional(),
    op: AlertOp,
    value: DecimalString,
    channels: Channels,
  })
  .superRefine((a, ctx) => {
    if (a.kind === "pnl" && !a.strategyId) ctx.addIssue({ code: "custom", path: ["strategyId"], message: "A P&L alert needs a strategy" });
    if (a.kind !== "pnl" && a.strategyId) ctx.addIssue({ code: "custom", path: ["strategyId"], message: "Only P&L alerts watch a strategy" });
    checkValue(a.kind, a.value, ctx);
  });
export type AlertCreate = z.infer<typeof AlertCreate>;

/** Edit the condition or the channels, pause, or re-arm (a triggered or paused alert goes back to armed). */
export const AlertPatch = z
  .strictObject({
    op: AlertOp.optional(),
    value: DecimalString.optional(),
    channels: Channels.optional(),
    state: z.enum(["armed", "paused"]).optional(),
  })
  .refine((p) => Object.keys(p).length > 0, { message: "Nothing to change" });
export type AlertPatch = z.infer<typeof AlertPatch>;

/** Posted by the client when the condition is met: the reading that met it. */
export const AlertTrigger = z.strictObject({ value: DecimalString });
export type AlertTrigger = z.infer<typeof AlertTrigger>;

/** Whether `current` satisfies the alert's condition. */
export function alertMet(a: Pick<Alert, "op" | "value">, current: number): boolean {
  const v = Number(a.value);
  if (!Number.isFinite(current) || !Number.isFinite(v)) return false;
  return a.op === ">=" ? current >= v : current <= v;
}

export interface AlertCounts {
  total: number;
  armed: number;
  triggered: number;
  paused: number;
}
export function alertCounts(items: readonly Pick<Alert, "state">[]): AlertCounts {
  const c: AlertCounts = { total: items.length, armed: 0, triggered: 0, paused: 0 };
  for (const a of items) c[a.state] += 1;
  return c;
}
