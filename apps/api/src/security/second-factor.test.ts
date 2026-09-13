// A fresh authenticator code on the sensitive routes (GAPS #94, ADR-086; HC-SH-136, HC-AD-129).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AdminUserRow, UserSettings } from "@hapiecoin/schema";
import type { AppDeps } from "../routes/shared.js";
import { AUTH_BASE_PATH } from "../auth.js";
import { eq } from "drizzle-orm";
import { sessions, users } from "../db/schema.js";
import { SEED } from "../db/seed.js";
import { DEFAULT_SETTINGS, safetyKnobsChanged } from "../routes/settings.js";
import { cookieHeaderFrom, createTestApp, type TestApp } from "../test-support/harness.js";
import { SECOND_FACTOR_FAIL_LIMIT, SECOND_FACTOR_HEADER, requireSecondFactor } from "./second-factor.js";

const email = "stepup@hapiecoin.test";
const password = "correct horse battery";
let t: TestApp;
let cookie: string;
let secret: string;

/** The otpauth URI carries the key base32-encoded (RFC 4648, no padding); the server's generator takes the raw key. */
const base32Decode = (text: string): string => {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const ch of text.replace(/=+$/, "")) bits += alphabet.indexOf(ch).toString(2).padStart(5, "0");
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes).toString("utf8");
};
const code = async () => (await t.auth.api.generateTOTP({ body: { secret: base32Decode(secret) } })).code;
const withCode = async (headers: Record<string, string> = {}) => ({ ...headers, [SECOND_FACTOR_HEADER]: await code() });
const body = async (res: Response) => (await res.json()) as { code: string; message: string };
/** A bare context for calling the guard directly: the header (or none) and no session. */
const ctxWithCode = (value: string | undefined) => ({ req: { header: (name: string) => (name === SECOND_FACTOR_HEADER ? value : undefined), raw: { headers: new Headers() } } }) as unknown as Parameters<typeof requireSecondFactor>[1];
const connect = (headers?: Record<string, string>) => t.request("/v1/credentials", { cookie, json: { brokerId: SEED.brokerId, apiKey: "stepup-key-0001", apiSecret: "s3cret" }, ...(headers ? { headers } : {}) });

beforeAll(async () => {
  t = await createTestApp();
  t.delta.accept("stepup-key-0001");
  cookie = (await t.signUp(email, { password })).cookie;
  // the authenticator goes on the ADR-078 way: enable with the password, prove the first code
  t.now.value += 11_000;
  const enable = await t.request(`${AUTH_BASE_PATH}/two-factor/enable`, { cookie, json: { password } });
  expect(enable.status).toBe(200);
  secret = new URL(((await enable.json()) as { totpURI: string }).totpURI).searchParams.get("secret")!;
  t.now.value += 11_000;
  const verify = await t.request(`${AUTH_BASE_PATH}/two-factor/verify-totp`, { cookie, json: { code: await code() } });
  expect(verify.status).toBe(200);
  cookie = cookieHeaderFrom(verify, cookie);
});
afterAll(() => t.close());

describe("HC-SH-136 a sensitive change asks an account with the authenticator on for its current code", () => {
  it("connecting an exchange key: refused without the header, refused with a wrong code, allowed with the current one; nothing is stored while refused", async () => {
    const missing = await connect();
    expect(missing.status).toBe(403);
    expect(await body(missing)).toMatchObject({ code: "SECOND_FACTOR_REQUIRED" });
    const wrong = await connect({ [SECOND_FACTOR_HEADER]: "000000" });
    expect(wrong.status).toBe(403);
    expect((await body(wrong)).code).toBe("SECOND_FACTOR_INVALID");
    expect(await (await t.request("/v1/credentials", { cookie })).json()).toEqual({ items: [] });
    t.now.value += 11_000;
    const sessionsBefore = (await t.db.select().from(sessions)).length;
    const ok = await connect(await withCode());
    expect(ok.status).toBe(201);
    expect(((await (await t.request("/v1/credentials", { cookie })).json()) as { items: unknown[] }).items).toHaveLength(1);
    expect((await t.db.select().from(sessions)).length).toBe(sessionsBefore); // the re-check signs nothing in: no new session, the cookie stays
  });

  it("removing a key asks the same way; the settings PUT asks only when the Mindful pause or the lot sizes change", async () => {
    const { items } = (await (await t.request("/v1/credentials", { cookie })).json()) as { items: { id: string }[] };
    const id = items[0]!.id;
    expect((await t.request(`/v1/credentials/${id}`, { cookie, method: "DELETE" })).status).toBe(403);
    const current = (await (await t.request("/v1/settings", { cookie })).json()) as UserSettings;
    // theme: no code needed
    expect((await t.request("/v1/settings", { cookie, method: "PUT", json: { ...current, theme: current.theme === "dark" ? "light" : "dark" } })).status).toBe(200);
    // the pause off: refused without the code, saved with it
    const off = { ...current, mindful: { ...current.mindful, enabled: false } };
    const refused = await t.request("/v1/settings", { cookie, method: "PUT", json: off });
    expect(refused.status).toBe(403);
    expect((await body(refused)).code).toBe("SECOND_FACTOR_REQUIRED");
    expect(((await (await t.request("/v1/settings", { cookie })).json()) as UserSettings).mindful.enabled).toBe(true); // nothing saved
    t.now.value += 11_000;
    expect((await t.request("/v1/settings", { cookie, method: "PUT", json: off, headers: await withCode() })).status).toBe(200);
    // lot sizes: asked too
    expect((await t.request("/v1/settings", { cookie, method: "PUT", json: { ...off, lotSizes: { ...off.lotSizes, BTC: "0.01" } } })).status).toBe(403);
    t.now.value += 11_000;
    expect((await t.request(`/v1/credentials/${id}`, { cookie, method: "DELETE", headers: await withCode() })).status).toBe(204);
    expect(safetyKnobsChanged(DEFAULT_SETTINGS, DEFAULT_SETTINGS)).toBe(false);
    expect(safetyKnobsChanged(DEFAULT_SETTINGS, { ...DEFAULT_SETTINGS, theme: "light" })).toBe(false);
    expect(safetyKnobsChanged(DEFAULT_SETTINGS, { ...DEFAULT_SETTINGS, mindful: { ...DEFAULT_SETTINGS.mindful, pauseSeconds: 60 } })).toBe(true);
    expect(safetyKnobsChanged(DEFAULT_SETTINGS, { ...DEFAULT_SETTINGS, lotSizes: { XAUT: DEFAULT_SETTINGS.lotSizes.XAUT, ETH: DEFAULT_SETTINGS.lotSizes.ETH, BTC: DEFAULT_SETTINGS.lotSizes.BTC } })).toBe(false); // key order is not a change
  });

  it("five wrong codes in fifteen minutes lock the check for that user; a right code within the budget clears it; an admin sees the authenticator state", async () => {
    for (let i = 0; i < SECOND_FACTOR_FAIL_LIMIT.max; i += 1) {
      t.now.value += 11_000;
      expect((await body(await connect({ [SECOND_FACTOR_HEADER]: "111111" }))).code).toBe("SECOND_FACTOR_INVALID");
    }
    t.now.value += 11_000;
    const locked = await connect(await withCode());
    expect(locked.status).toBe(429);
    const lockedBody = await body(locked);
    expect(lockedBody.code).toBe("SECOND_FACTOR_LOCKED");
    expect(Number(locked.headers.get("Retry-After"))).toBeLessThan(SECOND_FACTOR_FAIL_LIMIT.windowMs / 1000); // the time left, not the whole window
    expect(lockedBody.message).toMatch(/Try again in \d+ min/);
    // another account's budget is its own: with the first user locked, a wrong code from a second 2FA user is a plain refusal
    await expect(requireSecondFactor(t.deps, ctxWithCode("000000"), { id: "usr_other", email: "other@hapiecoin.test", name: "Other", role: "user", twoFactorEnabled: true })).rejects.toMatchObject({ code: "SECOND_FACTOR_INVALID" });
    t.now.value += SECOND_FACTOR_FAIL_LIMIT.windowMs + 1_000;
    expect((await connect(await withCode())).status).toBe(201); // the window passed
    t.now.value += 11_000;
    expect((await body(await connect({ [SECOND_FACTOR_HEADER]: "111111" }))).code).toBe("SECOND_FACTOR_INVALID");
    t.now.value += 11_000;
    expect((await connect(await withCode())).status).toBe(201); // a right code resets the budget
    // HC-AD-129: the admin table says whether the authenticator is on
    const admin = await t.adminCookie();
    const page = (await (await t.request(`/v1/admin/users?q=${encodeURIComponent(email)}`, { cookie: admin })).json()) as { items: AdminUserRow[] };
    expect(page.items.find((u) => u.email === email)?.twoFactorEnabled).toBe(true);
    expect(page.items.every((u) => typeof u.twoFactorEnabled === "boolean")).toBe(true);
  });

  it("a session user built without the flag is looked up, never assumed off; the server's own trouble is not a wrong code and costs no slot", async () => {
    const [row] = await t.db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
    await expect(requireSecondFactor(t.deps, ctxWithCode(undefined), { id: row!.id, email, name: "x", role: "user" })).rejects.toMatchObject({ code: "SECOND_FACTOR_REQUIRED" });
    t.now.value += 11_000;
    const before = await t.rateStore.peek(`2fa:fail:user:${row!.id}`, SECOND_FACTOR_FAIL_LIMIT.windowMs);
    const down: AppDeps = { ...t.deps, auth: { handler: t.deps.auth.handler, api: { verifyTOTP: () => Promise.reject(new Error("auth db down")) } as unknown as AppDeps["auth"]["api"] } };
    await expect(requireSecondFactor(down, ctxWithCode(await code()), { id: row!.id, email, name: "x", role: "user", twoFactorEnabled: true })).rejects.toThrow("auth db down");
    expect(await t.rateStore.peek(`2fa:fail:user:${row!.id}`, SECOND_FACTOR_FAIL_LIMIT.windowMs)).toBe(before);
  });

  it("an account without the authenticator is never asked, through the route and through the lookup", async () => {
    const plainEmail = "plain@hapiecoin.test";
    const plain = (await t.signUp(plainEmail)).cookie;
    const current = (await (await t.request("/v1/settings", { cookie: plain })).json()) as UserSettings;
    expect((await t.request("/v1/settings", { cookie: plain, method: "PUT", json: { ...current, mindful: { ...current.mindful, enabled: false } } })).status).toBe(200);
    const [row] = await t.db.select({ id: users.id }).from(users).where(eq(users.email, plainEmail)).limit(1);
    await expect(requireSecondFactor(t.deps, ctxWithCode(undefined), { id: row!.id, email: plainEmail, name: "p", role: "user" })).resolves.toBeUndefined();
  });
});
