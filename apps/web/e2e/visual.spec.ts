// Visual captures for comparison with mockup-v2/shots (v2-public-auth-login*.png, qa-dark/analyse.jpg …).
// Saved under e2e/__screenshots__/ in both themes and, with E2E_PIXELS=1, asserted against the Linux baseline within
// the spec's tolerance (shot.ts, ADR-096, GAPS #119). Runs under playwright.visual.config.ts (`pnpm test:visual`): the
// mock stack and every page are pinned to VISUAL_NOW, so two runs paint the same pixels on any day.
import { TEMPLATE_COUNT } from "../src/lib/strategy/templates";
import { expect, seedUser, signIn, test, typeLiveIfShown } from "./fixtures";
import { preparePage, shot } from "./shot";

test.beforeEach(({ page }) => preparePage(page));

for (const theme of ["dark", "light"] as const) {
  test.describe(`HC-SH-139 visual · ${theme}`, () => {
    test.use({ colorScheme: theme });

    test(`HC-PB-023 /auth ${theme}`, async ({ page }) => {
      await page.goto("/auth");
      await page.evaluate((t) => {
        localStorage.setItem("hapiecoin.theme", t);
      }, theme);
      await page.reload();
      await expect(page.getByTestId("auth-login")).toBeVisible();
      await expect(page.getByTestId("ticker-BTC")).not.toContainText("—", { timeout: 15_000 });
      await shot(page, "visual", `auth-login-${theme}`, { fullPage: true });
      await page.goto("/auth?tab=signup");
      await expect(page.getByTestId("auth-signup")).toBeVisible();
      await expect(page.getByTestId("ticker-BTC")).not.toContainText("—", { timeout: 15_000 }); // the tickers load after the form
      await shot(page, "visual", `auth-signup-${theme}`, { fullPage: true });
    });

    test(`HC-SH-001 /analyse ${theme}`, async ({ page, request }) => {
      await seedUser(request, { email: `shot-${theme}@example.com`, plan: { state: "active", planName: "Pro plan", expiresAt: "2026-12-31T00:00:00Z" }, connected: true, alerts: true });
      await signIn(page, `shot-${theme}@example.com`);
      await page.evaluate((t) => {
        localStorage.setItem("hapiecoin.theme", t);
      }, theme);
      await page.reload();
      await expect(page.getByTestId("chain-table")).toHaveAttribute("data-rows", /^[1-9][0-9]$/, { timeout: 15_000 });
      await expect(page.getByTestId("futures-price-value")).not.toHaveText("—", { timeout: 15_000 });
      await shot(page, "visual", `analyse-${theme}`);
      // HC-WS-010 Column Settings dialog over the chain
      await page.getByTestId("chain-columns").click();
      await expect(page.getByTestId("column-settings")).toBeVisible();
      await shot(page, "visual", `analyse-columns-${theme}`);
      await page.getByTestId("columns-done").click();
      // HC-WS-027 a chain holding two legs, with the hover control on the ATM row
      const atmStrike = (await page.locator("[data-testid=chain-row][data-atm=true]").getAttribute("data-strike"))!;
      await page.locator(`[data-testid=chain-row-calls][data-strike="${atmStrike}"]`).hover();
      await page.getByTestId("row-buy-calls").click();
      await page.locator(`[data-testid=chain-row-puts][data-strike="${atmStrike}"]`).hover();
      await page.getByTestId("row-sell-puts").click();
      await page.locator(`[data-testid=chain-row-calls][data-strike="${atmStrike}"]`).hover();
      await expect(page.getByTestId("row-controls-calls")).toBeVisible();
      await shot(page, "visual", `analyse-legs-${theme}`);
      // HC-TR-001 / HC-WS-033 the Builder with the two legs and the payoff pane priced
      await page.getByTestId("tab-builder").click();
      await expect(page.getByTestId("builder-panel")).toHaveAttribute("data-legs", "2");
      await expect(page.getByTestId("payoff-panel")).toHaveAttribute("data-state", "ready", { timeout: 15_000 });
      await expect(page.getByTestId("ticket-net")).not.toHaveText("—");
      await shot(page, "visual", `analyse-builder-${theme}`);
      await page.getByTestId("builder-tab-templates").click();
      await expect(page.getByTestId("template-card")).toHaveCount(TEMPLATE_COUNT);
      await shot(page, "visual", `analyse-templates-${theme}`);
      // HC-TR-176..178 the wizard with its three ranked cards
      await page.getByTestId("builder-tab-wizard").click();
      await expect(page.getByTestId("wizard-panel")).toHaveAttribute("data-state", "ready", { timeout: 30_000 });
      await shot(page, "visual", `analyse-wizard-${theme}`);
      await page.getByTestId("analysis-tab-greeks").click();
      await expect(page.getByTestId("greek-delta")).not.toContainText("—");
      await shot(page, "visual", `analyse-greeks-${theme}`);
      await page.getByTestId("share-open").click();
      await expect(page.getByTestId("share-link")).not.toHaveValue("");
      await shot(page, "visual", `analyse-share-${theme}`);
      await page.keyboard.press("Escape");
      // HC-WS-088..100 the Phase 5 tabs
      await page.getByTestId("analysis-tab-scenarios").click();
      await expect(page.getByTestId("scenarios-panel")).toHaveAttribute("data-state", "ready", { timeout: 15_000 });
      await shot(page, "visual", `analyse-scenarios-${theme}`);
      await page.getByTestId("scenario-smooth").click();
      await expect(page.getByTestId("scenario-heat")).toBeVisible();
      await shot(page, "visual", `analyse-scenarios-smooth-${theme}`);
      await page.getByTestId("analysis-tab-vol").click();
      await expect(page.getByTestId("vol-panel")).toHaveAttribute("data-state", "ready", { timeout: 15_000 });
      await shot(page, "visual", `analyse-vol-${theme}`);
      await page.getByTestId("analysis-tab-structure").click();
      await expect(page.getByTestId("structure-panel")).toHaveAttribute("data-state", "ready", { timeout: 15_000 });
      await shot(page, "visual", `analyse-structure-${theme}`);
      await page.getByTestId("analysis-tab-payoff").click();
      // HC-WS-110 the options screener
      await page.getByTestId("tab-screener").click();
      await expect(page.getByTestId("screener-panel")).toHaveAttribute("data-state", "ready", { timeout: 30_000 });
      await shot(page, "visual", `analyse-screener-${theme}`);
      await page.getByTestId("tab-builder").click(); // back to the Builder for the paper trade below
      // HC-TR-058 / HC-TR-068 a paper trade on the Paper tab and its details
      await page.getByTestId("builder-tab-builder").click();
      await page.getByTestId("strategy-name").fill("Visual straddle");
      await page.getByTestId("builder-paper-trade").click();
      await expect(page.getByTestId("trade-mode")).toBeVisible();
      await shot(page, "visual", `analyse-trade-mode-${theme}`);
      await page.getByTestId("trade-continue").click();
      await expect(page.getByTestId("trade-preview")).toBeVisible();
      await page.getByTestId("trade-now").click();
      await page.getByTestId("save-draft-confirm").click(); // the name is always confirmed (ADR-059)
      await page.getByTestId("rule-skip").click(); // the Protect step (HC-TR-167), skipped here
      await expect(page.getByTestId("paper-panel")).toHaveAttribute("data-count", "1", { timeout: 15_000 });
      await expect(page.getByTestId("paper-card").getByTestId("card-pnl")).not.toHaveText("—");
      await expect(page.getByTestId("paper-strip")).toHaveAttribute("data-portfolio", "ready", { timeout: 15_000 });
      await shot(page, "visual", `analyse-paper-${theme}`);
      // ADR-053 the keyboard shortcuts help
      await page.keyboard.press("Shift+?");
      await expect(page.getByTestId("shortcuts-dialog")).toBeVisible();
      await shot(page, "visual", `analyse-shortcuts-${theme}`);
      await page.keyboard.press("Escape");
      await expect(page.getByTestId("shortcuts-dialog")).toBeHidden();
      // ADR-052 the Alerts center from the bell, then the New alert form from a card's Set alert
      await page.getByTestId("alerts-bell").click();
      const alerts = page.getByTestId("alerts-dialog");
      await expect(alerts.getByTestId("alert-row")).toHaveCount(3);
      await expect(alerts.locator("[data-testid=alert-row][data-kind=price]").getByTestId("alert-now")).toContainText(/now [0-9]/, { timeout: 15_000 });
      await shot(page, "visual", `analyse-alerts-${theme}`, { mask: [page.getByTestId("alert-fired")] }); // "fired h:mm" comes from the mock's flowing clock
      await page.keyboard.press("Escape");
      await expect(alerts).toBeHidden();
      await page.getByTestId("paper-card").getByTestId("card-alert").click();
      await expect(alerts.getByTestId("alert-form")).toBeVisible();
      await expect(alerts.getByTestId("alert-form-now")).toContainText("$", { timeout: 15_000 });
      await shot(page, "visual", `analyse-alerts-form-${theme}`);
      await page.keyboard.press("Escape");
      await expect(alerts).toBeHidden();
      // ADR-044 the adjustment workbench (HC-TR-148..151) and its paper confirm
      await page.getByTestId("card-adjust").click();
      const wb = page.getByTestId("adjust-workbench");
      await expect(wb.getByTestId("wb-chain-table")).toHaveAttribute("data-rows", /^[1-9]/, { timeout: 15_000 });
      await wb.getByTestId("wb-leg").first().getByTestId("lots-after-down").click();
      // a sold call three rows above the ATM row, so the capture shows the chain centred on ATM (ADR-058)
      const atmIdx = Number(await wb.getByTestId("wb-chain-table").getAttribute("data-atm"));
      await wb.getByTestId("wb-chain-row").nth(atmIdx + 3).getByTestId("wb-chain-sell-call").click();
      await expect(page.getByTestId("before-after")).toBeVisible();
      await expect(page.getByTestId("adjust-change-box").getByTestId("adjust-summary")).toContainText("This change", { timeout: 15_000 });
      await page.getByTestId("position-ticket").scrollIntoViewIfNeeded(); // capture the legs, the change box and the tiles, not the scrolled chain
      await shot(page, "visual", `analyse-workbench-${theme}`);
      await wb.getByTestId("adjust-review").click();
      await expect(page.getByTestId("adjust-confirm")).toBeVisible();
      await shot(page, "visual", `analyse-adjust-confirm-${theme}`);
      await page.getByTestId("adjust-cancel").click();
      await wb.getByTestId("adjust-exit").click();
      await page.getByTestId("adjust-exit-discard").click(); // the change would be discarded, so Exit asks first
      await expect(wb).toBeHidden();
      await page.getByTestId("card-details").click();
      await expect(page.getByTestId("strategy-details")).toBeVisible();
      await shot(page, "visual", `analyse-details-${theme}`);
      await page.keyboard.press("Escape");
      // HC-TR-063 / HC-TR-082 go live: the exchange preview and the Live tab
      await page.getByTestId("card-golive").click();
      await expect(page.getByTestId("trade-mode").getByTestId("mode-live")).toHaveAttribute("aria-pressed", "true");
      await page.getByTestId("trade-continue").click();
      await expect(page.getByTestId("venue-preview")).toHaveAttribute("data-ok", "true");
      await shot(page, "visual", `analyse-live-preview-${theme}`);
      await typeLiveIfShown(page); // HC-TR-186: the word before a real order
      await page.getByTestId("trade-now").click();
      await expect(page.getByTestId("live-panel")).toHaveAttribute("data-count", "1", { timeout: 15_000 });
      await expect(page.getByTestId("live-card").getByTestId("order-chip").first()).toHaveAttribute("data-state", "filled");
      await shot(page, "visual", `analyse-live-${theme}`);
      // ADR-044 the live confirm (HC-TR-152): venue check, band, order type, hold-to-place
      await page.getByTestId("live-card").getByTestId("card-adjust").click();
      const lwb = page.getByTestId("adjust-workbench");
      await expect(lwb.getByTestId("wb-chain-table")).toHaveAttribute("data-rows", /^[1-9]/, { timeout: 15_000 });
      // close the sold put and sell a call above: a defined-risk batch the fake venue's wallet can carry
      await lwb.getByTestId("wb-leg").nth(1).getByTestId("lots-after-input").fill("0");
      await lwb.getByTestId("wb-chain-row").nth(2).getByTestId("wb-chain-sell-call").click();
      await lwb.getByTestId("adjust-review").click();
      await expect(page.getByTestId("adjust-confirm").getByTestId("adjust-venue")).toHaveAttribute("data-ok", /true|false/, { timeout: 15_000 });
      await shot(page, "visual", `analyse-adjust-live-${theme}`);
      await page.getByTestId("adjust-cancel").click();
      await lwb.getByTestId("adjust-exit").click();
      await page.getByTestId("adjust-exit-discard").click();
      await expect(lwb).toBeHidden();
      // HC-TR-128 the Journal: square off the live strategy, tag it, capture the closed trade with its stats and equity curve
      await page.getByTestId("live-card").getByTestId("card-sqall").click();
      const det = page.getByTestId("strategy-details");
      await det.getByTestId("details-sqall").click();
      await det.getByTestId("details-sqall-confirm").click();
      await expect(det).toHaveAttribute("data-status", "archived");
      await det.getByTestId("details-open-journal").click();
      await expect(page.getByTestId("journal-panel")).toHaveAttribute("data-count", "1", { timeout: 15_000 });
      await page.getByTestId("tag-hedge").click();
      await expect(page.getByTestId("tag-hedge")).toHaveAttribute("aria-pressed", "true");
      await page.getByTestId("trade-notes").fill("Squared off after the adjustment review; kept the call wing.");
      await page.getByTestId("trade-notes").blur();
      await expect(page.getByTestId("chart-equity")).toHaveAttribute("data-state", "ready");
      await shot(page, "visual", `analyse-journal-${theme}`);
      await page.evaluate(() => localStorage.removeItem("hapiecoin.ui"));
      await page.goto("/");
      await expect(page.getByTestId("tile-BTC")).toHaveAttribute("data-state", "live", { timeout: 15_000 });
      await shot(page, "visual", `home-${theme}`);
    });

    test(`HC-MA-012 /analytics/hub and HC-MA-030 /analytics/overview ${theme}`, async ({ page, request }) => {
      await seedUser(request, { email: `ma-${theme}@example.com` });
      await signIn(page, `ma-${theme}@example.com`);
      await page.evaluate((t) => {
        localStorage.setItem("hapiecoin.theme", t);
      }, theme);
      await page.goto("/analytics/hub");
      await expect(page.getByTestId("hub-page")).toHaveAttribute("data-state", "ready", { timeout: 15_000 });
      await expect(page.getByTestId("table-hub-derivatives")).toHaveAttribute("data-rows", "10");
      await shot(page, "visual", `analytics-hub-${theme}`, { fullPage: true });
      await page.goto("/analytics/overview");
      await expect(page.getByTestId("overview-page")).toHaveAttribute("data-state", "ready", { timeout: 15_000 });
      await expect(page.getByTestId("chart-oi")).toHaveAttribute("data-state", "ready");
      await shot(page, "visual", `analytics-overview-${theme}`, { fullPage: true });
    });

    test(`HC-MA-038 /analytics/markets, HC-MA-041 /analytics/derivatives, HC-MA-060 /analytics/liquidations and HC-MA-084 /analytics/coin/BTC ${theme}`, async ({ page, request }) => {
      await seedUser(request, { email: `ma3-${theme}@example.com` });
      await signIn(page, `ma3-${theme}@example.com`);
      await page.evaluate((t) => {
        localStorage.setItem("hapiecoin.theme", t);
      }, theme);
      await page.goto("/analytics/markets?compare=BTC,ETH");
      await expect(page.getByTestId("table-screener")).toHaveAttribute("data-rows", "10", { timeout: 15_000 });
      await expect(page.getByTestId("compare-grid")).toHaveAttribute("data-count", "2");
      await shot(page, "visual", `analytics-markets-${theme}`, { fullPage: true });
      await page.goto("/analytics/derivatives");
      await expect(page.getByTestId("arb-count")).toHaveText("10 of 10 coins", { timeout: 15_000 });
      await expect(page.getByTestId("chart-ls")).toHaveAttribute("data-state", "ready");
      await shot(page, "visual", `analytics-derivatives-${theme}`, { fullPage: true });
      await page.goto("/analytics/liquidations");
      await expect(page.getByTestId("liq-feed")).toHaveAttribute("data-rows", "40", { timeout: 15_000 });
      await shot(page, "visual", `analytics-liquidations-${theme}`, { fullPage: true });
      await page.goto("/analytics/coin/BTC");
      await expect(page.getByTestId("table-coin-funding")).toHaveAttribute("data-rows", "3", { timeout: 15_000 });
      await expect(page.getByTestId("chart-taker")).toHaveAttribute("data-state", "ready");
      await shot(page, "visual", `analytics-coin-${theme}`, { fullPage: true });
    });

    test(`HC-MT-040 /terminal, HC-MT-052 /terminal/spot, HC-MT-102 /terminal/exchanges, HC-MT-119 funding, HC-MT-126 long-short, HC-MT-144 fear-greed, HC-MT-148 cycle ${theme}`, async ({ page, request }) => {
      await seedUser(request, { email: `mt-${theme}@example.com` });
      await signIn(page, `mt-${theme}@example.com`);
      await page.evaluate((t) => {
        localStorage.setItem("hapiecoin.theme", t);
      }, theme);
      await page.goto("/terminal");
      await expect(page.getByTestId("table-dash-markets")).toHaveAttribute("data-rows", "10", { timeout: 15_000 });
      await page.getByTestId("table-dash-markets").getByTestId("star").nth(0).click();
      await page.getByTestId("table-dash-markets").getByTestId("star").nth(1).click();
      await expect(page.getByTestId("watch-strip")).toHaveAttribute("data-count", "2");
      await expect(page.getByTestId("chart-ls")).toHaveAttribute("data-state", "ready");
      await page.evaluate(() => window.scrollTo(0, 0)); // the star clicks scrolled; keep the sticky sidebar at the top of the capture
      await shot(page, "visual", `terminal-dashboard-${theme}`, { fullPage: true });
      await page.goto("/terminal/spot?compare=BTC,ETH");
      await expect(page.getByTestId("table-spot")).toHaveAttribute("data-rows", "10", { timeout: 15_000 });
      await shot(page, "visual", `terminal-spot-${theme}`, { fullPage: true });
      await page.goto("/terminal/exchanges/binance");
      await expect(page.getByTestId("table-exchange-coins")).toHaveAttribute("data-rows", "10", { timeout: 15_000 });
      await shot(page, "visual", `terminal-exchange-${theme}`, { fullPage: true });
      await page.goto("/terminal/derivatives/funding");
      await expect(page.getByTestId("table-funding-venues")).toHaveAttribute("data-rows", "3", { timeout: 15_000 });
      await expect(page.getByTestId("chart-funding")).toHaveAttribute("data-state", "ready");
      await shot(page, "visual", `terminal-funding-${theme}`, { fullPage: true });
      await page.goto("/terminal/derivatives/long-short");
      await expect(page.getByTestId("table-ls-readings")).toHaveAttribute("data-rows", "24", { timeout: 15_000 });
      await shot(page, "visual", `terminal-long-short-${theme}`, { fullPage: true });
      await page.goto("/terminal/indicators/fear-greed");
      await expect(page.getByTestId("chart-fg")).toHaveAttribute("data-state", "ready", { timeout: 15_000 });
      await shot(page, "visual", `terminal-fear-greed-${theme}`, { fullPage: true });
      await page.goto("/terminal/indicators/cycle");
      await expect(page.getByTestId("chart-pi")).toHaveAttribute("data-state", "ready", { timeout: 15_000 });
      await shot(page, "visual", `terminal-cycle-${theme}`, { fullPage: true });
    });

    test(`HC-MA-049 /analytics/options, HC-MA-073 /analytics/sentiment and HC-MA-054 /analytics/etf ${theme}`, async ({ page, request }) => {
      await seedUser(request, { email: `ma4-${theme}@example.com` });
      await signIn(page, `ma4-${theme}@example.com`);
      await page.evaluate((t) => {
        localStorage.setItem("hapiecoin.theme", t);
      }, theme);
      await page.goto("/analytics/options");
      await expect(page.getByTestId("table-options-exchanges")).toHaveAttribute("data-rows", "2", { timeout: 15_000 });
      await expect(page.getByTestId("chart-expiry")).toHaveAttribute("data-state", "ready");
      await shot(page, "visual", `analytics-options-${theme}`, { fullPage: true });
      await page.goto("/analytics/sentiment");
      await expect(page.getByTestId("table-rsi")).toHaveAttribute("data-rows", "10", { timeout: 15_000 });
      await expect(page.getByTestId("chart-rainbow")).toHaveAttribute("data-state", "ready");
      await shot(page, "visual", `analytics-sentiment-${theme}`, { fullPage: true });
      await page.goto("/analytics/etf");
      await expect(page.getByTestId("etf-page")).toHaveAttribute("data-state", "soon");
      await shot(page, "visual", `analytics-etf-${theme}`, { fullPage: true });
      await page.goto("/analytics/whales");
      await expect(page.getByTestId("table-whale-positions")).toHaveAttribute("data-rows", "12", { timeout: 15_000 });
      await expect(page.getByTestId("chart-index")).toHaveAttribute("data-state", "ready");
      await shot(page, "visual", `analytics-whales-${theme}`, { fullPage: true });
    });

    test(`HC-PB-042 /payoff-preview ${theme}`, async ({ page }) => {
      await page.goto("/payoff-preview");
      await page.evaluate((t) => {
        localStorage.setItem("hapiecoin.theme", t);
      }, theme);
      await page.reload();
      await expect(page.getByTestId("pp-summary")).toContainText("@ $100k");
      await page.getByTestId("pp-target-plus").click();
      await page.getByTestId("pp-target-plus").click();
      await page.waitForTimeout(300);
      await shot(page, "visual", `public-payoff-preview-${theme}`, { fullPage: true });
    });

    test(`HC-SH-064 tour and HC-SH-057 assistant ${theme}`, async ({ page, request }) => {
      await seedUser(request, { email: `tour-${theme}@example.com` });
      await signIn(page, `tour-${theme}@example.com`);
      await page.evaluate((t) => {
        localStorage.setItem("hapiecoin.theme", t);
      }, theme);
      await page.reload();
      await expect(page.locator("[data-testid=chain-row][data-atm=true]")).toHaveCount(1, { timeout: 15_000 });
      await page.getByTestId("settings-gear").click();
      await page.getByTestId("menu-tour").click();
      await expect(page.getByTestId("tour")).toHaveAttribute("data-step", "1");
      await page.waitForTimeout(700); // the card places itself again 180 ms and 600 ms after a step opens (Tour.tsx)
      await shot(page, "visual", `analyse-tour-welcome-${theme}`);
      await page.getByTestId("tour-next").click();
      await expect(page.getByTestId("tour")).toHaveAttribute("data-anchored", "true");
      await page.waitForTimeout(700);
      await shot(page, "visual", `analyse-tour-${theme}`);
      await page.keyboard.press("Escape");
      await page.getByTestId("assistant-launcher").click();
      await page.getByTestId("assistant-chip").nth(1).click();
      await expect(page.getByTestId("assistant-msg-bot").last()).toContainText("press B", { timeout: 10_000 });
      await expect(page.getByTestId("assistant-panel")).toHaveAttribute("data-typing", "false", { timeout: 10_000 });
      await shot(page, "visual", `analyse-assistant-${theme}`);
    });

    test(`HC-AC-037 /referrals and HC-AD-052 admin commissions ${theme}`, async ({ page, request }) => {
      await seedUser(request, { email: `ref-${theme}@example.com`, role: "admin", referrals: 6 });
      await signIn(page, `ref-${theme}@example.com`);
      await page.evaluate((t) => {
        localStorage.setItem("hapiecoin.theme", t);
      }, theme);
      await page.goto("/referrals");
      await expect(page.getByTestId("referrals-page")).toHaveAttribute("data-state", "ready", { timeout: 15_000 });
      await expect(page.getByTestId("ref-row")).toHaveCount(6);
      await shot(page, "visual", `account-referrals-${theme}`, { fullPage: true });
      await page.getByTestId("ref-share").click();
      await expect(page.getByTestId("share-dialog")).toBeVisible();
      await shot(page, "visual", `account-referrals-share-${theme}`);
      await page.keyboard.press("Escape");
      await page.goto("/admin/subscriptions");
      await expect(page.getByTestId("admin-shell")).toHaveAttribute("data-state", "ready", { timeout: 15_000 });
      await page.getByTestId("subs-tab-commissions").click();
      await expect(page.getByTestId("cms-row")).toHaveCount(1);
      await shot(page, "visual", `admin-commissions-${theme}`, { fullPage: true });
      await page.getByTestId("cms-mark").click();
      await expect(page.getByTestId("cms-mark-dialog")).toBeVisible();
      await shot(page, "visual", `admin-commissions-mark-${theme}`);
    });

    test(`HC-AD-086 /admin/users and the user drawer ${theme}`, async ({ page, request }) => {
      await seedUser(request, { email: `um-${theme}@example.com`, role: "admin", referrals: 4 });
      await signIn(page, `um-${theme}@example.com`);
      await page.evaluate((t) => {
        localStorage.setItem("hapiecoin.theme", t);
      }, theme);
      await page.goto("/admin/users");
      await expect(page.getByTestId("admin-users")).toHaveAttribute("data-state", "ready", { timeout: 15_000 });
      await expect(page.getByTestId("um-row")).toHaveCount(5);
      await page.getByTestId("um-row").nth(1).getByTestId("um-select").check();
      await shot(page, "visual", `admin-users-${theme}`, { fullPage: true });
      await page.locator(`[data-testid=um-row][data-email="um-${theme}@example.com"]`).click(); // the admin is the referrer
      await expect(page.getByTestId("user-drawer")).toHaveAttribute("data-state-load", "ready");
      await page.getByTestId("drawer-tab-referrals").click();
      await expect(page.getByTestId("drawer-referrals")).toBeVisible();
      await shot(page, "visual", `admin-user-drawer-${theme}`);
    });

    test(`HC-AD-059 /admin/banners and HC-SH-055 the flyer ${theme}`, async ({ page, request }) => {
      await seedUser(request, { email: `bn-${theme}@example.com`, role: "admin", banners: 4 });
      await signIn(page, `bn-${theme}@example.com`);
      await page.evaluate((t) => {
        localStorage.setItem("hapiecoin.theme", t);
      }, theme);
      await page.goto("/analyse");
      await expect(page.getByTestId("flyer")).toHaveAttribute("data-count", "2", { timeout: 15_000 });
      await shot(page, "visual", `analyse-flyer-${theme}`);
      await page.getByTestId("flyer-dismiss").click();
      await page.goto("/admin/banners");
      await expect(page.getByTestId("admin-banners")).toHaveAttribute("data-state", "ready", { timeout: 15_000 });
      await expect(page.getByTestId("banner-row")).toHaveCount(4);
      await shot(page, "visual", `admin-banners-${theme}`, { fullPage: true });
      await page.getByTestId("banner-new").click();
      await expect(page.getByTestId("banner-dialog")).toBeVisible();
      await shot(page, "visual", `admin-banner-dialog-${theme}`);
    });

    test(`HC-AC-016 subscribe dialog, HC-AC-062 invoice and HC-AD-029 coupons ${theme}`, async ({ page, request }) => {
      await seedUser(request, { email: `chk-${theme}@example.com`, role: "admin", plan: { state: "free" }, coupons: true, payments: 4 });
      await signIn(page, `chk-${theme}@example.com`);
      await page.evaluate((t) => {
        localStorage.setItem("hapiecoin.theme", t);
      }, theme);
      await page.goto("/subscription");
      await expect(page.getByTestId("subscription-page")).toHaveAttribute("data-state", "ready", { timeout: 15_000 });
      await page.getByTestId("plan-card").nth(2).getByTestId("plan-action").click();
      await expect(page.getByTestId("coupon-option").first()).toBeVisible();
      await page.getByTestId("coupon-input").fill("basic20");
      await page.getByTestId("coupon-apply").click();
      await expect(page.getByTestId("coupon-chip")).toBeVisible();
      await shot(page, "visual", `account-subscribe-${theme}`);
      await page.keyboard.press("Escape");
      await expect(page.getByTestId("payment-row").first()).toBeVisible();
      await page.getByTestId("payment-invoice").first().click();
      await expect(page.getByTestId("invoice-dialog")).toHaveAttribute("data-state-load", "ready");
      await shot(page, "visual", `account-invoice-${theme}`);
      await page.keyboard.press("Escape");
      await page.goto("/admin/coupons");
      await expect(page.getByTestId("coupon-row")).toHaveCount(4, { timeout: 15_000 });
      await shot(page, "visual", `admin-coupons-${theme}`, { fullPage: true });
    });

    test(`HC-AD-071 promotional emails compose and history ${theme}`, async ({ page, request }) => {
      await seedUser(request, { email: `em-${theme}@example.com`, role: "admin", referrals: 3, campaigns: 3 });
      await signIn(page, `em-${theme}@example.com`);
      await page.evaluate((t) => {
        localStorage.setItem("hapiecoin.theme", t);
      }, theme);
      await page.goto("/admin/emails");
      await expect(page.getByTestId("email-recipient")).toHaveCount(4, { timeout: 15_000 });
      await page.getByTestId("email-recipient").first().check();
      await page.getByTestId("email-template-plan_expiring").click();
      await expect(page.getByTestId("email-preview-subject")).not.toContainText("{{");
      await shot(page, "visual", `admin-emails-${theme}`, { fullPage: true });
      await page.getByTestId("emails-tab-history").click();
      await expect(page.getByTestId("campaign-row")).toHaveCount(3);
      await shot(page, "visual", `admin-emails-history-${theme}`, { fullPage: true });
    });
  });
}
