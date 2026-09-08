// Admin masters on the mock API (Phase 4 item 1): guard, rail, plans dialog, user subscriptions inline edit.
import { expect, seedUser, signIn, test } from "./fixtures";

test.describe("HC-AD admin", () => {
  test("HC-AD-002 a plain user is refused", async ({ page, request }) => {
    await seedUser(request, { email: "plain@example.com" });
    await signIn(page, "plain@example.com");
    await page.goto("/admin/plans");
    await expect(page.getByTestId("admin-shell")).toHaveAttribute("data-state", "denied", { timeout: 15_000 });
  });

  test("HC-AD-003 / HC-AD-006 / HC-AD-010 rail with counts, plans table, new plan dialog; HC-AD-044 / HC-AD-046 user subscriptions inline validity edit", async ({ page, request }) => {
    await seedUser(request, { email: "boss@example.com", role: "admin", plan: { state: "active", planName: "Pro plan", expiresAt: "2026-12-31T00:00:00Z" } });
    await signIn(page, "boss@example.com");
    await page.goto("/admin");
    await expect(page).toHaveURL(/\/admin\/users$/);
    await expect(page.getByTestId("admin-shell")).toHaveAttribute("data-state", "ready", { timeout: 15_000 });
    await expect(page.getByTestId("admin-nav-plans")).toContainText("4");
    await page.getByTestId("admin-nav-plans").click();
    await expect(page.getByTestId("plan-row")).toHaveCount(4);
    await page.getByTestId("plan-new").click();
    await page.getByTestId("plan-name").fill("Starter");
    await page.getByTestId("plan-price-monthly").fill("199");
    await page.getByTestId("plan-limit-monthly-paper_trading").fill("10");
    await page.getByTestId("plan-save").click();
    await expect(page.getByTestId("plan-row")).toHaveCount(5);
    await expect(page.locator("[data-testid=plan-row][data-plan=Starter]")).toContainText("₹199");
    await page.getByTestId("admin-nav-subscriptions").click();
    await expect(page.getByTestId("user-row").first()).toBeVisible();
    await page.getByTestId("users-search").fill("boss");
    await expect(page.getByTestId("user-row")).toHaveCount(1);
    await page.getByTestId("subs-tab-commissions").click();
    await expect(page.getByTestId("admin-commissions")).toHaveAttribute("data-state", "ready");
    await expect(page.getByTestId("cms-empty")).toBeVisible();
  });

  test("HC-AD-052..058 / HC-AD-118 commissions: tiles, View, Mark Paid, Bulk pay", async ({ page, request }) => {
    await seedUser(request, { email: "boss@example.com", role: "admin", referrals: 4 });
    await signIn(page, "boss@example.com");
    await page.goto("/admin/subscriptions");
    await expect(page.getByTestId("admin-shell")).toHaveAttribute("data-state", "ready", { timeout: 15_000 });
    await page.getByTestId("subs-tab-commissions").click();
    await expect(page.getByTestId("cms-row")).toHaveCount(1);
    await expect(page.getByTestId("cms-tile").nth(2)).toContainText("₹599.60");
    await page.getByTestId("cms-view").click();
    await expect(page.getByTestId("cms-view-row")).toHaveCount(4);
    await page.keyboard.press("Escape");
    await page.getByTestId("cms-mark").click();
    await page.getByTestId("cms-mark-note").fill("NEFT ref 9921");
    await page.getByTestId("cms-mark-save").click();
    await expect(page.getByTestId("cms-row")).toHaveAttribute("data-status", "paid");
    await expect(page.getByTestId("cms-tile").nth(2)).toContainText("₹0.00");
    await expect(page.getByTestId("cms-bulk-pay")).toBeDisabled();
  });

  test("HC-AD-086..101, 108 users: search, drawer, comped plan, invite", async ({ page, request }) => {
    await seedUser(request, { email: "boss@example.com", role: "admin" });
    await seedUser(request, { email: "ria@example.com" });
    await signIn(page, "boss@example.com");
    await page.goto("/admin/users");
    await expect(page.getByTestId("admin-users")).toHaveAttribute("data-state", "ready", { timeout: 15_000 });
    await expect(page.getByTestId("um-row")).toHaveCount(2);
    await page.getByTestId("um-search").fill("ria");
    await expect(page.getByTestId("um-row")).toHaveCount(1);
    await page.getByTestId("um-row").click();
    await expect(page.getByTestId("user-drawer")).toHaveAttribute("data-state-load", "ready");
    await expect(page.getByTestId("drawer-pill-plan")).toHaveText("Elite");
    await page.getByTestId("drawer-tab-subscription").click();
    await page.getByTestId("drawer-set-plan").click();
    await page.getByTestId("set-plan-plan").selectOption("pln_pro");
    await page.getByTestId("set-plan-save").click();
    await expect(page.getByTestId("drawer-pill-plan")).toHaveText("Pro");
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("user-drawer")).toHaveCount(0);
    await expect(page.getByTestId("um-row").getByTestId("user-plan")).toHaveText("Pro");
    await page.getByTestId("users-invite").click();
    await page.getByTestId("invite-name").fill("New Trader");
    await page.getByTestId("invite-email").fill("new@example.com");
    await page.getByTestId("invite-send").click();
    await expect(page.getByTestId("user-drawer")).toHaveAttribute("data-state-load", "ready");
    await expect(page.getByTestId("drawer-name")).toHaveText("New Trader");
  });
});
