// Referral and commission contracts (ADR-031): commission maths, month keys, and the Not Paid reason rule.
import { describe, expect, it } from "vitest";
import { AdminCommissionsView, BulkPayBody, COMMISSION_LABELS, MarkPaymentBody, ReferralsView, commissionFor, monthKey } from "./referrals.js";

describe("HC-AC-043 / HC-AD-052 commissionFor", () => {
  it("is the referrer's percentage of what was paid, two decimals, never negative", () => {
    expect(commissionFor("849", "20")).toBe("169.80");
    expect(commissionFor("999", "12.5")).toBe("124.88");
    expect(commissionFor("0", "20")).toBe("0");
    expect(commissionFor("849", "0")).toBe("0");
    expect(commissionFor("-5", "20")).toBe("0");
    expect(commissionFor("abc", "20")).toBe("0");
    expect(commissionFor("849", "NaN")).toBe("0");
  });
});

describe("HC-AC-067 monthKey", () => {
  it("keys by UTC year and month from an ISO string or a Date", () => {
    expect(monthKey("2026-09-08T23:30:00Z")).toBe("2026-09");
    expect(monthKey(new Date(Date.UTC(2026, 0, 1)))).toBe("2026-01");
  });
});

describe("HC-AD-055 MarkPaymentBody", () => {
  it("requires a note when not paying; accepts an optional proof URL", () => {
    expect(MarkPaymentBody.safeParse({ status: "paid" }).success).toBe(true);
    expect(MarkPaymentBody.safeParse({ status: "not_paid" }).success).toBe(false);
    expect(MarkPaymentBody.safeParse({ status: "not_paid", note: "" }).success).toBe(false);
    expect(MarkPaymentBody.safeParse({ status: "not_paid", note: "bank details missing", proofUrl: "https://example.com/t/1" }).success).toBe(true);
    expect(MarkPaymentBody.safeParse({ status: "paid", proofUrl: "not a url" }).success).toBe(false);
    expect(BulkPayBody.safeParse({}).success).toBe(true);
    expect(BulkPayBody.safeParse({ referrerIds: ["usr_1"] }).success).toBe(true);
  });
});

describe("views", () => {
  it("parse the referrer and admin views and label every status", () => {
    const row = { userId: "usr_1", name: "Sam", email: "sam@hapiecoin.test", joinedAt: "2026-09-01T00:00:00.000Z", planName: "Pro", interval: "monthly", amountInr: "849", commissionInr: "169.80", status: "pending", month: "2026-09" };
    const view = ReferralsView.parse({ code: "ASHA2026", link: "https://hapiecoin.com/auth?tab=signup&ref=ASHA2026", commissionPct: "20", stats: { referrals: 1, earnedInr: "169.80", paidInr: "0.00", pendingInr: "169.80" }, rows: [row], byMonth: [{ month: "2026-09", paidInr: "0.00", pendingInr: "169.80" }] });
    expect(view.rows[0]?.status).toBe("pending");
    const admin = AdminCommissionsView.parse({ tiles: { totalInr: "169.80", paidInr: "0.00", pendingInr: "169.80" }, rows: [{ referrerId: "usr_0", name: "Ria", email: "ria@hapiecoin.test", referrals: 1, commissionPct: "20", totalInr: "169.80", paidInr: "0.00", pendingInr: "169.80", status: "pending", lastNote: null }], byMonth: [], months: ["2026-09"] });
    expect(admin.rows[0]?.name).toBe("Ria");
    expect(Object.keys(COMMISSION_LABELS).sort()).toEqual(["not_paid", "paid", "pending"]);
  });
});
