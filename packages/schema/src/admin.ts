// Admin · User Management (Phase 4 item 4a, ADR-032; docs/design/admin.md): list query, user detail, comped plan
// changes, invitations and the audit trail an admin sees. Money is INR decimal strings; dates ISO.
import { z } from "zod";
import { Id, Mobile } from "./accounts.js";
import { AdminUserRow, BillingInterval, PlanLimits } from "./billing.js";
import { DecimalString, IsoDateTime } from "./primitives.js";
import { ReferralRow } from "./referrals.js";

export const AdminUsersSort = z.enum(["createdAt", "name", "email", "planName", "startsAt", "expiresAt", "paidInr", "lastLoginAt"]);
export type AdminUsersSort = z.infer<typeof AdminUsersSort>;
export const AdminUsersStatus = z.enum(["all", "active", "expired", "free", "deactivated"]);
export type AdminUsersStatus = z.infer<typeof AdminUsersStatus>;
/** Query of GET /v1/admin/users (HC-AD-086, 089, 094, 099). */
export const AdminUsersQuery = z.object({
  q: z.string().trim().max(80).optional(),
  status: AdminUsersStatus.default("all"),
  /** Catalogue plan id, "free" for users without a plan, or "all". */
  plan: z.string().trim().max(40).default("all"),
  sort: AdminUsersSort.default("createdAt"),
  dir: z.enum(["asc", "desc"]).default("desc"),
  page: z.coerce.number().int().min(1).default(1),
});
export type AdminUsersQuery = z.infer<typeof AdminUsersQuery>;

/** One audit-log line as shown in the drawer's History tab (HC-AD-090). */
export const AuditEntry = z.strictObject({
  id: z.number().int(),
  action: z.string(),
  target: z.string(),
  actorId: Id.nullable(),
  actorEmail: z.string().nullable(),
  at: IsoDateTime,
  after: z.unknown().nullable(),
});
export type AuditEntry = z.infer<typeof AuditEntry>;

export const AdminUserSubscription = z.strictObject({
  id: Id,
  planId: Id.nullable(),
  planName: z.string(),
  interval: BillingInterval.nullable(),
  status: z.enum(["active", "expired", "cancelled"]),
  startsAt: IsoDateTime,
  expiresAt: IsoDateTime.nullable(),
  validityDays: z.number().int().nullable(),
  daysLeft: z.number().int().nullable(),
  priceInr: DecimalString.nullable(),
  paidInr: DecimalString.nullable(),
});
export type AdminUserSubscription = z.infer<typeof AdminUserSubscription>;

/** GET /v1/admin/users/{id} (HC-AD-101..107). */
export const AdminUserDetail = z.strictObject({
  user: AdminUserRow,
  subscription: AdminUserSubscription.nullable(),
  /** Every subscription the user ever had, newest first (Subscription tab history). */
  subscriptions: z.array(AdminUserSubscription),
  /** The limits of the plan the user is on (or the Free plan), for the hint under each override field. */
  planDefaults: z.strictObject({ planName: z.string(), limits: PlanLimits }),
  referrals: z.strictObject({ code: z.string(), commissionPct: DecimalString, count: z.number().int(), earnedInr: DecimalString, paidInr: DecimalString, pendingInr: DecimalString, rows: z.array(ReferralRow) }),
  history: z.array(AuditEntry),
});
export type AdminUserDetail = z.infer<typeof AdminUserDetail>;

/** POST /v1/admin/users/{id}/plan — a plan comped by an admin at ₹0 (HC-AD-104). */
export const SetPlanBody = z.strictObject({ planId: Id, interval: BillingInterval });
export type SetPlanBody = z.infer<typeof SetPlanBody>;
/** POST /v1/admin/users/bulk-plan (HC-AD-100). */
export const BulkPlanBody = z.strictObject({ ids: z.array(Id).min(1).max(500), planId: Id, interval: BillingInterval });
export type BulkPlanBody = z.infer<typeof BulkPlanBody>;
export const BulkPlanResult = z.strictObject({ updated: z.number().int(), planName: z.string() });
export type BulkPlanResult = z.infer<typeof BulkPlanResult>;

/** POST /v1/admin/users/invite (HC-AD-108): creates the user and emails a sign-in invitation. */
export const InviteUserBody = z.strictObject({
  name: z.string().trim().min(1).max(100),
  email: z.email().max(200),
  mobile: Mobile.optional(),
  planId: Id.optional(),
  interval: BillingInterval.optional(),
});
export type InviteUserBody = z.infer<typeof InviteUserBody>;
