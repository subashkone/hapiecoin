import { TEMPLATE_COUNT } from "../src/lib/strategy/templates";
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

  test("HC-SH-077 / 078 header stats, HC-SH-105..108 portfolio bar, HC-SH-101..103 shortcuts, HC-SH-086 / 087 palette (ADR-053)", async ({ page }) => {
    await expect(page.getByTestId("header-atm-iv")).toHaveAttribute("data-state", "ready", { timeout: 15_000 });
    await expect(page.getByTestId("header-atm-iv")).toContainText(/\d%/);
    await expect(page.getByTestId("header-exp-move")).toContainText("±");
    // the portfolio bar reads empty and opens its places
    const bar = page.getByTestId("portfolio-bar");
    await expect(bar).toHaveAttribute("data-portfolio", "empty");
    await expect(bar.getByTestId("bar-portfolio")).toContainText("0 open strategies");
    await expect(bar.getByTestId("bar-basis")).toContainText("mark");
    await expect(bar.getByTestId("bar-ccy")).toContainText("USD");
    await bar.getByTestId("bar-alerts").click();
    await expect(page.getByTestId("alerts-dialog")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("alerts-dialog")).toBeHidden();
    await bar.getByTestId("bar-portfolio").click();
    await expect(page.getByTestId("tab-paper")).toHaveAttribute("data-state", "active");
    await page.getByTestId("tab-chain").click();
    // ? opens the help; T and D toggle theme and density; a field swallows them
    await page.keyboard.press("Shift+?");
    const help = page.getByTestId("shortcuts-dialog");
    await expect(help).toBeVisible();
    await expect(help.getByTestId("shortcuts-group")).toHaveCount(2);
    await page.keyboard.press("Escape");
    await expect(help).toBeHidden();
    await page.keyboard.press("t");
    await expect(page.locator("html")).toHaveClass(/light/);
    await page.keyboard.press("t");
    await expect(page.locator("html")).not.toHaveClass(/light/);
    await page.keyboard.press("d");
    await expect(page.locator("html")).toHaveClass(/compact/);
    await page.keyboard.press("d");
    await expect(page.locator("html")).not.toHaveClass(/compact/);
    // the palette underlines the match, remembers the command and lists Settings
    await page.keyboard.press("Control+k");
    await page.getByRole("combobox", { name: "Command" }).fill("open journal");
    await expect(page.getByRole("option", { name: "Open Journal" }).locator("u").first()).toBeVisible();
    await page.getByRole("option", { name: "Open Journal" }).click();
    await expect(page.getByTestId("tab-journal")).toHaveAttribute("data-state", "active");
    await page.keyboard.press("Control+k");
    await expect(page.getByRole("listbox").locator(".micro").first()).toHaveText("Recent");
    await expect(page.getByRole("option", { name: "Open P&L Settings" })).toBeVisible();
    await page.keyboard.press("Escape");
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
    // HC-WS-029 / 080 footer stats; HC-WS-075 the spot hairline; HC-WS-074 the Δ chips
    await expect(page.getByTestId("chain-max-pain")).not.toHaveText("—");
    await expect(page.getByTestId("chain-fwd")).not.toHaveText("—");
    await expect(page.getByTestId("spot-hairline")).toContainText("SPOT");
    await page.getByTestId("chain-delta-25").click();
    await expect(page.getByText("25Δ strikes")).toBeVisible();
    await expect(page.locator("[data-testid=chain-row][data-pulse=true]")).toHaveCount(2, { timeout: 1500 });
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
    // ADR-056 (GAPS #32): the 24 h mark / IV sparkline
    await expect(page.getByTestId("option-sparkline")).toHaveAttribute("data-state", "ready", { timeout: 15_000 });
    await expect(page.getByTestId("chart-option-spark")).toBeVisible();
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

  test("HC-TR-176..178 strategy wizard: view, move and date → ranked defined-risk cards at the live chain; Use this loads the Builder on the thesis; W and the palette open it (ADR-072)", async ({ page }) => {
    await page.getByTestId("tab-builder").click();
    await page.getByTestId("builder-goto-wizard").click();
    const panel = page.getByTestId("wizard-panel");
    await expect(panel).toHaveAttribute("data-state", "ready", { timeout: 30_000 });
    const cards = page.getByTestId("wizard-card");
    await expect(cards.first()).toHaveAttribute("data-rank", "1");
    await expect(cards.first().getByTestId("wizard-tag")).toHaveText("best return on risk");
    await expect(cards.first().getByTestId("wizard-pnl")).toContainText("$");
    await expect(cards.first().getByTestId("wizard-maxloss")).toContainText("−$");
    await expect(page.getByTestId("wizard-basis")).toContainText("Priced at the live chain");
    // the move derives the target price; a bearish view puts it below spot
    const price = page.getByTestId("wizard-price");
    const at3 = Number(await price.inputValue());
    await page.getByTestId("wizard-move").fill("5");
    await expect.poll(async () => Number(await price.inputValue())).toBeGreaterThan(at3);
    await page.getByTestId("wizard-view-bearish").click();
    await expect.poll(async () => Number(await price.inputValue())).toBeLessThan(at3);
    await page.getByTestId("wizard-view-neutral").click();
    await expect(page.getByTestId("wizard-band")).toContainText("stays inside");
    await page.getByTestId("wizard-view-bullish").click();
    await expect(panel).toHaveAttribute("data-state", "ready");
    // HC-TR-178 Use this → the Builder holds the template's legs, the payoff opens on the thesis
    const name = (await cards.first().getAttribute("data-name"))!;
    await cards.first().getByTestId("wizard-use").click();
    await expect(page.getByTestId("strategy-name")).toHaveValue(name);
    await expect(page.getByTestId("builder-panel")).not.toHaveAttribute("data-legs", "0");
    await expect(page.getByTestId("payoff-panel")).toHaveAttribute("data-state", "ready", { timeout: 15_000 });
    const target = Number(await page.getByTestId("target-price").inputValue());
    expect(target).toBeGreaterThan(at3 * 0.99); // the slider sits on the +3 % thesis, not on spot
    // W opens the wizard from the chain; the palette from anywhere
    await page.getByTestId("tab-chain").click();
    await page.keyboard.press("w");
    await expect(panel).toBeVisible();
    await page.getByTestId("builder-tab-builder").click();
    await page.keyboard.press("Control+k");
    await page.getByRole("combobox", { name: "Command" }).fill("wizard");
    await page.getByRole("option", { name: /Strategy wizard/ }).click();
    await expect(panel).toBeVisible();
  });

  test("HC-TR-040 / HC-WS-033 / HC-WS-039 a template loads legs into the Builder and the payoff tiles and chart appear", async ({ page }) => {
    await expect(page.getByTestId("payoff-panel")).toHaveAttribute("data-state", "empty");
    await page.getByTestId("tab-builder").click();
    await page.getByTestId("builder-tab-templates").click();
    await expect(page.getByTestId("template-card")).toHaveCount(TEMPLATE_COUNT);
    // HC-TR-106 / 107 cards priced at the chain; the outlook chips filter on the payoff
    await expect(page.getByTestId("template-cards")).toHaveAttribute("data-priced", /^[1-9]\d*$/, { timeout: 30_000 });
    await expect(page.getByTestId("template-pop").first()).toContainText("POP");
    await page.getByTestId("template-outlook-bearish").click();
    await expect(page.locator("[data-testid=template-card][data-outlook='Bearish']").first()).toBeVisible();
    await page.getByTestId("template-outlook-bearish").click();
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
    // HC-WS-081 / 083 / 084: ROI and margin in the strip, the IV +5% layer, a click on the chart sets the target
    await expect(page.getByTestId("max-roi")).not.toHaveText("—");
    await expect(page.getByTestId("strip-margin")).toContainText("$");
    await page.getByTestId("layer-ivUp").click();
    await expect(page.getByTestId("layer-ivUp")).toHaveAttribute("aria-pressed", "true");
    const slider = page.locator("[data-testid=target-controls] input[type=range]").first();
    const before = await slider.inputValue();
    const box = (await page.getByTestId("payoff-chart").boundingBox())!;
    await page.mouse.click(box.x + box.width * 0.75, box.y + box.height * 0.5);
    await expect.poll(async () => slider.inputValue()).not.toBe(before);
    await page.getByTestId("target-price-reset").click();
    await page.getByTestId("layer-ivUp").click();
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
    // HC-WS-067 tab-bar info; HC-WS-105 / 106 share link round trip; HC-WS-101 greeks across price
    await expect(page.getByTestId("pane-strategy-info")).toContainText("Iron Condor");
    await page.getByTestId("share-open").click();
    const link = await page.getByTestId("share-link").inputValue();
    expect(link).toMatch(/\/s\/[A-Za-z0-9_-]+$/);
    await page.getByTestId("share-copy").click();
    await expect(page.getByText("Link copied to clipboard")).toBeVisible();
    await page.keyboard.press("Escape");
    await page.getByTestId("analysis-tab-greeks").click();
    await expect(page.getByTestId("chart-delta-price")).toHaveAttribute("data-state", "ready", { timeout: 15_000 });
    await expect(page.getByTestId("greek-vega")).toContainText("$");
    await page.goto(link);
    await expect(page).toHaveURL(/\/analyse$/, { timeout: 15_000 });
    await expect(page.getByText("Strategy loaded from link")).toBeVisible();
    await expect(page.getByTestId("builder-panel")).toHaveAttribute("data-legs", "4", { timeout: 15_000 });
    await expect(page.getByTestId("strategy-name")).toHaveValue("Iron Condor");
    // HC-WS-006 deep link; HC-WS-065 collapse
    await page.goto("/analyse?tab=paper&panel=ladder");
    await expect(page.getByTestId("tab-paper")).toHaveAttribute("data-state", "active", { timeout: 15_000 });
    await expect(page.getByTestId("analysis-tab-ladder")).toHaveAttribute("data-state", "active");
    await page.getByTestId("collapse-right").click();
    await expect(page.getByTestId("workspace")).toHaveAttribute("data-collapse", "right");
    await page.getByTestId("collapse-restore").click();
    await expect(page.getByTestId("workspace")).not.toHaveAttribute("data-collapse", /./);
    // HC-WS-069 palette: switch expiry
    await page.keyboard.press("Control+k");
    await page.getByRole("combobox", { name: "Command" }).fill("switch expiry");
    await page.getByRole("option", { name: /Switch expiry →/ }).nth(1).click();
    await expect(page.getByTestId("tab-chain")).toHaveAttribute("data-state", "active");
  });

  test("HC-TR-009 / HC-TR-011 / HC-TR-013 builder edits: side, lots, custom price, delete; HC-TR-020 / HC-TR-044 save draft, list, load, delete", async ({ page }) => {
    const strike = (await page.locator("[data-testid=chain-row][data-atm=true]").getAttribute("data-strike"))!;
    await page.locator(`[data-testid=chain-row-calls][data-strike="${strike}"]`).hover();
    await page.getByTestId("row-buy-calls").click();
    await page.getByTestId("tab-builder").click();
    const row = page.getByTestId("leg-row").first();
    await expect(row).toHaveAttribute("data-side", "buy");
    // HC-TR-096 / 097 / 100 / 101 / 102 the ticket rows, the net line and the header tags
    await expect(page.getByTestId("ticket-fees")).toContainText("$", { timeout: 15_000 });
    await expect(page.getByTestId("ticket-total")).toHaveAttribute("data-kind", /debit|credit/);
    await expect(page.getByTestId("builder-netline")).toContainText("Net Δ");
    await expect(page.getByTestId("strategy-expiry-line")).toContainText("BTC");
    // HC-TR-104 P opens the trade-mode dialog; Escape closes it
    await page.keyboard.press("p");
    await expect(page.getByTestId("trade-mode")).toBeVisible();
    await expect(page.getByTestId("mode-check")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("trade-mode")).toBeHidden();
    // HC-TR-140 palette: Open Journal
    await page.keyboard.press("Control+k");
    await page.getByRole("combobox", { name: "Command" }).fill("open journal");
    await page.getByRole("option", { name: "Open Journal" }).click();
    await expect(page.getByTestId("tab-journal")).toHaveAttribute("data-state", "active");
    await page.getByTestId("tab-builder").click();
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
    // HC-WS-088..093 Scenarios: the matrix, a click sets the target, modes and the smooth field
    await page.getByTestId("analysis-tab-scenarios").click();
    const scen = page.getByTestId("scenarios-panel");
    await expect(scen).toHaveAttribute("data-state", "ready", { timeout: 15_000 });
    await expect(page.getByTestId("scenario-matrix")).toHaveAttribute("data-rows", "11");
    await expect(page.locator("[data-testid=scenario-cell][data-target=true]")).toHaveCount(1);
    await page.locator("[data-testid=scenario-cell][data-i='0']").last().click();
    await expect(page.locator("[data-testid=scenario-cell][data-i='0'][data-target=true]")).toHaveCount(1);
    await page.getByTestId("scenario-mode-delta").click();
    await expect(page.getByTestId("scenario-unit")).toHaveText("BTC Δ");
    await page.getByTestId("scenario-mode-pnl").click();
    await page.getByTestId("scenario-smooth").click();
    await expect(page.getByTestId("scenario-heat")).toHaveAttribute("data-rows", "11");
    await page.getByTestId("scenario-smooth").click();
    // HC-WS-094..097 Vol: the smile, the skew, the term structure and the expiry switch
    await page.getByTestId("analysis-tab-vol").click();
    const vol = page.getByTestId("vol-panel");
    await expect(vol).toHaveAttribute("data-state", "ready", { timeout: 15_000 });
    await expect(vol.getByTestId("chart-smile")).toHaveAttribute("data-state", "ready");
    await expect(vol.getByTestId("skew-25")).toContainText("pts");
    await expect(vol.getByTestId("term-expiry").first()).toBeVisible();
    // HC-WS-096 / 097 (ADR-056): rank and realised vs implied from the market history
    await expect(vol.getByTestId("iv-rank-value")).toHaveText(/^\d+$/);
    await expect(vol.getByTestId("iv-rank-label")).toContainText("premium");
    await expect(vol.getByTestId("chart-rv-iv")).toHaveAttribute("data-state", "ready");
    await expect(vol.getByTestId("rv-iv-spread")).toContainText("pts");
    await expect(page.getByTestId("header-iv-rank")).toHaveText(/IV rank \d+/);
    // HC-WS-098..100 Structure: open interest with max pain, the ratios and GEX
    await page.getByTestId("analysis-tab-structure").click();
    const structure = page.getByTestId("structure-panel");
    await expect(structure).toHaveAttribute("data-state", "ready", { timeout: 15_000 });
    await expect(structure).toHaveAttribute("data-max-pain", /^[0-9]/);
    await expect(structure.getByTestId("chart-oi")).toHaveAttribute("data-state", "ready");
    await expect(structure.getByTestId("pcr-oi")).toHaveAttribute("data-read", /put-heavy|call-heavy|balanced/);
    await expect(structure.getByTestId("chart-gex")).toHaveAttribute("data-state", "ready");
    await page.getByTestId("analysis-tab-payoff").click();
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
    await expect(page.getByTestId("save-draft-name")).toHaveValue("E2E straddle"); // the name is always confirmed (ADR-059)
    await page.getByTestId("save-draft-confirm").click();
    // HC-TR-167: the Protect step follows the trade; arm a stop of 5 (the mock wallet is USD) and see it on the card
    const protect = page.getByTestId("rule-dialog");
    await expect(protect).toBeVisible({ timeout: 15_000 });
    await expect(protect).toHaveAttribute("data-after-trade", "true");
    await protect.getByTestId("rule-stop-on").click();
    await protect.getByTestId("rule-stop-value").fill("5");
    await expect(protect.getByTestId("rule-stop-level")).toContainText("5");
    // HC-TR-171: a spot level beside it
    await protect.getByTestId("rule-spot-on").click();
    await protect.getByTestId("rule-spot-below").click();
    await protect.getByTestId("rule-spot-value").fill("70000");
    await expect(protect.getByTestId("rule-arm")).toHaveText("Arm stop loss + spot level");
    await protect.getByTestId("rule-arm").click();
    await expect(protect).toBeHidden();
    await expect(page.getByTestId("paper-panel")).toHaveAttribute("data-count", "1", { timeout: 15_000 });
    await expect(page.getByTestId("paper-count")).toHaveText("1");
    const card = page.getByTestId("paper-card");
    await expect(card.getByTestId("card-rules")).toContainText("stop at");
    await expect(card.getByTestId("card-rules")).toContainText("spot ≤ 70,000");
    await expect(card.getByTestId("mode-pill")).toHaveAttribute("data-status", "paper");
    await expect(card.getByTestId("card-pnl")).not.toHaveText("—");
    await expect(page.getByTestId("builder-count")).toHaveCount(0);
    // HC-TR-159: the same contract again shows the overlap line in the preview, naming the strategy that holds it
    await page.getByTestId("tab-chain").click();
    await page.locator(`[data-testid=chain-row-puts][data-strike="${strike}"]`).hover();
    await page.getByTestId("row-sell-puts").click();
    await page.getByTestId("tab-builder").click();
    await page.getByTestId("builder-paper-trade").click();
    await page.getByTestId("trade-mode").getByTestId("trade-continue").click();
    await expect(page.getByTestId("trade-preview").getByTestId("overlap-notice")).toHaveAttribute("data-count", "1");
    await expect(page.getByTestId("overlap-row").first()).toContainText("E2E straddle");
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("trade-preview")).toBeHidden();
    await page.getByTestId("builder-new").click();
    await page.getByTestId("tab-paper").click();
    // HC-TR-113 / 138 the strip's net delta and margin come from the worker
    await expect(page.getByTestId("paper-strip")).toHaveAttribute("data-portfolio", "ready", { timeout: 15_000 });
    await expect(page.getByTestId("paper-net-delta")).not.toHaveText("—");
    // HC-SH-106 the portfolio bar counts the strategy and prices it
    await expect(page.getByTestId("portfolio-bar")).toHaveAttribute("data-portfolio", "ready", { timeout: 15_000 });
    await expect(page.getByTestId("bar-portfolio")).toContainText("1 open strategy");
    await expect(page.getByTestId("bar-net-delta")).not.toContainText("—");
    // details: HC-TR-118 / 119 six tiles + the payoff mini chart; then square off one leg at market, stop and archive
    await card.getByTestId("card-details").click();
    const details = page.getByTestId("strategy-details");
    await expect(details.getByTestId("details-tiles").locator("> div")).toHaveCount(6);
    await expect(details.getByTestId("details-chart")).toBeVisible();
    await expect(details.getByTestId("details-margin-tile")).toContainText("POP", { timeout: 15_000 });
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
    // HC-TR-164: the Closed chip carries why it closed
    await page.getByTestId("paper-life-closed").click();
    await expect(page.getByTestId("card-close-reason")).toHaveText("squared off");
    await page.getByTestId("paper-life-open").click();
    // HC-TR-128..137: the stopped strategy is a closed trade in the Journal with its realised P&L, tags, notes and CSV
    await page.getByTestId("tab-journal").click();
    const journal = page.getByTestId("journal-panel");
    await expect(journal).toHaveAttribute("data-count", "1", { timeout: 15_000 });
    await expect(page.getByTestId("stat-trades")).toHaveText("1");
    await expect(page.getByTestId("chart-equity")).toHaveAttribute("data-state", "ready");
    await expect(page.getByTestId("journal-trade")).toContainText("E2E straddle");
    await expect(page.getByTestId("trade-reason")).toHaveText("squared off"); // HC-TR-164
    await expect(page.getByTestId("trade-pnl")).not.toHaveText("—");
    await page.getByTestId("tag-hedge").click();
    await expect(page.getByText("Tag added").first()).toBeVisible();
    await expect(page.getByTestId("tag-hedge")).toHaveAttribute("aria-pressed", "true");
    await page.getByTestId("trade-notes").fill("Closed early on the e2e run.");
    await page.getByTestId("trade-notes").blur();
    await expect(page.getByText("Notes saved").first()).toBeVisible();
    await page.getByTestId("journal-csv").click();
    await expect(page.getByText("CSV copied · 1 row")).toBeVisible();
    await page.getByTestId("journal-filter").getByText("Losses").click();
    const shown = await journal.getAttribute("data-shown");
    expect(["0", "1"]).toContain(shown);
    await page.getByTestId("journal-filter").getByText("All").click();
    await page.getByTestId("trade-row").click();
    await expect(page.getByTestId("strategy-details")).toBeVisible();
    await expect(page.getByTestId("details-tags")).toContainText("#hedge");
    await expect(page.getByTestId("details-notes")).toContainText("Closed early");
    await page.getByTestId("details-open-journal").click();
    await expect(page.getByTestId("strategy-details")).toBeHidden();
    await expect(page.getByTestId("tab-journal")).toHaveAttribute("data-state", "active");
    // the archived strategy is under My templates → Archived
    await page.getByTestId("tab-builder").click();
    await page.getByTestId("builder-tab-templates").click();
    await page.getByTestId("mine-archived").click();
    await expect(page.getByTestId("mine-card")).toHaveCount(1);
    await expect(page.getByTestId("mine-card")).toContainText("E2E straddle");
  });
});

test.describe("HC-SH-079 / HC-SH-094..100 alerts (ADR-052)", () => {
  test.beforeEach(async ({ page, request }) => {
    await seedUser(request, { email: "alerts@example.com", plan: { state: "active", planName: "Pro plan", expiresAt: "2026-12-31T00:00:00Z" }, alerts: true });
    await signIn(page, "alerts@example.com");
    await page.evaluate(() => localStorage.removeItem("hapiecoin.ui"));
    await page.reload();
    await expect(page.locator("[data-testid=chain-row][data-atm=true]")).toHaveCount(1, { timeout: 15_000 });
  });

  test("the bell counts the seeded alerts, a new price alert fires on the next tick, Set alert prefills the P&L form", async ({ page }) => {
    // seeded: 2 armed, 1 triggered → red badge
    const bell = page.getByTestId("alerts-bell");
    await expect(bell).toHaveAttribute("data-armed", "2");
    await expect(bell).toHaveAttribute("data-triggered", "1");
    await expect(page.getByTestId("alerts-badge")).toHaveText("1");
    await bell.click();
    const dialog = page.getByTestId("alerts-dialog");
    await expect(dialog.getByTestId("alerts-counts")).toHaveText("3 alerts · 2 armed · 1 triggered");
    await expect(dialog.getByTestId("alert-row")).toHaveCount(3);
    await expect(dialog.locator("[data-testid=alert-row][data-kind=price]").getByTestId("alert-now")).toContainText(/now [0-9]/, { timeout: 15_000 });
    // a price alert just above the live price, "at or below": the next tick meets it
    await dialog.getByTestId("alerts-new").click();
    const form = dialog.getByTestId("alert-form");
    await expect(form.getByTestId("alert-form-now")).toContainText(/now [0-9]/);
    const now = Number((await form.getByTestId("alert-form-now").textContent())!.replace(/[^0-9.]/g, ""));
    await form.getByTestId("alert-op").selectOption("<=");
    await form.getByTestId("alert-value").fill(String(Math.round(now * 1.01)));
    await form.getByTestId("alert-ch-email").click();
    await form.getByTestId("alert-save").click();
    await expect(dialog.getByTestId("alert-row")).toHaveCount(4);
    await expect(dialog.getByTestId("alerts-counts")).toHaveText(/4 alerts · [12] armed · [12] triggered/);
    await expect(dialog.getByTestId("alert-row").first()).toHaveAttribute("data-state", "triggered", { timeout: 15_000 });
    await expect(page.getByText("Alert triggered")).toBeVisible();
    await expect(dialog.getByTestId("alert-row").first().getByTestId("alert-now")).toContainText("fired");
    await expect(bell).toHaveAttribute("data-triggered", "2");
    // re-arm from the switch: it fires again on the still-met price
    await dialog.getByTestId("alert-row").first().getByTestId("alert-arm").click();
    await expect(dialog.getByTestId("alert-row").first()).toHaveAttribute("data-state", "triggered", { timeout: 15_000 });
    // delete with confirm
    await dialog.getByTestId("alert-row").first().getByTestId("alert-delete").click();
    await dialog.getByTestId("alert-delete-confirm").click();
    await expect(dialog.getByTestId("alert-row")).toHaveCount(3);
    // ADR-057 Telegram: connect through the deep link (the mock links on the next poll), then an alert on that channel
    await expect(dialog.getByTestId("telegram-status")).toHaveAttribute("data-state", "unlinked");
    await dialog.getByTestId("telegram-connect").click();
    await expect(dialog.getByTestId("telegram-link")).toHaveAttribute("href", /t\.me\/HapieCoinMockBot\?start=/);
    await expect(dialog.getByTestId("telegram-status")).toHaveAttribute("data-state", "linked", { timeout: 10_000 });
    await dialog.getByTestId("alerts-new").click();
    await expect(form.getByTestId("alert-ch-telegram")).toBeEnabled();
    await form.getByTestId("alert-ch-telegram").click();
    await form.getByTestId("alert-value").fill("990000");
    await form.getByTestId("alert-save").click();
    await expect(dialog.getByTestId("alert-row").first().getByTestId("alert-channel").nth(1)).toHaveText("telegram");
    await dialog.getByTestId("telegram-test").click();
    await expect(page.getByText("Test message sent")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    // HC-TR-114 / HC-TR-139 a paper trade, then Set alert on its card lands on the P&L form with the strategy chosen
    const strike = (await page.locator("[data-testid=chain-row][data-atm=true]").getAttribute("data-strike"))!;
    await page.locator(`[data-testid=chain-row-calls][data-strike="${strike}"]`).hover();
    await page.getByTestId("row-buy-calls").click();
    await page.getByTestId("tab-builder").click();
    await page.getByTestId("strategy-name").fill("E2E alert call");
    await page.getByTestId("builder-paper-trade").click();
    await page.getByTestId("trade-mode").getByTestId("trade-continue").click();
    await page.getByTestId("trade-preview").getByTestId("trade-now").click();
    await page.getByTestId("save-draft-confirm").click();
    await page.getByTestId("rule-skip").click(); // the Protect step, skipped here
    await expect(page.getByTestId("paper-panel")).toHaveAttribute("data-count", "1", { timeout: 15_000 });
    await page.getByTestId("paper-card").getByTestId("card-alert").click();
    await expect(dialog).toBeVisible();
    await expect(form.getByTestId("alert-kind")).toHaveValue("pnl");
    await expect(form.getByTestId("alert-strategy")).toHaveValue(/^strat/);
    await expect(form.getByTestId("alert-form-now")).toContainText("$", { timeout: 15_000 });
    await form.getByTestId("alert-value").fill("-5");
    await form.getByTestId("alert-op").selectOption("<=");
    await form.getByTestId("alert-save").click();
    await expect(dialog.getByTestId("alert-row").first().getByTestId("alert-condition")).toHaveText("E2E alert call · P&L ≤ −$5.00");
    await page.keyboard.press("Escape");
    // HC-SH-079 the palette reaches the center too
    await page.keyboard.press("Control+k");
    await page.getByRole("combobox", { name: "Command" }).fill("alerts center");
    await page.getByRole("option", { name: "Alerts center" }).click();
    await expect(dialog).toBeVisible();
    await expect(dialog.getByTestId("alert-form")).toHaveCount(0);
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
    await page.getByTestId("save-draft-confirm").click();
    await page.getByTestId("rule-skip").click(); // the Protect step (HC-TR-167), skipped here
    await expect(page.getByTestId("paper-panel")).toHaveAttribute("data-count", "1", { timeout: 15_000 });
    const card = page.getByTestId("paper-card");
    await expect(card.getByTestId("card-figures")).toHaveAttribute("data-state", "ready", { timeout: 15_000 });
    await expect(card.getByTestId("adjusted-badge")).toHaveCount(0);
    await expect(card.getByTestId("card-expiry")).toContainText("expires"); // HC-TR-156
    await expect(page.getByTestId("paper-life-open")).toHaveAttribute("data-count", "1"); // HC-TR-157
    // HC-TR-148: the workbench takes the left pane, the analysis pane follows "after the change"
    await card.getByTestId("card-adjust").click();
    const wb = page.getByTestId("adjust-workbench");
    await expect(wb).toBeVisible();
    await expect(wb).toHaveAttribute("data-empty", "true");
    await expect(page.getByTestId("pane-adjusting")).toBeVisible();
    await expect(wb.getByTestId("wb-chain-table")).toHaveAttribute("data-rows", /^[1-9]/, { timeout: 15_000 });
    await expect(wb.getByTestId("wb-chain-held")).toHaveCount(2);
    // ADR-058: the chain opens with the ATM row in view, not the top of the window
    await expect.poll(() => wb.getByTestId("wb-chain-box").evaluate((box) => {
      const row = box.querySelector<HTMLElement>("tr[data-atm]");
      if (!row) return "no atm row";
      const top = row.offsetTop - box.scrollTop;
      return top >= 0 && top + row.offsetHeight <= box.clientHeight ? "in view" : `row at ${top} of ${box.clientHeight} (scrollTop ${box.scrollTop})`;
    })).toBe("in view");
    // HC-TR-150: lots after on an open leg
    const leg = wb.getByTestId("wb-leg").first();
    await leg.getByTestId("lots-after-down").click();
    await expect(leg.getByTestId("effect")).toHaveAttribute("data-kind", "trim");
    await expect(wb.getByTestId("wb-order")).toHaveCount(1); // the trim is listed as an order under Proposed
    await expect(wb.getByTestId("wb-order")).toContainText("SELL");
    // HC-TR-149: before → after strip and the summary line
    await expect(page.getByTestId("before-after")).toBeVisible();
    await expect(page.getByTestId("adjust-change-box").getByTestId("adjust-summary")).toContainText("This change", { timeout: 15_000 });
    await expect(page.getByTestId("before-after-tiles").getByTestId("ba-margin")).toContainText("→");
    await expect(page.getByTestId("tile-max-loss")).toContainText("after");
    // ADR-058 footer tiles: what the change pays, loss after, margin estimate, open legs after
    await expect(wb.getByTestId("adjust-tile-cash")).toContainText("fees est.");
    await expect(wb.getByTestId("adjust-tile-loss")).toContainText("→");
    await expect(wb.getByTestId("adjust-tile-legs")).toContainText("of 10 · 2 now");
    // a leg closes with one click and undoes with the next
    await leg.getByTestId("wb-leg-undo").click();
    await expect(wb).toHaveAttribute("data-empty", "true");
    await leg.getByTestId("wb-leg-close").click();
    await expect(leg.getByTestId("effect")).toHaveAttribute("data-kind", "close");
    await leg.getByTestId("wb-leg-undo").click();
    await leg.getByTestId("lots-after-down").click();
    // HC-TR-154 / HC-TR-153: a quick fix loads a draft; it can be kept as a plan and compared; Reset returns to the trim
    await expect(wb.getByTestId("quick-fix").first()).toHaveAttribute("data-state", "ready", { timeout: 15_000 });
    await wb.getByTestId("quick-fix").first().click(); // roll strikes up
    await expect(wb.getByTestId("wb-pick")).toHaveCount(2);
    await wb.getByTestId("plan-save").click();
    await expect(wb.getByTestId("plans-bar")).toHaveAttribute("data-count", "1");
    await expect(wb.getByTestId("plan-row").last()).toHaveAttribute("data-state", "ready", { timeout: 15_000 });
    await expect(wb.getByTestId("plan-row").first()).toHaveAttribute("data-plan", "before");
    await expect(wb).toHaveAttribute("data-empty", "true"); // saving keeps Plan A and starts the next change
    await wb.getByTestId("plan-use").click();
    await expect(wb.getByTestId("plan-current-note")).toHaveText("= Plan A");
    await wb.getByTestId("adjust-reset").click();
    await expect(wb).toHaveAttribute("data-empty", "true");
    await leg.getByTestId("lots-after-down").click();
    // a new sold call two rows into the window (not a held strike)
    await wb.getByTestId("wb-chain-row").nth(2).getByTestId("wb-chain-sell-call").click();
    await expect(wb.getByTestId("wb-pick")).toHaveCount(1);
    await expect(wb.getByTestId("wb-pick").getByTestId("effect")).toHaveText("NEW LEG");
    await expect(wb.getByTestId("adjust-review")).toContainText("2 orders");
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

  test("HC-TR-148 under 720 px the workbench stacks its columns (ADR-044 extra 6), and Exit asks before discarding a change", async ({ page }) => {
    const strike = (await page.locator("[data-testid=chain-row][data-atm=true]").getAttribute("data-strike"))!;
    await page.locator(`[data-testid=chain-row-calls][data-strike="${strike}"]`).hover();
    await page.getByTestId("row-buy-calls").click();
    await page.getByTestId("tab-builder").click();
    await page.getByTestId("strategy-name").fill("E2E narrow");
    await page.getByTestId("builder-paper-trade").click();
    await page.getByTestId("trade-mode").getByTestId("trade-continue").click();
    await page.getByTestId("trade-preview").getByTestId("trade-now").click();
    await page.getByTestId("save-draft-confirm").click();
    await page.getByTestId("rule-skip").click(); // the Protect step (HC-TR-167), skipped here
    await expect(page.getByTestId("paper-panel")).toHaveAttribute("data-count", "1", { timeout: 15_000 });
    await page.getByTestId("paper-card").getByTestId("card-adjust").click();
    const wb = page.getByTestId("adjust-workbench");
    await page.setViewportSize({ width: 1600, height: 900 }); // the left pane is wider than 720 px here
    await expect(wb).toHaveAttribute("data-layout", "columns");
    await page.setViewportSize({ width: 640, height: 900 });
    await expect(wb).toHaveAttribute("data-layout", "stacked");
    await expect(wb.getByTestId("adjust-review")).toBeVisible();
    await wb.getByTestId("wb-leg").first().getByTestId("wb-leg-close").click();
    await wb.getByTestId("adjust-exit").click();
    const ask = page.getByTestId("adjust-exit-confirm");
    await expect(ask).toContainText("1 order in this change");
    await ask.getByTestId("adjust-exit-keep").click();
    await expect(wb).toHaveAttribute("data-empty", "false");
    await wb.getByTestId("adjust-exit").click();
    await ask.getByTestId("adjust-exit-discard").click();
    await expect(wb).toHaveCount(0);
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
    await page.getByTestId("save-draft-confirm").click();
    await page.getByTestId("rule-skip").click(); // the Protect step (HC-TR-167), skipped here
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
    await page.getByTestId("save-draft-confirm").click();
    await page.getByTestId("rule-skip").click(); // the Protect step (HC-TR-167), skipped here
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
    await expect(live.getByTestId("card-batch")).toContainText("batch"); // HC-TR-115
    await expect(page.getByTestId("live-strip")).toHaveAttribute("data-portfolio", "ready", { timeout: 15_000 });
    await expect(page.getByTestId("live-margin-used")).toContainText("$"); // HC-TR-116
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
    await page.getByTestId("rule-skip").click(); // the Protect step (HC-TR-167), skipped here
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
    // the stored position is applied by an effect after the first paint, so poll rather than read the first box
    await expect.poll(async () => Math.abs(((await launcher.boundingBox())?.x ?? Number.POSITIVE_INFINITY) - moved.x)).toBeLessThan(2);
    // the palette opens it
    await page.keyboard.press("Control+k");
    await page.getByRole("combobox").fill("assistant");
    await page.keyboard.press("Enter");
    await expect(panel).toBeVisible();
  });
});
