// Checkout, coupon and payment contracts (ADR-034): breakdown maths with percent and fixed coupons, paise, invoice
// numbers, and the coupon input rules.
import { describe, expect, it } from "vitest";
import { CouponBulkBody, CouponInput, breakdownFor, couponDiscountInr, invoiceNumber, toPaise } from "./payments.js";

const pro = { priceInr: "999", discountPriceInr: "849", limits: {} };
describe("HC-AC-021 breakdownFor", () => {
  it("applies the plan discount, then the coupon, then 18 % GST, as two-decimal strings", () => {
    expect(breakdownFor(pro)).toEqual({ list: "999.00", planDiscount: "150.00", couponDiscount: "0.00", subtotal: "849.00", tax: "152.82", total: "1001.82" });
    expect(breakdownFor(pro, { discountType: "percent", discountValue: "20" })).toMatchObject({ couponDiscount: "169.80", subtotal: "679.20", tax: "122.26", total: "801.46" });
    expect(breakdownFor(pro, { discountType: "fixed", discountValue: "500" })).toMatchObject({ couponDiscount: "500.00", subtotal: "349.00", total: "411.82" });
    expect(breakdownFor(pro, { discountType: "fixed", discountValue: "5000" })).toMatchObject({ couponDiscount: "849.00", subtotal: "0.00", tax: "0.00", total: "0.00" });
    expect(breakdownFor({ priceInr: "0", discountPriceInr: null, limits: {} })).toMatchObject({ total: "0.00" });
    expect(couponDiscountInr(100, null)).toBe(0);
    expect(toPaise("1001.82")).toBe(100182);
    expect(invoiceNumber(2026, 7)).toBe("INV-2026-0007");
  });
});

describe("HC-AD-035..041 CouponInput", () => {
  it("uppercases and validates the code, needs a plan, checks value ranges and the window", () => {
    const ok = CouponInput.parse({ code: "basic20", discountType: "percent", discountValue: "20", planIds: ["pln_basic"] });
    expect(ok).toMatchObject({ code: "BASIC20", scope: "public", intervals: ["monthly", "quarterly", "yearly"], perUserLimit: 1, maxUses: null, active: true });
    expect(CouponInput.safeParse({ code: "a", discountType: "percent", discountValue: "20", planIds: ["pln_basic"] }).success).toBe(false);
    expect(CouponInput.safeParse({ code: "BAD CODE", discountType: "percent", discountValue: "20", planIds: ["pln_basic"] }).success).toBe(false);
    expect(CouponInput.safeParse({ code: "PCT", discountType: "percent", discountValue: "120", planIds: ["pln_basic"] }).success).toBe(false);
    expect(CouponInput.safeParse({ code: "FIX", discountType: "fixed", discountValue: "0", planIds: ["pln_basic"] }).success).toBe(false);
    expect(CouponInput.safeParse({ code: "NOPLAN", discountType: "percent", discountValue: "10", planIds: [] }).success).toBe(false);
    expect(CouponInput.safeParse({ code: "WIN", discountType: "percent", discountValue: "10", planIds: ["pln_basic"], startsAt: "2026-02-01T00:00:00.000Z", endsAt: "2026-01-01T00:00:00.000Z" }).success).toBe(false);
    expect(CouponBulkBody.safeParse({ ids: ["cpn_1"], action: "delete" }).success).toBe(true);
    expect(CouponBulkBody.safeParse({ ids: [], action: "delete" }).success).toBe(false);
  });
});
