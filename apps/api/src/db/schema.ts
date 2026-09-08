/**
 * Drizzle schema. Property names on the Better Auth tables (users, sessions, accounts, verifications,
 * passkeys) must equal Better Auth's field names (camelCase) because the Drizzle adapter looks columns up
 * by property; the physical column names are snake_case.
 *
 * Money-shaped values (fee percentages, conversion rate, lot sizes) are stored as decimal strings in
 * text/jsonb columns, never as floats (brief: decimal strings cross package boundaries).
 */
import { sql } from "drizzle-orm";
import {
  bigserial,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

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
    apiKeyMasked: text("api_key_masked").notNull(),
    apiKeyCt: text("api_key_ct").notNull(),
    apiKeyIv: text("api_key_iv").notNull(),
    apiKeyTag: text("api_key_tag").notNull(),
    apiSecretCt: text("api_secret_ct").notNull(),
    apiSecretIv: text("api_secret_iv").notNull(),
    apiSecretTag: text("api_secret_tag").notNull(),
    connectedAt: timestamp("connected_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    whitelistedIp: text("whitelisted_ip").notNull(),
  },
  (t) => [
    uniqueIndex("broker_credentials_user_broker_uq").on(t.userId, t.brokerId),
    index("broker_credentials_broker_id_idx").on(t.brokerId),
  ],
);

/** Minimal subscription record for the plan banner (HC-SH-014). Payments (phase 4) will extend it. */
export const subscriptions = pgTable(
  "subscriptions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    planName: text("plan_name").notNull(),
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
    /** Sum of realised leg P&L in USD, decimal string. */
    realizedPnl: text("realized_pnl").notNull().default("0"),
    notes: text("notes").notNull().default(""),
    tags: jsonb("tags").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    orderBatchId: text("order_batch_id"),
    startedAt: timestamp("started_at", { withTimezone: true, mode: "date" }),
    closedAt: timestamp("closed_at", { withTimezone: true, mode: "date" }),
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

/** Every table, for `drizzle(client, { schema })`; declared last so each table exists before it is referenced. */
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
};
export type Schema = typeof schema;
