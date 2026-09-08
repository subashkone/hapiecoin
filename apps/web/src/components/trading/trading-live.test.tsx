// Live trading flows (Phase 3 item 2, ADR-025) against the mock API's fake venue: Go live from a paper card
// (HC-TR-063), live from the Builder (HC-TR-055), refused orders and Retry (HC-TR-083), Trade All → Live
// (HC-TR-089), live adjustments through Confirm Adjustment (HC-TR-088) and the Live tab (HC-TR-082, 084..087).
import type { Strategy, StrategyOrder } from "@hapiecoin/schema";
import { chainTopic } from "@hapiecoin/schema";
import { act, screen, waitFor, within } from "@testing-library/react";
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
  return { id: `strat_${i}`, name: `Paper ${i}`, asset: "BTC", status: "paper", tradingMode: "paper", templateName: "Custom", brokerId: "brk_delta", legs: [{ ...CALL, id: `leg_${i}` }], realizedPnl: "0", pnlHistory: [], notes: "", tags: [], orderBatchId: null, orders: [], startedAt: at, closedAt: null, createdAt: at, updatedAt: at, ...over };
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
  it("an adjustment goes through Confirm Adjustment Order and lands as a filled order; Square off all archives with exit orders", async () => {
    connect();
    const at = "2026-09-08T10:00:00Z";
    mine().push(strat(1, { status: "live", tradingMode: "live", orderBatchId: "web-seed", orders: [{ id: "ord_1", legId: "leg_1", purpose: "entry", clientOrderId: "hc-leg_1-1", venueOrderId: "700001", symbol: CALL.symbol, side: "buy", size: 10, state: "pending", fillPrice: null, error: null, attempts: 1, createdAt: at, updatedAt: at }] }));
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
    const picker = screen.getByTestId("chain-picker");
    await waitFor(() => expect(within(picker).getAllByTestId("picker-expiry").length).toBeGreaterThan(0));
    serveMarket();
    await waitFor(() => expect(within(picker).getAllByTestId("picker-row").length).toBeGreaterThan(0), { timeout: 5000 });
    await u.click(within(within(picker).getAllByTestId("picker-row")[3]!).getByTestId("picker-sell-call"));
    await u.click(within(picker).getByTestId("picker-add"));
    let confirm = await screen.findByTestId("confirm-adjustment");
    expect(within(confirm).getAllByTestId("adj-row")).toHaveLength(1);
    expect(mine()[0]!.legs).toHaveLength(1); // nothing sent before confirm
    await u.click(within(confirm).getByText("Cancel"));
    await waitFor(() => expect(screen.queryByTestId("confirm-adjustment")).toBeNull());
    expect(mine()[0]!.legs).toHaveLength(1);
    await u.click(within(details).getByTestId("details-adjust"));
    const again = screen.getByTestId("chain-picker");
    await waitFor(() => expect(within(again).getAllByTestId("picker-row").length).toBeGreaterThan(0), { timeout: 5000 });
    await u.click(within(within(again).getAllByTestId("picker-row")[3]!).getByTestId("picker-sell-call"));
    await u.click(within(again).getByTestId("picker-add"));
    confirm = await screen.findByTestId("confirm-adjustment");
    await u.click(within(confirm).getByTestId("adj-confirm"));
    await waitFor(() => expect(mine()[0]!.legs).toHaveLength(2));
    expect(mine()[0]!.orders.at(-1)).toMatchObject({ purpose: "adjustment", state: "filled" });
    await waitFor(() => expect(screen.queryByTestId("confirm-adjustment")).toBeNull());
    // square off all: live exits at the venue, strategy archived
    await u.click(within(details).getByTestId("details-sqall"));
    await u.click(within(details).getByTestId("details-sqall-confirm"));
    await waitFor(() => expect(mine()[0]!.status).toBe("archived"));
    expect(mine()[0]!.orders.filter((o) => o.purpose === "exit")).toHaveLength(2);
    expect(mine()[0]!.legs.every((l) => l.status === "squared_off")).toBe(true);
  });
});
