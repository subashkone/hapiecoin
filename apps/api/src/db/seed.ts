/**
 * Development seed (idempotent): one admin (demo@hapiecoin.com), the Delta Exchange India broker
 * (fee 0.05 %, GST 18 %, cap 10 % of premium) and an active Pro subscription for the admin.
 * Never runs in production; the seed writes no passwords — the admin signs in with an email OTP.
 */
import { eq } from "drizzle-orm";
import type { Db } from "./client.js";
import { brokers, subscriptions, users } from "./schema.js";

export const SEED = {
  adminId: "usr_demo_admin",
  adminEmail: "demo@hapiecoin.com",
  adminName: "Demo Admin",
  adminReferralCode: "REFDEMO001",
  brokerId: "brk_delta_india",
  brokerName: "Delta Exchange India",
  subscriptionId: "sub_demo_pro",
  planName: "Pro",
} as const;

export interface SeedResult {
  admin: "created" | "exists";
  broker: "created" | "exists";
  subscription: "created" | "exists";
}

export async function seed(db: Db, now: () => Date = () => new Date()): Promise<SeedResult> {
  const result: SeedResult = { admin: "exists", broker: "exists", subscription: "exists" };

  const [admin] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, SEED.adminEmail))
    .limit(1);
  if (!admin) {
    await db.insert(users).values({
      id: SEED.adminId,
      name: SEED.adminName,
      email: SEED.adminEmail,
      emailVerified: true,
      role: "admin",
      avatar: "rocket",
      referralCode: SEED.adminReferralCode,
    });
    result.admin = "created";
  }
  const adminId = admin?.id ?? SEED.adminId;

  const [broker] = await db
    .select({ id: brokers.id })
    .from(brokers)
    .where(eq(brokers.id, SEED.brokerId))
    .limit(1);
  if (!broker) {
    await db.insert(brokers).values({
      id: SEED.brokerId,
      name: SEED.brokerName,
      feePct: "0.05",
      gstPct: "18",
      feeCapPct: "10",
      scope: "GLOBAL",
      ownerId: null,
    });
    result.broker = "created";
  }

  const [sub] = await db
    .select({ id: subscriptions.id })
    .from(subscriptions)
    .where(eq(subscriptions.id, SEED.subscriptionId))
    .limit(1);
  if (!sub) {
    const startsAt = now();
    const expiresAt = new Date(startsAt.getTime() + 365 * 24 * 60 * 60 * 1000);
    await db.insert(subscriptions).values({
      id: SEED.subscriptionId,
      userId: adminId,
      planName: SEED.planName,
      status: "active",
      startsAt,
      expiresAt,
      featureLimits: { strategies: 100, alerts: 50, paperAccounts: 5 },
    });
    result.subscription = "created";
  }

  return result;
}
