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

  test("HC-SH-057 / HC-SH-063 visitor mode: the assistant is on the landing page with limited answers", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("assistant-launcher").click();
    await expect(page.getByTestId("assistant-mode")).toContainText("visitor mode");
    await expect(page.getByTestId("assistant-chip")).toHaveCount(4);
    await expect(page.getByTestId("assistant-chip").first()).toHaveText("How do I add a leg from the chain?");
    await page.getByTestId("assistant-chip").nth(2).click();
    await expect(page.getByTestId("assistant-msg-bot").last()).toContainText("sign in for help with your own strategies", { timeout: 10_000 });
    await page.getByTestId("assistant-close").click();
    await expect(page.getByTestId("assistant-panel")).toHaveCount(0);
  });

  test("HC-PB-042..051 payoff chart preview: presets, legend, zoom, layers, sliders and summary", async ({ page }) => {
    await page.goto("/payoff-preview");
    await expect(page).toHaveTitle(/Payoff chart preview/);
    const root = page.getByTestId("payoff-preview");
    await expect(page.getByTestId("pp-preset")).toHaveCount(4);
    await expect(page.getByTestId("pp-summary")).toContainText("@ $100k (+0.0%)");
    await expect(page.getByTestId("pp-pill")).toHaveText("Profit: $1.2k");
    await expect(page.getByTestId("pp-sd")).toContainText("Expected move by target date (15d)");
    await page.getByTestId("pp-zoom-in").click();
    await expect(root).toHaveAttribute("data-zoom", "125");
    await page.getByTestId("pp-zoom-label").click();
    await expect(root).toHaveAttribute("data-zoom", "100");
    await page.getByTestId("pp-layers-button").click();
    await expect(page.getByTestId("pp-layers")).toBeVisible();
    await page.getByTestId("pp-layer-oi").click();
    await expect(page.getByTestId("pp-legend-item").nth(4)).toHaveAttribute("data-on", "false");
    await page.mouse.click(10, 300);
    await expect(page.getByTestId("pp-layers")).toHaveCount(0);
    await page.getByTestId("pp-legend-item").first().click();
    await expect(page.getByTestId("pp-legend-item").first()).toHaveAttribute("data-on", "false");
    await page.getByTestId("pp-target-plus").click();
    await expect(page.getByTestId("pp-target-value")).toHaveText("$100,500");
    await expect(page.getByTestId("pp-target-pct")).toHaveText("+0.5%");
    await page.getByTestId("pp-day-prev").click();
    await expect(root).toHaveAttribute("data-day", "14");
    await expect(page.getByTestId("pp-summary")).toContainText("14D:");
    await page.getByTestId("pp-preset").nth(1).click();
    await expect(page.getByTestId("pp-pill")).toHaveText("Loss: $1.5k");
    await expect(page.getByTestId("pp-target-value")).toHaveText("$100,000"); // preset switch resets the target
    // hover readout over the plot
    const box = (await page.locator("[data-testid=payoff-preview] canvas").boundingBox())!;
    await page.mouse.move(box.x + box.width * 0.7, box.y + box.height / 2);
    await expect(page.getByTestId("pp-hover")).toContainText("Expiry");
    // reachable from the palette while signed out (HC-PB-059)
    await page.goto("/");
    await page.keyboard.press("Control+k");
    await page.getByRole("combobox").fill("payoff");
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/payoff-preview/);
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
      ["/subscription", "Choose a plan to unlock features"],
      ["/referrals", "Share & Earn"],
      ["/admin/users", "User Management"],
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
