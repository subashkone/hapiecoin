import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { User } from "@hapiecoin/schema";
import { eq } from "drizzle-orm";
import { auditLog } from "../db/schema.js";
import { createTestApp, type TestApp } from "../test-support/harness.js";

let t: TestApp;
let cookie: string;
beforeAll(async () => {
  t = await createTestApp();
  cookie = (await t.signUp("profile@hapiecoin.test", { name: "Pat Trader", mobile: "9000000001" })).cookie;
});
afterAll(() => t.close());

describe("HC-SH-027..030 profile", () => {
  it("HC-SH-029 GET /v1/me returns the strict User shape (email and referral code read-only)", async () => {
    const res = await t.request("/v1/me", { cookie });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(User.safeParse(body).success).toBe(true);
    expect(body).toMatchObject({
      email: "profile@hapiecoin.test",
      name: "Pat Trader",
      mobile: "9000000001",
      role: "user",
      avatar: "rocket",
    });
  });

  it("HC-SH-028 / HC-SH-030 PATCH updates name, mobile (nullable) and avatar and audits before/after", async () => {
    const res = await t.request("/v1/me", {
      method: "PATCH",
      cookie,
      json: { name: "  Pat T.  ", avatar: "diamond" },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ name: "Pat T.", avatar: "diamond", mobile: "9000000001" });

    const cleared = await t.request("/v1/me", { method: "PATCH", cookie, json: { mobile: null } });
    expect(cleared.status).toBe(200);
    const body = (await cleared.json()) as Record<string, unknown>;
    expect(body).not.toHaveProperty("mobile");
    expect(User.safeParse(body).success).toBe(true);

    const rows = await t.db.select().from(auditLog).where(eq(auditLog.action, "me.update"));
    expect(rows.length).toBe(2);
    expect(rows[0]?.before).toEqual({ name: "Pat Trader", mobile: "9000000001", avatar: "rocket" });
    expect(rows[0]?.after).toEqual({ name: "Pat T.", mobile: "9000000001", avatar: "diamond" });
    expect(rows[1]?.after).toMatchObject({ mobile: null });
  });

  it("validates: empty name, bad mobile, unknown avatar, read-only fields (email, role, referralCode)", async () => {
    for (const bad of [
      { name: "" },
      { mobile: "123" },
      { avatar: "unicorn" },
      { email: "x@y.z" },
      { role: "admin" },
      { referralCode: "REFHACK000" },
    ]) {
      const res = await t.request("/v1/me", { method: "PATCH", cookie, json: bad });
      expect(res.status, JSON.stringify(bad)).toBe(400);
      expect(((await res.json()) as { code: string }).code).toBe("VALIDATION_ERROR");
    }
    const unchanged = (await (await t.request("/v1/me", { cookie })).json()) as {
      role: string;
      email: string;
    };
    expect(unchanged.role).toBe("user");
    expect(unchanged.email).toBe("profile@hapiecoin.test");
  });

  it("a session whose user row vanished is treated as signed out", async () => {
    const { cookie: ghost } = await t.signUp("ghost@hapiecoin.test");
    const before = await t.request("/v1/me", { cookie: ghost });
    expect(before.status).toBe(200);
    // Deleting the user cascades to sessions, so the cookie no longer resolves.
    const { users } = await import("../db/schema.js");
    await t.db.delete(users).where(eq(users.email, "ghost@hapiecoin.test"));
    const after = await t.request("/v1/me", { cookie: ghost });
    expect(after.status).toBe(401);
  });
});
