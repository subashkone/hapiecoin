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
import { APIError } from "better-auth/api";
import { betterAuth } from "better-auth/minimal";
import { emailOTP } from "better-auth/plugins/email-otp";
import { eq } from "drizzle-orm";
import type { Config } from "./config.js";
import type { Db } from "./db/client.js";
import { accounts, passkeys, sessions, users, verifications } from "./db/schema.js";
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
}

export function authOptionsPublic(config: Config): AuthOptionsPublic {
  return { emailOtp: true, passkey: true, google: config.google !== undefined };
}

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
      },
      customStorage: {
        consume: async (key, rule) => {
          const r = await rateStore.consume(`ba:${key}`, rule.window * 1000, rule.max);
          return { allowed: r.allowed, retryAfter: r.allowed ? null : Math.ceil(r.retryAfterMs / 1000) };
        },
      },
    },
    databaseHooks: {
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

async function uniqueReferralCode(db: Db): Promise<string> {
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
      const u = result.user as { id: string; email: string; name: string; role?: string | null };
      return { id: u.id, email: u.email, name: u.name, role: u.role === "admin" ? "admin" : "user" };
    },
  };
}
