/**
 * Development seed (idempotent): one admin (demo@hapiecoin.com), the Delta Exchange India broker
 * (fee 0.05 %, GST 18 %, cap 10 % of premium) and an active Pro subscription for the admin.
 * Never runs in production; the seed writes no passwords — the admin signs in with an email OTP.
 */
import { eq } from "drizzle-orm";
import type { Db } from "./client.js";
import type { PlanIntervals } from "@hapiecoin/schema";
import { brokers, menuItems, plans, subscriptions, users } from "./schema.js";

export const SEED = {
  adminId: "usr_demo_admin",
  adminEmail: "demo@hapiecoin.com",
  adminName: "Demo Admin",
  adminReferralCode: "REFDEMO001",
  brokerId: "brk_delta_india",
  brokerName: "Delta Exchange India",
  subscriptionId: "sub_demo_pro",
  planName: "Pro",
  /** Catalogue ids (ADR-030); the demo admin's subscription points at the Pro plan. */
  plans: { free: "pln_free", basic: "pln_basic", pro: "pln_pro", elite: "pln_elite" },
  menuItems: { analytics: "mnu_market_analytics", exports: "mnu_reports_export", alerts: "mnu_alerts" },
} as const;

export interface SeedResult {
  admin: "created" | "exists";
  broker: "created" | "exists";
  subscription: "created" | "exists";
  plans: "created" | "exists";
}

export async function seed(db: Db, now: () => Date = () => new Date()): Promise<SeedResult> {
  const result: SeedResult = { admin: "exists", broker: "exists", subscription: "exists", plans: "exists" };

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

  const [anyPlan] = await db.select({ id: plans.id }).from(plans).limit(1);
  if (!anyPlan) {
    const items = [
      { id: SEED.menuItems.analytics, displayName: "Market Analytics", category: "Analytics", priceInr: "299" },
      { id: SEED.menuItems.exports, displayName: "Reports Export", category: "Data", priceInr: "199" },
      { id: SEED.menuItems.alerts, displayName: "Price & P&L Alerts", category: "Trading", priceInr: "149" },
    ];
    await db.insert(menuItems).values(items.map((m) => ({ ...m, active: true })));
    const tier = (monthly: number, quarterly: number, yearly: number, discount: number, limits: PlanIntervals["monthly"]["limits"]): PlanIntervals => {
      const at = (price: number): PlanIntervals["monthly"] => ({ priceInr: String(price), discountPriceInr: discount > 0 && price > 0 ? String(Math.round(price * (1 - discount / 100))) : null, limits });
      return { monthly: at(monthly), quarterly: at(quarterly), yearly: at(yearly) };
    };
    await db.insert(plans).values([
      { id: SEED.plans.free, name: "Free", description: "Explore the chain, build strategies and paper trade a little.", features: ["Live options chain", "Strategy builder and 28 templates", "3 paper trades a month"], intervals: tier(0, 0, 0, 0, { paper_trading: 3, templates: 5 }), menuItemIds: [], active: true, sortOrder: 0 },
      { id: SEED.plans.basic, name: "Basic", description: "For traders who paper trade every day.", features: ["Everything in Free", "25 paper trades a month", "Unlimited saved strategies", "Price alerts"], intervals: tier(499, 1299, 4499, 10, { paper_trading: 25, templates: 0, alerts: 10 }), menuItemIds: [SEED.menuItems.alerts], active: true, sortOrder: 10 },
      { id: SEED.plans.pro, name: "Pro", description: "Live trading on Delta Exchange India with analytics.", features: ["Everything in Basic", "Unlimited paper trades", "50 live trades a month", "Market analytics"], intervals: tier(999, 2699, 8999, 15, { paper_trading: 0, live_trading: 50, templates: 0, alerts: 50 }), menuItemIds: [SEED.menuItems.alerts, SEED.menuItems.analytics], active: true, sortOrder: 20 },
      { id: SEED.plans.elite, name: "Elite", description: "No limits, every module, priority support.", features: ["Everything in Pro", "Unlimited live trades", "Reports export", "Priority support"], intervals: tier(1999, 5399, 17999, 20, { paper_trading: 0, live_trading: 0, templates: 0, alerts: 0 }), menuItemIds: [SEED.menuItems.alerts, SEED.menuItems.analytics, SEED.menuItems.exports], active: true, sortOrder: 30 },
    ]);
    result.plans = "created";
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
      planId: SEED.plans.pro,
      interval: "yearly",
      priceInr: "8999",
      paidInr: "0",
      status: "active",
      startsAt,
      expiresAt,
      featureLimits: { strategies: 100, alerts: 50, paperAccounts: 5 },
    });
    result.subscription = "created";
  }

  return result;
}
