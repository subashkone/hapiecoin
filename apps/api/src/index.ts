// @hapiecoin/api — public surface for other apps (workers, gateway) and tests.
export { createApp, API_VERSION } from "./app.js";
export {
  AUTH_BASE_PATH,
  OTP_LENGTH,
  OTP_EXPIRY_SEC,
  authOptionsPublic,
  createAuth,
  generateReferralCode,
  sessionResolver,
} from "./auth.js";
export type { Auth, AuthDeps, AuthOptionsPublic } from "./auth.js";
export { ConfigError, loadConfig } from "./config.js";
export type { Config } from "./config.js";
export { createDb, defaultMigrationsFolder } from "./db/client.js";
export type { Db, DbHandle, DbKind } from "./db/client.js";
export { schema } from "./db/schema.js";
export { SEED, seed } from "./db/seed.js";
export { DeltaPrivateClientImpl, FakeDeltaPrivateClient, signDeltaRequest } from "./delta/private-client.js";
export type {
  DeltaPrivateClient,
  DeltaCredentialErrorCode,
  VerifyCredentialsResult,
} from "./delta/private-client.js";
export { createLogger, scrub, scrubPath } from "./logger.js";
export { MailCapture, ResendMailer, createMailer } from "./mailer.js";
export type { Mailer, OtpMail } from "./mailer.js";
export { writeAudit } from "./audit.js";
export { HttpError, errors } from "./security/errors.js";
export { requireUser, requireAdmin, adminOnly } from "./security/guards.js";
export type { SessionResolver } from "./security/guards.js";
export { MemoryRateStore, RedisRateStore } from "./security/rate-store.js";
export type { RateStore } from "./security/rate-store.js";
export {
  GLOBAL_LIMIT,
  OTP_SEND_LIMIT,
  OTP_FAIL_LIMIT,
  OTP_SEND_LIMIT_MESSAGE,
  OTP_LOCK_MESSAGE,
  GLOBAL_LIMIT_MESSAGE,
} from "./security/rate-limit.js";
export { createKeyring, createVault, keyIdOf, maskKey, VaultError } from "./vault.js";
export { resealCredentials } from "./credentials-reseal.js";
export { snapshotOnce, startIvSnapshotter, atmIvByExpiry, frontExpiry } from "./iv-snapshot.js";
export { ivHistory, markHistory } from "./market-history.js";
export type { Sealed, Vault } from "./vault.js";
export { DEFAULT_SETTINGS } from "./routes/settings.js";
export { planState, EXPIRING_SOON_DAYS } from "./routes/plan.js";
export type { AppDeps } from "./routes/shared.js";
