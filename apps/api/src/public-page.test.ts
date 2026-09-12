// Public trader page (ADR-075; HC-SH-127 settings, HC-PB-066 the page): a handle is unique and lower-case, the page is
// off until turned on, and what a visitor gets is the projection: totals net of fees, never account ids or balances.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PublicPageSettings, PublicTraderPage } from "@hapiecoin/schema";
import { SEED } from "./db/seed.js";
import { createTestApp, type TestApp } from "./test-support/harness.js";
import { isUniqueViolation } from "./routes/public-page.js";
import { ingestFills } from "./verified.js";

let t: TestApp;
let asha: string;
let ravi: string;
const KEY = "pp-main-key-AAAA";
const json = async <T>(res: Response): Promise<T> => (await res.json()) as T;
const OFF: PublicPageSettings = { handle: null, enabled: false, showDays: false, showAccounts: false, showMonths: false };

beforeAll(async () => {
  t = await createTestApp();
  asha = (await t.signUp("asha@hapiecoin.test", { name: "Asha" })).cookie;
  ravi = (await t.signUp("ravi@hapiecoin.test", { name: "Ravi" })).cookie;
});
afterAll(() => t.close());

describe("HC-SH-127 public page settings", () => {
  it("starts off with no handle; the page cannot be on without a handle; the handle is lower-cased, unique and never a reserved word", async () => {
    expect(await json(await t.request("/v1/public-page", { cookie: asha }))).toEqual(OFF);
    expect((await t.request("/v1/public-page", { method: "PUT", cookie: asha, json: { ...OFF, enabled: true } })).status).toBe(400);
    expect((await t.request("/v1/public-page", { method: "PUT", cookie: asha, json: { ...OFF, handle: "Admin" } })).status).toBe(400);
    expect((await t.request("/v1/public-page", { method: "PUT", cookie: asha, json: { ...OFF, handle: "no spaces" } })).status).toBe(400);
    const saved = await t.request("/v1/public-page", { method: "PUT", cookie: asha, json: { ...OFF, handle: " Asha_Trades " } });
    expect(saved.status).toBe(200);
    expect(await json(saved)).toEqual({ ...OFF, handle: "asha_trades" });
    const taken = await t.request("/v1/public-page", { method: "PUT", cookie: ravi, json: { ...OFF, handle: "ASHA_TRADES" } });
    expect(taken.status).toBe(409);
    expect(await json<{ message: string }>(taken)).toMatchObject({ message: "That handle is taken" });
    // the same user may save their own handle again
    expect((await t.request("/v1/public-page", { method: "PUT", cookie: asha, json: { ...OFF, handle: "asha_trades", showDays: true } })).status).toBe(200);
    expect((await t.request("/v1/public-page")).status).toBe(401);
  });

  it("a unique violation raised by the index between the check and the write reads as the same 409", () => {
    expect(isUniqueViolation({ code: "23505" })).toBe(true);
    expect(isUniqueViolation(new Error("wrapped", { cause: { code: "23505" } }))).toBe(true);
    expect(isUniqueViolation({ code: "23503" })).toBe(false);
    expect(isUniqueViolation(null)).toBe(false);
    expect(isUniqueViolation(new Error("plain"))).toBe(false);
  });
});

describe("HC-PB-066 the public page", () => {
  it("is 404 while off, unknown or malformed; once on it answers the projection, cached a minute, with nothing private in it", async () => {
    expect((await t.request("/v1/public/traders/asha_trades")).status).toBe(404); // saved but off
    expect((await t.request("/v1/public/traders/nobody")).status).toBe(404);
    expect((await t.request("/v1/public/traders/x")).status).toBe(404); // not even a valid handle

    // Asha connects a key with a closed round trip, then turns the page on with accounts shown
    t.delta.accept(KEY);
    expect((await t.request("/v1/credentials", { cookie: asha, json: { brokerId: SEED.brokerId, label: "Main", apiKey: KEY, apiSecret: "s" } })).status).toBe(201);
    t.trading.product("C-BTC-80000-250926", 101, "0.001");
    t.trading.addFill(KEY, { id: "f-1", productId: 101, side: "buy", size: 10, price: "1200", commission: "0.6", filledAt: "2026-09-10T09:00:00.000Z" });
    t.trading.addFill(KEY, { id: "f-2", productId: 101, side: "sell", size: 10, price: "1500", commission: "0.75", filledAt: "2026-09-11T09:00:00.000Z" });
    const me = await json<{ id: string }>(await t.request("/v1/me", { cookie: asha }));
    expect(await ingestFills(t.deps, { userId: me.id })).toMatchObject({ added: 2, errors: [] });
    expect((await t.request("/v1/public-page", { method: "PUT", cookie: asha, json: { handle: "asha_trades", enabled: true, showDays: true, showAccounts: true, showMonths: false } })).status).toBe(200);

    const res = await t.request("/v1/public/traders/Asha_Trades"); // any case finds the page
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("public, max-age=60");
    const page = await json<PublicTraderPage>(res);
    expect(page).toMatchObject({ handle: "asha_trades", name: "Asha", total: { all: "1.65" }, fills: 2, since: "2026-09-10T09:00:00.000Z", months: null, partial: false });
    expect(page.days).toEqual([{ day: "2026-09-10", pnl: "-0.6" }, { day: "2026-09-11", pnl: "2.25" }]); // commissions come off on their day
    expect(page.accounts).toEqual([{ label: "Main", realizedUsd: "1.65", fills: 2, since: "2026-09-10T09:00:00.000Z" }]);
    expect(JSON.stringify(page)).not.toMatch(/crd_|gross|journal|commission|difference|accountId|productId|wallet/);

    // off again: 404 for everyone, the settings still readable by the owner
    expect((await t.request("/v1/public-page", { method: "PUT", cookie: asha, json: { handle: "asha_trades", enabled: false, showDays: true, showAccounts: true, showMonths: false } })).status).toBe(200);
    expect((await t.request("/v1/public/traders/asha_trades")).status).toBe(404);
    expect(await json(await t.request("/v1/public-page", { cookie: asha }))).toMatchObject({ handle: "asha_trades", enabled: false });
  });
});
