// The analysis pane follows what the trader looks at (HC-TR-143, ADR-026) and the Live tab's net positions
// (HC-TR-144, HC-TR-145): tick to show in the pane, Exit with confirm, Exit all, asset filter, disconnected state.
import type { Strategy } from "@hapiecoin/schema";
import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeSocket, installMockFetch, renderWithProviders, type MockFetch } from "../../../test/helpers";
import { useUiStore } from "@/lib/store";
import { Workspace } from "@/components/workspace/Workspace";
import { fmtDateTime, fmtExpiry } from "@/lib/format";
import { positionLabel } from "./NetPositionsPanel";

const EMAIL = "follow@example.com";
let mock: MockFetch;
const acc = () => mock.state.accounts.get(EMAIL)!;
const mine = () => acc().strategies;
const AT = "2026-09-08T10:00:00Z";
const CALL = { id: "leg_a", kind: "call" as const, side: "buy" as const, strike: "80000", expiry: "2026-09-25", symbol: "C-BTC-80000-250926", lots: 10, price: "1200", entryPrice: "1200", exitPrice: null, iv: 0.5, status: "open" as const, isAdjustment: false, position: 0, openedAt: AT, closedAt: null, orderId: null };
function strat(i: number, over: Partial<Strategy> = {}): Strategy {
  return { id: `strat_${i}`, name: `Strategy ${i}`, asset: "BTC", venue: "delta_india", status: "paper", tradingMode: "paper", templateName: "Custom", brokerId: "brk_delta", legs: [{ ...CALL, id: `leg_${i}` }], realizedPnl: "0", pnlHistory: [], notes: "", tags: [], orderBatchId: null, orders: [], adjustments: [], startedAt: AT, closedAt: null, createdAt: AT, updatedAt: AT, ...over };
}
const liveStrat = (i: number, legs: Strategy["legs"] = [{ ...CALL, id: `leg_${i}` }]) =>
  strat(i, { status: "live", tradingMode: "live", orderBatchId: "web-seed", legs, orders: legs.map((l, k) => ({ id: `ord_${i}_${k}`, legId: l.id, purpose: "entry" as const, batchId: "web-seed", orderType: "market" as const, limitPrice: null, clientOrderId: `hc-${l.id}-1`, venueOrderId: `70000${k}`, symbol: l.symbol, side: l.side, size: 10, state: "filled" as const, fillPrice: "1200", error: null, attempts: 1, createdAt: AT, updatedAt: AT })) });
function connect() {
  acc().credentials = [{ id: "crd_main", label: "Main", brokerId: "brk_delta", apiKeyMasked: "****ab12", connectedAt: AT, whitelistedIp: "203.0.113.10" }];
}

beforeEach(() => {
  FakeSocket.reset();
  mock = installMockFetch();
  mock.loginAs(EMAIL);
  HTMLCanvasElement.prototype.getContext = vi.fn(() => new Proxy({} as CanvasRenderingContext2D, { get: () => () => undefined, set: () => true })) as unknown as typeof HTMLCanvasElement.prototype.getContext;
  useUiStore.setState({ asset: "BTC", legs: { BTC: [], ETH: [], XAUT: [] }, tradeFlow: null, detailsId: null, paneSource: null, workspaceTab: "paper", builderTab: "builder", analysisTab: "payoff" });
});
afterEach(() => mock.restore());

describe("HC-TR-143 the pane follows the selected strategy", () => {
  it("auto-follows the first paper card, a click follows another, Back to Builder returns to the Builder legs", async () => {
    mine().push(strat(1), strat(2, { name: "Second one" }));
    renderWithProviders(<Workspace />);
    act(() => FakeSocket.last().open());
    const u = userEvent.setup();
    await waitFor(() => expect(screen.getAllByTestId("paper-card")).toHaveLength(2));
    await waitFor(() => expect(useUiStore.getState().paneSource).toEqual({ kind: "strategy", id: "strat_1" }));
    const bar = screen.getByTestId("pane-source");
    expect(bar.dataset["kind"]).toBe("strategy");
    expect(bar.textContent).toContain("Strategy 1");
    expect(screen.getAllByTestId("paper-card")[0]!.dataset["followed"]).toBe("true");
    // the pane shows the followed legs: no "No strategy yet" empty state
    expect(screen.queryByText("No strategy yet")).toBeNull();
    await u.click(within(screen.getAllByTestId("paper-card")[1]!).getByText("Second one"));
    expect(useUiStore.getState().paneSource).toEqual({ kind: "strategy", id: "strat_2" });
    expect(screen.getByTestId("pane-source").textContent).toContain("Second one");
    // buttons on the card do not change the followed strategy
    await u.click(within(screen.getAllByTestId("paper-card")[0]!).getByTestId("card-details"));
    expect(useUiStore.getState().paneSource).toEqual({ kind: "strategy", id: "strat_2" });
    act(() => useUiStore.getState().openDetails(null));
    await u.click(screen.getByTestId("pane-back-to-builder"));
    expect(useUiStore.getState().paneSource).toBeNull();
    expect(useUiStore.getState().workspaceTab).toBe("builder");
    expect(screen.queryByTestId("pane-source")).toBeNull();
  });

  it("drops a followed strategy that disappears and keyboard-follows a card", async () => {
    mine().push(strat(1));
    renderWithProviders(<Workspace />);
    act(() => FakeSocket.last().open());
    const u = userEvent.setup();
    await waitFor(() => expect(useUiStore.getState().paneSource).toEqual({ kind: "strategy", id: "strat_1" }));
    act(() => useUiStore.getState().followStrategy("strat_gone"));
    await waitFor(() => expect(useUiStore.getState().paneSource).toEqual({ kind: "strategy", id: "strat_1" })); // cleared, then auto-followed again
    screen.getByTestId("paper-card").focus();
    await u.keyboard("{Enter}");
    expect(useUiStore.getState().paneSource).toEqual({ kind: "strategy", id: "strat_1" });
  });
});

describe("HC-TR-144 / HC-TR-145 net positions on the Live tab", () => {
  it("labels positions", () => {
    expect(positionLabel({ productId: 1, symbol: "P-XAUT-4410-080926", size: -1000, entryPrice: "18.52", realizedPnl: null, margin: null, contractValue: "0.001", mark: "16.74" })).toEqual({ title: "SHORT 4,410 PE", sub: `Exp ${fmtExpiry("2026-09-08")} · XAUT` });
    expect(positionLabel({ productId: 2, symbol: "BTCUSD", size: 5, entryPrice: null, realizedPnl: null, margin: null, contractValue: null, mark: null })).toEqual({ title: "LONG BTC perpetual", sub: "BTCUSD" });
    expect(positionLabel({ productId: 3, symbol: "ODD", size: 5, entryPrice: null, realizedPnl: null, margin: null, contractValue: null, mark: null })).toEqual({ title: "LONG ODD", sub: "" });
  });

  it("shows the venue's positions, ticks feed the pane, Exit squares off through the confirm and closes the HapieCoin leg", async () => {
    connect();
    mine().push(liveStrat(1, [{ ...CALL, id: "leg_1" }, { ...CALL, id: "leg_1b", kind: "put", side: "sell", strike: "78000", symbol: "P-BTC-78000-250926", price: "900", entryPrice: "900", position: 1 }]));
    useUiStore.setState({ workspaceTab: "live" });
    renderWithProviders(<Workspace />);
    act(() => FakeSocket.last().open());
    const u = userEvent.setup();
    const panel = await screen.findByTestId("net-positions");
    await waitFor(() => expect(panel.dataset["state"]).toBe("ready"));
    expect(within(panel).getAllByTestId("position-row")).toHaveLength(2);
    expect(within(panel).getAllByTestId("position-row")[0]!.textContent).toContain("LONG 80,000 CE");
    expect(within(panel).getAllByTestId("position-row")[1]!.textContent).toContain("SHORT 78,000 PE");
    expect(within(panel).getAllByTestId("position-pnl")[0]!.textContent).not.toBe("—");
    // asset filter
    await u.click(within(panel).getByTestId("positions-asset-eth"));
    expect(within(panel).getByTestId("positions-empty")).toBeTruthy();
    await u.click(within(panel).getByTestId("positions-asset-all"));
    // tick one → the pane shows that position
    await u.click(within(panel).getAllByTestId("position-tick")[1]!);
    expect(useUiStore.getState().paneSource).toEqual({ kind: "positions", productIds: [101] });
    expect(screen.getByTestId("pane-source").textContent).toContain("1 exchange position");
    await u.click(within(panel).getByTestId("positions-tick-all"));
    expect(useUiStore.getState().paneSource).toEqual({ kind: "positions", productIds: [100, 101] });
    await u.click(within(panel).getByTestId("positions-tick-all"));
    // nothing ticked: the Live tab auto-follows its first card again
    await waitFor(() => expect(useUiStore.getState().paneSource).toEqual({ kind: "strategy", id: "strat_1" }));
    // exit the put: confirm dialog lists it, the mock closes the matching leg
    await u.click(within(panel).getAllByTestId("position-exit")[1]!);
    const dlg = screen.getByTestId("exit-positions");
    expect(within(dlg).getAllByTestId("exit-row")).toHaveLength(1);
    await u.click(within(dlg).getByTestId("exit-confirm"));
    await waitFor(() => expect(mine()[0]!.legs[1]!.status).toBe("squared_off"));
    expect(mine()[0]!.status).toBe("live");
    await waitFor(() => expect(within(panel).getAllByTestId("position-row")).toHaveLength(1));
    // exit all: the strategy has no open legs left and is archived; the panel empties
    await u.click(within(panel).getByTestId("positions-exit-all"));
    await u.click(within(screen.getByTestId("exit-positions")).getByTestId("exit-confirm"));
    await waitFor(() => expect(mine()[0]!.status).toBe("archived"));
    await waitFor(() => expect(within(panel).getByTestId("positions-empty")).toBeTruthy());
  });

  it("explains itself when the exchange is not connected and reports a refused exit", async () => {
    mine().push(liveStrat(1));
    useUiStore.setState({ workspaceTab: "live" });
    renderWithProviders(<Workspace />);
    act(() => FakeSocket.last().open());
    const panel = await screen.findByTestId("net-positions");
    expect(panel.dataset["state"]).toBe("disconnected");
    expect(panel.textContent).toContain("once your exchange is connected");
  });

  it("a refused venue exit is reported and the leg stays open", async () => {
    connect();
    mine().push(liveStrat(1, [{ ...CALL, id: "leg_1", symbol: "C-BTC-FAIL-250926" }]));
    useUiStore.setState({ workspaceTab: "live" });
    renderWithProviders(<Workspace />);
    act(() => FakeSocket.last().open());
    const u = userEvent.setup();
    const panel = await screen.findByTestId("net-positions");
    await waitFor(() => expect(panel.dataset["state"]).toBe("ready"));
    await u.click(within(panel).getByTestId("position-exit"));
    await u.click(within(screen.getByTestId("exit-positions")).getByTestId("exit-confirm"));
    await waitFor(() => expect(screen.queryByTestId("exit-positions")).toBeNull());
    expect(mine()[0]!.legs[0]!.status).toBe("open");
    expect(screen.getByText("1 exit refused")).toBeTruthy();
  });
});

// A closed trade is followed like an open one (ADR-105): the pane shows the position as it was entered and how it
// ended, the live figures step aside, and the card says when it opened and closed to the minute.
const CLOSED_AT = "2026-09-08T12:42:00Z";
const closedStrat = (i: number, reason: NonNullable<Strategy["closeReason"]>, over: Partial<Strategy> = {}) =>
  strat(i, { name: `Closed ${reason}`, status: "archived", closedAt: CLOSED_AT, closeReason: reason, realizedPnl: "-10.11", legs: [{ ...CALL, id: `leg_${i}`, status: "squared_off", exitPrice: "1100", closedAt: CLOSED_AT }], ...over });

describe("HC-TR-214 a closed trade shows in the pane (ADR-105)", () => {
  it("a click on a closed paper card follows it whatever closed it: its name, how it ended, the entry payoff, and no live figures", async () => {
    mine().push(strat(1), closedStrat(2, "stopped"), closedStrat(3, "target"), closedStrat(4, "squared_off"), closedStrat(5, "expired"), closedStrat(6, "outside_app"));
    renderWithProviders(<Workspace />);
    act(() => FakeSocket.last().open());
    const u = userEvent.setup();
    await waitFor(() => expect(useUiStore.getState().paneSource).toEqual({ kind: "strategy", id: "strat_1" }));
    await u.click(screen.getByTestId("paper-life-closed"));
    await waitFor(() => expect(screen.getAllByTestId("paper-card")).toHaveLength(5));
    const labels: Record<string, string> = { stopped: "stopped", target: "target hit", squared_off: "squared off", expired: "expired", outside_app: "closed outside the app" };
    for (const card of screen.getAllByTestId("paper-card")) {
      const id = card.dataset["id"]!;
      const s = mine().find((x) => x.id === id)!;
      expect(card.title).toBe("Click to see this closed trade in the pane");
      await u.click(within(card).getByText(s.name));
      expect(useUiStore.getState().paneSource).toEqual({ kind: "strategy", id });
      // it stays followed: the bar names it, tags it Archived and gives the close time, the reason and the final result
      await waitFor(() => expect(screen.getByTestId("pane-closed").textContent).toBe(`closed ${fmtDateTime(CLOSED_AT)} · ${labels[s.closeReason!]} · final −$10.11`));
      expect(useUiStore.getState().paneSource).toEqual({ kind: "strategy", id });
      const bar = screen.getByTestId("pane-source");
      expect(bar.textContent).toContain(s.name);
      expect(bar.textContent).toContain("Archived");
      expect(card.dataset["followed"]).toBe("true");
      // the payoff is that trade's: its legs, the closed note, and nothing that needs a live price
      const panel = screen.getByTestId("payoff-panel");
      expect(panel.dataset["closed"]).toBe("true");
      expect(within(panel).getByTestId("payoff-closed").textContent).toBe(`Closed trade. Opened ${fmtDateTime(AT)}, closed ${fmtDateTime(CLOSED_AT)} (${labels[s.closeReason!]}), final result −$10.11. The curve is the position as it was entered, held to expiry; target date, Greeks and probability need live prices and are not shown.`);
      expect(screen.queryByText("No strategy yet")).toBeNull();
      expect(within(panel).queryByTestId("payoff-strip")).toBeNull();
      expect(within(panel).queryByTestId("target-controls")).toBeNull();
      expect(within(panel).queryByTestId("greeks-strip")).toBeNull();
      expect(within(panel).getByTestId("tile-pop").textContent).toContain("closed trade");
      expect(within(panel).getByTestId("layer-expiry")).toBeTruthy();
      expect(within(panel).queryByTestId("layer-target")).toBeNull();
      expect(within(panel).queryByTestId("layer-ivUp")).toBeNull();
    }
    expect(screen.getByTestId("pane-strategy-info").textContent).toContain("10 lots");
    // the A key opens no workbench on a closed card
    screen.getAllByTestId("paper-card")[0]!.focus();
    await u.keyboard("a");
    expect(useUiStore.getState().adjust).toBeNull();
    // the tabs that are nothing but live figures say so instead of pricing a dead contract
    for (const [tab, tid, what] of [["greeks", "greeks-closed", "Greeks"], ["scenarios", "scenarios-closed", "Scenarios"], ["ladder", "ladder-closed", "The ladder's target-date figures"]] as const) {
      await u.click(screen.getByTestId(`analysis-tab-${tab}`));
      expect((await screen.findByTestId(tid)).textContent).toBe(`This trade is closed${what} need live prices, and a closed trade has none. The Payoff tab shows the position as it was entered and how it ended.`);
    }
    // back on an open trade everything live returns
    await u.click(screen.getByTestId("analysis-tab-payoff"));
    await u.click(screen.getByTestId("paper-life-open"));
    await u.click(within(await screen.findByTestId("paper-card")).getByText("Strategy 1"));
    await waitFor(() => expect(screen.queryByTestId("pane-closed")).toBeNull());
    const live = screen.getByTestId("payoff-panel");
    expect(live.dataset["closed"]).toBeUndefined();
    expect(within(live).getByTestId("target-controls")).toBeTruthy();
    expect(within(live).getByTestId("greeks-strip")).toBeTruthy();
    expect(within(live).getByTestId("layer-target")).toBeTruthy();
  });

  it("a closed live trade is followed from the Live tab, by click and by keyboard", async () => {
    connect();
    const legs = [{ ...CALL, id: "leg_9", status: "squared_off" as const, exitPrice: "1500", closedAt: CLOSED_AT }];
    mine().push({ ...liveStrat(9, legs), name: "Live one", status: "archived", closedAt: CLOSED_AT, closeReason: "target", realizedPnl: "3" });
    useUiStore.setState({ workspaceTab: "live" });
    renderWithProviders(<Workspace />);
    act(() => FakeSocket.last().open());
    const u = userEvent.setup();
    await u.click(await screen.findByTestId("live-life-closed"));
    const card = await screen.findByTestId("live-card");
    expect(useUiStore.getState().paneSource).toBeNull(); // nothing open to auto-follow, and a closed trade is never followed by itself
    await u.click(within(card).getByText("Live one"));
    await waitFor(() => expect(screen.getByTestId("pane-closed").textContent).toBe(`closed ${fmtDateTime(CLOSED_AT)} · target hit · final +$3.00`));
    expect(screen.getByTestId("payoff-panel").dataset["closed"]).toBe("true");
    await u.click(screen.getByTestId("pane-back-to-builder"));
    expect(useUiStore.getState().paneSource).toBeNull();
    act(() => useUiStore.getState().setWorkspaceTab("live"));
    await u.click(await screen.findByTestId("live-life-closed")); // the tab opens on its open trades again
    (await screen.findByTestId("live-card")).focus();
    await u.keyboard("{Enter}");
    expect(useUiStore.getState().paneSource).toEqual({ kind: "strategy", id: "strat_9" });
    await waitFor(() => expect(screen.getByTestId("pane-closed")).toBeTruthy());
  });

  it("a trade that closes while the pane follows it open still hands the pane back; clicking its closed card afterwards shows it", async () => {
    mine().push(strat(1));
    renderWithProviders(<Workspace />);
    act(() => FakeSocket.last().open());
    const u = userEvent.setup();
    await waitFor(() => expect(useUiStore.getState().paneSource).toEqual({ kind: "strategy", id: "strat_1" }));
    await waitFor(() => expect(screen.getByTestId("pane-source").textContent).toContain("Strategy 1"));
    // the server closes it (a stop fired): the next read brings it back archived
    Object.assign(mine()[0]!, { status: "archived", closedAt: CLOSED_AT, closeReason: "stopped", realizedPnl: "-2", legs: [{ ...CALL, id: "leg_1", status: "squared_off", exitPrice: "1180", closedAt: CLOSED_AT }] });
    await u.click(screen.getByTestId("paper-refresh"));
    await waitFor(() => expect(useUiStore.getState().paneSource).toBeNull());
    expect(screen.queryByTestId("pane-source")).toBeNull();
    await u.click(screen.getByTestId("paper-life-closed"));
    await u.click(within(await screen.findByTestId("paper-card")).getByText("Strategy 1"));
    await waitFor(() => expect(screen.getByTestId("pane-closed").textContent).toBe(`closed ${fmtDateTime(CLOSED_AT)} · stopped · final −$2.00`));
    // and it is not thrown out on the next read
    await u.click(screen.getByTestId("paper-refresh"));
    await waitFor(() => expect(screen.getByTestId("pane-closed")).toBeTruthy());
    expect(useUiStore.getState().paneSource).toEqual({ kind: "strategy", id: "strat_1" });
  });
});

describe("HC-TR-214 a closed trade: what the pane remembers and what it draws", () => {
  it("a trade that closed after the trader left it is shown on the first click of its closed card", async () => {
    mine().push(strat(1));
    renderWithProviders(<Workspace />);
    act(() => FakeSocket.last().open());
    const u = userEvent.setup();
    await waitFor(() => expect(screen.getByTestId("pane-source").textContent).toContain("Strategy 1"));
    // the trader goes back to the Builder; the trade closes meanwhile
    await u.click(screen.getByTestId("pane-back-to-builder"));
    expect(useUiStore.getState().paneSource).toBeNull();
    Object.assign(mine()[0]!, { status: "archived", closedAt: CLOSED_AT, closeReason: "stopped", realizedPnl: "-2", legs: [{ ...CALL, id: "leg_1", status: "squared_off", exitPrice: "1180", closedAt: CLOSED_AT }] });
    act(() => useUiStore.getState().setWorkspaceTab("paper"));
    await u.click(await screen.findByTestId("paper-refresh"));
    await u.click(await screen.findByTestId("paper-life-closed"));
    await u.click(within(await screen.findByTestId("paper-card")).getByText("Strategy 1"));
    await waitFor(() => expect(screen.getByTestId("pane-closed").textContent).toBe(`closed ${fmtDateTime(CLOSED_AT)} · stopped · final −$2.00`));
    await new Promise((r) => setTimeout(r, 50));
    expect(useUiStore.getState().paneSource).toEqual({ kind: "strategy", id: "strat_1" });
  });

  it("every entered leg is drawn (a stopped leg and the one closed later), a leg that never filled is not, and Share names the trade", async () => {
    const put = { ...CALL, id: "leg_p", kind: "put" as const, side: "sell" as const, strike: "78000", symbol: "P-BTC-78000-250926", lots: 5, price: "900", entryPrice: "900", status: "squared_off" as const, exitPrice: "300", closedAt: CLOSED_AT };
    const call = { ...CALL, id: "leg_c", side: "sell" as const, status: "squared_off" as const, exitPrice: "2400", closedAt: "2026-09-08T11:00:00Z" };
    const unfilled = { ...CALL, id: "leg_u", strike: "82000", symbol: "C-BTC-82000-250926", lots: 7, entryPrice: null, status: "squared_off" as const, closedAt: CLOSED_AT };
    mine().push(closedStrat(2, "stopped", { name: "Two legs", legs: [call, put, unfilled] }), closedStrat(3, "squared_off", { name: "Nothing entered", legs: [unfilled] }));
    renderWithProviders(<Workspace />);
    act(() => FakeSocket.last().open());
    const u = userEvent.setup();
    await u.click(await screen.findByTestId("paper-life-closed"));
    await u.click(await screen.findByText("Two legs"));
    await waitFor(() => expect(screen.getByTestId("pane-closed")).toBeTruthy());
    expect(screen.getByTestId("pane-strategy-info").textContent).toContain("15 lots"); // 10 + 5, not the 7 that never filled
    expect(screen.getByTestId("pane-strategy-info").getAttribute("title")).toContain("2 legs");
    await u.click(screen.getByTestId("share-open"));
    expect((await screen.findByTestId("share-dialog")).textContent).toContain("Two legs · BTC · 2 legs");
    await u.keyboard("{Escape}");
    act(() => useUiStore.getState().followStrategy(null));
    // a closed trade that never held anything says so instead of "No strategy yet"
    await u.click(await screen.findByText("Nothing entered"));
    await waitFor(() => expect(screen.getByText("No leg of this trade was entered")).toBeTruthy());
    expect(screen.queryByText("No strategy yet")).toBeNull();
    expect(screen.queryByTestId("payoff-open-builder")).not.toBeNull();
  });
});

describe("HC-TR-214 a closed trade with no recorded reason", () => {
  it("an older closed trade (no close reason stored) is followed and named without one", async () => {
    mine().push({ ...closedStrat(2, "stopped"), name: "Old one", closeReason: null, realizedPnl: "4.5" });
    renderWithProviders(<Workspace />);
    act(() => FakeSocket.last().open());
    const u = userEvent.setup();
    await u.click(await screen.findByTestId("paper-life-closed"));
    await u.click(within(await screen.findByTestId("paper-card")).getByText("Old one"));
    await waitFor(() => expect(screen.getByTestId("pane-closed").textContent).toBe(`closed ${fmtDateTime(CLOSED_AT)} · final +$4.50`));
    expect(screen.getByTestId("payoff-closed").textContent).toContain(`closed ${fmtDateTime(CLOSED_AT)}, final result +$4.50.`);
  });
});

describe("HC-TR-215 a trade says when it opened and closed, to the minute", () => {
  it("the formatter gives the day and the minute in the named zone", () => {
    expect(fmtDateTime("2026-11-19T07:12:39Z", "Asia/Kolkata")).toBe("19 Nov 2026, 12:42 IST");
    expect(fmtDateTime("2026-11-19T18:40:00Z", "Asia/Kolkata")).toBe("20 Nov 2026, 00:10 IST"); // the local day, not the UTC one
    expect(fmtDateTime("2026-11-19T07:12:39Z", "UTC")).toBe("19 Nov 2026, 07:12 UTC");
    expect(fmtDateTime("2026-09-08T18:30:00Z", "Asia/Kolkata")).toBe("09 Sep 2026, 00:00 IST"); // "Sep" as everywhere else, whatever the engine calls it
    expect(fmtDateTime(null)).toBe("—");
    expect(fmtDateTime(undefined)).toBe("—");
    expect(fmtDateTime("not a date")).toBe("—");
  });

  it("open and closed cards and Details carry the start and the close with the time", async () => {
    mine().push(strat(1), closedStrat(2, "stopped"), strat(3, { name: "Never started", startedAt: null }));
    renderWithProviders(<Workspace />);
    act(() => FakeSocket.last().open());
    const u = userEvent.setup();
    await waitFor(() => expect(screen.getAllByTestId("paper-card")).toHaveLength(2));
    const [first, unstarted] = screen.getAllByTestId("paper-card");
    expect(within(first!).getByTestId("card-started").textContent).toBe(`started ${fmtDateTime(AT)}`);
    expect(within(first!).getByTestId("card-held").textContent).toMatch(/^open for \d+ (m|h \d+ m|d \d+ h)$/); // HC-TR-252
    expect(within(first!).queryByTestId("card-closed")).toBeNull();
    expect(within(unstarted!).getByTestId("card-started").textContent).toBe("started —");
    expect(within(unstarted!).queryByTestId("card-held")).toBeNull();
    await u.click(within(first!).getByTestId("card-details"));
    expect((await screen.findByTestId("details-started")).textContent).toBe(`Started${fmtDateTime(AT)}`);
    expect(screen.queryByTestId("details-closed")).toBeNull();
    act(() => useUiStore.getState().openDetails(null));
    await u.click(screen.getByTestId("paper-life-closed"));
    const closed = await screen.findByTestId("paper-card");
    expect(within(closed).getByTestId("card-started").textContent).toBe(`started ${fmtDateTime(AT)}`);
    expect(within(closed).getByTestId("card-held").textContent).toMatch(/^held \d+ (m|h \d+ m|d \d+ h)$/); // HC-TR-252
    expect(within(closed).getByTestId("card-closed").textContent).toBe(`closed ${fmtDateTime(CLOSED_AT)}stopped`);
    await u.click(within(closed).getByTestId("card-details"));
    expect((await screen.findByTestId("details-closed")).textContent).toBe(`Closed${fmtDateTime(CLOSED_AT)}`);
    expect(screen.getByTestId("details-started").textContent).toBe(`Started${fmtDateTime(AT)}`);
  });
});

describe("HC-TR-260 the pane follows a trade that has booked a result (ADR-131)", () => {
  it("HC-TR-260 the tiles and the curve are the whole trade's and the pane says so; the net premium stays what the open leg collected; a trade with nothing booked has no note", async () => {
    const PUT = { ...CALL, id: "leg_p", kind: "put" as const, side: "sell" as const, strike: "58500", symbol: "P-BTC-58500-250926", lots: 100, price: "1111.3", entryPrice: "1111.3" };
    const STOPPED = { ...CALL, id: "leg_c", side: "sell" as const, strike: "62000", symbol: "C-BTC-62000-250926", lots: 100, price: "1018.2", entryPrice: "1018.2", exitPrice: "3071.6", status: "squared_off" as const, closedAt: AT, closeReason: "stopped" as const, position: 1 };
    mine().push(strat(1, { name: "Stopped strangle", realizedPnl: "-205.34", legs: [PUT, STOPPED] }), strat(2, { name: "Plain put", legs: [{ ...PUT, id: "leg_q" }] }));
    renderWithProviders(<Workspace />);
    act(() => {
      FakeSocket.last().open();
      FakeSocket.last().receive({ t: "spot", s: "BTC", p: "61000", c24: 0.4 });
    });
    const u = userEvent.setup();
    await waitFor(() => expect(useUiStore.getState().paneSource).toEqual({ kind: "strategy", id: "strat_1" }));
    await waitFor(() => expect(screen.getByTestId("payoff-panel").dataset["state"]).toBe("ready"));
    await waitFor(() => expect(screen.getByTestId("tile-max-profit").textContent).toContain("−$94.21")); // 111.13 − 205.34
    expect(screen.getByTestId("tile-max-profit").textContent).toContain("Best case"); // not "Max profit" over a loss
    expect(screen.getByTestId("max-roi").textContent).toBe("—"); // the whole trade's best case over the open legs' margin is no ratio
    expect(screen.getByTestId("payoff-booked").textContent).toBe("Whole trade: the figures and the curve include −$205.34 already realised on this trade.");
    expect(screen.getByTestId("tile-net").textContent).toContain("+$111.13");
    expect(screen.getByTestId("tile-net").textContent).toContain("credit received");
    await u.click(within(screen.getAllByTestId("paper-card").find((c) => c.dataset["id"] === "strat_2")!).getByText("Plain put")); // the list is sorted by P&L, so by id
    await waitFor(() => expect(screen.getByTestId("tile-max-profit").textContent).toContain("$111.13"));
    expect(screen.getByTestId("tile-max-profit").textContent).not.toContain("−");
    expect(screen.queryByTestId("payoff-booked")).toBeNull();
  });
});
