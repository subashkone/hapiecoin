/**
 * Exchange API credentials (HC-SH-031..037). The secret is validated once against Delta with a
 * read-only call, sealed with the vault and never serialised again; clients only ever see the
 * masked key (`BrokerCredentialPublic` is a strict schema, so a stray field fails validation).
 */
import { BrokerCredentialPublic, Id } from "@hapiecoin/schema";
import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import { and, eq, or } from "drizzle-orm";
import { auditFrom } from "../audit.js";
import { brokerCredentials, brokers } from "../db/schema.js";
import type { DeltaCredentialErrorCode } from "../delta/private-client.js";
import { type AppEnv, currentUser } from "../security/context.js";
import { HttpError, errors } from "../security/errors.js";
import { requireUser } from "../security/guards.js";
import { maskKey } from "../vault.js";
import { type AppDeps, cookieAuth, errorResponses, jsonContent, newId } from "./shared.js";

export const CredentialCreate = z
  .object({
    brokerId: Id,
    apiKey: z.string().trim().min(1, "API key is required").max(128),
    apiSecret: z.string().trim().min(1, "API secret is required").max(128),
  })
  .strict();
export type CredentialCreate = z.infer<typeof CredentialCreate>;

const CredentialList = z.object({ items: z.array(BrokerCredentialPublic) });
const WhitelistIp = z.object({ ip: z.ipv4() });
const BrokerIdParam = z.object({ brokerId: Id });

type Row = typeof brokerCredentials.$inferSelect;

export function toPublic(row: Row): BrokerCredentialPublic {
  return {
    brokerId: row.brokerId,
    apiKeyMasked: row.apiKeyMasked,
    connectedAt: row.connectedAt.toISOString(),
    whitelistedIp: row.whitelistedIp,
  };
}

/** Delta's snake_case code → our SCREAMING_SNAKE envelope code; the original is kept in `details.deltaCode`. */
export function deltaFailure(code: DeltaCredentialErrorCode, message: string): HttpError {
  if (code === "delta_unavailable")
    return new HttpError(502, "DELTA_UNAVAILABLE", message, { deltaCode: code });
  return new HttpError(400, code.toUpperCase(), message, { deltaCode: code });
}

export function registerCredentialRoutes(app: OpenAPIHono<AppEnv>, deps: AppDeps): void {
  const guard = requireUser(deps.sessions);

  app.openapi(
    createRoute({
      method: "get",
      path: "/v1/credentials",
      tags: ["credentials"],
      summary: "Connected exchanges, masked (HC-SH-031)",
      security: cookieAuth,
      middleware: [guard],
      responses: { 200: jsonContent(CredentialList, "Credentials"), 401: errorResponses[401] },
    }),
    async (c) => {
      const me = currentUser(c);
      const rows = await deps.db
        .select()
        .from(brokerCredentials)
        .where(eq(brokerCredentials.userId, me.id))
        .orderBy(brokerCredentials.connectedAt);
      return c.json({ items: rows.map(toPublic) }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: "get",
      path: "/v1/credentials/whitelist-ip",
      tags: ["credentials"],
      summary: "Egress IP to whitelist at the exchange (HC-SH-036)",
      security: cookieAuth,
      middleware: [guard],
      responses: { 200: jsonContent(WhitelistIp, "IP"), 401: errorResponses[401] },
    }),
    (c) => c.json({ ip: deps.config.egressIp }, 200),
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/v1/credentials",
      tags: ["credentials"],
      summary:
        "Connect & Save: verify with one read-only Delta call, then store encrypted (HC-SH-033, HC-SH-034)",
      security: cookieAuth,
      middleware: [guard],
      request: { body: { content: { "application/json": { schema: CredentialCreate } }, required: true } },
      responses: {
        201: jsonContent(BrokerCredentialPublic, "Connected"),
        400: errorResponses[400],
        401: errorResponses[401],
        404: errorResponses[404],
        502: jsonContent(z.object({ code: z.string(), message: z.string() }), "Exchange unreachable"),
      },
    }),
    async (c) => {
      const me = currentUser(c);
      const body = c.req.valid("json");
      const [broker] = await deps.db
        .select({ id: brokers.id })
        .from(brokers)
        .where(
          and(eq(brokers.id, body.brokerId), or(eq(brokers.scope, "GLOBAL"), eq(brokers.ownerId, me.id))),
        )
        .limit(1);
      if (!broker) throw errors.notFound("Exchange");

      const check = await deps.delta.verifyCredentials({ apiKey: body.apiKey, apiSecret: body.apiSecret });
      if (!check.ok) throw deltaFailure(check.code, check.message);

      const key = deps.vault.seal(body.apiKey);
      const secret = deps.vault.seal(body.apiSecret);
      const [existing] = await deps.db
        .select()
        .from(brokerCredentials)
        .where(and(eq(brokerCredentials.userId, me.id), eq(brokerCredentials.brokerId, body.brokerId)))
        .limit(1);
      const values = {
        id: existing?.id ?? newId("crd"),
        userId: me.id,
        brokerId: body.brokerId,
        apiKeyMasked: maskKey(body.apiKey),
        apiKeyCt: key.ct,
        apiKeyIv: key.iv,
        apiKeyTag: key.tag,
        apiSecretCt: secret.ct,
        apiSecretIv: secret.iv,
        apiSecretTag: secret.tag,
        connectedAt: new Date(),
        whitelistedIp: deps.config.egressIp,
        keyId: key.kid,
      };
      const [row] = await deps.db
        .insert(brokerCredentials)
        .values(values)
        .onConflictDoUpdate({
          target: [brokerCredentials.userId, brokerCredentials.brokerId],
          set: { ...values, id: values.id },
        })
        .returning();
      if (!row) throw new Error("upsert returned no row");
      const pub = toPublic(row);
      await auditFrom(
        c,
        deps.db,
      )({
        action: "credentials.connect",
        target: `broker:${body.brokerId}`,
        before: existing ? toPublic(existing) : null,
        after: pub,
      });
      return c.json(pub, 201);
    },
  );

  app.openapi(
    createRoute({
      method: "delete",
      path: "/v1/credentials/{brokerId}",
      tags: ["credentials"],
      summary: "Disconnect exchange: credentials removed (HC-SH-037)",
      security: cookieAuth,
      middleware: [guard],
      request: { params: BrokerIdParam },
      responses: { 204: { description: "Disconnected" }, 401: errorResponses[401], 404: errorResponses[404] },
    }),
    async (c) => {
      const me = currentUser(c);
      const { brokerId } = c.req.valid("param");
      const [existing] = await deps.db
        .delete(brokerCredentials)
        .where(and(eq(brokerCredentials.userId, me.id), eq(brokerCredentials.brokerId, brokerId)))
        .returning();
      if (!existing) throw errors.notFound("Connected exchange");
      await auditFrom(
        c,
        deps.db,
      )({
        action: "credentials.disconnect",
        target: `broker:${brokerId}`,
        before: toPublic(existing),
        after: null,
      });
      return c.body(null, 204);
    },
  );
}
