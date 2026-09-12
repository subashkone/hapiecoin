// Alert evaluation (Phase 5 item 2, ADR-052; HC-SH-096): pure helpers that turn an alert plus the current readings
// into "met / not met", the condition text, the "now" line and the toast copy. The hooks live in AlertEngine.tsx.
import { type Alert, type Underlying, alertMet } from "@hapiecoin/schema";
import { fmtPrice } from "@/lib/format";
import { USD, fmtMoney } from "@/lib/money";

/** The key of a per-venue reading (ADR-071): a price alert on Deribit reads Deribit's index, like the server evaluator. */
export const readingKey = (venue: string, asset: Underlying): string => `${venue}:${asset}`;

/** What the engine knows right now: spot per venue and asset, ATM IV (fraction) per venue and asset, P&L (USD) per strategy. */
export interface AlertReadings {
  spot: Partial<Record<string, number | null>>;
  atmIv: Partial<Record<string, number | null>>;
  pnl: Record<string, number | null>;
}
export const EMPTY_READINGS: AlertReadings = { spot: {}, atmIv: {}, pnl: {} };

/** The reading an alert compares against, in the unit the alert was typed in (price USD, IV %, P&L USD); null when unknown. */
export function currentValue(a: Pick<Alert, "kind" | "asset" | "venue" | "strategyId">, r: AlertReadings): number | null {
  if (a.kind === "price") return r.spot[readingKey(a.venue, a.asset)] ?? null;
  if (a.kind === "iv") {
    const iv = r.atmIv[readingKey(a.venue, a.asset)];
    // vol points to 4 decimals, so 0.29 reads as 29 and not 28.999999999999996
    return iv === null || iv === undefined ? null : Math.round(iv * 1_000_000) / 10_000;
  }
  return a.strategyId ? (r.pnl[a.strategyId] ?? null) : null;
}

const pct = (v: number) => `${v.toFixed(1)}%`;
const signedUsd = (v: number | string) => fmtMoney(v, USD, { signed: true });

/** "BTC ≥ 82,000" · "ETH ATM IV ≤ 30.0%" · "Bull Call Spread · P&L ≥ +$20.00" (P&L alerts are typed and shown in USD). */
export function conditionText(a: Pick<Alert, "kind" | "asset" | "strategyName" | "op" | "value">): string {
  const op = a.op === ">=" ? "≥" : "≤";
  const v = Number(a.value);
  if (a.kind === "price") return `${a.asset} ${op} ${fmtPrice(v)}`;
  if (a.kind === "iv") return `${a.asset} ATM IV ${op} ${pct(v)}`;
  return `${a.strategyName ?? a.asset} · P&L ${op} ${signedUsd(v)}`;
}

/** "Price · now 79,506.5" · "ATM IV · now 42.4%" · "Strategy P&L · now −$0.64"; "—" while the reading is unknown. */
export function nowText(a: Pick<Alert, "kind">, current: number | null): string {
  const label = a.kind === "price" ? "Price" : a.kind === "iv" ? "ATM IV" : "Strategy P&L";
  if (current === null) return `${label} · now —`;
  const v = a.kind === "price" ? fmtPrice(current) : a.kind === "iv" ? pct(current) : signedUsd(current);
  return `${label} · now ${v}`;
}

/** Toast copy when an alert fires: "BTC crossed 82,000 · Sent via push, email". */
export function firedText(a: Pick<Alert, "kind" | "asset" | "strategyName" | "op" | "value" | "channels">): { title: string; description: string } {
  const v = Number(a.value);
  const what = a.kind === "price" ? `${a.asset} crossed ${fmtPrice(v)}` : a.kind === "iv" ? `${a.asset} ATM IV crossed ${pct(v)}` : `${a.strategyName ?? a.asset} P&L crossed ${signedUsd(v)}`;
  return { title: "Alert triggered", description: `${what} · Sent via ${a.channels.join(", ")}` };
}

export interface DueAlert {
  alert: Alert;
  current: number;
}
/** The armed alerts whose condition the readings meet. */
export function dueAlerts(alerts: readonly Alert[], r: AlertReadings): DueAlert[] {
  const out: DueAlert[] = [];
  for (const a of alerts) {
    if (a.state !== "armed") continue;
    const current = currentValue(a, r);
    if (current !== null && alertMet(a, current)) out.push({ alert: a, current });
  }
  return out;
}

/** A number as the decimal string the API accepts, trimmed of trailing zeros ("82010.5", "-0.64", "100"). */
export function decimalOf(n: number): string {
  const fixed = n.toFixed(4);
  return fixed.includes(".") ? fixed.replace(/0+$/, "").replace(/\.$/, "") : fixed;
}
