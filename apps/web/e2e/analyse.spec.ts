import { expect, seedUser, signIn, test } from "./fixtures";
import { strikesOf } from "../test/fixtures/chain";

test.describe("HC-SH analyse header and live chain", () => {
  test.beforeEach(async ({ page, request }) => {
    await seedUser(request, { email: "trader@example.com", plan: { state: "active", planName: "Pro plan", expiresAt: "2026-12-31T00:00:00Z" } });
    await signIn(page, "trader@example.com");
  });

  test("HC-SH-003 / HC-SH-004 asset switch and live futures price from the gateway", async ({ page }) => {
    const price = page.getByTestId("futures-price-value");
    await expect(price).not.toHaveText("—", { timeout: 15_000 });
    await expect(page.getByText("Futures · BTCUSD")).toBeVisible();
    await expect(page.getByTestId("feed-status")).toHaveAttribute("data-state", "live");
    await expect(page.getByTestId("feed-status")).toContainText(/ms/);
    const before = await price.textContent();
    await page.getByTestId("asset-ETH").click();
    await expect(page.getByText("Futures · ETHUSD")).toBeVisible();
    await expect(price).not.toHaveText(before ?? "", { timeout: 15_000 });
    await expect(page.getByTestId("plan-banner")).toContainText("Congratulations! Your plan is active until 31 Dec 2026");
  });

  test("HC-WS-108 chain panel renders the exact strikes the fake gateway serves, with an ATM band", async ({ page }) => {
    const chips = page.getByTestId("expiry-chip");
    await expect(chips.first()).toBeVisible();
    await expect(page.getByText("expiries · gateway")).toBeVisible();
    const table = page.getByTestId("chain-table");
    // The selected chip is the nearest expiry the fake gateway serves; its row count must equal the recorded ladder.
    const selected = await page.locator("[data-testid=expiry-chip][aria-selected=true]").getAttribute("data-expiry");
    const listed = strikesOf("BTC", selected ?? "");
    expect(listed.length).toBeGreaterThan(10);
    // the venue list is the total; the default ±12 range only slices it (HC-WS-016), "all" shows every row
    await expect(table).toHaveAttribute("data-total", String(listed.length), { timeout: 15_000 });
    await page.getByTestId("chain-range-0").click();
    await expect(table).toHaveAttribute("data-rows", String(listed.length));
    const rendered = await page.getByTestId("chain-row").evaluateAll((els) => els.map((e) => e.getAttribute("data-strike")));
    expect(rendered.length).toBeGreaterThan(10);
    // every rendered strike is one of the recorded instrument-list strikes for that expiry (ADR-006)
    for (const s of rendered) expect(listed).toContain(s);
    await expect(page.locator("[data-testid=chain-row][data-atm=true]")).toHaveCount(1);
    await expect(page.locator("[data-testid=chain-row][data-atm=true]")).toContainText("ATM ·");
    // deltas keep flowing: the seq counter advances
    await expect(page.getByText(/seq [1-9]/)).toBeVisible({ timeout: 15_000 });
    await chips.nth(1).click();
    await expect(page.getByTestId("chain-panel")).toHaveAttribute("data-topic", /chain:delta_india:BTC:2026-/);
  });

  test("HC-WS-016 chain opens centred on ATM and the range control filters rows", async ({ page }) => {
    const table = page.getByTestId("chain-table");
    await expect(table).toHaveAttribute("data-range", "12");
    await expect(page.locator("[data-testid=chain-row][data-atm=true]")).toHaveCount(1, { timeout: 15_000 });
    const total = Number(await table.getAttribute("data-total"));
    expect(total).toBeGreaterThan(25);
    // ±12 keeps at most 25 rows (fewer when the ATM sits near an edge of the list) and never invents any
    const rows12 = Number(await table.getAttribute("data-rows"));
    expect(rows12).toBeGreaterThan(12);
    expect(rows12).toBeLessThanOrEqual(25);
    expect(rows12).toBeLessThan(total);
    await expect(page.getByTestId("chain-count")).toHaveText(`${rows12} of ${total} strikes`);
    // the ATM row sits inside the viewport after the auto-centre
    const viewport = await page.getByTestId("chain-scroll").boundingBox();
    const atm = await page.locator("[data-testid=chain-row][data-atm=true]").boundingBox();
    expect(atm && viewport && atm.y >= viewport.y - 1 && atm.y + atm.height <= viewport.y + viewport.height + 1).toBe(true);
    // and near the middle, not merely inside
    const mid = viewport!.y + viewport!.height / 2;
    expect(Math.abs(atm!.y + atm!.height / 2 - mid)).toBeLessThan(viewport!.height / 4);
    await page.getByTestId("chain-range-6").click();
    await expect.poll(async () => Number(await table.getAttribute("data-rows"))).toBeLessThanOrEqual(13);
    expect(Number(await table.getAttribute("data-rows"))).toBeLessThan(rows12);
    await page.getByTestId("chain-range-0").click();
    await expect(table).toHaveAttribute("data-rows", String(total));
    await page.getByTestId("chain-range-12").click();
    await expect(table).toHaveAttribute("data-rows", String(rows12));
  });

  test("HC-WS-015 chain header stays pinned while scrolling; GAPS-2 calls and puts share the vertical scroll and mirror the horizontal one", async ({ page }) => {
    await expect(page.locator("[data-testid=chain-row][data-atm=true]")).toHaveCount(1, { timeout: 15_000 });
    await page.getByTestId("chain-range-0").click();
    const header = page.getByTestId("chain-header");
    const before = await header.boundingBox();
    const scroller = page.getByTestId("chain-scroll");
    await scroller.evaluate((el) => {
      el.scrollTop = 400;
    });
    await expect.poll(() => scroller.evaluate((el) => el.scrollTop)).toBe(400);
    const after = await header.boundingBox();
    expect(after?.y).toBe(before?.y);
    // one vertical scroller: the strike column, calls track and puts track render the same strikes at the same offsets
    const strikes = await page.getByTestId("chain-row").evaluateAll((els) => els.map((e) => e.getAttribute("data-strike")));
    await expect.poll(() => page.getByTestId("chain-row-calls").evaluateAll((els) => els.map((e) => e.getAttribute("data-strike")))).toEqual(strikes);
    await expect.poll(() => page.getByTestId("chain-row-puts").evaluateAll((els) => els.map((e) => e.getAttribute("data-strike")))).toEqual(strikes);
    const y = (id: string) => page.locator(`[data-testid=${id}]`).first().evaluate((e) => e.getBoundingClientRect().top);
    expect(await y("chain-row-calls")).toBe(await y("chain-row"));
    expect(await y("chain-row-puts")).toBe(await y("chain-row"));
    // horizontal: shrink the left pane so the tracks overflow, then move one side and read the mirrored offset
    await page.setViewportSize({ width: 1100, height: 800 });
    const table = page.getByTestId("chain-table");
    await expect.poll(async () => Number(await table.getAttribute("data-x"))).toBeGreaterThan(0);
    const max = Number(await table.getAttribute("data-x"));
    await expect(table).toHaveAttribute("data-puts-x", "0");
    await page.getByTestId("chain-calls").hover();
    await page.mouse.wheel(-40, 0);
    await expect.poll(async () => Number(await table.getAttribute("data-x"))).toBe(max - 40);
    await expect(table).toHaveAttribute("data-puts-x", "40");
    await expect(page.getByTestId("chain-head-calls")).toHaveAttribute("data-x", String(max - 40));
    await expect(page.getByTestId("chain-head-puts")).toHaveAttribute("data-x", "40");
    await page.getByTestId("chain-puts").hover();
    await page.mouse.wheel(-40, 0);
    await expect.poll(async () => Number(await table.getAttribute("data-puts-x"))).toBeLessThanOrEqual(1);
    expect(Math.abs(Number(await table.getAttribute("data-x")) - max)).toBeLessThanOrEqual(1);
    // a vertical wheel over a track scrolls the rows, not the columns
    const topBefore = await scroller.evaluate((el) => el.scrollTop);
    await page.mouse.wheel(0, 120);
    await expect.poll(() => scroller.evaluate((el) => el.scrollTop)).toBeGreaterThan(topBefore);
    expect(Math.abs(Number(await table.getAttribute("data-x")) - max)).toBeLessThanOrEqual(1);
  });

  test("HC-WS-016 keyboard moves the highlighted strike and A recentres", async ({ page }) => {
    await expect(page.locator("[data-testid=chain-row][data-atm=true]")).toHaveCount(1, { timeout: 15_000 });
    const atmStrike = await page.locator("[data-testid=chain-row][data-atm=true]").getAttribute("data-strike");
    await page.getByTestId("chain-scroll").focus();
    await page.keyboard.press("j");
    const focused = page.locator("[data-testid=chain-row][data-focus=true]");
    await expect(focused).toHaveCount(1);
    expect(Number(await focused.getAttribute("data-strike"))).toBeGreaterThan(Number(atmStrike));
    await page.keyboard.press("End");
    const last = await page.getByTestId("chain-row").last().getAttribute("data-strike");
    await expect(focused).toHaveAttribute("data-strike", last!);
    await page.keyboard.press("a");
    await expect(focused).toHaveAttribute("data-strike", atmStrike!);
  });

  test("HC-SH-006 feed status pauses and reconnects", async ({ page }) => {
    const feed = page.getByTestId("feed-status");
    await expect(feed).toHaveAttribute("data-state", "live", { timeout: 15_000 });
    await feed.click();
    await expect(feed).toHaveAttribute("data-state", "paused");
    await expect(page.getByText("Feed paused").first()).toBeVisible();
    await feed.click();
    await expect(feed).toHaveAttribute("data-state", "live", { timeout: 15_000 });
  });

  test("HC-SH-026 logout confirm signs out and returns to the landing page", async ({ page }) => {
    await page.getByTestId("settings-gear").click();
    await page.getByTestId("menu-logout").click();
    await expect(page.getByText("Confirm Logout")).toBeVisible();
    await page.getByTestId("logout-confirm").click();
    await expect(page).toHaveURL(/\/$/);
    await page.goto("/analyse");
    await expect(page).toHaveURL(/\/auth\?next=/);
  });
});
