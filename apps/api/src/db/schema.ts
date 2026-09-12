/**
 * Drizzle schema. Property names on the Better Auth tables (users, sessions, accounts, verifications,
 * passkeys) must equal Better Auth's field names (camelCase) because the Drizzle adapter looks columns up
 * by property; the physical column names are snake_case.
 *
 * Money-shaped values (fee percentages, conversion rate, lot sizes) are stored as decimal strings in
 * text/jsonb columns, never as floats (brief: decimal strings cross package boundaries).
 */
import type { PlanIntervals } from "@hapiecoin/schema";
import { sql } from "drizzle-orm";
import { bigserial, boolean, customType, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
};

// ---------------------------------------------------------------------------------------------
// Better Auth managed tables + our profile columns
// ---------------------------------------------------------------------------------------------

export const users = pgTable(
  "users",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    email: text("email").notNull(),
    emailVerified: boolean("email_verified").notNull().default(false),
    image: text("image"),
    ...timestamps,
    // HapieCoin profile (HC-SH-027..030)
    mobile: text("mobile"),
    role: text("role", { enum: ["user", "admin"] })
      .notNull()
      .default("user"),
    avatar: text("avatar", { enum: ["rocket", "diamond", "lightning"] })
      .notNull()
      .default("rocket"),
    referralCode: text("referral_code").notNull(),
    /** Referral code of the inviter, captured from `ref` at sign-up. */
    referredBy: text("referred_by"),
    /** Per-account kill switch (ADR-025): true refuses every live placement for this user. */
    tradingDisabled: boolean("trading_disabled").notNull().default(false),
    /** Admin account toggle (HC-AD-047): false refuses trading and plan activation. */
    active: boolean("active").notNull().default(true),
    /** Telegram alert delivery (ADR-057): the linked chat, the pending /start code, and when the link was made. */
    telegramChatId: text("telegram_chat_id"),
    telegramLinkCode: text("telegram_link_code"),
    telegramLinkedAt: timestamp("telegram_linked_at", { withTimezone: true }),
    /** Per-user feature limit overrides (HC-AD-048), same keys as plan limits; > 0 replaces the plan number. */
    limitOverrides: jsonb("limit_overrides").$type<Record<string, number>>().notNull().default(sql`'{}'::jsonb`),
    /** Referral commission percentage (HC-AD-046), decimal string. */
    commissionPct: text("commission_pct").notNull().default("0"),
  },
  (t) => [
    uniqueIndex("users_email_uq").on(t.email),
    uniqueIndex("users_referral_code_uq").on(t.referralCode),
  ],
);

export const sessions = pgTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }).notNull(),
    token: text("token").notNull(),
    ...timestamps,
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
  },
  (t) => [uniqueIndex("sessions_token_uq").on(t.token), index("sessions_user_id_idx").on(t.userId)],
);

export const accounts = pgTable(
  "accounts",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true, mode: "date" }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true, mode: "date" }),
    scope: text("scope"),
    password: text("password"),
    ...timestamps,
  },
  (t) => [index("accounts_user_id_idx").on(t.userId)],
);

export const verifications = pgTable(
  "verifications",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }).notNull(),
    ...timestamps,
  },
  (t) => [index("verifications_identifier_idx").on(t.identifier)],
);

export const passkeys = pgTable(
  "passkeys",
  {
    id: text("id").primaryKey(),
    name: text("name"),
    publicKey: text("public_key").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    credentialID: text("credential_id").notNull(),
    counter: integer("counter").notNull(),
    deviceType: text("device_type").notNull(),
    backedUp: boolean("backed_up").notNull(),
    transports: text("transports"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).defaultNow(),
    aaguid: text("aaguid"),
  },
  (t) => [index("passkeys_user_id_idx").on(t.userId), index("passkeys_credential_id_idx").on(t.credentialID)],
);

// ---------------------------------------------------------------------------------------------
// HapieCoin tables
// ---------------------------------------------------------------------------------------------

/** Per-user preferences (HC-SH-038..044). One row per user; absent row = defaults. */
export const userSettings = pgTable("user_settings", {
  userId: text("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  currency: text("currency", { enum: ["USD", "INR"] })
    .notNull()
    .default("USD"),
  /** Decimal string, USD → INR. */
  conversionRate: text("conversion_rate").notNull().default("83.5"),
  pnlBasis: text("pnl_basis", { enum: ["mark", "bid_ask"] })
    .notNull()
    .default("mark"),
  /** { BTC: "0.001", ETH: "0.01", XAUT: "0.001" } as decimal strings. */
  lotSizes: jsonb("lot_sizes").$type<Record<string, string>>().notNull(),
  theme: text("theme", { enum: ["dark", "light"] })
    .notNull()
    .default("dark"),
  density: text("density", { enum: ["comfortable", "compact"] })
    .notNull()
    .default("comfortable"),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
});

/** Exchange fee profiles (HC-SH-032, HC-SH-045..049). GLOBAL rows are admin-managed; USER rows belong to `ownerId`. */
export const brokers = pgTable(
  "brokers",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    feePct: text("fee_pct").notNull(),
    gstPct: text("gst_pct").notNull(),
    feeCapPct: text("fee_cap_pct").notNull(),
    scope: text("scope", { enum: ["GLOBAL", "USER"] }).notNull(),
    ownerId: text("owner_id").references(() => users.id, { onDelete: "cascade" }),
    /** ADR-065: the venue this row belongs to; every row so far is Delta India. */
    venue: text("venue", { enum: ["delta_india", "deribit"] }).notNull().default("delta_india"),
    ...timestamps,
  },
  (t) => [index("brokers_owner_id_idx").on(t.ownerId)],
);

/**
 * Encrypted exchange credentials (HC-SH-031..037). Key and secret are sealed separately, each with
 * its own IV and auth tag (AES-256-GCM must never reuse an IV under one key). Only `apiKeyMasked`
 * is ever serialised to a client.
 */
export const brokerCredentials = pgTable(
  "broker_credentials",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    brokerId: text("broker_id")
      .notNull()
      .references(() => brokers.id, { onDelete: "restrict" }),
    /** The trader's name for this key; several keys per broker are told apart by it (ADR-068). */
    label: text("label").notNull().default("Main"),
    apiKeyMasked: text("api_key_masked").notNull(),
    apiKeyCt: text("api_key_ct").notNull(),
    apiKeyIv: text("api_key_iv").notNull(),
    apiKeyTag: text("api_key_tag").notNull(),
    apiSecretCt: text("api_secret_ct").notNull(),
    apiSecretIv: text("api_secret_iv").notNull(),
    apiSecretTag: text("api_secret_tag").notNull(),
    connectedAt: timestamp("connected_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    whitelistedIp: text("whitelisted_ip").notNull(),
    /** Id of the vault key that sealed this row (ADR-054); null for rows written before key rotation existed. */
    keyId: text("key_id"),
  },
  (t) => [
    uniqueIndex("broker_credentials_user_broker_label_uq").on(t.userId, t.brokerId, t.label),
    index("broker_credentials_broker_id_idx").on(t.brokerId),
  ],
);

/** Minimal subscription record for the plan banner (HC-SH-014). Payments (phase 4) will extend it. */
/** Plan catalogue (Phase 4 item 1, ADR-030): prices and per-interval limits live in one JSON column per plan. */
export const plans = pgTable(
  "plans",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    features: jsonb("features").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    intervals: jsonb("intervals").$type<PlanIntervals>().notNull(),
    menuItemIds: jsonb("menu_item_ids").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    active: boolean("active").notNull().default(true),
    sortOrder: integer("sort_order").notNull().default(100),
    ...timestamps,
  },
  (t) => [uniqueIndex("plans_name_uq").on(t.name)],
);

/** Menu pricing master (HC-AD-020..028): priced items a plan can link. */
export const menuItems = pgTable("menu_items", {
  id: text("id").primaryKey(),
  displayName: text("display_name").notNull(),
  category: text("category").notNull(),
  priceInr: text("price_inr").notNull().default("0"),
  active: boolean("active").notNull().default(true),
  ...timestamps,
});

export const subscriptions = pgTable(
  "subscriptions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    planName: text("plan_name").notNull(),
    /** The catalogue plan (ADR-030); null for rows created before the catalogue existed. */
    planId: text("plan_id").references(() => plans.id, { onDelete: "set null" }),
    interval: text("interval", { enum: ["monthly", "quarterly", "yearly"] }),
    /** INR decimal strings: list price at the interval and what was actually paid (₹0 for a free activation). */
    priceInr: text("price_inr"),
    paidInr: text("paid_inr"),
    currency: text("currency").notNull().default("INR"),
    status: text("status", { enum: ["active", "expired", "cancelled"] }).notNull(),
    startsAt: timestamp("starts_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    /** Null = never expires. */
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }),
    featureLimits: jsonb("feature_limits")
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    ...timestamps,
  },
  (t) => [index("subscriptions_user_id_idx").on(t.userId)],
);

/** Append-only audit trail (spec "Trading safeguards"). UPDATE/DELETE are blocked by rules in the migration. */
export const auditLog = pgTable(
  "audit_log",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    actorId: text("actor_id"),
    action: text("action").notNull(),
    target: text("target").notNull(),
    before: jsonb("before").$type<unknown>(),
    after: jsonb("after").$type<unknown>(),
    ip: text("ip"),
    ua: text("ua"),
    at: timestamp("at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [index("audit_log_actor_id_idx").on(t.actorId), index("audit_log_target_idx").on(t.target)],
);


// ---------------------------------------------------------------------------------------------
// Strategies (Phase 3, ADR-024): drafts, paper trades, live trades and archived strategies
// ---------------------------------------------------------------------------------------------

export const strategies = pgTable(
  "strategies",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    asset: text("asset", { enum: ["BTC", "ETH", "XAUT"] }).notNull(),
    status: text("status", { enum: ["draft", "paper", "live", "archived"] }).notNull(),
    tradingMode: text("trading_mode", { enum: ["paper", "live"] }),
    templateName: text("template_name").notNull().default("Custom"),
    brokerId: text("broker_id").references(() => brokers.id, { onDelete: "set null" }),
    /**
     * The key (account) the strategy trades through (ADR-068). `restrict`: a key row cannot vanish underneath a
     * strategy and leave it to fall back to another sub-account; the route refuses the delete for live strategies
     * and clears the reference on the others first.
     */
    accountId: text("account_id").references(() => brokerCredentials.id, { onDelete: "restrict" }),
    /** Sum of realised leg P&L in USD, decimal string. */
    realizedPnl: text("realized_pnl").notNull().default("0"),
    notes: text("notes").notNull().default(""),
    tags: jsonb("tags").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    orderBatchId: text("order_batch_id"),
    startedAt: timestamp("started_at", { withTimezone: true, mode: "date" }),
    closedAt: timestamp("closed_at", { withTimezone: true, mode: "date" }),
    /** Why it closed (ADR-059 §2.4); null while active or for an archived draft. */
    closeReason: text("close_reason", { enum: ["expired", "squared_off", "stopped", "target", "outside_app"] }),
    /** ADR-065: the venue this row belongs to; every row so far is Delta India. */
    venue: text("venue", { enum: ["delta_india", "deribit"] }).notNull().default("delta_india"),
    ...timestamps,
  },
  (t) => [index("strategies_user_id_idx").on(t.userId), index("strategies_user_status_idx").on(t.userId, t.status)],
);

export const strategyLegs = pgTable(
  "strategy_legs",
  {
    id: text("id").primaryKey(),
    strategyId: text("strategy_id")
      .notNull()
      .references(() => strategies.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: ["call", "put", "future"] }).notNull(),
    side: text("side", { enum: ["buy", "sell"] }).notNull(),
    /** Venue-listed strike as a decimal string; empty for futures. */
    strike: text("strike").notNull().default(""),
    expiry: text("expiry").notNull(),
    symbol: text("symbol").notNull(),
    lots: integer("lots").notNull(),
    price: text("price").notNull(),
    entryPrice: text("entry_price"),
    exitPrice: text("exit_price"),
    iv: text("iv"),
    status: text("status", { enum: ["open", "squared_off"] }).notNull().default("open"),
    isAdjustment: boolean("is_adjustment").notNull().default(false),
    position: integer("position").notNull().default(0),
    openedAt: timestamp("opened_at", { withTimezone: true, mode: "date" }),
    closedAt: timestamp("closed_at", { withTimezone: true, mode: "date" }),
    closeReason: text("close_reason", { enum: ["expired", "squared_off", "stopped", "target", "outside_app"] }),
    orderId: text("order_id"),
    ...timestamps,
  },
  (t) => [index("strategy_legs_strategy_id_idx").on(t.strategyId)],
);

/** One P&L point per strategy per calendar day, upserted by the client's tick (HC-TR-076). */
export const strategyPnl = pgTable(
  "strategy_pnl",
  {
    strategyId: text("strategy_id")
      .notNull()
      .references(() => strategies.id, { onDelete: "cascade" }),
    day: text("day").notNull(),
    pnl: text("pnl").notNull(),
    ...timestamps,
  },
  (t) => [uniqueIndex("strategy_pnl_strategy_day_uq").on(t.strategyId, t.day)],
);

/** Venue orders behind live legs (ADR-025): one row per placement attempt outcome, keyed by the client order id. */
export const strategyOrders = pgTable(
  "strategy_orders",
  {
    id: text("id").primaryKey(),
    strategyId: text("strategy_id")
      .notNull()
      .references(() => strategies.id, { onDelete: "cascade" }),
    legId: text("leg_id")
      .notNull()
      .references(() => strategyLegs.id, { onDelete: "cascade" }),
    /** Batch this order was placed in (idempotency key of the placement). */
    batchId: text("batch_id").notNull(),
    purpose: text("purpose", { enum: ["entry", "exit", "adjustment"] }).notNull(),
    /** Market, or a limit at the reviewed mark (ADR-044 adjustment entries). */
    orderType: text("order_type", { enum: ["market", "limit"] }).notNull().default("market"),
    limitPrice: text("limit_price"),
    clientOrderId: text("client_order_id").notNull(),
    venueOrderId: text("venue_order_id"),
    productId: integer("product_id").notNull(),
    symbol: text("symbol").notNull(),
    side: text("side", { enum: ["buy", "sell"] }).notNull(),
    size: integer("size").notNull(),
    state: text("state", { enum: ["pending", "filled", "failed", "cancelled", "closed"] }).notNull(),
    fillPrice: text("fill_price"),
    error: text("error"),
    attempts: integer("attempts").notNull().default(1),
    ...timestamps,
  },
  (t) => [index("strategy_orders_strategy_id_idx").on(t.strategyId), uniqueIndex("strategy_orders_client_uq").on(t.clientOrderId)],
);

/** Adjustment batches on an active strategy (ADR-044): what changed, why, and the realised P&L of the closed lots. */
/** Stop and target rules on a strategy (ADR-059 §2.3): the engine fires them from the venue's marks. */
export const strategyRules = pgTable(
  "strategy_rules",
  {
    id: text("id").primaryKey(),
    strategyId: text("strategy_id")
      .notNull()
      .references(() => strategies.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: ["stop", "target", "leg_stop", "spot", "time"] }).notNull(),
    trigger: text("trigger", { enum: ["money", "pct", "multiple", "price", "above", "below", "at", "dte"] }).notNull(),
    value: text("value").notNull(),
    basis: text("basis", { enum: ["credit", "debit", "max_loss"] }),
    basisUsd: text("basis_usd"),
    /** The level in the kind's own unit (see StrategyRule.thresholdUsd). */
    thresholdUsd: text("threshold_usd").notNull(),
    /** The watched leg (leg_stop only). */
    legId: text("leg_id").references(() => strategyLegs.id, { onDelete: "cascade" }),
    scope: text("scope", { enum: ["strategy", "leg"] }).notNull().default("strategy"),
    channels: jsonb("channels").$type<string[]>().notNull().default(sql`'["push"]'::jsonb`),
    state: text("state", { enum: ["armed", "fired", "disarmed"] }).notNull().default("armed"),
    firedAt: timestamp("fired_at", { withTimezone: true }),
    firedPnl: text("fired_pnl"),
    outcome: text("outcome", { enum: ["closed", "partial"] }),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("strategy_rules_strategy_id_idx").on(t.strategyId), index("strategy_rules_state_idx").on(t.state)],
);

export const strategyAdjustments = pgTable(
  "strategy_adjustments",
  {
    id: text("id").primaryKey(),
    strategyId: text("strategy_id")
      .notNull()
      .references(() => strategies.id, { onDelete: "cascade" }),
    /** The caller's idempotency key, or `adj:<id>` when none was given; also the order batch id for live. Unique per strategy. */
    batchId: text("batch_id").notNull(),
    reason: text("reason"),
    added: integer("added").notNull().default(0),
    trimmed: integer("trimmed").notNull().default(0),
    closed: integer("closed").notNull().default(0),
    realizedPnl: text("realized_pnl").notNull().default("0"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("strategy_adjustments_strategy_id_idx").on(t.strategyId), uniqueIndex("strategy_adjustments_batch_uq").on(t.strategyId, t.batchId)],
);

/** Referral commissions (Phase 4 item 3, ADR-031): one row per referred subscription, settled by an admin. */
export const referralCommissions = pgTable(
  "referral_commissions",
  {
    id: text("id").primaryKey(),
    referrerId: text("referrer_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    referredUserId: text("referred_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    subscriptionId: text("subscription_id").references(() => subscriptions.id, { onDelete: "set null" }),
    planName: text("plan_name").notNull(),
    interval: text("interval", { enum: ["monthly", "quarterly", "yearly"] }),
    /** What the referred user paid (INR) and the commission on it at the referrer's percentage at that time. */
    amountInr: text("amount_inr").notNull().default("0"),
    commissionInr: text("commission_inr").notNull().default("0"),
    commissionPct: text("commission_pct").notNull().default("0"),
    status: text("status", { enum: ["paid", "pending", "not_paid"] }).notNull(),
    paidAt: timestamp("paid_at", { withTimezone: true, mode: "date" }),
    note: text("note"),
    proofUrl: text("proof_url"),
    ...timestamps,
  },
  (t) => [index("referral_commissions_referrer_idx").on(t.referrerId), uniqueIndex("referral_commissions_subscription_uq").on(t.subscriptionId)],
);

/** Raw bytes (banner images, ADR-033). drizzle has no bytea column, so a custom type maps Buffer <-> bytea. */
const bytea = customType<{ data: Buffer; driverData: Buffer | Uint8Array }>({
  dataType: () => "bytea",
  toDriver: (value) => value,
  fromDriver: (value) => Buffer.from(value),
});

/** Promotional banners (Phase 4 item 4b, ADR-033): scheduled popups with the image stored inline (≤ 5 MB). */
export const banners = pgTable("banners", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  description: text("description").notNull().default(""),
  linkUrl: text("link_url"),
  frequency: text("frequency", { enum: ["every_time", "once_per_session", "once_per_day"] }).notNull().default("once_per_day"),
  startsAt: timestamp("starts_at", { withTimezone: true, mode: "date" }),
  endsAt: timestamp("ends_at", { withTimezone: true, mode: "date" }),
  active: boolean("active").notNull().default(true),
  image: bytea("image").notNull(),
  imageType: text("image_type").notNull(),
  imageBytes: integer("image_bytes").notNull(),
  ...timestamps,
});

/** Discount coupons (Phase 4 item 2, ADR-034). Values are decimal strings; plan / interval scope as arrays. */
export const coupons = pgTable(
  "coupons",
  {
    id: text("id").primaryKey(),
    code: text("code").notNull(),
    description: text("description").notNull().default(""),
    discountType: text("discount_type", { enum: ["percent", "fixed"] }).notNull(),
    discountValue: text("discount_value").notNull(),
    minOrderInr: text("min_order_inr").notNull().default("0"),
    maxUses: integer("max_uses"),
    usedCount: integer("used_count").notNull().default(0),
    perUserLimit: integer("per_user_limit").notNull().default(1),
    startsAt: timestamp("starts_at", { withTimezone: true, mode: "date" }),
    endsAt: timestamp("ends_at", { withTimezone: true, mode: "date" }),
    scope: text("scope", { enum: ["public", "community"] }).notNull().default("public"),
    planIds: jsonb("plan_ids").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    intervals: jsonb("intervals").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    assignedUserIds: jsonb("assigned_user_ids").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    active: boolean("active").notNull().default(true),
    ...timestamps,
  },
  (t) => [uniqueIndex("coupons_code_uq").on(t.code)],
);

/** One row per checkout attempt (ADR-034): pending on order creation, paid after a verified confirmation or webhook. */
export const payments = pgTable(
  "payments",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    planId: text("plan_id").references(() => plans.id, { onDelete: "set null" }),
    planName: text("plan_name").notNull(),
    interval: text("interval", { enum: ["monthly", "quarterly", "yearly"] }).notNull(),
    listInr: text("list_inr").notNull(),
    planDiscountInr: text("plan_discount_inr").notNull().default("0.00"),
    couponId: text("coupon_id").references(() => coupons.id, { onDelete: "set null" }),
    couponCode: text("coupon_code"),
    couponDiscountInr: text("coupon_discount_inr").notNull().default("0.00"),
    taxInr: text("tax_inr").notNull().default("0.00"),
    amountInr: text("amount_inr").notNull(),
    status: text("status", { enum: ["paid", "pending", "failed"] }).notNull(),
    method: text("method"),
    orderId: text("order_id"),
    razorpayPaymentId: text("razorpay_payment_id"),
    failureReason: text("failure_reason"),
    invoiceNo: text("invoice_no"),
    subscriptionId: text("subscription_id").references(() => subscriptions.id, { onDelete: "set null" }),
    paidAt: timestamp("paid_at", { withTimezone: true, mode: "date" }),
    ...timestamps,
  },
  (t) => [index("payments_user_id_idx").on(t.userId), uniqueIndex("payments_order_id_uq").on(t.orderId), uniqueIndex("payments_rzp_payment_uq").on(t.razorpayPaymentId), uniqueIndex("payments_invoice_no_uq").on(t.invoiceNo)],
);

/** Promotional email campaigns (Phase 4 item 4c, ADR-035) and one delivery row per recipient. */
export const campaigns = pgTable("campaigns", {
  id: text("id").primaryKey(),
  subject: text("subject").notNull(),
  message: text("message").notNull(),
  segment: text("segment", { enum: ["all", "paid", "free", "expired"] }).notNull().default("all"),
  sentById: text("sent_by_id").references(() => users.id, { onDelete: "set null" }),
  sentBy: text("sent_by").notNull(),
  sentAt: timestamp("sent_at", { withTimezone: true, mode: "date" }).notNull(),
  recipients: integer("recipients").notNull().default(0),
  delivered: integer("delivered").notNull().default(0),
  failed: integer("failed").notNull().default(0),
  ...timestamps,
});

export const campaignRecipients = pgTable(
  "campaign_recipients",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    campaignId: text("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "cascade" }),
    userId: text("user_id").references(() => users.id, { onDelete: "set null" }),
    name: text("name").notNull(),
    email: text("email").notNull(),
    status: text("status", { enum: ["sent", "failed"] }).notNull(),
    sentAt: timestamp("sent_at", { withTimezone: true, mode: "date" }).notNull(),
    error: text("error"),
  },
  (t) => [index("campaign_recipients_campaign_idx").on(t.campaignId)],
);

/** Every table, for `drizzle(client, { schema })`; declared last so each table exists before it is referenced. */
/** Alerts (Phase 5 item 2, ADR-052): a trader's price / ATM IV / strategy P&L rules; the client evaluates, the server records and delivers. */
export const alerts = pgTable(
  "alerts",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: ["price", "iv", "pnl"] }).notNull(),
    asset: text("asset", { enum: ["BTC", "ETH", "XAUT"] }).notNull(),
    strategyId: text("strategy_id").references(() => strategies.id, { onDelete: "cascade" }),
    strategyName: text("strategy_name"),
    op: text("op", { enum: [">=", "<="] }).notNull(),
    value: text("value").notNull(),
    channels: jsonb("channels").$type<string[]>().notNull().default(sql`'["push"]'::jsonb`),
    state: text("state", { enum: ["armed", "triggered", "paused"] }).notNull().default("armed"),
    lastValue: text("last_value"),
    triggeredAt: timestamp("triggered_at", { withTimezone: true }),
    /** ADR-065: the venue this row belongs to; every row so far is Delta India. */
    venue: text("venue", { enum: ["delta_india", "deribit"] }).notNull().default("delta_india"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("alerts_user_id_idx").on(t.userId)],
);

/** IV history (ADR-056, GAPS #62): ATM IV per listed expiry with the spot, every snapshot; `front` marks the expiry the daily series follows. */
export const ivSnapshots = pgTable(
  "iv_snapshots",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    asset: text("asset", { enum: ["BTC", "ETH", "XAUT"] }).notNull(),
    expiry: text("expiry").notNull(),
    ts: timestamp("ts", { withTimezone: true }).notNull(),
    /** ATM implied volatility as a decimal fraction string ("0.42445"). */
    atmIv: text("atm_iv").notNull(),
    spot: text("spot").notNull(),
    atmStrike: text("atm_strike").notNull(),
    front: boolean("front").notNull().default(false),
    /** ADR-065: the venue this row belongs to; every row so far is Delta India. */
    venue: text("venue", { enum: ["delta_india", "deribit"] }).notNull().default("delta_india"),
  },
  (t) => [index("iv_snapshots_asset_ts_idx").on(t.venue, t.asset, t.ts), index("iv_snapshots_front_idx").on(t.venue, t.asset, t.front, t.ts)],
);

/** Per-option mark and mark IV every snapshot, 7 days (ADR-056, GAPS #32: the details sparkline). */
export const instrumentMarks = pgTable(
  "instrument_marks",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    asset: text("asset", { enum: ["BTC", "ETH", "XAUT"] }).notNull(),
    symbol: text("symbol").notNull(),
    ts: timestamp("ts", { withTimezone: true }).notNull(),
    mark: text("mark").notNull(),
    markIv: text("mark_iv"),
    /** ADR-065: the venue this row belongs to; every row so far is Delta India. */
    venue: text("venue", { enum: ["delta_india", "deribit"] }).notNull().default("delta_india"),
  },
  (t) => [index("instrument_marks_symbol_ts_idx").on(t.venue, t.symbol, t.ts), index("instrument_marks_ts_idx").on(t.ts)],
);

export const schema = {
  users,
  sessions,
  accounts,
  verifications,
  passkeys,
  userSettings,
  brokers,
  brokerCredentials,
  subscriptions,
  auditLog,
  strategies,
  strategyLegs,
  strategyPnl,
  strategyOrders,
  plans,
  menuItems,
  referralCommissions,
  banners,
  coupons,
  payments,
  campaigns,
  campaignRecipients,
  alerts,
  ivSnapshots,
  instrumentMarks,
};
export type Schema = typeof schema;

/**
 * Fills read from the venue per account (ADR-073): the trader's own trades, whether or not HapieCoin placed them;
 * verified P&L is computed from these alone. Disconnecting a key drops its fills (cascade); reconnecting re-reads
 * what the venue still offers.
 */
export const venueFills = pgTable(
  "venue_fills",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    accountId: text("account_id")
      .notNull()
      .references(() => brokerCredentials.id, { onDelete: "cascade" }),
    /** The venue's own fill id; unique per account. */
    venueFillId: text("venue_fill_id").notNull(),
    orderId: text("order_id"),
    productId: integer("product_id").notNull(),
    symbol: text("symbol"),
    side: text("side", { enum: ["buy", "sell"] }).notNull(),
    /** Contracts. */
    size: integer("size").notNull(),
    price: text("price").notNull(),
    commission: text("commission").notNull().default("0"),
    role: text("role"),
    /** The product's contract value looked up at ingest, while the product is still served; null when it was not. */
    contractValue: text("contract_value"),
    filledAt: timestamp("filled_at", { withTimezone: true, mode: "date" }).notNull(),
    /** The venue's row as received (the first live read settles the exact shape; disputes read it). */
    raw: jsonb("raw"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("venue_fills_account_fill_uq").on(t.accountId, t.venueFillId), index("venue_fills_user_filled_idx").on(t.userId, t.filledAt)],
);

/** Where the fills read of each account stands: when it last ran, the newest fill held, what went wrong. */
export const fillWatermarks = pgTable("fill_watermarks", {
  accountId: text("account_id")
    .primaryKey()
    .references(() => brokerCredentials.id, { onDelete: "cascade" }),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  lastReadAt: timestamp("last_read_at", { withTimezone: true, mode: "date" }).notNull(),
  lastFillAt: timestamp("last_fill_at", { withTimezone: true, mode: "date" }),
  fills: integer("fills").notNull().default(0),
  /** Where an earlier walk stopped on its page cap; the next pass carries on from here (older pages). */
  resumeAfter: text("resume_after"),
  /** Products whose venue position is not what the held fills add up to (opened before the read, or beyond the venue's history). */
  partialProducts: jsonb("partial_products").$type<number[]>().notNull().default(sql`'[]'::jsonb`),
  error: text("error"),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
});

/** The public trader page (ADR-075): a handle and what the page discloses; off until the trader turns it on. */
export const traderPages = pgTable(
  "trader_pages",
  {
    userId: text("user_id")
      .primaryKey()
      .references(() => users.id, { onDelete: "cascade" }),
    /** Lower-case, unique across users; null until chosen. */
    handle: text("handle"),
    enabled: boolean("enabled").notNull().default(false),
    showDays: boolean("show_days").notNull().default(false),
    showAccounts: boolean("show_accounts").notNull().default(false),
    showMonths: boolean("show_months").notNull().default(false),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("trader_pages_handle_uq").on(t.handle)],
);
