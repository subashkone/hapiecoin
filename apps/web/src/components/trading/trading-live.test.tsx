// Live trading flows (Phase 3 item 2, ADR-025) against the mock API's fake venue: Go live from a paper card
// (HC-TR-063), live from the Builder (HC-TR-055), refused orders and Retry (HC-TR-083), Trade All → Live
// (HC-TR-089), live adjustments through the workbench's confirm (HC-TR-088, ADR-044) and the Live tab (HC-TR-082, 084..087).
import type { Strategy, StrategyOrder } from "@hapiecoin/schema";
import { chainTopic } from "@hapiecoin/schema";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeSocket, installMockFetch, renderWithProviders, type MockFetch } from "../../../test/helpers";
import { buildChain } from "../../../test/fixtures/chain";
import { useUiStore } from "@/lib/store";
import { Workspace } from "@/components/workspace/Workspace";

const EXPIRY = "2026-09-25";
const TOPIC = chainTopic("delta_india", "BTC", EXPIRY);
const rows = buildChain("BTC", EXPIRY);
const EMAIL = "live@example.com";
let mock: MockFetch;
const acc = () => mock.state.accounts.get(EMAIL)!;
const mine = () => acc().strategies;

const CALL = { id: "leg_a", kind: "call" as const, side: "buy" as const, strike: "80000", expiry: EXPIRY, symbol: "C-BTC-80000-250926", lots: 10, price: "1200", entryPrice: "1200", exitPrice: null, iv: 0.5, status: "open" as const, isAdjustment: false, position: 0, openedAt: "2026-09-08T10:00:00Z", closedAt: null, orderId: null };
function strat(i: number, over: Partial<Strategy> = {}): Strategy {
  const at = `2026-09-0${(i % 8) + 1}T10:00:00Z`;
  return { id: `strat_${i}`, name: `Paper ${i}`, asset: "BTC", status: "paper", tradingMode: "paper", templateName: "Custom", brokerId: "brk_delta", legs: [{ ...CALL, id: `leg_${i}` }], realizedPnl: "0", pnlHistory: [], notes: "", tags: [], orderBatchId: null, orders: [], adjustments: [], startedAt: at, closedAt: null, createdAt: at, updatedAt: at, ...over };
}
function connect() {
  acc().credential = { brokerId: "brk_delta", apiKeyMasked: "****ab12", connectedAt: "2026-09-08T09:00:00Z", whitelistedIp: "203.0.113.10" };
}
function serveMarket() {
  const ws = FakeSocket.last();
  act(() => {
    ws.open();
    ws.receive({ t: "spot", s: "BTC", p: "79521", c24: 0.4 });
    ws.receive({ t: "snap", topic: TOPIC, seq: 0, rows });
  });
}
const panel = () => screen.getByTestId("live-panel");
/** Press and hold the live button for longer than HOLD_MS (real time, the button's interval drives it). */
async function hold(el: HTMLElement, ms = 1400) {
  fireEvent.pointerDown(el);
  await act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });
  fireEvent.pointerUp(el);
}

beforeEach(() => {
  FakeSocket.reset();
  mock = installMockFetch();
  mock.loginAs(EMAIL);
  HTMLCanvasElement.prototype.getContext = vi.fn(() => new Proxy({} as CanvasRenderingContext2D, { get: () => () => undefined, set: () => true })) as unknown as typeof HTMLCanvasElement.prototype.getContext;
  useUiStore.setState({
    asset: "BTC",
    expiry: { BTC: EXPIRY },
    legs: { BTC: [], ETH: [], XAUT: [] },
    strategy: { BTC: { name: "", basket: false, priceMode: "live", draftId: null }, ETH: { name: "", basket: false, priceMode: "live", draftId: null }, XAUT: { name: "", basket: false, priceMode: "live", draftId: null } },
    drafts: [],
    draftsImported: true,
    tradeFlow: null,
    detailsId: null,
    workspaceTab: "paper",
    builderTab: "builder",
    targetPrice: null,
    targetDays: 0,
  });
});
afterEach(() => mock.restore());

describe("HC-TR-063 Go live from a paper card", () => {
  it("locks the mode to Live, shows the exchange preview, places the orders and lands on the Live tab", async () => {
    connect();
    mine().push(strat(1));
    renderWithProviders(<Workspace />);
    act(() => FakeSocket.last().open());
    const u = userEvent.setup();
    await waitFor(() => expect(screen.getByTestId("paper-card")).toBeTruthy());
    await waitFor(() => expect(screen.getByTestId("card-golive").hasAttribute("disabled")).toBe(false));
    await u.click(screen.getByTestId("card-golive"));
    expect(useUiStore.getState().tradeFlow).toEqual({ strategyId: "strat_1", mode: "live" });
    const mode = screen.getByTestId("trade-mode");
    expect(within(mode).getByTestId("mode-live").getAttribute("aria-pressed")).toBe("true");
    expect(within(mode).getByTestId("mode-paper").hasAttribute("disabled")).toBe(true);
    expect(within(mode).getByTestId("trade-real-money")).toBeTruthy();
    expect(within(mode).queryByTestId("trade-not-connected")).toBeNull();
    await waitFor(() => expect(within(mode).getByTestId<HTMLSelectElement>("trade-broker").value).toBe("brk_delta"));
    await u.click(within(mode).getByTestId("trade-continue"));
    const preview = await screen.findByTestId("trade-preview");
    const venue = await within(preview).findByTestId("venue-preview");
    expect(venue.dataset["ok"]).toBe("true");
    expect(within(venue).getAllByTestId("venue-leg")).toHaveLength(1);
    expect(within(venue).getAllByTestId("venue-leg")[0]!.textContent).toContain("C-BTC-80000-250926");
    expect(within(preview).getByTestId("trade-now").textContent).toContain("Place live orders");
    expect(within(venue).getByTestId("venue-margin-used").textContent).toContain("12 USD"); // exchange margin in use (ADR-029)
    await u.click(within(preview).getByTestId("trade-now"));
    await waitFor(() => expect(mine()[0]!.status).toBe("live"));
    expect(mine()[0]!.orderBatchId).toMatch(/^web-/);
    expect(mine()[0]!.orders).toHaveLength(1);
    expect(mine()[0]!.orders[0]).toMatchObject({ state: "filled", purpose: "entry" });
    expect(useUiStore.getState().workspaceTab).toBe("live");
    await waitFor(() => expect(screen.getByTestId("live-count").textContent).toContain("1"));
    expect(screen.queryByTestId("paper-count")).toBeNull();
    // the Live tab: exchange chip, order chip per leg, Square off all instead of Stop
    await waitFor(() => expect(within(panel()).getByTestId("live-card")).toBeTruthy());
    expect(within(panel()).getByTestId("live-exchange-chip").textContent).toContain("exchange connected");
    expect(within(panel()).getByTestId("card-batch").textContent).toMatch(/^batch \w{6}$/); // HC-TR-115
    expect(within(panel()).getByTestId("order-chip").dataset["state"]).toBe("filled");
    expect(within(panel()).getByTestId("card-sqall")).toBeTruthy();
    expect(within(panel()).queryByTestId("card-stop")).toBeNull();
    expect(within(panel()).queryByTestId("failed-banner")).toBeNull();
  });

  it("stays disabled without a connected exchange and the mode dialog explains it", async () => {
    mine().push(strat(1));
    renderWithProviders(<Workspace />);
    act(() => FakeSocket.last().open());
    await waitFor(() => expect(screen.getByTestId("paper-card")).toBeTruthy());
    expect(screen.getByTestId("card-golive").hasAttribute("disabled")).toBe(true);
    expect(screen.getByTestId("card-golive").getAttribute("title")).toContain("Connect your exchange");
  });
});

describe("HC-TR-083 refused orders and Retry", () => {
  it("a refused leg shows the failed banner with the venue reason; Retry fills it", async () => {
    connect();
    mine().push(strat(1, { legs: [{ ...CALL, id: "leg_1", symbol: "C-BTC-FAIL-250926" }] }));
    renderWithProviders(<Workspace />);
    act(() => FakeSocket.last().open());
    const u = userEvent.setup();
    await waitFor(() => expect(screen.getByTestId("card-golive").hasAttribute("disabled")).toBe(false));
    await u.click(screen.getByTestId("card-golive"));
    const mode = screen.getByTestId("trade-mode");
    await waitFor(() => expect(within(mode).getByTestId<HTMLSelectElement>("trade-broker").value).toBe("brk_delta"));
    await u.click(within(mode).getByTestId("trade-continue"));
    const preview = await screen.findByTestId("trade-preview");
    await within(preview).findByTestId("venue-preview");
    await u.click(within(preview).getByTestId("trade-now"));
    await waitFor(() => expect(mine()[0]!.status).toBe("live"));
    expect(mine()[0]!.orders[0]).toMatchObject({ state: "failed", attempts: 1 });
    const banner = await within(panel()).findByTestId("failed-banner");
    expect(banner.textContent).toContain("Order placement failed");
    expect(within(panel()).getByTestId("order-chip").dataset["state"]).toBe("failed");
    expect(within(panel()).getByTestId("order-chip").getAttribute("title")).toContain("Not enough margin");
    await u.click(within(banner).getByTestId("card-retry"));
    await waitFor(() => expect(mine()[0]!.orders[0]).toMatchObject({ state: "filled", attempts: 2 }));
    await waitFor(() => expect(within(panel()).queryByTestId("failed-banner")).toBeNull());
    expect(within(panel()).getByTestId("order-chip").dataset["state"]).toBe("filled");
  });
});

describe("HC-TR-089 Trade All → Live", () => {
  it("ticks every open paper strategy, places them in order and moves to the Live tab", async () => {
    connect();
    mine().push(strat(1), strat(2), strat(3, { legs: [{ ...CALL, id: "leg_3", status: "squared_off", exitPrice: "1000", closedAt: "2026-09-08T11:00:00Z" }] }));
    renderWithProviders(<Workspace />);
    act(() => FakeSocket.last().open());
    const u = userEvent.setup();
    await waitFor(() => expect(screen.getAllByTestId("paper-card")).toHaveLength(3));
    await u.click(screen.getByTestId("trade-all-live"));
    const dlg = screen.getByTestId("batch-live");
    expect(within(dlg).getAllByTestId("batch-row")).toHaveLength(3);
    const checks = within(dlg).getAllByTestId<HTMLInputElement>("batch-check");
    expect(checks.map((c) => c.checked)).toEqual([true, true, false]);
    expect(checks[2]!.disabled).toBe(true);
    expect(within(dlg).getByTestId("batch-warning").textContent).toContain("Real Money Trading");
    await waitFor(() => expect(within(dlg).getByTestId<HTMLSelectElement>("batch-broker").value).toBe("brk_delta"));
    expect(within(dlg).getByTestId("batch-go").textContent).toContain("Trade 2 strategies live");
    await u.click(checks[1]!);
    expect(within(dlg).getByTestId("batch-go").textContent).toContain("Trade 1 strategy live");
    await u.click(checks[1]!);
    await u.selectOptions(within(dlg).getByTestId("batch-broker"), "brk_delta");
    await u.click(within(dlg).getByTestId("batch-go"));
    await waitFor(() => expect(mine().filter((s) => s.status === "live")).toHaveLength(2));
    expect(mine()[0]!.orderBatchId).toMatch(/^web-.*:strat_1$/);
    expect(useUiStore.getState().workspaceTab).toBe("live");
    await waitFor(() => expect(screen.getByTestId("live-count").textContent).toContain("2"));
  });

  it("reports the strategy at which the batch stopped", async () => {
    connect();
    mine().push(strat(1, { legs: [{ ...CALL, id: "leg_1", symbol: "C-BTC-FAIL-250926" }] }), strat(2));
    renderWithProviders(<Workspace />);
    act(() => FakeSocket.last().open());
    const u = userEvent.setup();
    await waitFor(() => expect(screen.getAllByTestId("paper-card")).toHaveLength(2));
    await u.click(screen.getByTestId("trade-all-live"));
    const dlg = screen.getByTestId("batch-live");
    await waitFor(() => expect(within(dlg).getByTestId<HTMLSelectElement>("batch-broker").value).toBe("brk_delta"));
    await u.click(within(dlg).getByTestId("batch-go"));
    await waitFor(() => expect(mine()[0]!.status).toBe("live"));
    expect(mine()[1]!.status).toBe("paper"); // stopped at the first refusal
    await waitFor(() => expect(screen.queryByTestId("batch-live")).toBeNull());
    // back on the Paper tab, reopen and cancel: nothing else is placed
    act(() => useUiStore.getState().setWorkspaceTab("paper"));
    await u.click(screen.getByTestId("trade-all-live"));
    await u.click(within(screen.getByTestId("batch-live")).getByText("Cancel"));
    await waitFor(() => expect(screen.queryByTestId("batch-live")).toBeNull());
    expect(mine()[1]!.status).toBe("paper");
  });
});

describe("HC-TR-055 live from the Builder", () => {
  it("Live in the mode dialog → name → exchange preview → orders placed and the Builder cleared", async () => {
    connect();
    const s = useUiStore.getState();
    const atm = rows.findIndex((r) => Number(r.strike) >= 79521);
    const call = rows[atm]!;
    s.addLeg({ asset: "BTC", kind: "call", side: "buy", strike: call.strike, expiry: EXPIRY, lots: 10, price: call.call!.mark, iv: call.call!.markIv });
    useUiStore.setState({ workspaceTab: "builder" });
    renderWithProviders(<Workspace />);
    serveMarket();
    const u = userEvent.setup();
    await u.click(screen.getByTestId("builder-paper-trade"));
    const mode = screen.getByTestId("trade-mode");
    await waitFor(() => expect(within(mode).getByTestId<HTMLSelectElement>("trade-broker").value).toBe("brk_delta"));
    await waitFor(() => expect(within(mode).getByTestId("mode-live").hasAttribute("disabled")).toBe(false));
    await u.click(within(mode).getByTestId("mode-live"));
    await waitFor(() => expect(within(mode).queryByTestId("trade-not-connected")).toBeNull());
    await u.click(within(mode).getByTestId("trade-continue"));
    // unnamed: name first, then the server draft is previewed against the venue
    const name = screen.getByTestId("save-draft-dialog");
    await u.clear(within(name).getByTestId("save-draft-name")); // the box arrives pre-filled (HC-TR-155)
    await u.type(within(name).getByTestId("save-draft-name"), "Long call live");
    await u.click(within(name).getByTestId("save-draft-confirm"));
    const preview = await screen.findByTestId("trade-preview");
    const venue = await within(preview).findByTestId("venue-preview");
    expect(venue.dataset["ok"]).toBe("true");
    expect(within(preview).getByTestId("preview-note").textContent).not.toContain("Paper trade");
    await waitFor(() => expect(mine()).toHaveLength(1));
    expect(mine()[0]!.status).toBe("draft");
    await u.click(within(preview).getByTestId("trade-now"));
    await waitFor(() => expect(mine()[0]!.status).toBe("live"));
    expect(mine()[0]!.name).toBe("Long call live");
    expect(mine()[0]!.orders.map((o: StrategyOrder) => o.state)).toEqual(["filled"]);
    expect(useUiStore.getState().legs.BTC).toHaveLength(0);
    expect(useUiStore.getState().workspaceTab).toBe("live");
  });
});

describe("HC-TR-088 live adjustments and square off from Details", () => {
  it("an adjustment goes through the workbench's live confirm with the venue check and lands as a filled order; Square off all archives with exit orders", async () => {
    connect();
    const at = "2026-09-08T10:00:00Z";
    mine().push(strat(1, { status: "live", tradingMode: "live", orderBatchId: "web-seed", orders: [{ id: "ord_1", legId: "leg_1", purpose: "entry", batchId: "web-seed", orderType: "market", limitPrice: null, clientOrderId: "hc-leg_1-1", venueOrderId: "700001", symbol: CALL.symbol, side: "buy", size: 10, state: "pending", fillPrice: null, error: null, attempts: 1, createdAt: at, updatedAt: at }] }));
    useUiStore.setState({ workspaceTab: "live" });
    renderWithProviders(<Workspace />);
    act(() => FakeSocket.last().open());
    const u = userEvent.setup();
    await waitFor(() => expect(within(panel()).getByTestId("live-card")).toBeTruthy());
    // a pending order shows a Sync button; the mock answers the strategy as is
    expect(within(panel()).getByTestId("order-chip").dataset["state"]).toBe("pending");
    await u.click(within(panel()).getByTestId("card-sync"));
    await waitFor(() => expect(screen.getByText("Synced")).toBeTruthy());
    mine()[0]!.orders[0]!.state = "filled";
    await u.click(within(panel()).getByTestId("card-details"));
    const details = screen.getByTestId("strategy-details");
    expect(details.dataset["status"]).toBe("live");
    expect(within(details).getByTestId("details-mode-note").textContent).toContain("Live trading");
    await u.click(within(details).getByTestId("details-adjust"));
    const wb = await screen.findByTestId("adjust-workbench");
    serveMarket();
    await waitFor(() => expect(within(wb).getAllByTestId("wb-chain-row").length).toBeGreaterThan(0), { timeout: 5000 });
    await u.click(within(within(wb).getAllByTestId("wb-chain-row")[3]!).getByTestId("wb-chain-sell-call"));
    await u.click(within(wb).getByTestId("adjust-review"));
    let confirm = await screen.findByTestId("adjust-confirm");
    expect(confirm.dataset["mode"]).toBe("live");
    expect(within(confirm).getAllByTestId("adjust-confirm-row")).toHaveLength(1);
    // the venue prices the proposed batch before anything is placed
    await waitFor(() => expect(within(confirm).getByTestId("adjust-venue").dataset["ok"]).toBe("true"));
    expect(within(confirm).getByTestId("adjust-venue").textContent).toContain("band");
    expect(mine()[0]!.legs).toHaveLength(1); // nothing sent before confirm
    await u.click(within(confirm).getByTestId("adjust-cancel"));
    await waitFor(() => expect(screen.queryByTestId("adjust-confirm")).toBeNull());
    expect(mine()[0]!.legs).toHaveLength(1);
    await u.click(within(wb).getByTestId("adjust-review"));
    confirm = await screen.findByTestId("adjust-confirm");
    await waitFor(() => expect(within(confirm).getByTestId("adjust-venue").dataset["ok"]).toBe("true"));
    await u.type(within(confirm).getByTestId("adjust-reason"), "hedge the upside");
    // HC-TR-152: the band column, the order type, and hold-to-place: a short press cancels, a held press places
    expect(within(confirm).getByTestId("adjust-band").textContent).toContain("±5%");
    expect(within(confirm).getByTestId("adjust-type").textContent).toBe("market");
    const apply = within(confirm).getByTestId("adjust-apply");
    expect(apply.textContent).toContain("Hold to place 1 order");
    await hold(apply, 300);
    expect(mine()[0]!.legs).toHaveLength(1); // let go early: nothing sent
    expect(apply.dataset["progress"]).toBe("0.00");
    await hold(apply);
    await waitFor(() => expect(mine()[0]!.legs).toHaveLength(2));
    expect(mine()[0]!.orders.at(-1)).toMatchObject({ purpose: "adjustment", state: "filled", orderType: "market" });
    expect(mine()[0]!.adjustments.at(-1)).toMatchObject({ added: 1, reason: "hedge the upside" });
    // the fill states stay on screen until Done
    await waitFor(() => expect(confirm.dataset["stage"]).toBe("placed"));
    expect(within(confirm).getAllByTestId("adjust-result").map((r) => r.dataset["state"])).toEqual(["filled"]);
    await u.click(within(confirm).getByTestId("adjust-done"));
    await waitFor(() => expect(screen.queryByTestId("adjust-confirm")).toBeNull());
    // a second batch: the venue refuses (account blocked) → Place stays disabled with the reason; unblocked, it goes with a fresh key
    await waitFor(() => expect(screen.queryByTestId("adjust-workbench")).toBeNull());
    const firstKey = mine()[0]!.adjustments.at(-1)!.batchId;
    await u.keyboard("{Escape}");
    await u.click(within(panel()).getByTestId("card-adjust"));
    const wb2 = await screen.findByTestId("adjust-workbench");
    serveMarket();
    await waitFor(() => expect(within(wb2).getAllByTestId("wb-chain-row").length).toBeGreaterThan(0), { timeout: 5000 });
    await u.click(within(within(wb2).getAllByTestId("wb-chain-row")[4]!).getByTestId("wb-chain-buy-put"));
    acc().tradingDisabled = true;
    await u.click(within(wb2).getByTestId("adjust-review"));
    const refused = await screen.findByTestId("adjust-confirm");
    await waitFor(() => expect(within(refused).getByTestId("adjust-venue").dataset["ok"]).toBe("false"));
    expect(within(refused).getByTestId("adjust-venue-verdict").textContent).toContain("disabled");
    expect(within(refused).getByTestId<HTMLButtonElement>("adjust-apply").disabled).toBe(true);
    await u.click(within(refused).getByTestId("adjust-cancel"));
    acc().tradingDisabled = false;
    await u.click(within(wb2).getByTestId("adjust-review"));
    const second = await screen.findByTestId("adjust-confirm");
    await waitFor(() => expect(within(second).getByTestId("adjust-venue").dataset["ok"]).toBe("true"));
    // a limit at the reviewed mark: the bought put rests on the venue (the mock's mark sits above the reviewed one), so it comes back pending
    await u.click(within(second).getByTestId("order-type-limit"));
    expect(within(second).getByTestId("adjust-type").textContent).toBe("limit");
    await hold(within(second).getByTestId("adjust-apply"));
    await waitFor(() => expect(mine()[0]!.adjustments).toHaveLength(2));
    expect(mine()[0]!.adjustments.at(-1)!.batchId).not.toBe(firstKey);
    expect(mine()[0]!.orders.at(-1)).toMatchObject({ purpose: "adjustment", orderType: "limit", state: "pending", batchId: mine()[0]!.adjustments.at(-1)!.batchId });
    expect(mine()[0]!.legs.at(-1)!.entryPrice).toBeNull();
    await waitFor(() => expect(second.dataset["stage"]).toBe("placed"));
    expect(within(second).getAllByTestId("adjust-result").map((r) => r.dataset["state"])).toEqual(["pending"]);
    expect(within(second).getByTestId("adjust-result").textContent).toContain("resting");
    await u.click(within(second).getByTestId("adjust-done"));
    await waitFor(() => expect(screen.queryByTestId("adjust-confirm")).toBeNull());
    // the workbench closes and Details reopens with the history; square off all: live exits at the venue, strategy archived
    await waitFor(() => expect(screen.queryByTestId("adjust-workbench")).toBeNull());
    const reopened = await screen.findByTestId("strategy-details");
    await waitFor(() => expect(within(reopened).getAllByTestId("details-adjustment")).toHaveLength(2));
    expect(within(reopened).getByTestId("adjusted-badge").dataset["count"]).toBe("2");
    await u.click(within(reopened).getByTestId("details-sqall"));
    await u.click(within(reopened).getByTestId("details-sqall-confirm"));
    await waitFor(() => expect(mine()[0]!.status).toBe("archived"));
    expect(mine()[0]!.orders.filter((o) => o.purpose === "exit")).toHaveLength(3); // the original leg and both adjustment legs
    expect(mine()[0]!.legs.every((l) => l.status === "squared_off")).toBe(true);
  });
});
