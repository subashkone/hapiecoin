import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, getTableName, sql } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import { writeAudit } from "../audit.js";
import { createDb, defaultMigrationsFolder, type DbHandle } from "./client.js";
import {
  accounts,
  auditLog,
  brokerCredentials,
  brokers,
  passkeys,
  schema,
  sessions,
  strategies,
  strategyLegs,
  strategyOrders,
  strategyPnl,
  subscriptions,
  userSettings,
  users,
  verifications,
} from "./schema.js";
import { SEED, seed } from "./seed.js";

let handle: DbHandle;
beforeAll(async () => {
  handle = await createDb();
  await handle.migrate();
});
afterAll(() => handle.close());

describe("[DB] driver factory and migrations", () => {
  it("uses PGlite without DATABASE_URL, applies the committed migrations and answers ping", async () => {
    expect(handle.kind).toBe("pglite");
    expect(existsSync(defaultMigrationsFolder())).toBe(true);
    expect(await handle.ping()).toBe(true);
    const tables = (await handle.db.execute(
      sql`select table_name from information_schema.tables where table_schema = 'public' order by table_name`,
    )) as {
      rows: { table_name: string }[];
    };
    const names = tables.rows.map((r) => r.table_name);
    for (const expected of [
      "users",
      "sessions",
      "accounts",
      "verifications",
      "passkeys",
      "user_settings",
      "brokers",
      "broker_credentials",
      "subscriptions",
      "audit_log",
    ]) {
      expect(names).toContain(expected);
    }
    await handle.migrate(); // idempotent
  });

  it("selects the postgres-js driver when DATABASE_URL is set (no connection is opened until first use)", async () => {
    const pg = await createDb({
      databaseUrl: "postgres://hapiecoin:hapiecoin@127.0.0.1:1/hapiecoin",
      migrationsFolder: defaultMigrationsFolder(),
    });
    expect(pg.kind).toBe("postgres");
    expect(await pg.ping()).toBe(false);
    await expect(pg.migrate()).rejects.toThrow();
    await pg.close();
  });

  it("persists to a PGlite data directory when one is configured", async () => {
    const dir = join(tmpdir(), `hapiecoin-pglite-${process.pid}-${Date.now()}`);
    const first = await createDb({ pgliteDataDir: dir });
    await first.migrate();
    await seed(first.db);
    await first.close();
    const second = await createDb({ pgliteDataDir: dir });
    const [broker] = await second.db.select().from(brokers).where(eq(brokers.id, SEED.brokerId));
    expect(broker?.name).toBe("Delta Exchange India");
    await second.close();
    await rm(dir, { recursive: true, force: true });
  });

  it("reports ping=false once closed", async () => {
    const h = await createDb();
    await h.close();
    expect(await h.ping()).toBe(false);
  });
});

describe("[DB] schema declares the relationships the API relies on", () => {
  const fks = (table: Parameters<typeof getTableConfig>[0]) =>
    getTableConfig(table).foreignKeys.map((fk) => {
      const ref = fk.reference();
      return {
        from: ref.columns.map((c) => c.name).join(","),
        to: `${getTableName(ref.foreignTable)}.${ref.foreignColumns.map((c) => c.name).join(",")}`,
        onDelete: fk.onDelete,
      };
    });

  it("Better Auth tables cascade from users; credentials restrict broker deletion; audit_log has no FKs", () => {
    expect(fks(sessions)).toEqual([{ from: "user_id", to: "users.id", onDelete: "cascade" }]);
    expect(fks(accounts)).toEqual([{ from: "user_id", to: "users.id", onDelete: "cascade" }]);
    expect(fks(passkeys)).toEqual([{ from: "user_id", to: "users.id", onDelete: "cascade" }]);
    expect(fks(userSettings)).toEqual([{ from: "user_id", to: "users.id", onDelete: "cascade" }]);
    expect(fks(subscriptions)).toEqual([
      { from: "user_id", to: "users.id", onDelete: "cascade" },
      { from: "plan_id", to: "plans.id", onDelete: "set null" },
    ]);
    expect(fks(brokers)).toEqual([{ from: "owner_id", to: "users.id", onDelete: "cascade" }]);
    expect(fks(brokerCredentials)).toEqual([
      { from: "user_id", to: "users.id", onDelete: "cascade" },
      { from: "broker_id", to: "brokers.id", onDelete: "restrict" },
    ]);
    expect(fks(auditLog)).toEqual([]);
    expect(fks(verifications)).toEqual([]);
  });

  it("strategy tables cascade from users and strategies; a deleted broker leaves the strategy (broker null)", () => {
    expect(fks(strategies)).toEqual([
      { from: "user_id", to: "users.id", onDelete: "cascade" },
      { from: "broker_id", to: "brokers.id", onDelete: "set null" },
    ]);
    expect(fks(strategyLegs)).toEqual([{ from: "strategy_id", to: "strategies.id", onDelete: "cascade" }]);
    expect(fks(strategyPnl)).toEqual([{ from: "strategy_id", to: "strategies.id", onDelete: "cascade" }]);
    expect(fks(strategyOrders)).toEqual([
      { from: "strategy_id", to: "strategies.id", onDelete: "cascade" },
      { from: "leg_id", to: "strategy_legs.id", onDelete: "cascade" },
    ]);
    const indexNames = (table: Parameters<typeof getTableConfig>[0]) => getTableConfig(table).indexes.map((i) => i.config.name);
    expect(indexNames(strategies)).toContain("strategies_user_id_idx");
    expect(indexNames(strategyLegs)).toEqual(["strategy_legs_strategy_id_idx"]);
    expect(indexNames(strategyPnl)).toEqual(["strategy_pnl_strategy_day_uq"]);
    expect(indexNames(strategyOrders)).toEqual(["strategy_orders_strategy_id_idx", "strategy_orders_client_uq"]);
  });

  it("unique constraints protect email, referral code, session token and one credential per user+broker", () => {
    const uniqueNames = (table: Parameters<typeof getTableConfig>[0]) =>
      getTableConfig(table)
        .indexes.filter((i) => i.config.unique)
        .map((i) => i.config.name);
    expect(uniqueNames(users)).toEqual(["users_email_uq", "users_referral_code_uq"]);
    expect(uniqueNames(sessions)).toEqual(["sessions_token_uq"]);
    expect(uniqueNames(brokerCredentials)).toEqual(["broker_credentials_user_broker_uq"]);
    expect(Object.keys(schema).sort()).toEqual(
      [
        "accounts",
        "auditLog",
        "brokerCredentials",
        "brokers",
        "passkeys",
        "sessions",
        "plans",
        "menuItems",
        "referralCommissions",
        "banners",
        "coupons",
        "payments",
        "campaigns",
        "campaignRecipients",
        "alerts",
        "ivSnapshots",
        "instrumentMarks",
        "strategies",
        "strategyLegs",
        "strategyOrders",
        "strategyPnl",
        "subscriptions",
        "userSettings",
        "users",
        "verifications",
      ].sort(),
    );
  });
});

describe("[DB] seed", () => {
  it("creates the admin, the Delta India broker and an active Pro subscription once", async () => {
    const first = await seed(handle.db, () => new Date("2026-09-07T00:00:00Z"));
    expect(first).toEqual({ admin: "created", broker: "created", subscription: "created", plans: "created" });
    const second = await seed(handle.db);
    expect(second).toEqual({ admin: "exists", broker: "exists", subscription: "exists", plans: "exists" });

    const [admin] = await handle.db.select().from(users).where(eq(users.email, SEED.adminEmail));
    expect(admin).toMatchObject({ role: "admin", emailVerified: true, referralCode: SEED.adminReferralCode });
    const [broker] = await handle.db.select().from(brokers).where(eq(brokers.id, SEED.brokerId));
    expect(broker).toMatchObject({
      name: "Delta Exchange India",
      feePct: "0.05",
      gstPct: "18",
      feeCapPct: "10",
      scope: "GLOBAL",
      ownerId: null,
    });
    const [sub] = await handle.db.select().from(subscriptions).where(eq(subscriptions.userId, SEED.adminId));
    expect(sub).toMatchObject({ planName: "Pro", status: "active" });
    expect(sub?.expiresAt?.toISOString()).toBe("2027-09-07T00:00:00.000Z");
    expect(sub?.featureLimits).toMatchObject({ strategies: 100 });
  });
});

describe("[AUDIT] append-only log", () => {
  it("writes scrubbed before/after and ignores UPDATE and DELETE", async () => {
    await writeAudit(handle.db, {
      actorId: SEED.adminId,
      action: "test.action",
      target: "thing:1",
      before: { apiSecret: "s3cr3t", name: "old" },
      after: { apiKey: "k", name: "new" },
      ip: "203.0.113.1",
      ua: "vitest",
    });
    await writeAudit(handle.db, { actorId: null, action: "anon.action", target: "thing:2" });
    const rows = await handle.db.select().from(auditLog).where(eq(auditLog.target, "thing:1"));
    expect(rows.length).toBe(1);
    expect(rows[0]?.before).toEqual({ apiSecret: "[redacted]", name: "old" });
    expect(rows[0]?.after).toEqual({ apiKey: "[redacted]", name: "new" });
    expect(rows[0]?.ip).toBe("203.0.113.1");
    const [anon] = await handle.db.select().from(auditLog).where(eq(auditLog.target, "thing:2"));
    expect(anon).toMatchObject({ actorId: null, before: null, after: null, ip: null, ua: null });

    await handle.db.update(auditLog).set({ action: "tampered" }).where(eq(auditLog.target, "thing:1"));
    await handle.db.delete(auditLog).where(eq(auditLog.target, "thing:1"));
    const after = await handle.db.select().from(auditLog).where(eq(auditLog.target, "thing:1"));
    expect(after.length).toBe(1);
    expect(after[0]?.action).toBe("test.action");
  });
});
