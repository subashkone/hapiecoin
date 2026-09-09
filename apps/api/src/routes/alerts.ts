/**
 * Alerts (Phase 5 item 2, ADR-052): price, ATM IV and strategy P&L rules per user. The client evaluates them
 * on every quote while the app is open (it holds the feed); the server keeps the rules, records the trigger
 * and delivers the email channel.
 *
 *   GET    /v1/alerts               your alerts, newest first (HC-SH-095, 097)
 *   POST   /v1/alerts               create, armed at once (HC-SH-098)
 *   PATCH  /v1/alerts/{id}          edit the condition or channels, pause, re-arm (HC-SH-097)
 *   DELETE /v1/alerts/{id}          (HC-SH-097)
 *   POST   /v1/alerts/{id}/trigger  the condition was met at `value`: mark triggered, send the email (HC-SH-096)
 */
import { Alert, AlertCreate, AlertList, AlertPatch, AlertTrigger, Id, MAX_ALERTS, type AlertChannel } from "@hapiecoin/schema";
import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import { and, desc, eq } from "drizzle-orm";
import { auditFrom } from "../audit.js";
import { alerts, strategies } from "../db/schema.js";
import { type AppEnv, type SessionUser, currentUser } from "../security/context.js";
import { errors } from "../security/errors.js";
import { requireUser } from "../security/guards.js";
import { type AppDeps, cookieAuth, errorResponses, jsonContent, newId } from "./shared.js";

type AlertRow = typeof alerts.$inferSelect;
const IdParam = z.object({ id: Id });

const CHANNELS: readonly string[] = ["push", "email"];

export function toAlert(row: AlertRow): Alert {
  return {
    id: row.id,
    kind: row.kind,
    asset: row.asset,
    strategyId: row.strategyId,
    strategyName: row.strategyName,
    op: row.op,
    value: row.value,
    channels: row.channels.filter((c): c is AlertChannel => CHANNELS.includes(c)),
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

export function registerAlertRoutes(app: OpenAPIHono<AppEnv>, deps: AppDeps, now: () => Date = () => new Date()): void {
  const db = deps.db;
  const guard = requireUser(deps.sessions);

  async function loadOwned(user: SessionUser, id: string): Promise<AlertRow> {
    const [row] = await db.select().from(alerts).where(and(eq(alerts.id, id), eq(alerts.userId, user.id))).limit(1);
    if (!row) throw errors.notFound("Alert");
    return row;
  }

  app.openapi(
    createRoute({
      method: "get",
      path: "/v1/alerts",
      tags: ["alerts"],
      summary: "Your alerts, newest first (HC-SH-095, HC-SH-097)",
      security: cookieAuth,
      middleware: [guard],
      responses: { 200: jsonContent(AlertList, "Alerts"), 401: errorResponses[401] },
    }),
    async (c) => {
      const me = currentUser(c);
      const rows = await db.select().from(alerts).where(eq(alerts.userId, me.id)).orderBy(desc(alerts.createdAt), desc(alerts.id));
      return c.json({ items: rows.map(toAlert) }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/v1/alerts",
      tags: ["alerts"],
      summary: "Create an alert; it is armed at once (HC-SH-098)",
      security: cookieAuth,
      middleware: [guard],
      request: { body: { content: { "application/json": { schema: AlertCreate } }, required: true } },
      responses: { 201: jsonContent(Alert, "Created"), 400: errorResponses[400], 401: errorResponses[401], 404: errorResponses[404], 409: errorResponses[409] },
    }),
    async (c) => {
      const me = currentUser(c);
      const body = c.req.valid("json");
      const mine = await db.select({ id: alerts.id }).from(alerts).where(eq(alerts.userId, me.id));
      if (mine.length >= MAX_ALERTS) throw errors.conflict(`You can keep up to ${MAX_ALERTS} alerts; delete one first`);
      let strategyName: string | null = null;
      if (body.strategyId) {
        const [s] = await db.select({ name: strategies.name, asset: strategies.asset }).from(strategies).where(and(eq(strategies.id, body.strategyId), eq(strategies.userId, me.id))).limit(1);
        if (!s) throw errors.notFound("Strategy");
        if (s.asset !== body.asset) throw errors.badRequest("The alert's asset must match the strategy's asset");
        strategyName = s.name;
      }
      const at = now();
      const id = newId("alr");
      const [row] = await db
        .insert(alerts)
        .values({ id, userId: me.id, kind: body.kind, asset: body.asset, strategyId: body.strategyId ?? null, strategyName, op: body.op, value: body.value, channels: body.channels, state: "armed", createdAt: at, updatedAt: at })
        .returning();
      if (!row) throw errors.conflict("Alert could not be created");
      const out = toAlert(row);
      await auditFrom(c, db)({ action: "alert.create", target: `alert:${id}`, before: null, after: out });
      return c.json(out, 201);
    },
  );

  app.openapi(
    createRoute({
      method: "patch",
      path: "/v1/alerts/{id}",
      tags: ["alerts"],
      summary: "Edit the condition or channels, pause or re-arm (HC-SH-097)",
      security: cookieAuth,
      middleware: [guard],
      request: { params: IdParam, body: { content: { "application/json": { schema: AlertPatch } }, required: true } },
      responses: { 200: jsonContent(Alert, "Updated"), 400: errorResponses[400], 401: errorResponses[401], 404: errorResponses[404] },
    }),
    async (c) => {
      const me = currentUser(c);
      const row = await loadOwned(me, c.req.valid("param").id);
      const body = c.req.valid("json");
      const [updated] = await db
        .update(alerts)
        .set({
          ...(body.op ? { op: body.op } : {}),
          ...(body.value ? { value: body.value } : {}),
          ...(body.channels ? { channels: body.channels } : {}),
          // re-arming clears the last firing so the row reads "armed" again; a condition edit re-arms too
          ...(body.state === "armed" || (body.state === undefined && (body.op || body.value)) ? { state: "armed" as const, triggeredAt: null } : {}),
          ...(body.state === "paused" ? { state: "paused" as const } : {}),
          updatedAt: now(),
        })
        .where(eq(alerts.id, row.id))
        .returning();
      if (!updated) throw errors.notFound("Alert");
      return c.json(toAlert(updated), 200);
    },
  );

  app.openapi(
    createRoute({
      method: "delete",
      path: "/v1/alerts/{id}",
      tags: ["alerts"],
      summary: "Delete an alert (HC-SH-097)",
      security: cookieAuth,
      middleware: [guard],
      request: { params: IdParam },
      responses: { 204: { description: "Deleted" }, 401: errorResponses[401], 404: errorResponses[404] },
    }),
    async (c) => {
      const me = currentUser(c);
      const row = await loadOwned(me, c.req.valid("param").id);
      await db.delete(alerts).where(eq(alerts.id, row.id));
      await auditFrom(c, db)({ action: "alert.delete", target: `alert:${row.id}`, before: toAlert(row), after: null });
      return c.body(null, 204);
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/v1/alerts/{id}/trigger",
      tags: ["alerts"],
      summary: "The condition was met: record the reading, mark triggered, deliver the email channel (HC-SH-096)",
      security: cookieAuth,
      middleware: [guard],
      request: { params: IdParam, body: { content: { "application/json": { schema: AlertTrigger } }, required: true } },
      responses: { 200: jsonContent(Alert, "Triggered"), 400: errorResponses[400], 401: errorResponses[401], 404: errorResponses[404], 409: errorResponses[409] },
    }),
    async (c) => {
      const me = currentUser(c);
      const row = await loadOwned(me, c.req.valid("param").id);
      if (row.state !== "armed") throw errors.conflict("Only an armed alert can trigger");
      const { value } = c.req.valid("json");
      const at = now();
      const [updated] = await db.update(alerts).set({ state: "triggered", lastValue: value, triggeredAt: at, updatedAt: at }).where(eq(alerts.id, row.id)).returning();
      if (!updated) throw errors.notFound("Alert");
      const out = toAlert(updated);
      await auditFrom(c, db)({ action: "alert.trigger", target: `alert:${row.id}`, before: null, after: { value, channels: out.channels } });
      if (out.channels.includes("email")) {
        const subject = `HapieCoin alert · ${alertSubject(out)}`;
        const text = `Your alert fired at ${at.toISOString()}.\n\n${alertSubject(out)}\nNow: ${fmtNum(value)}\n\nOpen HapieCoin to re-arm or edit it: ${deps.config.webUrl}/analyse\n`;
        // delivery must not undo the trigger: a bounced mailbox is logged, the alert stays triggered
        try {
          await deps.mailer.sendAlert({ email: me.email, subject, text });
        } catch (e) {
          deps.logger.warn({ alert: row.id, reason: e instanceof Error ? e.message : String(e) }, "alert mail failed");
        }
      }
      return c.json(out, 200);
    },
  );
}
