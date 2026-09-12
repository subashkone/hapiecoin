// Response shapes of /v1 endpoints that @hapiecoin/schema does not define yet. Kept tolerant (non-strict)
// so the API may add fields; tighten and move into packages/schema once the API lands (see report gaps).
import { BrokerCredentialPublic } from "@hapiecoin/schema";
import { z } from "zod";

/** GET /v1/plan (HC-SH-014): drives the banner under the analyse header. Shape from apps/api/src/routes/plan.ts. */
export { PlanState, type PlanState as PlanStateT } from "@hapiecoin/schema";

/** GET /v1/credentials: stored credentials (masked), one per broker; empty when not connected. */
export const CredentialResponse = z.object({ items: z.array(BrokerCredentialPublic) });
export type CredentialResponse = z.infer<typeof CredentialResponse>;

/** POST /v1/credentials body. The secret is sent once and never returned. */
export const ConnectCredentialBody = z.object({
  brokerId: z.string().min(1),
  /** The account's name (ADR-068): a new one adds a key, a known one replaces it. */
  label: z.string().trim().min(1).max(32).optional(),
  apiKey: z.string().min(1),
  apiSecret: z.string().min(1),
});
export type ConnectCredentialBody = z.infer<typeof ConnectCredentialBody>;

/** GET /v1/credentials/whitelist-ip (HC-SH-036). */
export const WhitelistIp = z.object({ ip: z.ipv4() });
export type WhitelistIp = z.infer<typeof WhitelistIp>;

/** PATCH-style profile update (HC-SH-030): only what the user may change. */
export const ProfileUpdate = z.object({
  name: z.string().trim().min(1).max(100),
  mobile: z
    .string()
    .regex(/^[0-9]{10}$/)
    .optional(),
  avatar: z.enum(["rocket", "diamond", "lightning"]).optional(),
});
export type ProfileUpdate = z.infer<typeof ProfileUpdate>;

/** Brokers list envelope. */
export const BrokerList = z.object({ items: z.array(z.unknown()) });

/** Gateway GET /healthz: apps/gateway reports the default venue's expiries under `feed.expiries` and every venue's under `feed.venues[id].expiries` (ADR-067; 503 while loading). */
const ExpiryMap = z.record(z.string(), z.array(z.string()));
export const GatewayHealth = z.object({
  ok: z.boolean().optional(),
  expiries: ExpiryMap.optional(),
  feed: z
    .object({
      ready: z.boolean().optional(),
      expiries: ExpiryMap.optional(),
      venues: z.record(z.string(), z.object({ expiries: ExpiryMap.optional() }).passthrough()).optional(),
    })
    .optional(),
});
export type GatewayHealth = z.infer<typeof GatewayHealth>;
