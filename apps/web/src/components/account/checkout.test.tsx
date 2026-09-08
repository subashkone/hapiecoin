// Subscribe dialog with coupons and the mock checkout, payment history and the invoice (HC-AC-016..036, 060..065;
// ADR-034) against the mock API; plus the fetchers and the checkout.js loader.
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installMockFetch, renderWithProviders, type MockFetch } from "../../../test/helpers";
import { createApiClient } from "@/lib/api/client";
import { CHECKOUT_JS, type RazorpaySuccess, loadCheckoutJs, openRazorpay, paymentFetchers } from "@/lib/api/payments";
import { InvoiceDialog, PaymentHistory, invoiceText, paymentsCsv } from "./PaymentHistory";
import { SubscriptionPage } from "./SubscriptionPage";

const USER = "buyer@example.com";
let mock: MockFetch;
beforeEach(() => {
  mock = installMockFetch();
});
afterEach(() => mock.restore());
const clipboard = () => navigator.clipboard.readText();

async function seed(email: string, extra: Record<string, unknown>) {
  const res = await mock.app.request("http://localhost/__test/seed", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, ...extra }) });
  expect(res.status).toBe(200);
}

describe("HC-AC-016..026 subscribe with coupons and the mock checkout", () => {
  it("quotes a coupon, shows the chip and the recalculated total, pays through the mock checkout and activates the plan", async () => {
    await seed(USER, { plan: { state: "free" }, coupons: true });
    mock.loginAs(USER);
    mock.state.accounts.get(USER)!.subscription = null;
    const u = userEvent.setup();
    renderWithProviders(<SubscriptionPage />);
    await waitFor(() => expect(screen.getByTestId("subscription-page").dataset["state"]).toBe("ready"));
    await u.click(screen.getAllByTestId("plan-card")[2]!.querySelector("[data-testid=plan-action]")!); // Pro monthly
    await waitFor(() => expect(screen.getByTestId("subscribe-dialog")).toBeTruthy());
    expect(screen.getByTestId("price-total").textContent).toBe("₹1,001.82");
    await waitFor(() => expect(screen.getAllByTestId("coupon-option").length).toBeGreaterThan(0));
    const options = screen.getAllByTestId("coupon-option");
    expect(options.find((o) => o.dataset["code"] === "PRO500")?.dataset["applicable"]).toBe("false"); // yearly only
    expect(options.find((o) => o.dataset["code"] === "COMMUNITY25")?.dataset["applicable"]).toBe("false"); // quarterly / yearly only
    await u.type(screen.getByTestId("coupon-input"), "nope{Enter}");
    await waitFor(() => expect(screen.getByTestId("coupon-error").textContent).toBe("Invalid coupon"));
    await u.clear(screen.getByTestId("coupon-input"));
    await u.type(screen.getByTestId("coupon-input"), "basic20");
    await u.click(screen.getByTestId("coupon-apply"));
    await waitFor(() => expect(screen.getByTestId("coupon-chip").textContent).toContain("BASIC20"));
    expect(screen.getByTestId("price-total").textContent).toBe("₹801.46");
    await u.click(screen.getByTestId("coupon-remove"));
    expect(screen.getByTestId("price-total").textContent).toBe("₹1,001.82");
    await u.click(options.find((o) => o.dataset["code"] === "BASIC20")!);
    await waitFor(() => expect(screen.getByTestId("coupon-chip")).toBeTruthy());
    await u.click(screen.getByTestId("subscribe-pay"));
    await waitFor(() => expect(screen.getByTestId("mock-checkout")).toBeTruthy());
    expect(screen.getByTestId("mock-checkout").textContent).toContain("₹801.46");
    await u.click(screen.getByTestId("mock-method-card"));
    await u.click(screen.getByTestId("mock-pay"));
    await waitFor(() => expect(screen.queryByTestId("subscribe-dialog")).toBeNull(), { timeout: 3_000 });
    await waitFor(() => expect(screen.getByTestId("sub-plan-name").textContent).toBe("Pro"));
    const pay = mock.state.payments[0]!;
    expect(pay).toMatchObject({ status: "paid", couponCode: "BASIC20", amountInr: "801.46", method: "card" });
    expect(pay.invoiceNo).toMatch(/^INV-2026-\d{4}$/);
    expect(mock.state.coupons.find((c) => c.code === "BASIC20")?.usedCount).toBe(38);
    // history shows the row with its invoice
    await waitFor(() => expect(screen.getByTestId("payment-history").dataset["count"]).toBe("1"));
    expect(screen.getByTestId("payment-row").dataset["status"]).toBe("paid");
    await u.click(screen.getByTestId("payment-invoice"));
    await waitFor(() => expect(screen.getByTestId("invoice-dialog").dataset["stateLoad"]).toBe("ready"));
    expect(screen.getByTestId("invoice-lines").textContent).toContain("BASIC20");
    expect(screen.getByTestId("invoice").textContent).toContain("CGST 9%");
    await u.click(screen.getByTestId("invoice-copy"));
    expect(await clipboard()).toContain("TAX INVOICE INV-2026-");
  });

  it("cancel, failure and confirmation failure each leave the right row and toast; a ₹0 total activates", async () => {
    await seed(USER, { plan: { state: "free" }, coupons: true });
    mock.loginAs(USER);
    mock.state.accounts.get(USER)!.subscription = null;
    const u = userEvent.setup();
    renderWithProviders(<SubscriptionPage />);
    await waitFor(() => expect(screen.getByTestId("subscription-page").dataset["state"]).toBe("ready"));
    await u.click(screen.getAllByTestId("plan-card")[1]!.querySelector("[data-testid=plan-action]")!); // Basic monthly
    await waitFor(() => expect(screen.getByTestId("subscribe-dialog")).toBeTruthy());
    await u.click(screen.getByTestId("subscribe-pay"));
    await waitFor(() => expect(screen.getByTestId("mock-checkout")).toBeTruthy());
    await u.keyboard("{Escape}"); // closing the mock checkout counts as a cancel
    await waitFor(() => expect(screen.getAllByText("Payment cancelled").length).toBeGreaterThan(0));
    await waitFor(() => expect(screen.queryByTestId("mock-checkout")).toBeNull());
    await u.click(screen.getByTestId("subscribe-pay"));
    await waitFor(() => expect(screen.getByTestId("mock-checkout")).toBeTruthy());
    await u.click(screen.getByTestId("mock-cancel"));
    await waitFor(() => expect(mock.state.payments[0]?.status).toBe("failed"));
    expect(screen.getByTestId("subscribe-dialog")).toBeTruthy(); // the dialog stays open to try again
    await u.click(screen.getByTestId("subscribe-pay"));
    await waitFor(() => expect(screen.getByTestId("mock-checkout")).toBeTruthy());
    await u.click(screen.getByTestId("mock-fail"));
    await waitFor(() => expect(screen.getAllByText("Payment failed").length).toBeGreaterThan(0), { timeout: 3_000 });
    await u.click(screen.getByTestId("subscribe-pay"));
    await waitFor(() => expect(screen.getByTestId("mock-checkout")).toBeTruthy());
    await u.click(screen.getByTestId("mock-confirm-fail"));
    await waitFor(() => expect(screen.getByText("Confirmation failed")).toBeTruthy(), { timeout: 3_000 });
    expect(mock.state.payments.filter((p) => p.status === "failed")).toHaveLength(4);
    // a 100 % coupon makes Activate appear
    const full = { ...mock.state.coupons[0]!, id: "cpn_full", code: "FULL", discountType: "percent" as const, discountValue: "100", planIds: ["pln_basic"], intervals: ["monthly" as const], usedCount: 0, maxUses: null };
    mock.state.coupons.push(full);
    await u.type(screen.getByTestId("coupon-input"), "FULL{Enter}");
    await waitFor(() => expect(screen.getByTestId("price-total").textContent).toBe("₹0.00"));
    mock.state.accounts.get(USER)!.active = false; // a deactivated account is refused
    await u.click(screen.getByTestId("subscribe-activate"));
    await waitFor(() => expect(screen.getAllByText("Activation failed").length).toBeGreaterThan(0));
    mock.state.accounts.get(USER)!.active = true;
    await u.click(screen.getByTestId("subscribe-activate"));
    await waitFor(() => expect(screen.queryByTestId("subscribe-dialog")).toBeNull());
    await waitFor(() => expect(screen.getByTestId("sub-plan-name").textContent).toBe("Basic"));
    expect(mock.state.payments[0]).toMatchObject({ status: "paid", amountInr: "0.00", method: "coupon", couponCode: "FULL" });
  });
});

type RzOpts = { order_id: string; handler: (r: RazorpaySuccess) => void; modal?: { ondismiss?: () => void } };
/** A stand-in for window.Razorpay: `behave` decides what the checkout does when opened. */
function stubRazorpay(behave: (opts: RzOpts, fail: (reason: string) => void) => void) {
  const w = window as unknown as { Razorpay?: unknown };
  w.Razorpay = class {
    private failed: ((e: { error?: { description?: string } }) => void) | null = null;
    constructor(private readonly opts: RzOpts) {}
    on(_ev: string, cb: (e: { error?: { description?: string } }) => void) {
      this.failed = cb;
    }
    open() {
      behave(this.opts, (reason) => this.failed?.({ error: { description: reason } }));
    }
  };
  return () => {
    delete w.Razorpay;
  };
}

describe("HC-AC-022, 025..029 real checkout.js path", () => {
  it("opens Razorpay with the API order, confirms on the handler, and reports dismiss, failure and SDK errors", async () => {
    await seed(USER, { plan: { state: "free" } });
    mock.loginAs(USER);
    mock.state.accounts.get(USER)!.subscription = null;
    mock.state.checkoutMode = "razorpay";
    const u = userEvent.setup();
    renderWithProviders(<SubscriptionPage />);
    await waitFor(() => expect(screen.getByTestId("subscription-page").dataset["state"]).toBe("ready"));
    await u.click(screen.getAllByTestId("plan-card")[2]!.querySelector("[data-testid=plan-action]")!);
    await waitFor(() => expect(screen.getByTestId("subscribe-dialog")).toBeTruthy());
    // 1. dismissed
    let restore = stubRazorpay((o) => o.modal?.ondismiss?.());
    await u.click(screen.getByTestId("subscribe-pay"));
    await waitFor(() => expect(screen.getAllByText("Payment cancelled").length).toBeGreaterThan(0));
    await waitFor(() => expect(mock.state.payments[0]?.status).toBe("failed"));
    restore();
    // 2. payment.failed
    restore = stubRazorpay((_o, fail) => fail("Card declined"));
    await u.click(screen.getByTestId("subscribe-pay"));
    await waitFor(() => expect(screen.getAllByText("Payment failed").length).toBeGreaterThan(0));
    restore();
    // 3. success: the handler payload is confirmed with the mock server's signature
    restore = stubRazorpay((o) => o.handler({ razorpay_order_id: o.order_id, razorpay_payment_id: "pay_real_upi", razorpay_signature: "mock-sig" }));
    await u.click(screen.getByTestId("subscribe-pay"));
    await waitFor(() => expect(screen.queryByTestId("subscribe-dialog")).toBeNull(), { timeout: 3_000 });
    await waitFor(() => expect(screen.getByTestId("sub-plan-name").textContent).toBe("Pro"));
    expect(mock.state.payments.find((p) => p.status === "paid")?.razorpayPaymentId).toBe("pay_real_upi");
    restore();
    // 4. SDK cannot load: no window.Razorpay and the script errors
    await u.click(screen.getAllByTestId("plan-card")[3]!.querySelector("[data-testid=plan-action]")!);
    await waitFor(() => expect(screen.getByTestId("subscribe-dialog")).toBeTruthy());
    await u.click(screen.getByTestId("subscribe-pay"));
    await waitFor(() => expect(document.querySelector(`script[src="${CHECKOUT_JS}"]`)).toBeTruthy());
    fireEvent(document.querySelector(`script[src="${CHECKOUT_JS}"]`)!, new Event("error"));
    await waitFor(() => expect(screen.getAllByText("Failed to load Razorpay SDK").length).toBeGreaterThan(0));
    document.querySelector(`script[src="${CHECKOUT_JS}"]`)?.remove();
    mock.state.checkoutMode = "mock";
  });

  it("openRazorpay resolves with the handler payload and rejects on dismiss and failure", async () => {
    const order = { mode: "razorpay" as const, paymentId: "pay_1", orderId: "order_1", keyId: "k", amountPaise: 100, currency: "INR" as const, name: "HapieCoin", description: "d", prefill: { name: "n", email: "e" }, breakdown: { list: "1.00", planDiscount: "0.00", couponDiscount: "0.00", subtotal: "1.00", tax: "0.00", total: "1.00" } };
    let restore = stubRazorpay((o) => o.handler({ razorpay_order_id: o.order_id, razorpay_payment_id: "p", razorpay_signature: "s" }));
    await expect(openRazorpay(order)).resolves.toMatchObject({ razorpay_payment_id: "p" });
    restore();
    restore = stubRazorpay((o) => o.modal?.ondismiss?.());
    await expect(openRazorpay(order)).rejects.toThrow("dismissed");
    restore();
    restore = stubRazorpay((_o, fail) => fail("nope"));
    await expect(openRazorpay(order)).rejects.toThrow("nope");
    restore();
  });
});

describe("HC-AC-031..035, 060..064 payment history", () => {
  it("chips with counts filter, pages five at a time, copies CSV, opens the invoice, shows failure reasons", async () => {
    await seed(USER, { payments: 7 });
    mock.loginAs(USER);
    const u = userEvent.setup();
    renderWithProviders(<PaymentHistory />);
    await waitFor(() => expect(screen.getByTestId("payment-history").dataset["state"]).toBe("ready"));
    expect(screen.getAllByTestId("payment-row")).toHaveLength(5);
    expect(screen.getByTestId("payment-chip-failed").textContent).toContain("2");
    expect(screen.getByTestId("payments-pager").textContent).toContain("Page 1 of 2");
    await u.click(screen.getByText("Next →"));
    await waitFor(() => expect(screen.getAllByTestId("payment-row")).toHaveLength(2));
    await u.click(screen.getByTestId("payment-chip-failed"));
    await waitFor(() => expect(screen.getAllByTestId("payment-row")).toHaveLength(2));
    expect(screen.getAllByTestId("payment-row")[0]!.textContent).toContain("Bank declined");
    await u.click(screen.getByTestId("payment-chip-pending"));
    await waitFor(() => expect(screen.getAllByTestId("payment-row")).toHaveLength(1));
    await u.click(screen.getByTestId("payments-csv"));
    expect((await clipboard()).split("\n")).toHaveLength(2);
    await u.click(screen.getByTestId("payment-chip-all"));
    await waitFor(() => expect(screen.getAllByTestId("payment-row")).toHaveLength(5));
    await u.click(screen.getAllByTestId("payment-invoice")[0]!);
    await waitFor(() => expect(screen.getByTestId("invoice-dialog").dataset["stateLoad"]).toBe("ready"));
    expect(screen.getByTestId("invoice").textContent).toContain("Pro plan · yearly");
    await u.click(screen.getByTestId("invoice-download"));
    await waitFor(() => expect(screen.getByText(/downloaded/)).toBeTruthy());
  });

  it("shows the empty state, a filtered-empty state with Show all, and an unavailable invoice", async () => {
    mock.loginAs("fresh@example.com");
    const u = userEvent.setup();
    const browse = vi.fn();
    const view = renderWithProviders(<PaymentHistory onBrowsePlans={browse} />);
    await waitFor(() => expect(screen.getByTestId("payments-empty")).toBeTruthy());
    await u.click(screen.getByText("Browse plans"));
    expect(browse).toHaveBeenCalled();
    view.unmount();
    mock.restore();
    mock = installMockFetch(); // nobody signed in → error state with Retry
    const errView = renderWithProviders(<PaymentHistory />);
    await waitFor(() => expect(screen.getByTestId("payment-history").dataset["state"]).toBe("error"));
    await u.click(screen.getByText("Retry"));
    await waitFor(() => expect(screen.getByTestId("payment-history").dataset["state"]).toBe("error"));
    errView.unmount();
    await seed(USER, { payments: 2 }); // two paid rows
    mock.loginAs(USER);
    renderWithProviders(<PaymentHistory />);
    await waitFor(() => expect(screen.getAllByTestId("payment-row")).toHaveLength(2));
    await u.click(screen.getByTestId("payment-chip-failed"));
    await waitFor(() => expect(screen.getByTestId("payments-empty-filtered")).toBeTruthy());
    await u.click(screen.getByText("Show all"));
    await waitFor(() => expect(screen.getAllByTestId("payment-row")).toHaveLength(2));
    const dlg = renderWithProviders(<InvoiceDialog paymentId="pay_nope" onOpenChange={() => undefined} />);
    await waitFor(() => expect(within(dlg.container.ownerDocument.body).getAllByTestId("invoice-dialog").at(-1)?.dataset["stateLoad"]).toBe("error"));
  });
});

describe("[API] payment fetchers, helpers and the checkout.js loader", () => {
  it("round-trips coupons, checkout, confirm, cancel, payments and invoice; renders CSV and invoice text; loads the script", async () => {
    await seed(USER, { coupons: true });
    mock.loginAs(USER);
    mock.state.accounts.get(USER)!.subscription = null;
    const f = paymentFetchers(createApiClient());
    expect((await f.coupons("pln_pro", "yearly")).items.map((c) => c.code)).toEqual(["BASIC20", "PRO500", "COMMUNITY25"]);
    expect((await f.quote("pro500", "pln_pro", "yearly")).breakdown.couponDiscount).toBe("500.00");
    const order = await f.checkout("pln_pro", "yearly", "PRO500");
    expect(order.mode).toBe("mock");
    const cancelled = await f.cancel({ orderId: order.orderId });
    expect(cancelled.status).toBe("failed");
    const order2 = await f.checkout("pln_pro", "yearly");
    const done = await f.confirm({ razorpay_order_id: order2.orderId, razorpay_payment_id: "pay_mock_upi_1", razorpay_signature: "mock-sig" });
    expect(done.activated).toBe(true);
    const page = await f.payments("all", 1);
    expect(page.counts).toEqual({ all: 2, paid: 1, pending: 0, failed: 1 });
    const inv = await f.invoice(done.payment.id);
    expect(inv.lines.totalInr).toBe(done.payment.amountInr);
    expect(paymentsCsv(page.items).split("\n")).toHaveLength(3);
    expect(invoiceText(inv)).toContain(`TAX INVOICE ${inv.no}`);
    // admin coupon fetchers
    mock.loginAs("boss@example.com", { role: "admin" });
    const created = await f.createCoupon({ code: "NEW5", description: "", discountType: "fixed", discountValue: "5", minOrderInr: "0", maxUses: null, perUserLimit: 1, startsAt: null, endsAt: null, scope: "public", planIds: ["pln_pro"], intervals: ["monthly"], assignedUserIds: [], active: true });
    expect((await f.switchCoupon(created.id, false)).active).toBe(false);
    expect((await f.replaceCoupon(created.id, { code: "NEW5", description: "x", discountType: "fixed", discountValue: "6", minOrderInr: "0", maxUses: null, perUserLimit: 1, startsAt: null, endsAt: null, scope: "public", planIds: ["pln_pro"], intervals: ["monthly"], assignedUserIds: [], active: true })).discountValue).toBe("6");
    expect(await f.bulkCoupons({ ids: [created.id], action: "deactivate" })).toEqual({ updated: 1 });
    await f.deleteCoupon(created.id);
    expect((await f.adminCoupons()).items.some((c) => c.id === created.id)).toBe(false);
    // checkout.js loader: resolves when the script tag fires load with window.Razorpay set, rejects on error
    const w = window as unknown as { Razorpay?: unknown };
    const p = loadCheckoutJs();
    const script = document.querySelector<HTMLScriptElement>(`script[src="${CHECKOUT_JS}"]`)!;
    expect(script).toBeTruthy();
    w.Razorpay = vi.fn();
    script.dispatchEvent(new Event("load"));
    await expect(p).resolves.toBe(w.Razorpay);
    delete w.Razorpay;
    const p2 = loadCheckoutJs();
    fireEvent(document.querySelector(`script[src="${CHECKOUT_JS}"]`)!, new Event("error"));
    await expect(p2).rejects.toThrow(/Razorpay SDK/);
    document.querySelector(`script[src="${CHECKOUT_JS}"]`)?.remove();
  });
});
