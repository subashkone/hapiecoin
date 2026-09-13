// Phone pass (ADR-080; HC-SH-130, HC-SH-131, HC-WS-115): the Analyse workspace, the chain, the cards and the dialogs on
// a Pixel 7 profile (412 × 839, touch). Runs under the `phone` (Pixel 7) and `phone-ios` (iPhone 14 on Chromium)
// Playwright projects only. The home-screen app (ADR-082; HC-SH-134, HC-SH-135) is proven here too.
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

  test("HC-SH-130 the header compacts, the panes stack, the tab strips scroll to their last tab, and nothing scrolls sideways", async ({ page }, testInfo) => {
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
      // one capture per profile: analyse-phone-* is the Pixel 7, analyse-iphone-* the iPhone 14 (ADR-082)
      const device = testInfo.project.name === "phone-ios" ? "iphone" : "phone";
      await page.screenshot({ path: `${DIR}/analyse-${device}-${theme}.png` });
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

  test("HC-SH-134 the manifest names HapieCoin with 192 and 512 px icons, and the settings menu offers Install (iPhone: the Share-sheet steps)", async ({ page, request }, testInfo) => {
    const manifest = await request.get("/manifest.webmanifest");
    expect(manifest.ok()).toBe(true);
    const body = (await manifest.json()) as { name: string; display: string; start_url: string; icons: { src: string; sizes: string; purpose?: string }[] };
    expect(body.name).toBe("HapieCoin");
    expect(body.display).toBe("standalone");
    expect(body.start_url).toBe("/analyse");
    expect(body.icons.map((i) => i.sizes)).toEqual(expect.arrayContaining(["192x192", "512x512"]));
    expect(body.icons.some((i) => i.purpose === "maskable"), "a maskable icon").toBe(true);
    for (const icon of body.icons) expect((await request.get(icon.src)).headers()["content-type"]).toContain("image/png");
    await expect(page.locator('link[rel="manifest"]')).toHaveAttribute("href", "/manifest.webmanifest");
    const ios = testInfo.project.name === "phone-ios";
    await page.getByTestId("settings-gear").click();
    const item = page.getByTestId("menu-install");
    if (ios) {
      // Safari has no install prompt: the hint toast and the menu item both lead to the two Share-sheet steps
      await expect(item).toContainText("iPhone");
      await item.click();
      const dialog = page.getByTestId("install-dialog");
      await expect(dialog).toHaveAttribute("data-state-install", "ios");
      await expect(dialog.getByTestId("install-ios-steps")).toContainText("Add to Home Screen");
      await page.keyboard.press("Escape");
      await expect(page.evaluate(() => localStorage.getItem("hapiecoin.install-hint"))).resolves.toBe("1");
    } else {
      // headless Chrome never fires beforeinstallprompt, so the item is absent rather than misleading
      await expect(item).toHaveCount(0);
      await page.keyboard.press("Escape");
    }
  });

  test("HC-SH-135 the service worker registers, an offline navigation shows the offline page, and the live chain never comes from a cache", async ({ page, context }) => {
    await expect(page.getByTestId("chain-table")).toHaveAttribute("data-rows", /^[1-9][0-9]?$/, { timeout: 15_000 });
    const scope = await page.evaluate(async () => {
      const reg = await navigator.serviceWorker.ready;
      return reg.scope;
    });
    expect(scope).toMatch(/\/$/);
    const cached = await page.evaluate(async () => {
      const names = await caches.keys();
      const keys: string[] = [];
      for (const n of names) for (const r of await (await caches.open(n)).keys()) keys.push(new URL(r.url).pathname);
      return keys;
    });
    expect(cached).toContain("/offline");
    expect(cached.filter((k) => k.startsWith("/icons/"))).toEqual([]); // the manifest fetches icons itself
    expect(cached.filter((k) => k.startsWith("/v1/") || k.startsWith("/api/") || k === "/analyse")).toEqual([]);
    await context.setOffline(true);
    await page.goto("/analytics", { waitUntil: "commit" }).catch(() => undefined);
    await expect(page.getByTestId("offline-page")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("offline-page")).toContainText("You are offline");
    await noSidewaysScroll(page);
    await context.setOffline(false);
    await page.getByTestId("offline-retry").click();
    await expect(page.getByTestId("chain-table")).toHaveAttribute("data-rows", /^[1-9][0-9]?$/, { timeout: 20_000 });
  });
});
