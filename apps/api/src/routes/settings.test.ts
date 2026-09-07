import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { UserSettings } from "@hapiecoin/schema";
import { eq } from "drizzle-orm";
import type { userSettings } from "../db/schema.js";
import { auditLog } from "../db/schema.js";
import { createTestApp, type TestApp } from "../test-support/harness.js";
import { DEFAULT_SETTINGS, toSettings } from "./settings.js";

let t: TestApp;
let cookie: string;
beforeAll(async () => {
  t = await createTestApp();
  cookie = (await t.signUp("settings@hapiecoin.test")).cookie;
});
afterAll(() => t.close());

describe("HC-SH-038 currency & conversion rate, HC-SH-041 lot sizes, HC-SH-043 P&L basis", () => {
  it("returns defaults before the first save (rate 83.5, BTC 0.001 / ETH 0.01 / XAUT 0.001, mark basis)", async () => {
    const res = await t.request("/v1/settings", { cookie });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual(DEFAULT_SETTINGS);
    expect(UserSettings.safeParse(body).success).toBe(true);
  });

  it("HC-SH-040 / HC-SH-042 saves a full settings object and reads it back; audit row has before/after", async () => {
    const next = {
      currency: "INR",
      conversionRate: "84.25",
      pnlBasis: "bid_ask",
      lotSizes: { BTC: "0.002", ETH: "0.05", XAUT: "0.001" },
      theme: "light",
      density: "compact",
    };
    const put = await t.request("/v1/settings", { method: "PUT", cookie, json: next });
    expect(put.status).toBe(200);
    expect(await put.json()).toEqual(next);
    const get = await t.request("/v1/settings", { cookie });
    expect(await get.json()).toEqual(next);

    const again = await t.request("/v1/settings", {
      method: "PUT",
      cookie,
      json: { ...next, theme: "dark" },
    });
    expect(((await again.json()) as { theme: string }).theme).toBe("dark");

    const rows = await t.db.select().from(auditLog).where(eq(auditLog.action, "settings.update"));
    expect(rows.length).toBe(2);
    expect(rows[0]?.before).toEqual(DEFAULT_SETTINGS);
    expect(rows[0]?.after).toEqual(next);
    expect(rows[1]?.before).toEqual(next);
    expect((rows[1]?.after as { theme: string }).theme).toBe("dark");
    expect(rows[0]?.actorId).toBeTruthy();
    expect(rows[0]?.ip).toBe("203.0.113.10");
  });

  it("rejects lot sizes that are not > 0, a non-decimal conversion rate, a missing underlying and unknown fields", async () => {
    const good = {
      currency: "USD",
      conversionRate: "83.5",
      pnlBasis: "mark",
      lotSizes: { BTC: "0.001", ETH: "0.01", XAUT: "0.001" },
      theme: "dark",
      density: "comfortable",
    };
    const attempts: [unknown, string][] = [
      [{ ...good, lotSizes: { ...good.lotSizes, BTC: "0" } }, "lotSizes.BTC"],
      [{ ...good, lotSizes: { ...good.lotSizes, ETH: "-1" } }, "lotSizes.ETH"],
      [{ ...good, lotSizes: { BTC: "0.001", ETH: "0.01" } }, "lotSizes"],
      [{ ...good, conversionRate: 83.5 }, "conversionRate"],
      [{ ...good, conversionRate: "83,5" }, "conversionRate"],
      [{ ...good, conversionRate: "0" }, "conversionRate"],
      [{ ...good, currency: "EUR" }, "currency"],
      [{ ...good, extra: 1 }, ""],
    ];
    for (const [body, path] of attempts) {
      const res = await t.request("/v1/settings", { method: "PUT", cookie, json: body });
      expect(res.status).toBe(400);
      const err = (await res.json()) as { code: string; details: { issues: { path: string }[] } };
      expect(err.code).toBe("VALIDATION_ERROR");
      expect(err.details.issues.some((i) => i.path.startsWith(path))).toBe(true);
    }
    const stillSaved = await t.request("/v1/settings", { cookie });
    expect(((await stillSaved.json()) as { currency: string }).currency).toBe("INR");
  });

  it("fills a lot size missing from an old row with the default", () => {
    const row: typeof userSettings.$inferSelect = {
      userId: "u",
      currency: "USD",
      conversionRate: "80",
      pnlBasis: "mark",
      lotSizes: { BTC: "0.003" },
      theme: "dark",
      density: "comfortable",
      updatedAt: new Date(),
    };
    expect(toSettings(row).lotSizes).toEqual({ BTC: "0.003", ETH: "0.01", XAUT: "0.001" });
  });

  it("malformed JSON is a 400 envelope, not a crash", async () => {
    const res = await t.request("/v1/settings", {
      method: "PUT",
      cookie,
      headers: { "content-type": "application/json" },
      json: undefined,
    });
    expect([400, 415]).toContain(res.status);
  });
});
