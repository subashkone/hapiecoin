/**
 * Firing an alert (ADR-052, ADR-057): one path for the client's trigger route and the server-side evaluator.
 * Marks the row triggered with the reading, audits it, then delivers each channel best-effort: a failed mail or
 * Telegram message is logged and never undoes the trigger.
 */
import type { Alert } from "@hapiecoin/schema";
import { and, eq } from "drizzle-orm";
import { writeAudit } from "./audit.js";
import { alerts, users } from "./db/schema.js";
import type { AppDeps } from "./routes/shared.js";

type AlertRow = typeof alerts.$inferSelect;
const CHANNELS: readonly string[] = ["push", "email", "telegram"];

export function toAlert(row: AlertRow): Alert {
  return {
    id: row.id,
    kind: row.kind,
    asset: row.asset,
    strategyId: row.strategyId,
    strategyName: row.strategyName,
    op: row.op,
    value: row.value,
    channels: row.channels.filter((c): c is Alert["channels"][number] => CHANNELS.includes(c)),
    state: row.state,
    lastValue: row.lastValue,
    triggeredAt: row.triggeredAt === null ? null : row.triggeredAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

const fmtNum = (v: string) => {
  const n = Number(v);
  return Number.isFinite(n) ? n.toLocaleString("en-US", { maximumFractionDigits: 2 }) : v;
};

/** The one-line condition used in the alert mail: "BTC ≥ 82,000", "ETH ATM IV ≤ 30%", "BTC Bull Call Spread · P&L ≥ +20". */
export function alertSubject(a: Pick<Alert, "kind" | "asset" | "strategyName" | "op" | "value">): string {
  const op = a.op === ">=" ? "≥" : "≤";
  if (a.kind === "price") return `${a.asset} ${op} ${fmtNum(a.value)}`;
  if (a.kind === "iv") return `${a.asset} ATM IV ${op} ${fmtNum(a.value)}%`;
  const signed = Number(a.value) > 0 ? `+${fmtNum(a.value)}` : fmtNum(a.value);
  return `${a.strategyName ?? a.asset} · P&L ${op} ${signed}`;
}

export interface FireOptions {
  /** "client" when the browser engine posted the trigger, "server" for the snapshot evaluator. */
  source: "client" | "server";
  ip?: string | null;
  ua?: string | null;
}

/** Mark `row` triggered at `value`, audit, deliver email and Telegram. Returns the updated alert (or null when it was not armed any more). */
export async function fireAlert(deps: AppDeps, row: AlertRow, value: string, opts: FireOptions, now: () => Date = () => new Date()): Promise<Alert | null> {
  const at = now();
  // the state guard is in the update itself (WHERE state = 'armed'), so two evaluators (client + server) racing on
  // the same row leave exactly one of them with a returned row
  const [updated] = await deps.db
    .update(alerts)
    .set({ state: "triggered", lastValue: value, triggeredAt: at, updatedAt: at })
    .where(and(eq(alerts.id, row.id), eq(alerts.state, "armed")))
    .returning();
  if (!updated) return null;
  const out = toAlert(updated);
  await writeAudit(deps.db, { actorId: opts.source === "client" ? row.userId : null, action: "alert.trigger", target: `alert:${row.id}`, before: null, after: { value, channels: out.channels, source: opts.source }, ip: opts.ip ?? null, ua: opts.ua ?? null });
  const wantsMail = out.channels.includes("email");
  const wantsTelegram = out.channels.includes("telegram");
  if (wantsMail || wantsTelegram) {
    const [user] = await deps.db.select({ email: users.email, telegramChatId: users.telegramChatId }).from(users).where(eq(users.id, row.userId)).limit(1);
    const line = alertSubject(out);
    const text = `Your alert fired at ${at.toISOString()}.\n\n${line}\nNow: ${fmtNum(value)}\n\nOpen HapieCoin to re-arm or edit it: ${deps.config.webUrl}/analyse\n`;
    if (wantsMail && user) {
      try {
        await deps.mailer.sendAlert({ email: user.email, subject: `HapieCoin alert · ${line}`, text });
      } catch (e) {
        deps.logger.warn({ alert: row.id, reason: e instanceof Error ? e.message : String(e) }, "alert mail failed");
      }
    }
    if (wantsTelegram && user?.telegramChatId && deps.telegram) {
      try {
        await deps.telegram.sendMessage(user.telegramChatId, `HapieCoin alert · ${line}\nNow: ${fmtNum(value)}\n${deps.config.webUrl}/analyse`);
      } catch (e) {
        deps.logger.warn({ alert: row.id, reason: e instanceof Error ? e.message : String(e) }, "alert telegram failed");
      }
    } else if (wantsTelegram) {
      deps.logger.warn({ alert: row.id, linked: Boolean(user?.telegramChatId), configured: deps.telegram !== null }, "alert telegram skipped");
    }
  }
  return out;
}
