import { expect, seedUser, signIn, test } from "./fixtures";

test.describe("HC-SH settings dialogs persist through the API", () => {
  test.beforeEach(async ({ page, request }) => {
    await seedUser(request, { email: "settings@example.com" });
    await signIn(page, "settings@example.com");
  });

  test("HC-SH-040 currency settings save and survive a reload", async ({ page }) => {
    await page.getByTestId("settings-gear").click();
    await page.getByTestId("menu-currency").click();
    await expect(page.getByTestId("conversion-rate")).toHaveValue("83.5");
    await page.getByTestId("currency-INR").click();
    await page.getByTestId("conversion-rate").fill("84.25");
    await expect(page.getByTestId("currency-note")).toContainText("Indian Rupees (₹) · Rate: $1 = ₹84.25");
    await page.getByTestId("currency-save").click();
    await expect(page.getByText("Currency conversion saved")).toBeVisible();
    await page.reload();
    await page.getByTestId("settings-gear").click();
    await expect(page.getByTestId("menu-currency")).toContainText("INR");
    await page.getByTestId("menu-currency").click();
    await expect(page.getByTestId("conversion-rate")).toHaveValue("84.25");
  });

  test("HC-SH-042 lot sizes validate and persist", async ({ page }) => {
    await page.getByTestId("settings-gear").click();
    await page.getByTestId("menu-lot").click();
    await expect(page.getByTestId("lot-BTC")).toHaveValue("0.001");
    await page.getByTestId("lot-ETH").fill("0");
    await page.getByTestId("lot-save").click();
    await expect(page.getByText("Failed to save lot sizes")).toBeVisible();
    await page.getByTestId("lot-ETH").fill("0.02");
    await page.getByTestId("lot-save").click();
    await expect(page.getByText("Lot sizes saved")).toBeVisible();
    await page.reload();
    await page.getByTestId("settings-gear").click();
    await page.getByTestId("menu-lot").click();
    await expect(page.getByTestId("lot-ETH")).toHaveValue("0.02");
  });

  test("HC-SH-043 P&L basis persists", async ({ page }) => {
    await page.getByTestId("settings-gear").click();
    await page.getByTestId("menu-pnl").click();
    await page.getByTestId("pnl-bid_ask").click();
    await page.getByTestId("pnl-save").click();
    await expect(page.getByText("P&L settings saved")).toBeVisible();
    await page.reload();
    await page.getByTestId("settings-gear").click();
    await expect(page.getByTestId("menu-pnl")).toContainText("bid/ask");
  });

  test("HC-SH-046..049 exchange management: add, edit, delete", async ({ page }) => {
    await page.getByTestId("settings-gear").click();
    await page.getByTestId("menu-exchanges").click();
    await expect(page.getByTestId("broker-count")).toHaveText("1 exchange(s) configured");
    await page.getByTestId("add-exchange").click();
    await page.getByTestId("broker-submit").click();
    await expect(page.getByText("Exchange name is required").first()).toBeVisible();
    await page.getByTestId("broker-name").fill("CoinDCX");
    await page.getByTestId("broker-submit").click();
    await expect(page.getByText("Exchange created successfully")).toBeVisible();
    await expect(page.getByTestId("broker-row")).toHaveCount(2);
    await page.reload();
    await page.getByTestId("settings-gear").click();
    await page.getByTestId("menu-exchanges").click();
    await expect(page.getByTestId("broker-row")).toHaveCount(2);
    await page.getByTestId("broker-row").nth(1).getByTestId("broker-edit").click();
    await page.getByTestId("broker-name").fill("CoinDCX Pro");
    await page.getByTestId("broker-submit").click();
    await expect(page.getByText("Exchange updated successfully")).toBeVisible();
    await page.getByTestId("broker-row").nth(1).getByTestId("broker-delete-btn").click();
    await expect(page.getByText("This action cannot be undone")).toBeVisible();
    await page.getByTestId("broker-delete-confirm").click();
    await expect(page.getByText("Exchange deleted successfully")).toBeVisible();
    await expect(page.getByTestId("broker-row")).toHaveCount(1);
  });

  test("HC-SH-034 / HC-SH-037 API settings connect, chip turns green, disconnect", async ({ page }) => {
    await expect(page.getByTestId("exchange-chip")).toHaveAttribute("data-state", "disconnected");
    await page.getByTestId("exchange-chip").click();
    await expect(page.getByTestId("api-status")).toHaveAttribute("data-state", "disconnected");
    await expect(page.getByTestId("whitelist-ip")).toHaveText("172.236.179.136");
    await page.getByTestId("connect-save").click();
    await expect(page.getByText("Save Failed")).toBeVisible();
    await page.getByTestId("api-key").fill("key-1234abcd");
    await page.getByTestId("api-secret").fill("s3cret");
    await page.getByTestId("connect-save").click();
    await expect(page.getByText("Exchange Connected")).toBeVisible();
    await expect(page.getByTestId("api-status")).toHaveAttribute("data-state", "connected");
    await expect(page.getByText("API Key: ****abcd")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("exchange-chip")).toHaveAttribute("data-state", "connected");
    await page.reload();
    await expect(page.getByTestId("exchange-chip")).toHaveAttribute("data-state", "connected");
    await page.getByTestId("exchange-chip").click();
    await page.getByTestId("disconnect-exchange").click();
    await expect(page.getByText("Exchange Disconnected")).toBeVisible();
    await expect(page.getByTestId("api-status")).toHaveAttribute("data-state", "disconnected");
  });

  test("HC-SH-030 profile edit and avatar persist", async ({ page }) => {
    await page.getByTestId("settings-gear").click();
    await page.getByTestId("menu-profile").click();
    await page.getByTestId("profile-edit").click();
    await page.getByTestId("profile-name").fill("Asha T.");
    await page.getByTestId("profile-save").click();
    await expect(page.getByText("Profile updated")).toBeVisible();
    await page.getByTestId("avatar-big").click();
    await page.getByTestId("avatar-lightning").click();
    await expect(page.getByText("Avatar updated")).toBeVisible();
    await page.reload();
    await page.getByTestId("account-avatar").click();
    await expect(page.getByTestId("account-menu")).toContainText("Asha T.");
  });
});
