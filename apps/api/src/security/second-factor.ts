/**
 * A fresh authenticator code on a sensitive change (GAPS #94, ADR-086; HC-SH-136). ADR-078 put the second factor on
 * sign-in; a session that is already in could still replace an exchange key, remove one, or switch the safety knobs
 * off. When the account has the authenticator on, those routes ask for the current code in the `X-Second-Factor`
 * header and check it through Better Auth's verifier with the request's own session. The signed-in verify path skips
 * the plugin's lockout, so this keeps its own budget: five wrong codes in fifteen minutes lock the check for that user.
 * An account without the authenticator is never asked.
 */
import { APIError } from "better-auth/api";
import { eq } from "drizzle-orm";
import type { Context } from "hono";
import { users } from "../db/schema.js";
import type { AppDeps } from "../routes/shared.js";
import type { AppEnv, SessionUser } from "./context.js";
import { HttpError, errors } from "./errors.js";

export const SECOND_FACTOR_HEADER = "x-second-factor";
export const SECOND_FACTOR_FAIL_LIMIT = { windowMs: 15 * 60_000, max: 5 };
export const SECOND_FACTOR_REQUIRED_MESSAGE = "Enter the code from your authenticator app to confirm this change";
export const SECOND_FACTOR_INVALID_MESSAGE = "That code is not right. Codes change every 30 seconds; try the current one";
export const lockMessage = (retryAfterSec: number): string => `Too many wrong codes. Try again in ${Math.max(1, Math.ceil(retryAfterSec / 60))} min`;

const failKey = (userId: string) => `2fa:fail:user:${userId}`;

/** The resolver's flag when present; a session user built without it is read from the table, so omission never switches the step-up off. */
async function authenticatorOn(deps: AppDeps, user: SessionUser): Promise<boolean> {
  if (user.twoFactorEnabled !== undefined) return user.twoFactorEnabled;
  const [row] = await deps.db.select({ on: users.twoFactorEnabled }).from(users).where(eq(users.id, user.id)).limit(1);
  return row?.on === true;
}

/** Refuses the request unless the account has no authenticator or the header carries its current code. */
export async function requireSecondFactor(deps: AppDeps, c: Context<AppEnv>, user: SessionUser): Promise<void> {
  if (!(await authenticatorOn(deps, user))) return;
  const code = (c.req.header(SECOND_FACTOR_HEADER) ?? "").trim();
  if (code === "") throw new HttpError(403, "SECOND_FACTOR_REQUIRED", SECOND_FACTOR_REQUIRED_MESSAGE);
  // only wrong codes take a slot; at the limit the store names the time left (a blocked hit is not recorded)
  const key = failKey(user.id);
  if ((await deps.rateStore.peek(key, SECOND_FACTOR_FAIL_LIMIT.windowMs)) >= SECOND_FACTOR_FAIL_LIMIT.max) {
    const blocked = await deps.rateStore.consume(key, SECOND_FACTOR_FAIL_LIMIT.windowMs, SECOND_FACTOR_FAIL_LIMIT.max);
    const retryAfterSec = Math.max(1, Math.ceil(blocked.retryAfterMs / 1000));
    throw errors.rateLimited(lockMessage(retryAfterSec), retryAfterSec, "SECOND_FACTOR_LOCKED");
  }
  try {
    await deps.auth.api.verifyTOTP({ body: { code, trustDevice: false }, headers: c.req.raw.headers });
  } catch (error) {
    // Better Auth answers a wrong or malformed code with an APIError (the reason is not the client's business); anything
    // else is the server's own trouble and must neither read as a wrong code nor cost the trader a slot
    if (!(error instanceof APIError)) throw error;
    await deps.rateStore.consume(key, SECOND_FACTOR_FAIL_LIMIT.windowMs, SECOND_FACTOR_FAIL_LIMIT.max);
    throw new HttpError(403, "SECOND_FACTOR_INVALID", SECOND_FACTOR_INVALID_MESSAGE);
  }
  await deps.rateStore.reset(key);
}
