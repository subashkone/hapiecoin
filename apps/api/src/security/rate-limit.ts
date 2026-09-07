/**
 * Rate limiting (spec "API hardening", "Authentication & sessions"):
 * - global: 300 requests / minute per client IP on every route;
 * - OTP sends: 5 / 15 min per email and per IP (sign-up, sign-in code, password reset);
 * - OTP verification: 10 failures / 15 min per email locks that email for 15 minutes.
 * Counters live in `RateStore` (Redis when configured, else memory).
 */
import type { MiddlewareHandler } from "hono";
import type { AppEnv } from "./context.js";
import { errors } from "./errors.js";
import type { RateStore } from "./rate-store.js";

export const GLOBAL_LIMIT = { windowMs: 60_000, max: 300 } as const;
export const OTP_SEND_LIMIT = { windowMs: 15 * 60_000, max: 5 } as const;
export const OTP_FAIL_LIMIT = { windowMs: 15 * 60_000, max: 10 } as const;

export const GLOBAL_LIMIT_MESSAGE = "Too many requests. Slow down and try again in a minute.";
export const OTP_SEND_LIMIT_MESSAGE = "Too many code requests. Wait 15 minutes and try again.";
export const OTP_LOCK_MESSAGE = "Too many failed attempts. Sign-in is locked for 15 minutes.";

export function globalRateLimit(
  store: RateStore,
  limit: { windowMs: number; max: number } = GLOBAL_LIMIT,
): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const result = await store.consume(`global:${c.get("clientIp")}`, limit.windowMs, limit.max);
    c.header("X-RateLimit-Limit", String(limit.max));
    c.header("X-RateLimit-Remaining", String(Math.max(0, limit.max - result.count)));
    if (!result.allowed) {
      throw errors.rateLimited(GLOBAL_LIMIT_MESSAGE, Math.ceil(result.retryAfterMs / 1000));
    }
    await next();
  };
}

/** Auth sub-paths (relative to the Better Auth base path) that send an OTP. */
export const OTP_SEND_PATHS = new Set([
  "/email-otp/send-verification-otp",
  "/sign-up/email",
  "/email-otp/request-password-reset",
  "/forget-password/email-otp",
]);

/** Auth sub-paths that consume an OTP (a 4xx answer counts as a failed verification). */
export const OTP_VERIFY_PATHS = new Set([
  "/sign-in/email-otp",
  "/email-otp/verify-email",
  "/email-otp/reset-password",
  "/email-otp/check-verification-otp",
]);

async function emailFromBody(raw: Request): Promise<string | undefined> {
  try {
    const body: unknown = await raw.clone().json();
    const email =
      typeof body === "object" && body !== null ? (body as Record<string, unknown>)["email"] : undefined;
    return typeof email === "string" && email.length > 0 ? email.trim().toLowerCase() : undefined;
  } catch {
    return undefined;
  }
}

export function otpSendKeys(email: string, ip: string): { email: string; ip: string } {
  return { email: `otp:send:email:${email}`, ip: `otp:send:ip:${ip}` };
}

export function otpFailKey(email: string): string {
  return `otp:fail:email:${email}`;
}

/**
 * Guards the Better Auth OTP endpoints. `basePath` is the auth mount (e.g. "/v1/auth").
 */
export function otpRateLimit(store: RateStore, basePath: string): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    if (c.req.method !== "POST" || !c.req.path.startsWith(basePath)) return next();
    const sub = c.req.path.slice(basePath.length);

    if (OTP_SEND_PATHS.has(sub)) {
      const email = await emailFromBody(c.req.raw);
      const ip = c.get("clientIp");
      const keys = otpSendKeys(email ?? "-", ip);
      const byIp = await store.consume(keys.ip, OTP_SEND_LIMIT.windowMs, OTP_SEND_LIMIT.max);
      if (!byIp.allowed)
        throw errors.rateLimited(
          OTP_SEND_LIMIT_MESSAGE,
          Math.ceil(byIp.retryAfterMs / 1000),
          "OTP_RATE_LIMITED",
        );
      if (email !== undefined) {
        const byEmail = await store.consume(keys.email, OTP_SEND_LIMIT.windowMs, OTP_SEND_LIMIT.max);
        if (!byEmail.allowed)
          throw errors.rateLimited(
            OTP_SEND_LIMIT_MESSAGE,
            Math.ceil(byEmail.retryAfterMs / 1000),
            "OTP_RATE_LIMITED",
          );
      }
      return next();
    }

    if (OTP_VERIFY_PATHS.has(sub)) {
      const email = await emailFromBody(c.req.raw);
      if (email === undefined) return next();
      const key = otpFailKey(email);
      const failures = await store.peek(key, OTP_FAIL_LIMIT.windowMs);
      if (failures >= OTP_FAIL_LIMIT.max) {
        throw errors.rateLimited(OTP_LOCK_MESSAGE, Math.ceil(OTP_FAIL_LIMIT.windowMs / 1000), "OTP_LOCKED");
      }
      await next();
      if (c.res.status >= 400 && c.res.status < 500) {
        await store.consume(key, OTP_FAIL_LIMIT.windowMs, Number.MAX_SAFE_INTEGER);
      } else if (c.res.status < 300) {
        await store.reset(key);
      }
      return;
    }

    return next();
  };
}
