/**
 * Exchange API credentials (HC-SH-031..037, HC-SH-123). The secret is validated once against Delta with a
 * read-only call, sealed with the vault and never serialised again; clients only ever see the
 * masked key (`BrokerCredentialPublic` is a strict schema, so a stray field fails validation).
 * Several keys per exchange, told apart by a label, are the "accounts" of ADR-068 (Delta sub-accounts): a
 * strategy names the key it trades through, and a key a live strategy still names cannot be removed.
 */
import { requireSecondFactor } from "../security/second-factor.js";
import { AccountLabel, BrokerCredentialPublic, Id, MAX_ACCOUNTS_PER_BROKER } from "@hapiecoin/schema";
import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import { and, eq, isNull, or } from "drizzle-orm";
import { auditFrom } from "../audit.js";
import { brokerCredentials, brokers, strategies } from "../db/schema.js";
import { dataOnlyReason } from "./live-exec.js";
import type { DeltaCredentialErrorCode } from "../delta/private-client.js";
import { type AppEnv, currentUser } from "../security/context.js";
import { HttpError, errors } from "../security/errors.js";
import { requireUser } from "../security/guards.js";
import { maskKey } from "../vault.js";
import { type AppDeps, cookieAuth, errorResponses, jsonContent, newId } from "./shared.js";

export const CredentialCreate = z
  .object({
    brokerId: Id,
    label: AccountLabel.default("Main"),
    apiKey: z.string().trim().min(1, "API key is required").max(128),
    apiSecret: z.string().trim().min(1, "API secret is required").max(128),
  })
  .strict();
export type CredentialCreate = z.infer<typeof CredentialCreate>;

const CredentialList = z.object({ items: z.array(BrokerCredentialPublic) });
const WhitelistIp = z.object({ ip: z.ipv4() });
const IdParam = z.object({ id: Id });

type Row = typeof brokerCredentials.$inferSelect;

export function toPublic(row: Row): BrokerCredentialPublic {
  return {
    id: row.id,
    brokerId: row.brokerId,
    label: row.label,
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
        "Connect & Save: verify with one read-only Delta call, then store encrypted; a new label adds an account, a known one replaces its key (HC-SH-033, HC-SH-034, HC-SH-123)",
      security: cookieAuth,
      middleware: [guard],
      request: { body: { content: { "application/json": { schema: CredentialCreate } }, required: true } },
      responses: {
        201: jsonContent(BrokerCredentialPublic, "Connected"),
        400: errorResponses[400],
        401: errorResponses[401],
        403: errorResponses[403],
        404: errorResponses[404],
        429: errorResponses[429],
        502: jsonContent(z.object({ code: z.string(), message: z.string() }), "Exchange unreachable"),
      },
    }),
    async (c) => {
      const me = currentUser(c);
      const body = c.req.valid("json");
      await requireSecondFactor(deps, c, me); // ADR-086: a key is secret material; an account with the authenticator on confirms with its code
      const [broker] = await deps.db
        .select({ id: brokers.id, venue: brokers.venue })
        .from(brokers)
        .where(
          and(eq(brokers.id, body.brokerId), or(eq(brokers.scope, "GLOBAL"), eq(brokers.ownerId, me.id))),
        )
        .limit(1);
      if (!broker) throw errors.notFound("Exchange");
      const dataOnly = dataOnlyReason(broker.venue);
      if (dataOnly !== null) throw errors.conflict(dataOnly); // ADR-067: no keys for a data-only venue

      const check = await deps.delta.verifyCredentials({ apiKey: body.apiKey, apiSecret: body.apiSecret });
      if (!check.ok) throw deltaFailure(check.code, check.message);

      const key = deps.vault.seal(body.apiKey);
      const secret = deps.vault.seal(body.apiSecret);
      const mine = await deps.db
        .select()
        .from(brokerCredentials)
        .where(and(eq(brokerCredentials.userId, me.id), eq(brokerCredentials.brokerId, body.brokerId)))
        .orderBy(brokerCredentials.connectedAt);
      const existing = mine.find((r) => r.label === body.label);
      if (!existing && mine.length >= MAX_ACCOUNTS_PER_BROKER) throw errors.badRequest(`At most ${MAX_ACCOUNTS_PER_BROKER} accounts per exchange`);
      // the second key for this exchange: the strategies placed through the first one stay bound to it, so no
      // running strategy is ever left to guess between keys (ADR-068)
      const first = mine[0];
      if (!existing && mine.length === 1 && first) {
        await deps.db
          .update(strategies)
          .set({ accountId: first.id })
          .where(and(eq(strategies.userId, me.id), eq(strategies.brokerId, body.brokerId), isNull(strategies.accountId), or(eq(strategies.status, "paper"), eq(strategies.status, "live"))));
      }
      const values = {
        id: existing?.id ?? newId("crd"),
        userId: me.id,
        brokerId: body.brokerId,
        label: body.label,
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
          target: [brokerCredentials.userId, brokerCredentials.brokerId, brokerCredentials.label],
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
        target: `credential:${row.id}`,
        before: existing ? toPublic(existing) : null,
        after: pub,
      });
      return c.json(pub, 201);
    },
  );

  app.openapi(
    createRoute({
      method: "delete",
      path: "/v1/credentials/{id}",
      tags: ["credentials"],
      summary: "Disconnect one account by its id (or an exchange id when it has one key): the key is removed; refused while a live strategy still trades through it (HC-SH-037, HC-SH-123)",
      security: cookieAuth,
      middleware: [guard],
      request: { params: IdParam },
      responses: { 204: { description: "Disconnected" }, 401: errorResponses[401], 403: errorResponses[403], 404: errorResponses[404], 409: errorResponses[409], 429: errorResponses[429] },
    }),
    async (c) => {
      const me = currentUser(c);
      const { id } = c.req.valid("param");
      await requireSecondFactor(deps, c, me); // ADR-086
      // the key row by id; an exchange id still works while that exchange has a single key (older clients, HC-SH-037)
      let [row] = await deps.db
        .select()
        .from(brokerCredentials)
        .where(and(eq(brokerCredentials.userId, me.id), eq(brokerCredentials.id, id)))
        .limit(1);
      if (!row) {
        const ofBroker = await deps.db
          .select()
          .from(brokerCredentials)
          .where(and(eq(brokerCredentials.userId, me.id), eq(brokerCredentials.brokerId, id)))
          .limit(2);
        if (ofBroker.length > 1) throw errors.conflict("This exchange has several accounts connected · disconnect one by its id");
        row = ofBroker[0];
      }
      if (!row) throw errors.notFound("Connected exchange");
      // a live strategy that trades through this key (or, from before accounts, through this broker with no key
      // named) would be cut off from its exits: square it off or move it first
      const live = await deps.db
        .select({ id: strategies.id })
        .from(strategies)
        .where(and(eq(strategies.userId, me.id), eq(strategies.status, "live"), or(eq(strategies.accountId, row.id), and(eq(strategies.brokerId, row.brokerId), isNull(strategies.accountId)))));
      if (live.length) throw errors.conflict(`${live.length} live ${live.length === 1 ? "strategy trades" : "strategies trade"} through this key · square off or stop them first`);
      // drafts, paper and closed strategies stop naming the key (the column is `restrict`, never a silent fallback)
      await deps.db.update(strategies).set({ accountId: null }).where(and(eq(strategies.userId, me.id), eq(strategies.accountId, row.id)));
      await deps.db.delete(brokerCredentials).where(eq(brokerCredentials.id, row.id));
      await auditFrom(
        c,
        deps.db,
      )({
        action: "credentials.disconnect",
        target: `credential:${row.id}`,
        before: toPublic(row),
        after: null,
      });
      return c.body(null, 204);
    },
  );
}
