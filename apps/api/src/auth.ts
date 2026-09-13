/**
 * Better Auth configuration (spec "Authentication & sessions").
 * - Email OTP for sign-in, sign-up verification and password reset (6 digits, 10 minutes).
 * - Passkeys; Google only when both client values are configured.
 * - httpOnly + SameSite=Lax cookies (Secure in production); trusted origin = the web app.
 * - Rate limits backed by the shared `RateStore` (Redis when present, else memory).
 * - `role` defaults to "user" and cannot be set by the client; `referralCode` is generated on sign-up;
 *   an optional `ref` (inviter's code) is stored as `referredBy` when it matches an existing user.
 */
import { randomBytes } from "node:crypto";
import { passkey } from "@better-auth/passkey";
import { Mobile } from "@hapiecoin/schema";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { twoFactor } from "better-auth/plugins/two-factor";
import { betterAuth } from "better-auth/minimal";
import { emailOTP } from "better-auth/plugins/email-otp";
import { eq } from "drizzle-orm";
import type { Config } from "./config.js";
import type { Db } from "./db/client.js";
import { accounts, passkeys, sessions, users, verifications , twoFactors } from "./db/schema.js";
import type { Logger } from "./logger.js";
import type { Mailer } from "./mailer.js";
import { CLIENT_IP_HEADER, type SessionUser } from "./security/context.js";
import type { SessionResolver } from "./security/guards.js";
import type { RateStore } from "./security/rate-store.js";

export const AUTH_BASE_PATH = "/v1/auth";
export const OTP_LENGTH = 6;
export const OTP_EXPIRY_SEC = 10 * 60;
export const SESSION_TTL_SEC = 7 * 24 * 60 * 60;

/** RFC 4648 base32 alphabet: unambiguous upper-case letters and digits 2–7. */
const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/** "REF" + 7 base32 characters, e.g. REFK7P2Q9X (10 chars, satisfies schema `ReferralCode`). */
export function generateReferralCode(random: (bytes: number) => Buffer = randomBytes): string {
  const bytes = random(7);
  let out = "REF";
  for (let i = 0; i < 7; i += 1) out += BASE32[(bytes[i] ?? 0) & 31];
  return out;
}

export interface AuthDeps {
  config: Config;
  db: Db;
  mailer: Mailer;
  rateStore: RateStore;
  logger: Logger;
}

/** What the web app needs to render the sign-in screen (Google button hidden when not configured). */
export interface AuthOptionsPublic {
  emailOtp: true;
  passkey: true;
  google: boolean;
  /** TOTP second factor through an authenticator app (ADR-078). */
  totp: true;
}

export function authOptionsPublic(config: Config): AuthOptionsPublic {
  return { emailOtp: true, passkey: true, google: config.google !== undefined, totp: true };
}

/** The code and sentence the sign-in paths answer when an account with an authenticator must use its password (ADR-078). */
export const TWO_FACTOR_REQUIRED = { code: "TWO_FACTOR_REQUIRED", message: "This account uses an authenticator app: sign in with your password and the code" } as const;
/** ADR-078: a trusted-device cookie would let the next 30 days of sign-ins skip the code; HapieCoin asks every time. */
const TRUST_DEVICE_REFUSED = { code: "TRUST_DEVICE_REFUSED", message: "HapieCoin asks for the code on every sign-in" } as const;
/** Session creations that are part of the password + code sign-in itself; every other path is refused for a 2FA account.
 *  /change-password asks for the current password on a live session, and better-auth re-creates the session there when
 *  the other sessions are revoked. */
const TWO_FACTOR_SESSION_PATHS = new Set(["/sign-in/email", "/two-factor/verify-totp", "/two-factor/verify-backup-code", "/two-factor/verify-otp", "/change-password"]);

export function createAuth(deps: AuthDeps) {
  const { config, db, mailer, rateStore } = deps;
  const rpID = new URL(config.webUrl).hostname;

  return betterAuth({
    appName: "HapieCoin",
    baseURL: config.betterAuthUrl,
    basePath: AUTH_BASE_PATH,
    secret: config.betterAuthSecret,
    database: drizzleAdapter(db, {
      provider: "pg",
      schema: {
        user: users,
        session: sessions,
        account: accounts,
        verification: verifications,
        passkey: passkeys,
        twoFactor: twoFactors, // ADR-078
      },
    }),
    trustedOrigins: [config.webUrl],
    logger: { disabled: config.isTest, level: "warn" },
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      autoSignIn: false,
      minPasswordLength: 8,
      maxPasswordLength: 128,
    },
    emailVerification: { autoSignInAfterVerification: true },
    user: {
      additionalFields: {
        mobile: { type: "string", required: false, input: true },
        role: { type: "string", required: false, defaultValue: "user", input: false },
        avatar: { type: "string", required: false, defaultValue: "rocket", input: false },
        referralCode: { type: "string", required: false, input: false },
        referredBy: { type: "string", required: false, input: false },
      },
    },
    session: { expiresIn: SESSION_TTL_SEC, updateAge: 24 * 60 * 60 },
    advanced: {
      useSecureCookies: config.isProd,
      defaultCookieAttributes: { httpOnly: true, sameSite: "lax", secure: config.isProd, path: "/" },
      // Only the header app.ts sets after the trusted-proxy check (ADR-019); raw proxy headers are not read.
      ipAddress: { ipAddressHeaders: [CLIENT_IP_HEADER] },
    },
    rateLimit: {
      enabled: true,
      window: 60,
      max: 120,
      customRules: {
        "/email-otp/send-verification-otp": { window: 15 * 60, max: 5 },
        "/sign-up/email": { window: 15 * 60, max: 5 },
        "/sign-in/email-otp": { window: 15 * 60, max: 10 },
        // ADR-078: the plugin's own rule is 3 calls per 10 s on /two-factor/*; a trader who mistypes the first code twice
        // must not meet a 429. The plugin still counts failed codes and locks the account.
        "/two-factor/verify-totp": { window: 60, max: 10 },
        "/two-factor/verify-backup-code": { window: 60, max: 10 },
      },
      customStorage: {
        consume: async (key, rule) => {
          const r = await rateStore.consume(`ba:${key}`, rule.window * 1000, rule.max);
          return { allowed: r.allowed, retryAfter: r.allowed ? null : Math.ceil(r.retryAfterMs / 1000) };
        },
      },
    },
    // ADR-078: with an authenticator on, the account signs in with password + code only. The two-factor plugin guards
    // the password path; the email-OTP path is refused up front with a plain sentence, and any other session (Google,
    // passkey, the verify-email sign-in) is refused where it would be created, so no path around the second factor
    // exists. A trusted-device cookie would skip the code for 30 days, so the verify endpoints refuse `trustDevice`.
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        const body = (ctx.body ?? {}) as { email?: unknown; type?: unknown; trustDevice?: unknown };
        if (ctx.path.startsWith("/two-factor/verify-") && body.trustDevice === true) throw new APIError("BAD_REQUEST", TRUST_DEVICE_REFUSED);
        const otpSignIn = ctx.path === "/sign-in/email-otp" || (ctx.path === "/email-otp/send-verification-otp" && body.type === "sign-in");
        if (!otpSignIn || typeof body.email !== "string") return;
        const found = await ctx.context.internalAdapter.findUserByEmail(body.email.toLowerCase());
        const user = (found && "user" in found ? found.user : found) as { twoFactorEnabled?: boolean } | null;
        if (user?.twoFactorEnabled) throw new APIError("FORBIDDEN", TWO_FACTOR_REQUIRED);
      }),
    },
    databaseHooks: {
      session: {
        create: {
          before: async (session, ctx) => {
            if (!ctx || TWO_FACTOR_SESSION_PATHS.has(ctx.path)) return;
            const user = (await ctx.context.internalAdapter.findUserById(session.userId)) as { twoFactorEnabled?: boolean } | null;
            if (user?.twoFactorEnabled) throw new APIError("FORBIDDEN", TWO_FACTOR_REQUIRED);
          },
        },
      },
      user: {
        create: {
          before: async (user, ctx) => {
            const body = (ctx?.body ?? {}) as Record<string, unknown>;
            const mobile = typeof user["mobile"] === "string" ? user["mobile"] : undefined;
            if (mobile !== undefined && !Mobile.safeParse(mobile).success) {
              throw new APIError("BAD_REQUEST", {
                message: "expected a 10-digit mobile number",
                code: "INVALID_MOBILE",
              });
            }
            const rawRef = body["ref"] ?? body["referredBy"];
            const ref = typeof rawRef === "string" ? rawRef.trim().toUpperCase() : undefined;
            const referredBy = ref ? await findReferralCode(db, ref) : null;
            return {
              data: {
                ...user,
                role: "user",
                avatar: "rocket",
                referralCode: await uniqueReferralCode(db),
                referredBy,
              },
            };
          },
        },
      },
    },
    plugins: [
      // ADR-078: TOTP second factor (authenticator app) with backup codes; the first code is verified before it turns on
      twoFactor({ issuer: "HapieCoin", skipVerificationOnEnable: false }),
      emailOTP({
        otpLength: OTP_LENGTH,
        expiresIn: OTP_EXPIRY_SEC,
        allowedAttempts: 10,
        sendVerificationOnSignUp: true,
        overrideDefaultEmailVerification: true,
        sendVerificationOTP: ({ email, otp, type }) => mailer.sendOtp({ email, otp, type }),
      }),
      passkey({ rpID, rpName: "HapieCoin", origin: config.webUrl }),
    ],
    ...(config.google
      ? {
          socialProviders: {
            google: { clientId: config.google.clientId, clientSecret: config.google.clientSecret },
          },
        }
      : {}),
  });
}

export type Auth = ReturnType<typeof createAuth>;

async function findReferralCode(db: Db, code: string): Promise<string | null> {
  const [row] = await db
    .select({ code: users.referralCode })
    .from(users)
    .where(eq(users.referralCode, code))
    .limit(1);
  return row?.code ?? null;
}

export async function uniqueReferralCode(db: Db): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = generateReferralCode();
    if ((await findReferralCode(db, code)) === null) return code;
  }
  throw new Error("could not allocate a unique referral code");
}

/** Adapts Better Auth's session lookup to the guards' `SessionResolver`. */
export function sessionResolver(auth: Auth): SessionResolver {
  return {
    async resolve(headers: Headers): Promise<SessionUser | null> {
      const result = await auth.api.getSession({ headers });
      if (!result) return null;
      const u = result.user as { id: string; email: string; name: string; role?: string | null; twoFactorEnabled?: boolean | null };
      return { id: u.id, email: u.email, name: u.name, role: u.role === "admin" ? "admin" : "user", twoFactorEnabled: u.twoFactorEnabled === true };
    },
  };
}
