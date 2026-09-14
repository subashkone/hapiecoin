// Captures for the feature guide (docs/guide): the screens the visual suite does not already record. Dark theme
// only; the visual suite holds both themes for the main screens. Run with `playwright test guide` after the mock
// stack is free. Titles carry the screens' existing traceability ids; nothing here asserts behaviour beyond "ready".
import { expect, seedUser, signIn, test } from "./fixtures";

const DIR = "e2e/__screenshots__/guide";

test.describe("guide captures", () => {
  test("HC-SH-026..049 the settings dialogs: profile, API keys and accounts, currency, lot size, P&L basis, mindful pause, exchanges, public page", async ({ page, request }) => {
    await seedUser(request, { email: "guide-settings@example.com", plan: { state: "active", planName: "Pro plan", expiresAt: "2026-12-31T00:00:00Z" }, connected: true, publicHandle: "guide_trader" });
    await signIn(page, "guide-settings@example.com");
    await expect(page.getByTestId("chain-table")).toHaveAttribute("data-rows", /^[1-9][0-9]?$/, { timeout: 15_000 });
    const dialog = page.getByRole("dialog");
    const shots: [string, string][] = [
      ["menu-profile", "settings-profile"],
      ["menu-api", "settings-api-keys"],
      ["menu-currency", "settings-currency"],
      ["menu-lot", "settings-lot-size"],
      ["menu-pnl", "settings-pnl-basis"],
      ["menu-mindful", "settings-mindful"],
      ["menu-exchanges", "settings-exchanges"],
      ["menu-public", "settings-public-page"],
    ];
    for (const [item, file] of shots) {
      await page.getByTestId("settings-gear").click();
      await page.getByTestId(item).click();
      await expect(dialog).toBeVisible();
      await page.waitForTimeout(400); // the dialog's data settles (rates, keys, handle)
      await page.screenshot({ path: `${DIR}/${file}.png` });
      await page.keyboard.press("Escape");
      await expect(dialog).toBeHidden();
    }
    // the command palette
    await page.getByTestId("settings-gear").click();
    await page.getByTestId("menu-palette").click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.screenshot({ path: `${DIR}/command-palette.png` });
    await page.keyboard.press("Escape");
  });

  test("HC-SH-129 / HC-SH-137 security: two-factor and passkeys; HC-PB-068 the code step at sign-in", async ({ page, request }) => {
    await seedUser(request, { email: "guide-security@example.com", plan: { state: "active", planName: "Pro plan", expiresAt: "2026-12-31T00:00:00Z" } });
    await signIn(page, "guide-security@example.com");
    await expect(page.getByTestId("chain-table")).toHaveAttribute("data-rows", /^[1-9][0-9]?$/, { timeout: 15_000 });
    await page.getByTestId("settings-gear").click();
    await page.getByTestId("menu-security").click();
    await expect(page.getByTestId("security-status")).toBeVisible();
    await page.screenshot({ path: `${DIR}/settings-security.png` });
    await page.keyboard.press("Escape");
    // the code step: a second account with the authenticator on (a signed-in browser is sent away from /auth, so sign out first)
    await seedUser(request, { email: "guide-totp@example.com", twoFactor: true });
    await page.context().clearCookies();
    await page.goto("/auth");
    await page.getByRole("textbox", { name: "Email", exact: true }).fill("guide-totp@example.com");
    await page.getByRole("textbox", { name: "Password", exact: true }).fill("Passw0rd!");
    await page.getByRole("button", { name: "Sign In", exact: true }).click();
    await expect(page.getByTestId("otp-input")).toBeVisible({ timeout: 15_000 });
    await page.screenshot({ path: `${DIR}/auth-two-factor-code.png` });
  });

  test("HC-WS-113 replay, HC-TR-185 backtest, HC-WS-037 ladder, HC-WS-040 select from chain, HC-SH-053 portfolio bar", async ({ page, request }) => {
    await seedUser(request, { email: "guide-analysis@example.com", plan: { state: "active", planName: "Pro plan", expiresAt: "2026-12-31T00:00:00Z" }, connected: true });
    await signIn(page, "guide-analysis@example.com");
    await expect(page.getByTestId("chain-table")).toHaveAttribute("data-rows", /^[1-9][0-9]?$/, { timeout: 15_000 });
    await page.getByTestId("analysis-tab-backtest").click();
    const backtest = page.getByTestId("backtest-panel");
    await expect(backtest).toBeVisible();
    await expect(backtest.getByTestId("backtest-total")).toBeVisible({ timeout: 30_000 });
    await page.screenshot({ path: `${DIR}/analyse-backtest.png` });
    await page.getByTestId("analysis-tab-replay").click();
    const replay = page.getByTestId("replay-panel");
    await expect(replay).toBeVisible();
    await expect(replay.getByTestId("replay-ladder")).toBeVisible({ timeout: 30_000 });
    await page.screenshot({ path: `${DIR}/analyse-replay.png` });
    // two legs so the ladder and the chain picker have something to show
    const atmStrike = (await page.locator("[data-testid=chain-row][data-atm=true]").getAttribute("data-strike"))!;
    await page.locator(`[data-testid=chain-row-calls][data-strike="${atmStrike}"]`).hover();
    await page.getByTestId("row-buy-calls").click();
    await page.getByTestId("analysis-tab-ladder").click();
    await expect(page.getByTestId("analysis-tab-ladder")).toHaveAttribute("data-state", "active");
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${DIR}/analyse-ladder.png` });
    await page.getByTestId("analysis-tab-payoff").click();
    await page.getByTestId("tab-builder").click();
    await page.getByTestId("builder-select-chain").click();
    const picker = page.getByTestId("chain-picker");
    await expect(picker.getByTestId("picker-row").first()).toBeVisible({ timeout: 15_000 });
    await page.screenshot({ path: `${DIR}/builder-select-from-chain.png` });
    await page.keyboard.press("Escape");
  });

  test("HC-TR-181 verified P&L in the Journal, HC-PB-066 the public trader page", async ({ page, request }) => {
    await seedUser(request, { email: "guide-verified@example.com", plan: { state: "active", planName: "Pro plan", expiresAt: "2026-12-31T00:00:00Z" }, connected: true, fills: true, publicHandle: "asha_guide" });
    await signIn(page, "guide-verified@example.com");
    await expect(page.getByTestId("chain-table")).toHaveAttribute("data-rows", /^[1-9][0-9]?$/, { timeout: 15_000 });
    await page.getByTestId("tab-journal").click();
    await expect(page.getByTestId("verified-block")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("verified-total")).not.toHaveText("—", { timeout: 15_000 });
    await page.screenshot({ path: `${DIR}/journal-verified-pnl.png` });
    await page.goto("/t/asha_guide");
    await expect(page.getByTestId("trader-page")).toHaveAttribute("data-state", "ready");
    await page.screenshot({ path: `${DIR}/public-trader-page.png`, fullPage: true });
  });

  test("HC-AD-001 admin: plans, pricing master, user subscriptions", async ({ page, request }) => {
    await seedUser(request, { email: "guide-admin@example.com", role: "admin", referrals: 3, payments: 3 });
    await signIn(page, "guide-admin@example.com");
    await page.goto("/admin/plans");
    await expect(page.getByTestId("admin-shell")).toHaveAttribute("data-state", "ready", { timeout: 15_000 });
    await expect(page.getByTestId("plan-row").first()).toBeVisible();
    await page.screenshot({ path: `${DIR}/admin-plans.png`, fullPage: true });
    await page.goto("/admin/pricing");
    await expect(page.getByTestId("admin-shell")).toHaveAttribute("data-state", "ready", { timeout: 15_000 });
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${DIR}/admin-pricing.png`, fullPage: true });
    await page.goto("/admin/subscriptions");
    await expect(page.getByTestId("admin-shell")).toHaveAttribute("data-state", "ready", { timeout: 15_000 });
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${DIR}/admin-subscriptions.png`, fullPage: true });
    await page.goto("/admin");
    await expect(page.getByTestId("admin-shell")).toHaveAttribute("data-state", "ready", { timeout: 15_000 });
    await page.screenshot({ path: `${DIR}/admin-index.png`, fullPage: true });
  });

  test("HC-MT-001 terminal: sectors, open interest, coin detail, exchanges, ETF, exchange balance, unlocks", async ({ page, request }) => {
    await seedUser(request, { email: "guide-terminal@example.com" });
    await signIn(page, "guide-terminal@example.com");
    const shots: [string, string, () => Promise<void>][] = [
      ["/terminal/sectors", "terminal-sectors", async () => { await expect(page.getByTestId("sector-page")).toHaveAttribute("data-state", "ready", { timeout: 15_000 }); }],
      ["/terminal/derivatives/open-interest", "terminal-open-interest", async () => { await expect(page.getByTestId("oi-page")).toHaveAttribute("data-state", "ready", { timeout: 15_000 }); }],
      ["/terminal/coin/BTC", "terminal-coin", async () => { await expect(page.getByTestId("coin-page")).toHaveAttribute("data-base", "terminal", { timeout: 15_000 }); await page.waitForTimeout(800); }],
      ["/terminal/exchanges", "terminal-exchanges", async () => { await page.waitForTimeout(1500); }],
      ["/terminal/etf", "terminal-etf", async () => { await expect(page.getByTestId("etf-page")).toHaveAttribute("data-state", "soon", { timeout: 15_000 }); }],
      ["/terminal/onchain/exchange-balance", "terminal-exchange-balance", async () => { await expect(page.getByTestId("balance-page")).toHaveAttribute("data-state", "soon", { timeout: 15_000 }); }],
      ["/terminal/onchain/unlocks", "terminal-unlocks", async () => { await page.waitForTimeout(1500); }],
      ["/terminal/derivatives/liquidations", "terminal-liquidations", async () => { await expect(page.getByTestId("liq-page")).toHaveAttribute("data-state", "ready", { timeout: 15_000 }); }],
    ];
    for (const [route, file, ready] of shots) {
      await page.goto(route);
      await ready();
      await page.screenshot({ path: `${DIR}/${file}.png`, fullPage: true });
    }
  });

  test("HC-PB-001 public pages: privacy, terms, disclaimer, Delta sign-in, offline", async ({ page }) => {
    for (const [route, file] of [["/privacy", "public-privacy"], ["/terms", "public-terms"], ["/disclaimer", "public-disclaimer"], ["/auth/delta", "auth-delta"], ["/offline", "offline-page"]] as const) {
      await page.goto(route);
      await page.waitForTimeout(600);
      await page.screenshot({ path: `${DIR}/${file}.png`, fullPage: route !== "/offline" });
    }
  });
});

test.describe("guide captures · iPhone", () => {
  test.use({ userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1", viewport: { width: 390, height: 664 } });
  test("HC-SH-134 the Install dialog with the iPhone steps", async ({ page, request }) => {
    await seedUser(request, { email: "guide-install@example.com" });
    await signIn(page, "guide-install@example.com");
    await expect(page.getByTestId("chain-table")).toHaveAttribute("data-rows", /^[1-9][0-9]?$/, { timeout: 15_000 });
    await page.getByTestId("settings-gear").click();
    await page.getByTestId("menu-install").click();
    await expect(page.getByTestId("install-dialog")).toHaveAttribute("data-state-install", "ios");
    await page.screenshot({ path: `${DIR}/install-dialog-iphone.png` });
  });
});
