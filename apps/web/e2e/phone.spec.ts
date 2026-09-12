// Phone pass (ADR-080; HC-SH-130, HC-SH-131, HC-WS-115): the Analyse workspace, the chain, the cards and the dialogs on
// a Pixel 7 profile (412 × 839, touch). Runs under the `phone` Playwright project only.
import type { Page } from "@playwright/test";
import { expect, seedUser, signIn, test } from "./fixtures";

const DIR = "e2e/__screenshots__";
/** The page must never scroll sideways: the document is no wider than the viewport. */
async function noSidewaysScroll(page: Page) {
  const [scrollWidth, innerWidth] = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
  expect(scrollWidth, "document wider than the viewport").toBeLessThanOrEqual(innerWidth);
}

test.describe("HC-SH-130 the workspace on a phone", () => {
  test.beforeEach(async ({ page, request }) => {
    await seedUser(request, { email: "phone@example.com", plan: { state: "active", planName: "Pro plan", expiresAt: "2026-12-31T00:00:00Z", daysLeft: 100 }, connected: true, fills: true });
    await signIn(page, "phone@example.com");
  });

  test("HC-SH-130 the header compacts, the panes stack, the tab strips scroll to their last tab, and nothing scrolls sideways", async ({ page }) => {
    await expect(page.getByTestId("workspace")).toHaveAttribute("data-layout", "stacked");
    await expect(page.getByTestId("chain-table")).toHaveAttribute("data-rows", /^[1-9][0-9]?$/, { timeout: 15_000 });
    await expect(page.getByTestId("exchange-chip")).toBeHidden();
    await expect(page.getByTestId("currency-toggle")).toBeHidden();
    await expect(page.getByTestId("left-tab-info")).toBeHidden();
    await noSidewaysScroll(page);
    // the left strip reaches its last tab; the analysis strip reaches Replay
    await page.getByTestId("tab-screener").click();
    await expect(page.getByTestId("tab-screener")).toHaveAttribute("data-state", "active");
    await page.getByTestId("stack-analysis").click();
    const replayTab = page.getByTestId("analysis-tab-replay");
    const strip = await replayTab.evaluate((el) => {
      const list = el.parentElement!;
      return { overflowX: getComputedStyle(list).overflowX, wider: list.scrollWidth > list.clientWidth };
    });
    expect(strip, "the analysis strip scrolls sideways").toEqual({ overflowX: "auto", wider: true });
    await replayTab.click();
    const tabBox = await replayTab.boundingBox();
    const viewport = page.viewportSize()!;
    expect(tabBox!.x + tabBox!.width, "the last tab scrolled into the viewport").toBeLessThanOrEqual(viewport.width);
    await expect(page.getByTestId("replay-panel")).toBeVisible();
    await page.getByTestId("analysis-tab-payoff").click();
    await expect(page.getByTestId("analysis-tab-payoff")).toHaveAttribute("data-state", "active");
    await page.getByTestId("stack-left").click();
    await page.getByTestId("tab-chain").click();
    await noSidewaysScroll(page);
    for (const theme of ["dark", "light"] as const) {
      await page.evaluate((t) => localStorage.setItem("hapiecoin.theme", t), theme);
      await page.reload();
      await expect(page.getByTestId("chain-table")).toHaveAttribute("data-rows", /^[1-9][0-9]?$/, { timeout: 15_000 });
      await page.screenshot({ path: `${DIR}/analyse-phone-${theme}.png` });
    }
  });

  test("HC-SH-131 the chain shows one side at a time and a tapped row carries finger-sized controls", async ({ page }) => {
    await expect(page.getByTestId("chain-table")).toHaveAttribute("data-rows", /^[1-9][0-9]?$/, { timeout: 15_000 });
    const side = page.getByTestId("chain-side");
    await expect(side).toBeVisible(); // the narrow toggle: calls or puts, not both
    await expect(page.getByTestId("chain-puts")).toHaveCount(0);
    const row = page.getByTestId("chain-row-calls").nth(3);
    await row.tap();
    const controls = page.getByTestId("row-controls-calls");
    await expect(controls).toBeVisible();
    await expect(controls).toHaveAttribute("data-coarse", "true");
    const buy = page.getByTestId("row-buy-calls");
    const box = await buy.boundingBox();
    expect(box, "the buy control has a box").not.toBeNull();
    expect(box!.width).toBeGreaterThanOrEqual(32);
    expect(box!.height).toBeGreaterThanOrEqual(32);
    await buy.tap();
    await expect(page.getByTestId("builder-count")).toHaveText("1");
    // the puts side reaches its controls the same way
    await side.getByRole("button", { name: /puts/i }).click();
    await expect(page.getByTestId("chain-puts")).toHaveCount(1);
    await page.getByTestId("chain-row-puts").nth(3).tap({ position: { x: 24, y: 8 } }); // the visible cells, not the strike column beside them
    await expect(page.getByTestId("row-controls-puts")).toBeVisible();
  });

  test("HC-WS-115 the cards, the journal, a dialog and the public page fit a phone", async ({ page, request }) => {
    await page.getByTestId("tab-paper").click();
    await expect(page.getByTestId("paper-panel")).toBeVisible();
    await noSidewaysScroll(page);
    await page.getByTestId("tab-journal").click();
    await expect(page.getByTestId("journal-stats").or(page.getByTestId("verified-block"))).toBeVisible({ timeout: 15_000 });
    await noSidewaysScroll(page);
    await page.getByTestId("settings-gear").click();
    await page.getByTestId("menu-currency").click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    const dbox = await dialog.boundingBox();
    const width = await page.evaluate(() => window.innerWidth);
    expect(dbox!.width).toBeLessThanOrEqual(width);
    expect(dbox!.x).toBeGreaterThanOrEqual(0);
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    // the public trader page, the first thing a stranger opens from a shared link
    await seedUser(request, { email: "asha@example.com", connected: true, fills: true, publicHandle: "asha_phone" });
    await page.goto("/t/asha_phone");
    await expect(page.getByTestId("trader-page")).toHaveAttribute("data-state", "ready");
    await expect(page.getByTestId("share-bar")).toBeVisible();
    await noSidewaysScroll(page);
  });
});
