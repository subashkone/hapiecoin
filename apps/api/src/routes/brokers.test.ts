import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Broker } from "@hapiecoin/schema";
import { eq } from "drizzle-orm";
import { auditLog } from "../db/schema.js";
import { SEED } from "../db/seed.js";
import { createTestApp, type TestApp } from "../test-support/harness.js";

let t: TestApp;
let alice: string;
let bob: string;
let admin: string;
beforeAll(async () => {
  t = await createTestApp();
  alice = (await t.signUp("alice@hapiecoin.test")).cookie;
  bob = (await t.signUp("bob@hapiecoin.test")).cookie;
  admin = await t.adminCookie();
});
afterAll(() => t.close());

const FEES = { feePct: "0.05", gstPct: "18", feeCapPct: "10" };

describe("HC-SH-045..049 exchange management", () => {
  it("HC-SH-032 / HC-SH-045 lists the seeded Delta India broker with fee 0.05 %, GST 18 %, cap 10 %", async () => {
    const res = await t.request("/v1/brokers", { cookie: alice });
    const { items, nextCursor } = (await res.json()) as { items: Broker[]; nextCursor: string | null };
    expect(nextCursor).toBeNull(); // the shared paginated envelope; the web rejects a list without it (GAPS #41)
    expect(items.map((b) => b.id)).toContain(SEED.brokerId);
    const delta = items.find((b) => b.id === SEED.brokerId);
    expect(delta).toEqual({
      id: SEED.brokerId,
      name: "Delta Exchange India",
      feePct: "0.05",
      gstPct: "18",
      feeCapPct: "10",
      scope: "GLOBAL",
    });
    expect(Broker.safeParse(delta).success).toBe(true);
  });

  it("HC-SH-046 a user creates a USER-scoped exchange that only they (and admins) can see", async () => {
    const created = await t.request("/v1/brokers", {
      cookie: alice,
      json: { name: "  Alice Exchange ", ...FEES },
    });
    expect(created.status).toBe(201);
    const broker = (await created.json()) as Broker;
    expect(broker).toMatchObject({ name: "Alice Exchange", scope: "USER", ...FEES });
    expect(broker.id).toMatch(/^brk_/);

    const aliceList = (await (await t.request("/v1/brokers", { cookie: alice })).json()) as {
      items: Broker[];
    };
    expect(aliceList.items.some((b) => b.id === broker.id)).toBe(true);
    const bobList = (await (await t.request("/v1/brokers", { cookie: bob })).json()) as { items: Broker[] };
    expect(bobList.items.some((b) => b.id === broker.id)).toBe(false);

    const bobPatch = await t.request(`/v1/brokers/${broker.id}`, {
      method: "PATCH",
      cookie: bob,
      json: { name: "Hijack" },
    });
    expect(bobPatch.status).toBe(404);
    const bobDelete = await t.request(`/v1/brokers/${broker.id}`, { method: "DELETE", cookie: bob });
    expect(bobDelete.status).toBe(404);
  });

  it("HC-SH-047 validation: 'Exchange name is required', negative fees, unknown fields", async () => {
    const empty = await t.request("/v1/brokers", { cookie: alice, json: { name: "   ", ...FEES } });
    expect(empty.status).toBe(400);
    const err = (await empty.json()) as {
      code: string;
      details: { issues: { path: string; message: string }[] };
    };
    expect(err.code).toBe("VALIDATION_ERROR");
    expect(
      err.details.issues.some((i) => i.path === "name" && i.message === "Exchange name is required"),
    ).toBe(true);
    expect(
      (await t.request("/v1/brokers", { cookie: alice, json: { name: "N", ...FEES, feePct: "-0.1" } }))
        .status,
    ).toBe(400);
    expect(
      (await t.request("/v1/brokers", { cookie: alice, json: { name: "N", ...FEES, gstPct: "abc" } })).status,
    ).toBe(400);
    expect(
      (await t.request("/v1/brokers", { cookie: alice, json: { name: "N", ...FEES, bogus: 1 } })).status,
    ).toBe(400);
    expect(
      (await t.request("/v1/brokers", { cookie: alice, json: { name: "N", ...FEES, scope: "PLANET" } }))
        .status,
    ).toBe(400);
  });

  it("HC-SH-048 edit: owner updates fees; admin edits global; users cannot edit global; audit has before/after", async () => {
    const created = (await (
      await t.request("/v1/brokers", { cookie: alice, json: { name: "Editable", ...FEES } })
    ).json()) as Broker;
    const patched = await t.request(`/v1/brokers/${created.id}`, {
      method: "PATCH",
      cookie: alice,
      json: { feePct: "0.06", name: "Edited" },
    });
    expect(patched.status).toBe(200);
    expect(await patched.json()).toEqual({ ...created, feePct: "0.06", name: "Edited" });

    const userOnGlobal = await t.request(`/v1/brokers/${SEED.brokerId}`, {
      method: "PATCH",
      cookie: alice,
      json: { name: "Nope" },
    });
    expect(userOnGlobal.status).toBe(403);
    const adminOnGlobal = await t.request(`/v1/brokers/${SEED.brokerId}`, {
      method: "PATCH",
      cookie: admin,
      json: { gstPct: "18", feeCapPct: "10", feePct: "0.05" },
    });
    expect(adminOnGlobal.status).toBe(200);
    const adminOnUser = await t.request(`/v1/brokers/${created.id}`, {
      method: "PATCH",
      cookie: admin,
      json: { name: "Admin touched" },
    });
    expect(adminOnUser.status).toBe(404); // not visible to the admin: USER rows belong to their owner
    expect(
      (await t.request(`/v1/brokers/${created.id}`, { method: "PATCH", cookie: alice, json: { name: "" } }))
        .status,
    ).toBe(400);
    expect(
      (await t.request(`/v1/brokers/missing`, { method: "PATCH", cookie: alice, json: { name: "x" } }))
        .status,
    ).toBe(404);

    const rows = await t.db
      .select()
      .from(auditLog)
      .where(eq(auditLog.target, `broker:${created.id}`));
    expect(rows.map((r) => r.action)).toEqual(["broker.create", "broker.update"]);
    expect(rows[1]?.before).toEqual(created);
    expect((rows[1]?.after as Broker).feePct).toBe("0.06");
  });

  it("HC-SH-049 delete works when unused and is refused (409 BROKER_IN_USE) while credentials reference it", async () => {
    const created = (await (
      await t.request("/v1/brokers", { cookie: alice, json: { name: "Doomed", ...FEES } })
    ).json()) as Broker;
    const del = await t.request(`/v1/brokers/${created.id}`, { method: "DELETE", cookie: alice });
    expect(del.status).toBe(204);
    expect((await t.request(`/v1/brokers/${created.id}`, { method: "DELETE", cookie: alice })).status).toBe(
      404,
    );

    const inUse = (await (
      await t.request("/v1/brokers", { cookie: alice, json: { name: "Connected", ...FEES } })
    ).json()) as Broker;
    t.delta.accept("alice-key-9999");
    const connect = await t.request("/v1/credentials", {
      cookie: alice,
      json: { brokerId: inUse.id, apiKey: "alice-key-9999", apiSecret: "alice-secret" },
    });
    expect(connect.status).toBe(201);
    const refused = await t.request(`/v1/brokers/${inUse.id}`, { method: "DELETE", cookie: alice });
    expect(refused.status).toBe(409);
    expect(await refused.json()).toMatchObject({ code: "BROKER_IN_USE", details: { credentials: 1 } });
    expect((await t.request(`/v1/credentials/${inUse.id}`, { method: "DELETE", cookie: alice })).status).toBe(
      204,
    );
    expect((await t.request(`/v1/brokers/${inUse.id}`, { method: "DELETE", cookie: alice })).status).toBe(
      204,
    );

    const userDeletesGlobal = await t.request(`/v1/brokers/${SEED.brokerId}`, {
      method: "DELETE",
      cookie: alice,
    });
    expect(userDeletesGlobal.status).toBe(403);
  });
});
