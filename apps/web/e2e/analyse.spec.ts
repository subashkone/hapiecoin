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

  test("HC-WS-010 gear opens Column Settings and toggles apply to the chain; HC-WS-012 presets", async ({ page }) => {
    const table = page.getByTestId("chain-table");
    await expect(table).toHaveAttribute("data-columns", "ask,mark,bid,oi,delta", { timeout: 15_000 });
    await page.getByTestId("chain-columns").click();
    const dialog = page.getByTestId("column-settings");
    await expect(dialog).toBeVisible();
    await expect(page.getByTestId("columns-counter")).toHaveText("5 of 13 columns visible");
    await page.getByRole("switch", { name: "Gamma" }).click();
    await expect(page.getByTestId("columns-counter")).toHaveText("6 of 13 columns visible");
    await expect(table).toHaveAttribute("data-columns", "ask,mark,bid,oi,delta,gamma");
    await expect(page.getByTestId("chain-head-puts").locator("[data-col=gamma]")).toHaveText("Γ");
    await page.getByTestId("columns-preset-none").click();
    await expect(table).toHaveAttribute("data-columns", "");
    await expect(page.getByTestId("chain-head-puts")).toContainText("no columns");
    await page.getByTestId("columns-preset-essentials").click();
    await expect(table).toHaveAttribute("data-columns", "ask,mark,bid,oi,delta");
    await page.getByTestId("columns-done").click();
    await expect(dialog).toBeHidden();
  });

  test("HC-WS-013 reorder moves a column next to the strike on both sides; HC-WS-014 the layout survives a reload", async ({ page }) => {
    const table = page.getByTestId("chain-table");
    await expect(table).toHaveAttribute("data-columns", "ask,mark,bid,oi,delta", { timeout: 15_000 });
    await page.getByTestId("chain-columns").click();
    await page.getByTestId("columns-tab-reorder").click();
    // Δ up four times: it becomes the column touching the strike on both sides
    for (let i = 0; i < 4; i += 1) await page.getByTestId("columns-up-delta").click();
    await expect(table).toHaveAttribute("data-columns", "delta,ask,mark,bid,oi");
    const putHeads = page.getByTestId("chain-head-puts").locator("[data-col]");
    await expect(putHeads.first()).toHaveAttribute("data-col", "delta");
    const callHeads = page.getByTestId("chain-head-calls").locator("[data-col]");
    await expect(callHeads.last()).toHaveAttribute("data-col", "delta");
    await page.getByTestId("columns-done").click();
    await page.reload();
    await expect(page.getByTestId("chain-table")).toHaveAttribute("data-columns", "delta,ask,mark,bid,oi", { timeout: 15_000 });
    // clean up for the other tests (the layout is persisted per browser context)
    await page.getByTestId("chain-columns").click();
    await page.getByTestId("columns-preset-reset").click();
    await expect(page.getByTestId("chain-table")).toHaveAttribute("data-columns", "ask,mark,bid,oi,delta");
  });

  test("HC-WS-023 / HC-WS-024 / HC-WS-027 hover control adds a call and a put leg at mark; pills and stripes survive a reload", async ({ page }) => {
    await expect(page.locator("[data-testid=chain-row][data-atm=true]")).toHaveCount(1, { timeout: 15_000 });
    const atm = page.locator("[data-testid=chain-row][data-atm=true]");
    const strike = (await atm.getAttribute("data-strike"))!;
    const callsRow = page.locator(`[data-testid=chain-row-calls][data-strike="${strike}"]`);
    await callsRow.hover();
    const controls = page.getByTestId("row-controls-calls");
    await expect(controls).toBeVisible();
    await expect(controls).toHaveAttribute("data-strike", strike);
    await expect(page.getByTestId("row-lots-value-calls")).toHaveText("100");
    await page.getByTestId("row-lots-up-calls").click();
    await expect(page.getByTestId("row-lots-value-calls")).toHaveText("250");
    await page.getByTestId("row-buy-calls").click();
    await expect(page.getByText("Leg added")).toBeVisible();
    await expect(atm).toHaveAttribute("data-legs", "C B 250");
    await expect(callsRow).toHaveAttribute("data-leg", "buy");
    await expect(callsRow.locator("[data-col=mark]")).toHaveClass(/legcell-buy/);
    await expect(page.getByTestId("row-buy-calls")).toHaveAttribute("aria-pressed", "true");
    const putsRow = page.locator(`[data-testid=chain-row-puts][data-strike="${strike}"]`);
    await putsRow.hover();
    await page.getByTestId("row-sell-puts").click();
    await expect(atm).toHaveAttribute("data-legs", "C B 250|P S 250");
    await expect(putsRow).toHaveAttribute("data-leg", "sell");
    // persisted per browser context (ADR-022)
    await page.reload();
    await expect(page.locator(`[data-testid=chain-row][data-strike="${strike}"]`)).toHaveAttribute("data-legs", "C B 250|P S 250", { timeout: 15_000 });
    await page.getByTestId("chain-scroll").focus();
    // clean up for the other tests: Esc clears the highlight; legs are cleared through the store in the next test's seed
    await page.evaluate(() => localStorage.removeItem("hapiecoin.ui"));
  });

  test("HC-WS-026 details dialog opens from the info button and Enter, and adds a leg with the chosen lots", async ({ page }) => {
    await expect(page.locator("[data-testid=chain-row][data-atm=true]")).toHaveCount(1, { timeout: 15_000 });
    const strike = (await page.locator("[data-testid=chain-row][data-atm=true]").getAttribute("data-strike"))!;
    await page.locator(`[data-testid=chain-row-puts][data-strike="${strike}"]`).hover();
    await page.getByTestId("row-info-puts").click();
    const dialog = page.getByTestId("option-details");
    await expect(dialog).toBeVisible();
    await expect(page.getByTestId("option-symbol")).toHaveText(new RegExp(`^P-BTC-${Number(strike)}-\\d{6}$`));
    await expect(page.getByTestId("option-description")).toContainText("PUT · BTC");
    await expect(page.getByTestId("option-mark")).not.toHaveText("—", { timeout: 15_000 });
    await expect(page.getByTestId("option-stats")).toContainText("Gamma");
    await page.getByTestId("option-lots").selectOption("5");
    await page.getByTestId("option-buy").click();
    await expect(dialog).toBeHidden();
    await expect(page.locator(`[data-testid=chain-row][data-strike="${strike}"]`)).toHaveAttribute("data-legs", "P B 5");
    // Enter on the highlighted row opens the call details
    await page.getByTestId("chain-scroll").focus();
    await page.keyboard.press("a");
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("option-symbol")).toHaveText(/^C-BTC-/);
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await page.evaluate(() => localStorage.removeItem("hapiecoin.ui"));
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

test.describe("HC-TR / HC-WS Builder, templates and the analysis pane", () => {
  test.beforeEach(async ({ page, request }) => {
    await seedUser(request, { email: "builder@example.com", plan: { state: "active", planName: "Pro plan", expiresAt: "2026-12-31T00:00:00Z" } });
    await signIn(page, "builder@example.com");
    await page.evaluate(() => localStorage.removeItem("hapiecoin.ui"));
    await page.reload();
    await expect(page.locator("[data-testid=chain-row][data-atm=true]")).toHaveCount(1, { timeout: 15_000 });
  });

  test("HC-TR-040 / HC-WS-033 / HC-WS-039 a template loads legs into the Builder and the payoff tiles and chart appear", async ({ page }) => {
    await expect(page.getByTestId("payoff-panel")).toHaveAttribute("data-state", "empty");
    await page.getByTestId("tab-builder").click();
    await page.getByTestId("builder-tab-templates").click();
    await expect(page.getByTestId("template-card")).toHaveCount(28);
    await page.getByTestId("template-cat-neutral").click();
    await page.locator("[data-testid=template-card][data-name='Iron Condor']").click();
    await expect(page.getByTestId("builder-panel")).toHaveAttribute("data-legs", "4");
    await expect(page.getByTestId("builder-count")).toHaveText("4");
    await expect(page.getByTestId("strategy-name")).toHaveValue("Iron Condor");
    await expect(page.getByTestId("payoff-panel")).toHaveAttribute("data-state", "ready", { timeout: 15_000 });
    await expect(page.getByTestId("tile-max-profit")).not.toContainText("—");
    await expect(page.getByTestId("tile-breakeven")).toContainText("%"); // two break-evens, each as % from spot (ADR-028)
    await expect(page.getByTestId("tile-net")).toContainText("credit received");
    await expect(page.getByTestId("payoff-chart")).toHaveAttribute("data-points", /^[1-9]\d+$/);
    await expect(page.getByTestId("win-zone")).toContainText("–");
    // HC-WS-007 the chain's expiry chip carries the leg dot
    await page.getByTestId("tab-chain").click();
    await expect(page.getByTestId("expiry-dot").first()).toBeVisible();
    // HC-TR-040 strip: one click from the Builder legs replaces the strategy (ADR-027)
    await page.getByTestId("tab-builder").click();
    await page.getByTestId("builder-tab-builder").click();
    await expect(page.getByTestId("templates-strip")).toHaveAttribute("data-open", "true");
    await page.getByTestId("strip-cat-neutral").click();
    await expect(page.locator("[data-testid=strip-card][data-name='Iron Condor']")).toBeEnabled({ timeout: 15_000 });
    await page.locator("[data-testid=strip-card][data-name='Iron Condor']").click();
    await expect(page.getByTestId("builder-panel")).toHaveAttribute("data-legs", "4");
    await expect(page.getByTestId("strategy-name")).toHaveValue("Iron Condor");
  });

  test("HC-TR-009 / HC-TR-011 / HC-TR-013 builder edits: side, lots, custom price, delete; HC-TR-020 / HC-TR-044 save draft, list, load, delete", async ({ page }) => {
    const strike = (await page.locator("[data-testid=chain-row][data-atm=true]").getAttribute("data-strike"))!;
    await page.locator(`[data-testid=chain-row-calls][data-strike="${strike}"]`).hover();
    await page.getByTestId("row-buy-calls").click();
    await page.getByTestId("tab-builder").click();
    const row = page.getByTestId("leg-row").first();
    await expect(row).toHaveAttribute("data-side", "buy");
    await row.getByTestId("leg-side").click();
    await expect(row).toHaveAttribute("data-side", "sell");
    await row.getByTestId("leg-lots-up").click();
    await expect(row.getByTestId("leg-lots")).toHaveValue("250");
    // HC-TR-146 untick the leg: it stays in the table but leaves the analysis; HC-TR-147 CE → PE in place
    await row.getByTestId("leg-enabled").click();
    await expect(page.getByTestId("builder-panel")).toHaveAttribute("data-active-legs", "0");
    await expect(row).toHaveAttribute("data-enabled", "false");
    await row.getByTestId("leg-enabled").click();
    await expect(page.getByTestId("builder-panel")).toHaveAttribute("data-active-legs", "1");
    await row.getByTestId("leg-kind").click();
    await expect(row.getByTestId("leg-kind")).toHaveText("PE");
    await expect(row.getByTestId("leg-strike")).toHaveValue(strike);
    // HC-SH-012 header currency toggle
    await page.getByTestId("currency-toggle").click();
    await expect(page.getByTestId("currency-toggle")).toHaveAttribute("data-currency", "INR");
    await page.getByTestId("currency-toggle").click();
    await expect(page.getByTestId("currency-toggle")).toHaveAttribute("data-currency", "USD");
    await page.getByTestId("price-mode").click();
    await row.getByTestId("leg-price-input").fill("999.5");
    await page.getByTestId("price-mode").click();
    await expect(row.getByTestId("leg-price")).not.toHaveText("999.5");
    // save as a draft
    await page.getByTestId("strategy-name").fill("E2E short call");
    await page.getByTestId("builder-save").click();
    await page.getByTestId("save-draft-confirm").click();
    await expect(page.getByTestId("builder-save")).toHaveText("Update");
    await page.getByTestId("builder-new").click();
    await expect(page.getByText("No legs added")).toBeVisible();
    await page.getByTestId("builder-tab-templates").click();
    await expect(page.getByTestId("mine-card")).toHaveCount(1);
    await page.getByTestId("mine-load").click();
    await expect(page.getByTestId("builder-panel")).toHaveAttribute("data-legs", "1");
    await expect(page.getByTestId("strategy-name")).toHaveValue("E2E short call");
    // delete the leg, then the draft
    await page.getByTestId("leg-delete").click();
    await expect(page.getByText("No legs added")).toBeVisible();
    await page.getByTestId("builder-tab-templates").click();
    await page.getByTestId("mine-delete").click();
    await page.getByTestId("mine-delete-confirm").click();
    await expect(page.getByTestId("mine-empty")).toBeVisible();
    // drafts live in the browser until Phase 3 (ADR-023): none left after a reload
    await page.reload();
    await page.getByTestId("tab-builder").click();
    await page.getByTestId("builder-tab-templates").click();
    await expect(page.getByTestId("mine-empty")).toBeVisible();
  });

  test("HC-TR-027 / HC-TR-035 select from chain and add a future; HC-WS-047 / HC-WS-048 target sliders; HC-WS-059 / HC-WS-062 Greeks and ladder", async ({ page }) => {
    await page.getByTestId("tab-builder").click();
    await page.getByTestId("builder-select-chain").click();
    const picker = page.getByTestId("chain-picker");
    await expect(picker.getByTestId("picker-row").first()).toBeVisible({ timeout: 15_000 });
    const rows = picker.getByTestId("picker-row");
    await rows.nth(10).getByTestId("picker-buy-call").click();
    await rows.nth(14).getByTestId("picker-sell-call").click();
    await expect(picker.getByTestId("picker-add")).toHaveText("Add 2 Legs");
    await picker.getByTestId("picker-add").click();
    await expect(page.getByTestId("builder-panel")).toHaveAttribute("data-legs", "2");
    await page.getByTestId("builder-add-future").click();
    await page.getByTestId("future-sell").click();
    await page.getByTestId("future-add").click();
    await expect(page.getByTestId("builder-panel")).toHaveAttribute("data-legs", "3");
    await expect(page.getByTestId("leg-row").nth(2)).toContainText("BTCUSD");
    // payoff target sliders
    await expect(page.getByTestId("payoff-panel")).toHaveAttribute("data-state", "ready", { timeout: 15_000 });
    const before = await page.getByTestId("ticket-target").textContent();
    await page.getByTestId("target-days-expiry").click();
    await page.getByTestId("target-price").focus();
    await page.keyboard.press("End");
    await expect(page.getByTestId("ticket-target")).not.toHaveText(before ?? "");
    await page.getByTestId("target-price-reset").click();
    // greeks and ladder tabs
    await page.getByTestId("analysis-tab-greeks").click();
    await expect(page.getByTestId("greeks-row")).toHaveCount(3);
    await expect(page.getByTestId("greek-delta")).not.toContainText("—");
    await page.getByTestId("analysis-tab-ladder").click();
    await expect(page.locator("[data-testid=ladder-row][data-status=spot]")).toHaveCount(1);
    await page.evaluate(() => localStorage.removeItem("hapiecoin.ui"));
  });
});

test.describe("HC-TR paper trading (Phase 3 item 1)", () => {
  test.beforeEach(async ({ page, request }) => {
    await seedUser(request, { email: "paper@example.com", plan: { state: "active", planName: "Pro plan", expiresAt: "2026-12-31T00:00:00Z" } });
    await signIn(page, "paper@example.com");
    await page.evaluate(() => localStorage.removeItem("hapiecoin.ui"));
    await page.reload();
    await expect(page.locator("[data-testid=chain-row][data-atm=true]")).toHaveCount(1, { timeout: 15_000 });
  });

  test("HC-TR-022 / HC-TR-050..057 a paper trade from the Builder lands on the Paper tab with live P&L; HC-TR-079 / HC-TR-081 square off and stop", async ({ page }) => {
    const strike = (await page.locator("[data-testid=chain-row][data-atm=true]").getAttribute("data-strike"))!;
    await page.locator(`[data-testid=chain-row-calls][data-strike="${strike}"]`).hover();
    await page.getByTestId("row-buy-calls").click();
    await page.locator(`[data-testid=chain-row-puts][data-strike="${strike}"]`).hover();
    await page.getByTestId("row-sell-puts").click();
    await page.getByTestId("tab-builder").click();
    await page.getByTestId("strategy-name").fill("E2E straddle");
    await page.getByTestId("builder-paper-trade").click();
    const mode = page.getByTestId("trade-mode");
    await expect(mode).toBeVisible();
    await expect(mode.getByTestId("mode-paper")).toHaveAttribute("aria-pressed", "true");
    await expect(mode.getByTestId("trade-broker")).toHaveValue("brk_delta");
    await mode.getByTestId("trade-continue").click();
    const preview = page.getByTestId("trade-preview");
    await expect(preview.getByTestId("preview-row")).toHaveCount(2);
    await preview.getByTestId("trade-now").click();
    await expect(page.getByTestId("paper-panel")).toHaveAttribute("data-count", "1", { timeout: 15_000 });
    await expect(page.getByTestId("paper-count")).toHaveText("1");
    const card = page.getByTestId("paper-card");
    await expect(card.getByTestId("mode-pill")).toHaveAttribute("data-status", "paper");
    await expect(card.getByTestId("card-pnl")).not.toHaveText("—");
    await expect(page.getByTestId("builder-count")).toHaveCount(0);
    // details: square off one leg at market, then stop and archive
    await card.getByTestId("card-details").click();
    const details = page.getByTestId("strategy-details");
    await expect(details.getByTestId("details-leg")).toHaveCount(2);
    await details.getByTestId("details-sqoff").first().click();
    const sq = page.getByTestId("square-off");
    await expect(sq.getByTestId("sqoff-exit")).not.toHaveValue("");
    await sq.getByTestId("sqoff-confirm").click();
    await expect(sq).toBeHidden();
    await details.getByTestId("details-tab-closed").click();
    await expect(details.getByTestId("details-leg")).toHaveCount(1);
    await details.getByTestId("details-stop").click();
    const stop = page.getByTestId("stop-paper");
    await expect(stop.getByTestId("stop-leg")).toHaveCount(1);
    await expect(stop.getByTestId("stop-go")).toHaveText("Stop trading");
    await stop.getByTestId("stop-go").click();
    await expect(details).toBeHidden();
    await expect(page.getByTestId("paper-empty")).toBeVisible();
    // the archived strategy is under My templates → Archived
    await page.getByTestId("tab-builder").click();
    await page.getByTestId("builder-tab-templates").click();
    await page.getByTestId("mine-archived").click();
    await expect(page.getByTestId("mine-card")).toHaveCount(1);
    await expect(page.getByTestId("mine-card")).toContainText("E2E straddle");
  });
});

test.describe("HC-TR-148..152 adjustment workbench (ADR-044)", () => {
  test.beforeEach(async ({ page, request }) => {
    await seedUser(request, { email: "adjust@example.com", plan: { state: "active", planName: "Pro plan", expiresAt: "2026-12-31T00:00:00Z" } });
    await signIn(page, "adjust@example.com");
    await page.evaluate(() => localStorage.removeItem("hapiecoin.ui"));
    await page.reload();
    await expect(page.locator("[data-testid=chain-row][data-atm=true]")).toHaveCount(1, { timeout: 15_000 });
  });

  test("trim a leg and add one from the chain with the combined payoff, review and apply on paper; history and the badge follow", async ({ page }) => {
    const strike = (await page.locator("[data-testid=chain-row][data-atm=true]").getAttribute("data-strike"))!;
    await page.locator(`[data-testid=chain-row-calls][data-strike="${strike}"]`).hover();
    await page.getByTestId("row-buy-calls").click();
    await page.locator(`[data-testid=chain-row-puts][data-strike="${strike}"]`).hover();
    await page.getByTestId("row-sell-puts").click();
    await page.getByTestId("tab-builder").click();
    await page.getByTestId("strategy-name").fill("E2E adjust");
    await page.getByTestId("builder-paper-trade").click();
    await page.getByTestId("trade-mode").getByTestId("trade-continue").click();
    await page.getByTestId("trade-preview").getByTestId("trade-now").click();
    await expect(page.getByTestId("paper-panel")).toHaveAttribute("data-count", "1", { timeout: 15_000 });
    const card = page.getByTestId("paper-card");
    await expect(card.getByTestId("card-figures")).toHaveAttribute("data-state", "ready", { timeout: 15_000 });
    await expect(card.getByTestId("adjusted-badge")).toHaveCount(0);
    // HC-TR-148: the workbench takes the left pane, the analysis pane follows "after the change"
    await card.getByTestId("card-adjust").click();
    const wb = page.getByTestId("adjust-workbench");
    await expect(wb).toBeVisible();
    await expect(wb).toHaveAttribute("data-empty", "true");
    await expect(page.getByTestId("pane-adjusting")).toBeVisible();
    await expect(wb.getByTestId("wb-chain-table")).toHaveAttribute("data-rows", /^[1-9]/, { timeout: 15_000 });
    await expect(wb.getByTestId("wb-chain-held")).toHaveCount(2);
    // HC-TR-150: lots after on an open leg
    const leg = wb.getByTestId("wb-leg").first();
    await leg.getByTestId("lots-after-down").click();
    await expect(leg.getByTestId("effect")).toHaveAttribute("data-kind", "trim");
    // HC-TR-149: before → after strip and the summary line
    await expect(page.getByTestId("before-after")).toBeVisible();
    await expect(wb.getByTestId("adjust-summary")).toContainText("This change", { timeout: 15_000 });
    await expect(page.getByTestId("tile-max-loss")).toContainText("after");
    // HC-TR-154 / HC-TR-153: a quick fix loads a draft; it can be kept as a plan and compared; Reset returns to the trim
    await expect(wb.getByTestId("quick-fix").first()).toHaveAttribute("data-state", "ready", { timeout: 15_000 });
    await wb.getByTestId("quick-fix").first().click(); // roll strikes up
    await expect(wb.getByTestId("wb-pick")).toHaveCount(2);
    await wb.getByTestId("plan-save").click();
    await expect(wb.getByTestId("plans-bar")).toHaveAttribute("data-count", "1");
    await expect(wb.getByTestId("plan-row").nth(1)).toHaveAttribute("data-state", "ready", { timeout: 15_000 });
    await wb.getByTestId("adjust-reset").click();
    await expect(wb).toHaveAttribute("data-empty", "true");
    await leg.getByTestId("lots-after-down").click();
    // a new sold call two rows into the window (not a held strike)
    await wb.getByTestId("wb-chain-row").nth(2).getByTestId("wb-chain-sell-call").click();
    await expect(wb.getByTestId("wb-pick")).toHaveCount(1);
    await expect(wb.getByTestId("wb-pick").getByTestId("effect")).toHaveText("NEW LEG");
    await expect(wb.getByTestId("adjust-review")).toContainText("2 changes");
    // HC-TR-151: review and apply on paper with a reason
    await wb.getByTestId("adjust-review").click();
    const confirm = page.getByTestId("adjust-confirm");
    await expect(confirm).toHaveAttribute("data-mode", "paper");
    await expect(confirm.getByTestId("adjust-confirm-row")).toHaveCount(2);
    await expect(confirm.getByTestId("cf-max-loss")).toContainText("→");
    await confirm.getByTestId("adjust-reason").fill("e2e roll up");
    await confirm.getByTestId("adjust-apply").click();
    const details = page.getByTestId("strategy-details");
    await expect(details).toBeVisible({ timeout: 15_000 });
    await expect(details.getByTestId("details-adjustment")).toHaveCount(1);
    await expect(details.getByTestId("details-adjustment")).toContainText("e2e roll up");
    await expect(details.getByTestId("adjusted-badge")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(wb).toBeHidden();
    await expect(page.getByTestId("left-pane")).toBeVisible();
    await expect(page.getByTestId("paper-card").getByTestId("adjusted-badge")).toHaveAttribute("data-count", "1");
    await expect(page.getByTestId("paper-card").getByTestId("order-chip")).toHaveCount(4); // two kept, the trimmed split, the new leg
  });
});

test.describe("HC-TR live trading on the fake venue (Phase 3 item 2)", () => {
  test.beforeEach(async ({ page, request }) => {
    await seedUser(request, { email: "live@example.com", plan: { state: "active", planName: "Pro plan", expiresAt: "2026-12-31T00:00:00Z" }, connected: true });
    await signIn(page, "live@example.com");
    await page.evaluate(() => localStorage.removeItem("hapiecoin.ui"));
    await page.reload();
    await expect(page.locator("[data-testid=chain-row][data-atm=true]")).toHaveCount(1, { timeout: 15_000 });
  });

  test("HC-TR-152 a live adjustment: venue check, hold-to-place, fill states, then the history", async ({ page }) => {
    const strike = (await page.locator("[data-testid=chain-row][data-atm=true]").getAttribute("data-strike"))!;
    await page.locator(`[data-testid=chain-row-calls][data-strike="${strike}"]`).hover();
    await page.getByTestId("row-buy-calls").click();
    await page.getByTestId("tab-builder").click();
    await page.getByTestId("strategy-name").fill("E2E live adjust");
    await page.getByTestId("builder-paper-trade").click();
    const mode = page.getByTestId("trade-mode");
    await expect(mode.getByTestId("trade-broker")).toHaveValue("brk_delta");
    await mode.getByTestId("trade-continue").click();
    await page.getByTestId("trade-preview").getByTestId("trade-now").click();
    await expect(page.getByTestId("paper-panel")).toHaveAttribute("data-count", "1", { timeout: 15_000 });
    await page.getByTestId("paper-card").getByTestId("card-golive").click();
    await expect(mode.getByTestId("mode-live")).toHaveAttribute("aria-pressed", "true");
    await mode.getByTestId("trade-continue").click();
    await expect(page.getByTestId("trade-preview").getByTestId("venue-preview")).toHaveAttribute("data-ok", "true");
    await page.getByTestId("trade-preview").getByTestId("trade-now").click();
    await expect(page.getByTestId("live-panel")).toHaveAttribute("data-count", "1", { timeout: 15_000 });
    const card = page.getByTestId("live-card");
    await expect(card.getByTestId("order-chip").first()).toHaveAttribute("data-state", "filled");
    await card.getByTestId("card-adjust").click();
    const wb = page.getByTestId("adjust-workbench");
    await expect(wb.getByTestId("wb-chain-table")).toHaveAttribute("data-rows", /^[1-9]/, { timeout: 15_000 });
    await wb.getByTestId("wb-chain-row").nth(2).getByTestId("wb-chain-sell-call").click();
    await wb.getByTestId("adjust-review").click();
    const confirm = page.getByTestId("adjust-confirm");
    await expect(confirm).toHaveAttribute("data-mode", "live");
    await expect(confirm.getByTestId("adjust-venue")).toHaveAttribute("data-ok", "true", { timeout: 15_000 });
    await expect(confirm.getByTestId("adjust-band")).toContainText("±");
    const apply = confirm.getByTestId("adjust-apply");
    await expect(apply).toContainText("Hold to place");
    // a short press cancels
    await apply.hover();
    await page.mouse.down();
    await page.waitForTimeout(300);
    await page.mouse.up();
    await expect(confirm).toHaveAttribute("data-stage", "review");
    await page.mouse.down();
    await page.waitForTimeout(1600);
    await page.mouse.up();
    await expect(confirm).toHaveAttribute("data-stage", "placed", { timeout: 15_000 });
    await expect(confirm.getByTestId("adjust-result")).toHaveAttribute("data-state", "filled");
    await confirm.getByTestId("adjust-done").click();
    const details = page.getByTestId("strategy-details");
    await expect(details).toBeVisible();
    await expect(details.getByTestId("details-adjustment")).toHaveCount(1);
    await expect(details.getByTestId("adjusted-badge")).toBeVisible();
  });

  test("HC-TR-063 go live from a paper card: locked Live mode, exchange preview, orders on the Live tab; HC-TR-086 square off all", async ({ page }) => {
    const strike = (await page.locator("[data-testid=chain-row][data-atm=true]").getAttribute("data-strike"))!;
    await page.locator(`[data-testid=chain-row-calls][data-strike="${strike}"]`).hover();
    await page.getByTestId("row-buy-calls").click();
    await page.getByTestId("tab-builder").click();
    await page.getByTestId("strategy-name").fill("E2E long call");
    await page.getByTestId("builder-paper-trade").click();
    const mode = page.getByTestId("trade-mode");
    await expect(mode.getByTestId("trade-broker")).toHaveValue("brk_delta");
    await mode.getByTestId("trade-continue").click();
    await page.getByTestId("trade-preview").getByTestId("trade-now").click();
    await expect(page.getByTestId("paper-panel")).toHaveAttribute("data-count", "1", { timeout: 15_000 });
    // Go live from the card
    const card = page.getByTestId("paper-card");
    await expect(card.getByTestId("card-golive")).toBeEnabled();
    await card.getByTestId("card-golive").click();
    await expect(mode.getByTestId("mode-live")).toHaveAttribute("aria-pressed", "true");
    await expect(mode.getByTestId("mode-paper")).toBeDisabled();
    await expect(mode.getByTestId("trade-real-money")).toBeVisible();
    await mode.getByTestId("trade-continue").click();
    const preview = page.getByTestId("trade-preview");
    await expect(preview.getByTestId("venue-preview")).toHaveAttribute("data-ok", "true");
    await expect(preview.getByTestId("venue-leg")).toHaveCount(1);
    await expect(preview.getByTestId("trade-now")).toHaveText(/Place live orders/);
    await preview.getByTestId("trade-now").click();
    await expect(page.getByTestId("live-panel")).toHaveAttribute("data-count", "1", { timeout: 15_000 });
    await expect(page.getByTestId("live-count")).toContainText("1");
    const live = page.getByTestId("live-card");
    await expect(live.getByTestId("mode-pill")).toHaveAttribute("data-status", "live");
    await expect(live.getByTestId("order-chip")).toHaveAttribute("data-state", "filled");
    await expect(page.getByTestId("live-exchange-chip")).toHaveText(/exchange connected/);
    // HC-TR-143 the pane follows the new live strategy; HC-TR-144 the venue's net positions with tick-to-analyse
    await expect(page.getByTestId("pane-source")).toContainText("E2E long call");
    await expect(page.getByTestId("net-positions")).toHaveAttribute("data-state", "ready", { timeout: 15_000 });
    await expect(page.getByTestId("position-row")).toHaveCount(1);
    await page.getByTestId("position-tick").click();
    await expect(page.getByTestId("pane-source")).toContainText("1 exchange position");
    await page.getByTestId("position-tick").click();
    await expect(page.getByTestId("pane-source")).toContainText("E2E long call");
    // square off all from Details: reduce-only exits, strategy archived
    await live.getByTestId("card-sqall").click();
    const details = page.getByTestId("strategy-details");
    await expect(details.getByTestId("details-mode-note")).toContainText("Live trading");
    await details.getByTestId("details-sqall").click();
    await details.getByTestId("details-sqall-confirm").click();
    await expect(details).toHaveAttribute("data-status", "archived");
    await page.keyboard.press("Escape");
    await expect(details).toBeHidden();
    await expect(page.getByTestId("live-empty")).toBeVisible();
  });
});

test.describe("HC-SH-055 / HC-SH-056 flyer popup", () => {
  test("shows the live banners once on /analyse, cycles, and does not return within the session", async ({ page, request }) => {
    await seedUser(request, { email: "flyer@example.com", banners: 4 }); // live once-a-day, live once-per-session, scheduled, hidden
    await signIn(page, "flyer@example.com");
    await page.goto("/analyse");
    await expect(page.getByTestId("flyer")).toHaveAttribute("data-count", "2", { timeout: 15_000 });
    await expect(page.getByTestId("flyer-title")).toHaveText("Welcome Offer");
    await page.getByTestId("flyer-next").click();
    await expect(page.getByTestId("flyer-title")).toHaveText("Live Trading is here");
    await expect(page.getByTestId("flyer-view")).toContainText("↗");
    await page.getByTestId("flyer-dismiss").click();
    await expect(page.getByTestId("flyer")).toHaveCount(0);
    await page.reload();
    await expect(page.getByTestId("chain-table")).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(800);
    await expect(page.getByTestId("flyer")).toHaveCount(0); // both rules say not again today / this session
    await page.keyboard.press("Control+k");
    await page.getByRole("combobox").fill("announcements");
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("flyer")).toHaveAttribute("data-count", "2");
  });
});

test.describe("HC-SH-064..076 product tour", () => {
  test.use({ tour: true });
  test("starts once after sign-in, walks a real paper trade, remembers completion, replays from the settings menu", async ({ page, request }) => {
    await seedUser(request, { email: "tour@example.com", plan: { state: "active", planName: "Pro plan", expiresAt: "2026-12-31T00:00:00Z" } });
    await signIn(page, "tour@example.com");
    await expect(page.locator("[data-testid=chain-row][data-atm=true]")).toHaveCount(1, { timeout: 15_000 });
    const tour = page.getByTestId("tour");
    await expect(tour).toHaveAttribute("data-step", "1", { timeout: 10_000 }); // HC-SH-076 auto-start
    await expect(page.getByTestId("tour-title")).toHaveText("Welcome to HapieCoin");
    await expect(page.getByTestId("tour-next")).toHaveText("Start");
    await expect(page.getByTestId("tour-prev")).toHaveCount(0);
    await page.getByTestId("tour-next").click();
    await expect(tour).toHaveAttribute("data-step", "2");
    await expect(tour).toHaveAttribute("data-anchored", "true"); // HC-SH-064 cut-out around the asset picker
    await expect(page.getByTestId("tour-ring")).toBeVisible();
    await page.keyboard.press("ArrowRight");
    await expect(tour).toHaveAttribute("data-step", "3");
    await page.keyboard.press("ArrowLeft");
    await expect(tour).toHaveAttribute("data-step", "2");
    await page.getByTestId("tour-next").click();
    await page.getByTestId("tour-next").click();
    await expect(tour).toHaveAttribute("data-step", "4"); // HC-SH-068 do it: add a leg
    await expect(page.getByTestId("tab-chain")).toHaveAttribute("data-state", "active");
    const strike = (await page.locator("[data-testid=chain-row][data-atm=true]").getAttribute("data-strike"))!;
    await page.locator(`[data-testid=chain-row-calls][data-strike="${strike}"]`).hover();
    await page.getByTestId("row-buy-calls").click();
    await expect(tour).toHaveAttribute("data-step", "5"); // advanced by the leg
    await expect(page.getByTestId("tab-builder")).toHaveAttribute("data-state", "active"); // HC-SH-069
    await page.getByTestId("tour-next").click();
    await expect(tour).toHaveAttribute("data-target", "payoff-panel"); // HC-SH-070
    await page.getByTestId("tour-next").click();
    await expect(tour).toHaveAttribute("data-step", "7"); // HC-SH-071
    await page.getByTestId("builder-paper-trade").click();
    await expect(page.getByTestId("trade-mode")).toBeVisible();
    await expect(tour).toHaveAttribute("data-step", "8");
    await expect(page.getByTestId("tour-title")).toHaveText("Paper or Live");
    await page.getByTestId("trade-continue").click();
    await expect(page.getByTestId("trade-preview")).toBeVisible();
    await expect(tour).toHaveAttribute("data-step", "9"); // HC-SH-073 review and start
    await page.getByTestId("trade-now").click();
    await expect(page.getByTestId("save-draft-dialog")).toBeVisible(); // unnamed → name dialog
    await expect(tour).toHaveAttribute("data-step", "10"); // HC-SH-072
    await page.getByTestId("save-draft-name").fill("Tour call");
    await page.getByTestId("save-draft-confirm").click();
    await expect(page.getByTestId("paper-panel")).toHaveAttribute("data-count", "1", { timeout: 15_000 });
    await expect(tour).toHaveAttribute("data-step", "11"); // HC-SH-074 paper tab
    await expect(page.getByTestId("tab-paper")).toHaveAttribute("data-state", "active");
    await page.getByTestId("tour-next").click();
    await expect(tour).toHaveAttribute("data-target", "paper-pnl");
    await expect(tour).toHaveAttribute("data-anchored", "true");
    await page.getByTestId("tour-next").click();
    await expect(tour).toHaveAttribute("data-target", "paper-stop");
    await page.getByTestId("tour-next").click();
    await expect(tour).toHaveAttribute("data-target", "settings-menu"); // HC-SH-075
    await page.getByTestId("tour-next").click();
    await expect(tour).toHaveAttribute("data-target", "chat-launcher");
    await page.getByTestId("tour-next").click();
    await expect(tour).toHaveAttribute("data-target", "command-palette"); // HC-SH-112
    await expect(page.getByTestId("tour-progress")).toHaveText("16 / 16");
    await expect(page.getByTestId("tour-next")).toHaveText("Done");
    await page.getByTestId("tour-next").click();
    await expect(tour).toHaveCount(0);
    await expect(page.getByText("Tour complete")).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem("hapiecoin.tour"))).toBe("done");
    // once only: a reload does not restart it; the settings menu replays it (HC-SH-076)
    await page.reload();
    await expect(page.getByTestId("paper-panel")).toHaveAttribute("data-count", "1", { timeout: 15_000 }); // the Paper tab is the remembered tab
    await page.waitForTimeout(2500);
    await expect(tour).toHaveCount(0);
    await page.getByTestId("settings-gear").click();
    await page.getByTestId("menu-tour").click();
    await expect(tour).toHaveAttribute("data-step", "1");
    await page.keyboard.press("Escape");
    await expect(tour).toHaveCount(0);
    // the palette replays it too
    await page.keyboard.press("Control+k");
    await page.getByRole("combobox").fill("take a tour");
    await page.keyboard.press("Enter");
    await expect(tour).toHaveAttribute("data-step", "1");
    await page.getByTestId("tour-close").click();
    await expect(tour).toHaveCount(0);
  });
});

test.describe("HC-SH-057..063 / HC-SH-110 assistant", () => {
  test("answers platform questions, explains the Builder legs, keeps its dragged position, hands off to email", async ({ page, request }) => {
    await seedUser(request, { email: "chat@example.com" });
    await signIn(page, "chat@example.com");
    await expect(page.locator("[data-testid=chain-row][data-atm=true]")).toHaveCount(1, { timeout: 15_000 });
    const launcher = page.getByTestId("assistant-launcher");
    await expect(launcher).toBeVisible();
    await launcher.click();
    const panel = page.getByTestId("assistant-panel");
    await expect(panel).toBeVisible();
    await expect(page.getByTestId("assistant-mode")).toContainText("Platform help");
    await expect(page.getByTestId("assistant-chip")).toHaveCount(4);
    await expect(page.getByTestId("assistant-chip").first()).toHaveText("Explain this strategy");
    await page.getByTestId("assistant-chip").first().click();
    await expect(page.getByTestId("assistant-msg-bot").last()).toContainText("no legs in the Builder yet", { timeout: 10_000 });
    await expect(page.getByTestId("assistant-email")).toHaveAttribute("href", "mailto:support@hapiecoin.com");
    await expect(panel).toHaveAttribute("data-typing", "false", { timeout: 10_000 });
    await page.getByTestId("assistant-input").fill("what is probability of profit");
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("assistant-msg-bot").last()).toContainText("statistical estimate", { timeout: 10_000 });
    await page.keyboard.press("Escape");
    await expect(panel).toHaveCount(0);
    // a leg in the Builder makes the explainer real
    const strike = (await page.locator("[data-testid=chain-row][data-atm=true]").getAttribute("data-strike"))!;
    await page.locator(`[data-testid=chain-row-calls][data-strike="${strike}"]`).hover();
    await page.getByTestId("row-buy-calls").click();
    await page.getByTestId("tab-builder").click();
    await expect(page.getByTestId("payoff-panel")).toHaveAttribute("data-state", "ready", { timeout: 15_000 });
    await launcher.click();
    await expect(page.getByTestId("assistant-msg-me")).toHaveCount(2); // conversation kept
    await expect(panel).toHaveAttribute("data-typing", "false");
    await page.getByTestId("assistant-explain").click();
    const last = page.getByTestId("assistant-msg-bot").last();
    await expect(last).toContainText("not financial advice", { timeout: 10_000 });
    await expect(last).toContainText("Buy 100 ×");
    await expect(last).toContainText("Max profit");
    await expect(last).toContainText("Probability of profit");
    await page.getByTestId("assistant-close").click();
    // drag the bubble; the position survives a reload (HC-SH-058)
    const box = (await launcher.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x - 300, box.y - 200, { steps: 8 });
    await page.mouse.up();
    await expect(panel).toHaveCount(0); // a drag is not a click
    const moved = (await launcher.boundingBox())!;
    expect(moved.x).toBeLessThan(box.x - 200);
    await page.reload();
    await expect(launcher).toBeVisible();
    const after = (await launcher.boundingBox())!;
    expect(Math.abs(after.x - moved.x)).toBeLessThan(2);
    // the palette opens it
    await page.keyboard.press("Control+k");
    await page.getByRole("combobox").fill("assistant");
    await page.keyboard.press("Enter");
    await expect(panel).toBeVisible();
  });
});
