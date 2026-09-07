import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AUTH_BASE_PATH, authOptionsPublic, generateReferralCode } from "./auth.js";
import { loadConfig } from "./config.js";
import { users } from "./db/schema.js";
import { OTP_LOCK_MESSAGE, OTP_SEND_LIMIT_MESSAGE } from "./security/rate-limit.js";
import { TEST_ENV, cookieHeaderFrom, createTestApp, type TestApp } from "./test-support/harness.js";

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(() => t.close());

describe("HC-PB-031 sign-up with email OTP verification", () => {
  it("sign-up → OTP from the dev mailer → verify → session cookie → GET /v1/me", async () => {
    const res = await t.request(`${AUTH_BASE_PATH}/sign-up/email`, {
      json: {
        email: "new@hapiecoin.test",
        name: "New Trader",
        password: "correct horse battery",
        mobile: "9876543210",
        ref: "REFDEMO001",
      },
    });
    expect(res.status).toBe(200);
    // Not signed in until the email is verified.
    expect(cookieHeaderFrom(res)).not.toContain("session_token");
    const otp = t.mail.last("new@hapiecoin.test", "email-verification")?.otp;
    expect(otp).toMatch(/^[0-9]{6}$/);

    const verify = await t.request(`${AUTH_BASE_PATH}/email-otp/verify-email`, {
      json: { email: "new@hapiecoin.test", otp },
    });
    expect(verify.status).toBe(200);
    const cookie = cookieHeaderFrom(verify);
    expect(cookie).toContain("better-auth.session_token=");
    const setCookie = verify.headers.getSetCookie().find((l) => l.includes("session_token")) ?? "";
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/SameSite=Lax/i);
    expect(setCookie).not.toMatch(/Secure/);

    const me = await t.request("/v1/me", { cookie });
    expect(me.status).toBe(200);
    const body = (await me.json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      email: "new@hapiecoin.test",
      name: "New Trader",
      role: "user",
      avatar: "rocket",
      mobile: "9876543210",
    });
    expect(body["referralCode"]).toMatch(/^REF[A-Z2-7]{7}$/);
    expect(body).not.toHaveProperty("password");
    const [row] = await t.db.select().from(users).where(eq(users.email, "new@hapiecoin.test"));
    expect(row?.referredBy).toBe("REFDEMO001");
    expect(row?.emailVerified).toBe(true);
  });

  it("ignores an unknown ref, rejects a malformed mobile, and never lets the client choose the role", async () => {
    await t.signUp("ref-unknown@hapiecoin.test", { ref: "NOPE123" });
    const [row] = await t.db.select().from(users).where(eq(users.email, "ref-unknown@hapiecoin.test"));
    expect(row?.referredBy).toBeNull();

    const bad = await t.request(`${AUTH_BASE_PATH}/sign-up/email`, {
      json: { email: "badmobile@hapiecoin.test", name: "x", password: "correct horse battery", mobile: "12" },
    });
    expect(bad.status).toBe(400);
    expect(await bad.text()).toContain("10-digit");

    const sneaky = await t.request(`${AUTH_BASE_PATH}/sign-up/email`, {
      json: { email: "sneaky@hapiecoin.test", name: "x", password: "correct horse battery", role: "admin" },
    });
    expect(sneaky.status).toBe(200);
    const [s] = await t.db.select().from(users).where(eq(users.email, "sneaky@hapiecoin.test"));
    expect(s?.role).toBe("user");
  });

  it("wrong OTP is rejected and the session is not created", async () => {
    await t.request(`${AUTH_BASE_PATH}/sign-up/email`, {
      json: { email: "wrong@hapiecoin.test", name: "W", password: "correct horse battery" },
    });
    const res = await t.request(`${AUTH_BASE_PATH}/email-otp/verify-email`, {
      json: { email: "wrong@hapiecoin.test", otp: "000000" },
    });
    expect(res.status).toBe(400);
    expect(cookieHeaderFrom(res)).not.toContain("session_token");
    expect(await res.json()).toMatchObject({ code: "INVALID_OTP" });
  });
});

describe("HC-PB-030 OTP sign-in and password reset", () => {
  it("existing user signs in with a one-time code", async () => {
    await t.signUp("otp@hapiecoin.test");
    const { cookie } = await t.signInOtp("otp@hapiecoin.test");
    const me = await t.request("/v1/me", { cookie });
    expect(me.status).toBe(200);
    expect(((await me.json()) as { email: string }).email).toBe("otp@hapiecoin.test");
  });

  it("password reset via forget-password OTP then password sign-in", async () => {
    await t.signUp("reset@hapiecoin.test", { password: "old password 123" });
    const req = await t.request(`${AUTH_BASE_PATH}/email-otp/request-password-reset`, {
      json: { email: "reset@hapiecoin.test" },
    });
    expect(req.status).toBe(200);
    const otp = t.mail.last("reset@hapiecoin.test", "forget-password")?.otp;
    expect(otp).toBeDefined();
    const reset = await t.request(`${AUTH_BASE_PATH}/email-otp/reset-password`, {
      json: { email: "reset@hapiecoin.test", otp, password: "new password 456" },
    });
    expect(reset.status).toBe(200);
    const oldSignIn = await t.request(`${AUTH_BASE_PATH}/sign-in/email`, {
      json: { email: "reset@hapiecoin.test", password: "old password 123" },
    });
    expect(oldSignIn.status).toBe(401);
    const newSignIn = await t.request(`${AUTH_BASE_PATH}/sign-in/email`, {
      json: { email: "reset@hapiecoin.test", password: "new password 456" },
    });
    expect(newSignIn.status).toBe(200);
    expect(cookieHeaderFrom(newSignIn)).toContain("session_token");
  });

  it("sign-out clears the session", async () => {
    const { cookie } = await t.signUp("bye@hapiecoin.test");
    const out = await t.request(`${AUTH_BASE_PATH}/sign-out`, { method: "POST", cookie, json: {} });
    expect(out.status).toBe(200);
    const me = await t.request("/v1/me", { cookie });
    expect(me.status).toBe(401);
  });
});

describe("[SEC] OTP rate limits", () => {
  it("5 code requests per 15 minutes per email → 429 with the exact message", async () => {
    const email = "flood@hapiecoin.test";
    for (let i = 0; i < 5; i += 1) {
      const r = await t.request(`${AUTH_BASE_PATH}/email-otp/send-verification-otp`, {
        json: { email, type: "sign-in" },
        ip: `198.51.100.${i}`,
      });
      expect(r.status).toBe(200);
    }
    const blocked = await t.request(`${AUTH_BASE_PATH}/email-otp/send-verification-otp`, {
      json: { email, type: "sign-in" },
      ip: "198.51.100.99",
    });
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("retry-after")).toMatch(/^[0-9]+$/);
    expect(await blocked.json()).toMatchObject({ code: "OTP_RATE_LIMITED", message: OTP_SEND_LIMIT_MESSAGE });
    // Window slides: 15 minutes later the same email may request again.
    t.now.value += 15 * 60_000 + 1;
    const later = await t.request(`${AUTH_BASE_PATH}/email-otp/send-verification-otp`, {
      json: { email, type: "sign-in" },
      ip: "198.51.100.98",
    });
    expect(later.status).toBe(200);
  });

  it("5 code requests per 15 minutes per IP, regardless of email", async () => {
    const ip = "192.0.2.77";
    for (let i = 0; i < 5; i += 1) {
      const r = await t.request(`${AUTH_BASE_PATH}/email-otp/send-verification-otp`, {
        json: { email: `ip${i}@hapiecoin.test`, type: "sign-in" },
        ip,
      });
      expect(r.status).toBe(200);
    }
    const blocked = await t.request(`${AUTH_BASE_PATH}/email-otp/send-verification-otp`, {
      json: { email: "ip9@hapiecoin.test", type: "sign-in" },
      ip,
    });
    expect(blocked.status).toBe(429);
    expect(((await blocked.json()) as { message: string }).message).toBe(OTP_SEND_LIMIT_MESSAGE);
    // A body without an email still counts against the IP and is not a crash.
    const noEmail = await t.request(`${AUTH_BASE_PATH}/email-otp/send-verification-otp`, {
      json: { type: "sign-in" },
      ip,
    });
    expect(noEmail.status).toBe(429);
  });

  it("10 failed verifications lock the email for 15 minutes", async () => {
    const email = "locked@hapiecoin.test";
    await t.request(`${AUTH_BASE_PATH}/email-otp/send-verification-otp`, {
      json: { email, type: "sign-in" },
    });
    for (let i = 0; i < 10; i += 1) {
      const r = await t.request(`${AUTH_BASE_PATH}/sign-in/email-otp`, { json: { email, otp: "000000" } });
      expect([400, 403]).toContain(r.status);
    }
    const locked = await t.request(`${AUTH_BASE_PATH}/sign-in/email-otp`, { json: { email, otp: "000000" } });
    expect(locked.status).toBe(429);
    expect(await locked.json()).toMatchObject({ code: "OTP_LOCKED", message: OTP_LOCK_MESSAGE });
    t.now.value += 15 * 60_000 + 1;
    const afterLock = await t.request(`${AUTH_BASE_PATH}/sign-in/email-otp`, {
      json: { email, otp: "000000" },
    });
    expect(afterLock.status).not.toBe(429);
    // A non-JSON body on a verify path passes through to Better Auth untouched.
    const junk = await t.request(`${AUTH_BASE_PATH}/sign-in/email-otp`, {
      method: "POST",
      headers: { "content-type": "text/plain" },
    });
    expect(junk.status).not.toBe(429);
  });

  it("a successful verification clears the failure counter", async () => {
    const email = "recover@hapiecoin.test";
    await t.signUp(email);
    await t.request(`${AUTH_BASE_PATH}/email-otp/send-verification-otp`, {
      json: { email, type: "sign-in" },
    });
    for (let i = 0; i < 3; i += 1)
      await t.request(`${AUTH_BASE_PATH}/sign-in/email-otp`, { json: { email, otp: "000000" } });
    const otp = t.mail.last(email, "sign-in")?.otp;
    const ok = await t.request(`${AUTH_BASE_PATH}/sign-in/email-otp`, { json: { email, otp } });
    expect(ok.status).toBe(200);
    expect(await t.rateStore.peek("otp:fail:email:recover@hapiecoin.test", 15 * 60_000)).toBe(0);
  });
});

describe("HC-PB-029 Google sign-in visibility", () => {
  it("is hidden without GOOGLE_CLIENT_ID/SECRET and offered when both exist", async () => {
    const res = await t.request("/v1/auth-options");
    expect(await res.json()).toEqual({ emailOtp: true, passkey: true, google: false });
    expect(t.auth.options.socialProviders).toBeUndefined();

    const withGoogle = await createTestApp({ GOOGLE_CLIENT_ID: "gid", GOOGLE_CLIENT_SECRET: "gsecret" });
    try {
      const r = await withGoogle.request("/v1/auth-options");
      expect(await r.json()).toEqual({ emailOtp: true, passkey: true, google: true });
      expect(withGoogle.auth.options.socialProviders?.google).toBeDefined();
      expect(
        authOptionsPublic(loadConfig({ ...TEST_ENV, GOOGLE_CLIENT_ID: "a", GOOGLE_CLIENT_SECRET: "b" }))
          .google,
      ).toBe(true);
    } finally {
      await withGoogle.close();
    }
  });
});

describe("[AUTH] referral codes", () => {
  it("are REF + 7 base32 characters and depend on the random source", () => {
    expect(generateReferralCode()).toMatch(/^REF[A-Z2-7]{7}$/);
    expect(generateReferralCode((n) => Buffer.alloc(n, 0))).toBe("REFAAAAAAA");
    expect(generateReferralCode((n) => Buffer.alloc(n, 31))).toBe("REF7777777");
  });
});
