/** Shared route plumbing: dependency bag, OpenAPI response helpers, id generation. */
import type { DeltaTradingClient } from "@hapiecoin/venues";
import { randomBytes } from "node:crypto";
import { ApiError } from "@hapiecoin/schema";
import type { z } from "@hono/zod-openapi";
import type { Config } from "../config.js";
import type { Db, DbKind } from "../db/client.js";
import type { DeltaPrivateClient } from "../delta/private-client.js";
import type { Logger } from "../logger.js";
import type { Mailer } from "../mailer.js";
import type { RazorpayClient } from "../razorpay.js";
import type { SessionResolver } from "../security/guards.js";
import type { RateStore } from "../security/rate-store.js";
import type { Vault } from "../vault.js";
import type { AnalyticsReader } from "../analytics.js";
import type { TelegramClient } from "../telegram.js";

export interface AppDeps {
  config: Config;
  db: Db;
  dbKind: DbKind;
  ping: () => Promise<boolean>;
  auth: { handler(request: Request): Promise<Response> };
  authBasePath: string;
  sessions: SessionResolver;
  /** Transactional mail (OTP through Better Auth, admin invitations through routes). */
  mailer: Mailer;
  /** Razorpay (ADR-034); null when keys are absent → checkout answers 503. */
  razorpay: RazorpayClient | null;
  rateStore: RateStore;
  logger: Logger;
  vault: Vault;
  delta: DeltaPrivateClient;
  /** The live executor (ADR-025): the only path to order endpoints. */
  trading: DeltaTradingClient;
  /** Market Analytics snapshots written by the ingest service (ADR-038). */
  analytics: AnalyticsReader;
  /** Telegram bot for alert delivery and chat linking (ADR-057); null without TELEGRAM_BOT_TOKEN. */
  telegram: TelegramClient | null;
  /** ADR-062: whether this replica runs the background jobs (set by main.ts; absent in tests). */
  jobsStatus?: () => { role: "leader" | "always" | "off"; active: boolean };
  /** Public auth capabilities (Google hidden when unconfigured). */
  authOptions: { emailOtp: true; passkey: true; google: boolean };
}

export function jsonContent<T extends z.ZodType>(schema: T, description: string) {
  return { description, content: { "application/json": { schema } } };
}

export const errorResponses = {
  400: jsonContent(ApiError, "Validation failed"),
  401: jsonContent(ApiError, "Not signed in"),
  402: jsonContent(ApiError, "Payment required"),
  503: jsonContent(ApiError, "Not configured on this server"),
  403: jsonContent(ApiError, "Not allowed"),
  404: jsonContent(ApiError, "Not found"),
  409: jsonContent(ApiError, "Wrong state for this action"),
  502: jsonContent(ApiError, "Exchange refused or unreachable"),
  429: jsonContent(ApiError, "Rate limited"),
} as const;

export const cookieAuth = [{ cookieAuth: [] }];

export function newId(prefix: string): string {
  return `${prefix}_${randomBytes(9).toString("base64url")}`;
}
