// Admin · User Management contracts (ADR-032): list query defaults, invite validation, comped plan bodies.
import { describe, expect, it } from "vitest";
import { AdminUsersQuery, AuditEntry, BulkPlanBody, InviteUserBody, SetPlanBody } from "./admin.js";
import { AdminUserPatch } from "./billing.js";

describe("HC-AD-086 / 094 / 099 AdminUsersQuery", () => {
  it("defaults to newest first, every plan and status, page 1", () => {
    expect(AdminUsersQuery.parse({})).toEqual({ status: "all", plan: "all", sort: "createdAt", dir: "desc", page: 1 });
    expect(AdminUsersQuery.parse({ q: " ria ", sort: "name", dir: "asc", page: "3", plan: "pln_pro", status: "expired" })).toMatchObject({ q: "ria", sort: "name", dir: "asc", page: 3, plan: "pln_pro", status: "expired" });
    expect(AdminUsersQuery.safeParse({ sort: "password" }).success).toBe(false);
    expect(AdminUsersQuery.safeParse({ page: 0 }).success).toBe(false);
  });
});

describe("HC-AD-108 InviteUserBody, HC-AD-100 / 104 plan bodies, HC-AD-103 patch", () => {
  it("validates the invitation, the plan bodies and the extended patch", () => {
    expect(InviteUserBody.safeParse({ name: "Pat", email: "pat@hapiecoin.test" }).success).toBe(true);
    expect(InviteUserBody.safeParse({ name: "", email: "pat@hapiecoin.test" }).success).toBe(false);
    expect(InviteUserBody.safeParse({ name: "Pat", email: "not-an-email" }).success).toBe(false);
    expect(InviteUserBody.safeParse({ name: "Pat", email: "pat@hapiecoin.test", mobile: "12" }).success).toBe(false);
    expect(SetPlanBody.safeParse({ planId: "pln_pro", interval: "yearly" }).success).toBe(true);
    expect(BulkPlanBody.safeParse({ ids: [], planId: "pln_pro", interval: "yearly" }).success).toBe(false);
    expect(AdminUserPatch.safeParse({ role: "admin" }).success).toBe(true);
    expect(AdminUserPatch.safeParse({ role: "owner" }).success).toBe(false);
    expect(AdminUserPatch.safeParse({ mobile: null, name: "Renamed" }).success).toBe(true);
    expect(AuditEntry.safeParse({ id: 1, action: "admin.user.update", target: "user:usr_1", actorId: null, actorEmail: null, at: "2026-09-08T00:00:00.000Z", after: null }).success).toBe(true);
  });
});
