import { expect, seedUser, signIn, test } from "./fixtures";

test.describe("HC-PB landing and public pages", () => {
  test("HC-PB-001 / HC-PB-004 / HC-PB-018 / HC-PB-058 header, hero, exchanges, footer", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveTitle(/HapieCoin/);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Trade Crypto Options");
    await expect(page.getByText("Live on Delta Exchange")).toBeVisible();
    await expect(page.getByText("Free plan · paper trading included")).toBeVisible();
    await expect(page.getByTestId("get-started")).toHaveAttribute("href", "/auth");
    await expect(page.getByTestId("exchange-live")).toHaveCount(1);
    await expect(page.getByTestId("exchange-coming")).toHaveCount(3);
    await expect(page.getByText("support@hapiecoin.com")).toBeVisible();
    await expect(page.locator("img")).toHaveCount(0); // hero terminal is built from components, not images
    // security headers from the proxy
    const res = await page.request.get("/privacy");
    const csp = res.headers()["content-security-policy"] ?? "";
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toMatch(/script-src 'self' 'nonce-[A-Za-z0-9+/=]+' 'strict-dynamic'/);
    expect(res.headers()["x-content-type-options"]).toBe("nosniff");
  });

  test("HC-PB-009 live market tiles connect and show prices", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("live-badge")).toContainText("Live", { timeout: 15_000 });
    await expect(page.getByTestId("tile-BTC")).toHaveAttribute("data-state", "live", { timeout: 15_000 });
    await expect(page.getByTestId("tile-BTC").getByTestId("tile-price")).not.toHaveText("—");
  });

  test("HC-PB-059 Ctrl K palette navigates", async ({ page }) => {
    await page.goto("/");
    await page.keyboard.press("Control+k");
    await expect(page.getByRole("listbox")).toBeVisible();
    await page.getByRole("combobox").fill("disc");
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/disclaimer/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Disclaimer");
  });

  test("HC-PB-003 theme toggle persists and the landing shows Go to App when signed in", async ({ page, request }) => {
    await page.goto("/");
    await expect(page.locator("html")).toHaveClass(/dark/);
    await page.getByTestId("theme-toggle").click();
    await expect(page.locator("html")).toHaveClass(/light/);
    await page.reload();
    await expect(page.locator("html")).toHaveClass(/light/);
    await seedUser(request, { email: "home@example.com" });
    await signIn(page, "home@example.com");
    await page.goto("/");
    await expect(page.getByTestId("go-to-app")).toHaveAttribute("href", "/analyse");
  });

  test("HC-SH-016 placeholder routes keep the default header and never dead-end", async ({ page, request }) => {
    await seedUser(request, { email: "nav@example.com", role: "admin" });
    await signIn(page, "nav@example.com");
    for (const [path, title] of [
      ["/analytics", "Market Analytics"],
      ["/subscription", "Subscription"],
      ["/referrals", "Referrals"],
      ["/admin/users", "Admin"],
    ] as const) {
      await page.goto(path);
      await expect(page.getByTestId("app-header")).toHaveAttribute("data-variant", "default");
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(title);
      await expect(page.getByTestId("admin-chip")).toBeVisible();
    }
    await page.goto("/does-not-exist");
    await expect(page.getByText("Oops! Page not found")).toBeVisible();
  });
});
