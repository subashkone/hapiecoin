/**
 * Exchange fee profiles (HC-SH-045..049). GLOBAL brokers are visible to everyone and managed by admins;
 * USER brokers belong to the user who created them. Deleting a broker that stored credentials reference is refused.
 */
import { Broker, BrokerScope, DecimalString, Id, isNonNegativeDecimal } from "@hapiecoin/schema";
import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import { and, count, eq, or } from "drizzle-orm";
import { auditFrom } from "../audit.js";
import { brokerCredentials, brokers } from "../db/schema.js";
import { type AppEnv, type SessionUser, currentUser } from "../security/context.js";
import { HttpError, errors } from "../security/errors.js";
import { requireUser } from "../security/guards.js";
import { type AppDeps, cookieAuth, errorResponses, jsonContent, newId } from "./shared.js";

const NonNegativeDecimal = DecimalString.refine(isNonNegativeDecimal, { message: "must not be negative" });

export const BrokerCreate = z
  .object({
    name: z.string().trim().min(1, "Exchange name is required").max(80),
    feePct: NonNegativeDecimal,
    gstPct: NonNegativeDecimal,
    feeCapPct: NonNegativeDecimal,
    /** GLOBAL requires admin; defaults to USER. */
    scope: BrokerScope.default("USER"),
  })
  .strict();
export type BrokerCreate = z.infer<typeof BrokerCreate>;

export const BrokerPatch = z
  .object({
    name: z.string().trim().min(1, "Exchange name is required").max(80).optional(),
    feePct: NonNegativeDecimal.optional(),
    gstPct: NonNegativeDecimal.optional(),
    feeCapPct: NonNegativeDecimal.optional(),
  })
  .strict();
export type BrokerPatch = z.infer<typeof BrokerPatch>;

const BrokerList = z.object({ items: z.array(Broker) });
const IdParam = z.object({ id: Id });

type Row = typeof brokers.$inferSelect;

export function toBroker(row: Row): Broker {
  return {
    id: row.id,
    name: row.name,
    feePct: row.feePct,
    gstPct: row.gstPct,
    feeCapPct: row.feeCapPct,
    scope: row.scope,
  };
}

/** GLOBAL rows or the caller's own USER rows. */
function visibleTo(user: SessionUser) {
  return or(eq(brokers.scope, "GLOBAL"), eq(brokers.ownerId, user.id));
}

function canManage(user: SessionUser, row: Row): boolean {
  if (user.role === "admin") return true;
  return row.scope === "USER" && row.ownerId === user.id;
}

export function registerBrokerRoutes(app: OpenAPIHono<AppEnv>, deps: AppDeps): void {
  const guard = requireUser(deps.sessions);

  async function load(user: SessionUser, id: string): Promise<Row> {
    const [row] = await deps.db
      .select()
      .from(brokers)
      .where(and(eq(brokers.id, id), visibleTo(user)))
      .limit(1);
    if (!row) throw errors.notFound("Exchange");
    return row;
  }

  app.openapi(
    createRoute({
      method: "get",
      path: "/v1/brokers",
      tags: ["brokers"],
      summary: "List exchanges visible to you (HC-SH-032, HC-SH-045)",
      security: cookieAuth,
      middleware: [guard],
      responses: { 200: jsonContent(BrokerList, "Exchanges"), 401: errorResponses[401] },
    }),
    async (c) => {
      const me = currentUser(c);
      const rows = await deps.db
        .select()
        .from(brokers)
        .where(visibleTo(me))
        .orderBy(brokers.createdAt, brokers.id);
      return c.json({ items: rows.map(toBroker) }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/v1/brokers",
      tags: ["brokers"],
      summary: "Add an exchange (HC-SH-046, HC-SH-047); scope GLOBAL is admin-only",
      security: cookieAuth,
      middleware: [guard],
      request: { body: { content: { "application/json": { schema: BrokerCreate } }, required: true } },
      responses: {
        201: jsonContent(Broker, "Created"),
        400: errorResponses[400],
        401: errorResponses[401],
        403: errorResponses[403],
      },
    }),
    async (c) => {
      const me = currentUser(c);
      const body = c.req.valid("json");
      if (body.scope === "GLOBAL" && me.role !== "admin")
        throw errors.forbidden("Only admins can add a global exchange");
      const [row] = await deps.db
        .insert(brokers)
        .values({
          id: newId("brk"),
          name: body.name,
          feePct: body.feePct,
          gstPct: body.gstPct,
          feeCapPct: body.feeCapPct,
          scope: body.scope,
          ownerId: body.scope === "GLOBAL" ? null : me.id,
        })
        .returning();
      if (!row) throw new Error("insert returned no row");
      const broker = toBroker(row);
      await auditFrom(
        c,
        deps.db,
      )({ action: "broker.create", target: `broker:${row.id}`, before: null, after: broker });
      return c.json(broker, 201);
    },
  );

  app.openapi(
    createRoute({
      method: "patch",
      path: "/v1/brokers/{id}",
      tags: ["brokers"],
      summary: "Edit an exchange (HC-SH-048)",
      security: cookieAuth,
      middleware: [guard],
      request: {
        params: IdParam,
        body: { content: { "application/json": { schema: BrokerPatch } }, required: true },
      },
      responses: {
        200: jsonContent(Broker, "Updated"),
        400: errorResponses[400],
        401: errorResponses[401],
        403: errorResponses[403],
        404: errorResponses[404],
      },
    }),
    async (c) => {
      const me = currentUser(c);
      const { id } = c.req.valid("param");
      const patch = c.req.valid("json");
      const before = await load(me, id);
      if (!canManage(me, before)) throw errors.forbidden("You cannot edit this exchange");
      const set: Partial<typeof brokers.$inferInsert> = { updatedAt: new Date() };
      if (patch.name !== undefined) set.name = patch.name;
      if (patch.feePct !== undefined) set.feePct = patch.feePct;
      if (patch.gstPct !== undefined) set.gstPct = patch.gstPct;
      if (patch.feeCapPct !== undefined) set.feeCapPct = patch.feeCapPct;
      const [after] = await deps.db.update(brokers).set(set).where(eq(brokers.id, id)).returning();
      if (!after) throw errors.notFound("Exchange");
      await auditFrom(
        c,
        deps.db,
      )({
        action: "broker.update",
        target: `broker:${id}`,
        before: toBroker(before),
        after: toBroker(after),
      });
      return c.json(toBroker(after), 200);
    },
  );

  app.openapi(
    createRoute({
      method: "delete",
      path: "/v1/brokers/{id}",
      tags: ["brokers"],
      summary: "Delete an exchange; refused while credentials reference it (HC-SH-049)",
      security: cookieAuth,
      middleware: [guard],
      request: { params: IdParam },
      responses: {
        204: { description: "Deleted" },
        401: errorResponses[401],
        403: errorResponses[403],
        404: errorResponses[404],
        409: jsonContent(
          z.object({ code: z.string(), message: z.string() }),
          "Exchange still has connected credentials",
        ),
      },
    }),
    async (c) => {
      const me = currentUser(c);
      const { id } = c.req.valid("param");
      const before = await load(me, id);
      if (!canManage(me, before)) throw errors.forbidden("You cannot delete this exchange");
      const [refs] = await deps.db
        .select({ n: count() })
        .from(brokerCredentials)
        .where(eq(brokerCredentials.brokerId, id));
      if ((refs?.n ?? 0) > 0) {
        throw new HttpError(
          409,
          "BROKER_IN_USE",
          "Disconnect the API credentials that use this exchange before deleting it",
          {
            credentials: refs?.n ?? 0,
          },
        );
      }
      await deps.db.delete(brokers).where(eq(brokers.id, id));
      await auditFrom(
        c,
        deps.db,
      )({ action: "broker.delete", target: `broker:${id}`, before: toBroker(before), after: null });
      return c.body(null, 204);
    },
  );
}
