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

  test("HC-TR-183 Mindful trading settings persist and show in the menu (ADR-074)", async ({ page }) => {
    await page.getByTestId("settings-gear").click();
    await expect(page.getByTestId("menu-mindful")).toContainText("30 s");
    await page.getByTestId("menu-mindful").click();
    await expect(page.getByTestId("mindful-threshold")).toHaveValue("0");
    await page.getByTestId("mindful-threshold").fill("25");
    await page.getByTestId("mindful-seconds").fill("60");
    await page.getByTestId("mindful-save").click();
    await expect(page.getByText("Mindful trading saved")).toBeVisible();
    await page.reload();
    await page.getByTestId("settings-gear").click();
    await expect(page.getByTestId("menu-mindful")).toContainText("60 s");
    await page.getByTestId("menu-mindful").click();
    await expect(page.getByTestId("mindful-threshold")).toHaveValue("25");
    await page.getByTestId("mindful-enabled").click();
    await expect(page.getByTestId("mindful-off-note")).toBeVisible();
    await page.getByTestId("mindful-save").click();
    await page.reload();
    await page.getByTestId("settings-gear").click();
    await expect(page.getByTestId("menu-mindful")).toContainText("off");
  });

  test("HC-SH-129 Security: turn two-factor sign-in on with the first code, see the backup codes once, turn it off (ADR-078)", async ({ page }) => {
    await page.getByTestId("settings-gear").click();
    await expect(page.getByTestId("menu-security")).toContainText("2FA off");
    await page.getByTestId("menu-security").click();
    await page.getByTestId("security-enable").click();
    await page.getByTestId("security-password").fill("Passw0rd!");
    await page.getByTestId("security-password-next").click();
    await expect(page.getByTestId("security-secret")).toContainText("JBSW");
    await page.getByTestId("otp-input").getByRole("textbox").first().click();
    await page.keyboard.type("654321");
    await page.getByTestId("security-verify").click();
    await expect(page.getByTestId("security-backup-code")).toHaveCount(10);
    await expect(page.getByTestId("security-status")).toHaveText("on");
    await page.getByTestId("security-done").click();
    await page.reload();
    await page.getByTestId("settings-gear").click();
    await expect(page.getByTestId("menu-security")).toContainText("2FA on");
    await page.getByTestId("menu-security").click();
    await page.getByTestId("security-disable").click();
    await page.getByTestId("security-password").fill("Passw0rd!");
    await page.getByTestId("security-disable-confirm").click();
    await expect(page.getByText("Two-factor sign-in is off")).toBeVisible();
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
    // HC-SH-123: a second key with its own name is another account; it can go alone
    await expect(page.getByTestId("api-label")).toHaveValue("Sub 1");
    await page.getByTestId("api-key").fill("key-5678efgh");
    await page.getByTestId("api-secret").fill("s3cret2");
    await page.getByTestId("connect-save").click();
    await expect(page.getByTestId("api-status")).toHaveAttribute("data-count", "2");
    await page.getByTestId("disconnect-exchange").nth(1).click();
    await expect(page.getByTestId("api-status")).toHaveAttribute("data-count", "1");
    await page.getByTestId("disconnect-exchange").click();
    await expect(page.getByText("Exchange Disconnected").last()).toBeVisible(); // the second toast of this flow (the sub-account's is still fading)
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

test.describe("HC-SH-127 public page settings", () => {
  test("HC-SH-127 choose a handle, switch the page on, get the link and the share bar; the page opens", async ({ page, request }) => {
    await seedUser(request, { email: "asha@example.com", connected: true, fills: true });
    await signIn(page, "asha@example.com");
    await page.getByTestId("settings-gear").click();
    await page.getByTestId("menu-public").click();
    const dialog = page.getByTestId("public-dialog");
    await expect(dialog.getByTestId("public-off-note")).toContainText("Choose a handle and save");
    await expect(dialog.getByTestId("public-enabled")).toBeDisabled();
    await dialog.getByTestId("public-handle").fill("Asha_Trades");
    await expect(dialog.getByTestId("public-enabled")).toBeEnabled();
    await dialog.getByTestId("public-enabled").click();
    await dialog.getByTestId("public-showDays").click();
    await dialog.getByTestId("public-save").click();
    await expect(page.getByText("Public page is on")).toBeVisible();
    await expect(dialog.getByTestId("public-link")).toHaveValue(/\/t\/asha_trades$/);
    await expect(dialog.getByTestId("share-x")).toHaveAttribute("href", /twitter\.com\/intent\/tweet\?text=.*asha_trades/);
    await expect(dialog.getByTestId("share-telegram")).toHaveAttribute("href", /t\.me\/share\/url\?url=.*asha_trades/);
    const link = await dialog.getByTestId("public-link").inputValue();
    // the page itself, in the same browser: the trader's own figures net of fees
    await page.goto(link);
    await expect(page).toHaveTitle(/Asha Trader · Verified P&L/);
    await expect(page.getByTestId("trader-page")).toHaveAttribute("data-state", "ready");
    await expect(page.getByTestId("trader-total")).toHaveText("+$1.65");
    await expect(page.getByTestId("trader-days")).toHaveAttribute("data-count", "2");
    await expect(page.getByTestId("trader-accounts")).toHaveCount(0); // not turned on
  });
});
