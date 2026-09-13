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
    expect(await res.json()).toEqual({ emailOtp: true, passkey: true, google: false, totp: true });
    expect(t.auth.options.socialProviders).toBeUndefined();

    const withGoogle = await createTestApp({ GOOGLE_CLIENT_ID: "gid", GOOGLE_CLIENT_SECRET: "gsecret" });
    try {
      const r = await withGoogle.request("/v1/auth-options");
      expect(await r.json()).toEqual({ emailOtp: true, passkey: true, google: true, totp: true });
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

describe("HC-PB-068 / HC-SH-129 the TOTP second factor (ADR-078)", () => {
  const email = "totp@hapiecoin.test";
  const password = "correct horse battery";
  // its own app: the shared one's clock is moved far ahead by the rate-limit tests, which expires its sessions
  let tt: TestApp;
  let cookie: string;
  let secret: string;
  beforeAll(async () => {
    tt = await createTestApp();
  });
  afterAll(() => tt.close());
  /** The otpauth URI carries the key base32-encoded (RFC 4648, no padding); the server's generator takes the raw key. */
  const base32Decode = (text: string): string => {
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
    let bits = "";
    for (const ch of text.replace(/=+$/, "")) bits += alphabet.indexOf(ch).toString(2).padStart(5, "0");
    const bytes: number[] = [];
    for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
    return Buffer.from(bytes).toString("utf8");
  };
  const code = async () => (await tt.auth.api.generateTOTP({ body: { secret: base32Decode(secret) } })).code;

  it("turns on only after the first code from the authenticator, hands out backup codes once, and shows on /v1/me", async () => {
    cookie = (await tt.signUp(email)).cookie;
    tt.now.value += 11_000; // the plugin allows 3 two-factor calls per 10 s
    const enable = await tt.request(`${AUTH_BASE_PATH}/two-factor/enable`, { cookie, json: { password } });
    expect(enable.status).toBe(200);
    const body = (await enable.json()) as { totpURI: string; backupCodes: string[] };
    expect(body.totpURI).toMatch(/^otpauth:\/\/totp\/HapieCoin/);
    expect(body.backupCodes.length).toBeGreaterThanOrEqual(8);
    secret = new URL(body.totpURI).searchParams.get("secret")!;
    expect(secret.length).toBeGreaterThan(10);
    // not on yet: the first code proves the app holds the key
    expect(((await (await tt.request("/v1/me", { cookie })).json()) as { twoFactorEnabled?: boolean }).twoFactorEnabled).toBe(false);
    tt.now.value += 11_000; // the plugin allows 3 two-factor calls per 10 s
    const wrong = await tt.request(`${AUTH_BASE_PATH}/two-factor/verify-totp`, { cookie, json: { code: "000000" } });
    expect(wrong.status).toBeGreaterThanOrEqual(400);
    tt.now.value += 11_000; // the plugin allows 3 two-factor calls per 10 s
    const verify = await tt.request(`${AUTH_BASE_PATH}/two-factor/verify-totp`, { cookie, json: { code: await code() } });
    expect(verify.status).toBe(200);
    cookie = cookieHeaderFrom(verify, cookie); // the verify answer refreshes the session cookie
    expect(((await (await tt.request("/v1/me", { cookie })).json()) as { twoFactorEnabled?: boolean }).twoFactorEnabled).toBe(true);
  });

  it("a password sign-in stops at the second factor until the code is right; the email-OTP path is refused for this account", async () => {
    const first = await tt.request(`${AUTH_BASE_PATH}/sign-in/email`, { json: { email, password } });
    expect(first.status).toBe(200);
    expect((await first.json()) as Record<string, unknown>).toMatchObject({ twoFactorRedirect: true });
    const pending = cookieHeaderFrom(first);
    expect(pending).toContain("two_factor");
    expect(pending).not.toContain("session_token=");
    tt.now.value += 11_000; // the plugin allows 3 two-factor calls per 10 s
    const bad = await tt.request(`${AUTH_BASE_PATH}/two-factor/verify-totp`, { cookie: pending, json: { code: "123456" } });
    expect(bad.status).toBeGreaterThanOrEqual(400);
    tt.now.value += 11_000; // the plugin allows 3 two-factor calls per 10 s
    const ok = await tt.request(`${AUTH_BASE_PATH}/two-factor/verify-totp`, { cookie: pending, json: { code: await code() } });
    expect(ok.status).toBe(200);
    const session = cookieHeaderFrom(ok, pending);
    expect(session).toContain("session_token=");
    expect((await tt.request("/v1/me", { cookie: session })).status).toBe(200);
    // the passwordless paths cannot go round the authenticator
    const send = await tt.request(`${AUTH_BASE_PATH}/email-otp/send-verification-otp`, { json: { email, type: "sign-in" } });
    expect(send.status).toBe(403);
    expect(((await send.json()) as { code?: string; message?: string }).message).toContain("authenticator app");
    const otpSignIn = await tt.request(`${AUTH_BASE_PATH}/sign-in/email-otp`, { json: { email, otp: "123456" } });
    expect(otpSignIn.status).toBe(403);
    cookie = session;
  });

  it("refuses a trusted device, and refuses the session a verify-email sign-in would create for this account", async () => {
    // a trusted-device cookie would skip the code for 30 days (the plugin honours the flag from any caller)
    const again = await tt.request(`${AUTH_BASE_PATH}/sign-in/email`, { json: { email, password } });
    const pending = cookieHeaderFrom(again);
    const trusted = await tt.request(`${AUTH_BASE_PATH}/two-factor/verify-totp`, { cookie: pending, json: { code: await code(), trustDevice: true } });
    expect(trusted.status).toBe(400);
    expect(((await trusted.json()) as { code?: string }).code).toBe("TRUST_DEVICE_REFUSED");
    expect(cookieHeaderFrom(trusted)).not.toContain("session_token=");
    // the email-verification OTP signs the account in after a successful verify on any other account; here the session is refused
    const send = await tt.request(`${AUTH_BASE_PATH}/email-otp/send-verification-otp`, { json: { email, type: "email-verification" } });
    expect(send.status).toBe(200);
    const otp = tt.mail.last(email, "email-verification")?.otp;
    expect(otp).toMatch(/^[0-9]{6}$/);
    const verify = await tt.request(`${AUTH_BASE_PATH}/email-otp/verify-email`, { json: { email, otp } });
    expect(verify.status).toBe(403);
    expect(((await verify.json()) as { code?: string }).code).toBe("TWO_FACTOR_REQUIRED");
    expect(cookieHeaderFrom(verify)).not.toContain("session_token=");
    // the honest path still works: the code without the flag
    const ok = await tt.request(`${AUTH_BASE_PATH}/two-factor/verify-totp`, { cookie: pending, json: { code: await code() } });
    expect(ok.status).toBe(200);
    expect(cookieHeaderFrom(ok, pending)).toContain("session_token=");
  });

  it("turns off with the password, after which the email-OTP path works again", async () => {
    tt.now.value += 11_000; // the plugin allows 3 two-factor calls per 10 s
    const off = await tt.request(`${AUTH_BASE_PATH}/two-factor/disable`, { cookie, json: { password } });
    expect(off.status).toBe(200);
    cookie = cookieHeaderFrom(off, cookie);
    const me = await tt.request("/v1/me", { cookie });
    expect(me.status).toBe(200);
    expect(((await me.json()) as { twoFactorEnabled?: boolean }).twoFactorEnabled).toBe(false);
    const send = await tt.request(`${AUTH_BASE_PATH}/email-otp/send-verification-otp`, { json: { email, type: "sign-in" } });
    expect(send.status).toBe(200);
    const plain = await tt.request(`${AUTH_BASE_PATH}/sign-in/email`, { json: { email, password } });
    expect(cookieHeaderFrom(plain)).toContain("session_token=");
  });
});

describe("HC-SH-137 / HC-PB-069 the passkey plugin routes are mounted (ADR-089)", () => {
  it("register options for a session name HapieCoin on the web host, the list starts empty and needs a session, an assertion without the challenge cookie is refused", async () => {
    const tt = await createTestApp();
    try {
      const { cookie } = await tt.signUp("passkey@hapiecoin.test");
      const options = await tt.request(`${AUTH_BASE_PATH}/passkey/generate-register-options?name=Laptop`, { cookie });
      expect(options.status).toBe(200);
      const body = (await options.json()) as { rp: { id: string; name: string }; challenge: string; user: { name: string }; authenticatorSelection: { residentKey: string } };
      expect(body.rp).toEqual({ id: "localhost", name: "HapieCoin" });
      expect(body.challenge.length).toBeGreaterThan(10);
      expect(body.user.name).toBe("Laptop"); // the name given labels the credential on the authenticator
      const list = await tt.request(`${AUTH_BASE_PATH}/passkey/list-user-passkeys`, { cookie });
      expect(list.status).toBe(200);
      expect(await list.json()).toEqual([]);
      expect((await tt.request(`${AUTH_BASE_PATH}/passkey/list-user-passkeys`)).status).toBe(401);
      const bogus = await tt.request(`${AUTH_BASE_PATH}/passkey/verify-authentication`, { json: { response: { id: "bm9wZQ", rawId: "bm9wZQ", type: "public-key", response: { clientDataJSON: "e30", authenticatorData: "AA", signature: "AA" }, clientExtensionResults: {} } } });
      expect(bogus.status).toBe(400);
      expect(((await bogus.json()) as { code?: string }).code).toBe("CHALLENGE_NOT_FOUND"); // the challenge cookie is checked before any credential lookup
    } finally {
      await tt.close();
    }
  });
});
