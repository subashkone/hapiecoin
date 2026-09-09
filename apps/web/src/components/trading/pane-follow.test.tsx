// The analysis pane follows what the trader looks at (HC-TR-143, ADR-026) and the Live tab's net positions
// (HC-TR-144, HC-TR-145): tick to analyse, Exit with confirm, Exit all, asset filter, disconnected state.
import type { Strategy } from "@hapiecoin/schema";
import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeSocket, installMockFetch, renderWithProviders, type MockFetch } from "../../../test/helpers";
import { useUiStore } from "@/lib/store";
import { Workspace } from "@/components/workspace/Workspace";
import { fmtExpiry } from "@/lib/format";
import { positionLabel } from "./NetPositionsPanel";

const EMAIL = "follow@example.com";
let mock: MockFetch;
const acc = () => mock.state.accounts.get(EMAIL)!;
const mine = () => acc().strategies;
const AT = "2026-09-08T10:00:00Z";
const CALL = { id: "leg_a", kind: "call" as const, side: "buy" as const, strike: "80000", expiry: "2026-09-25", symbol: "C-BTC-80000-250926", lots: 10, price: "1200", entryPrice: "1200", exitPrice: null, iv: 0.5, status: "open" as const, isAdjustment: false, position: 0, openedAt: AT, closedAt: null, orderId: null };
function strat(i: number, over: Partial<Strategy> = {}): Strategy {
  return { id: `strat_${i}`, name: `Strategy ${i}`, asset: "BTC", status: "paper", tradingMode: "paper", templateName: "Custom", brokerId: "brk_delta", legs: [{ ...CALL, id: `leg_${i}` }], realizedPnl: "0", pnlHistory: [], notes: "", tags: [], orderBatchId: null, orders: [], adjustments: [], startedAt: AT, closedAt: null, createdAt: AT, updatedAt: AT, ...over };
}
const liveStrat = (i: number, legs: Strategy["legs"] = [{ ...CALL, id: `leg_${i}` }]) =>
  strat(i, { status: "live", tradingMode: "live", orderBatchId: "web-seed", legs, orders: legs.map((l, k) => ({ id: `ord_${i}_${k}`, legId: l.id, purpose: "entry" as const, batchId: "web-seed", clientOrderId: `hc-${l.id}-1`, venueOrderId: `70000${k}`, symbol: l.symbol, side: l.side, size: 10, state: "filled" as const, fillPrice: "1200", error: null, attempts: 1, createdAt: AT, updatedAt: AT })) });
function connect() {
  acc().credential = { brokerId: "brk_delta", apiKeyMasked: "****ab12", connectedAt: AT, whitelistedIp: "203.0.113.10" };
}

beforeEach(() => {
  FakeSocket.reset();
  mock = installMockFetch();
  mock.loginAs(EMAIL);
  HTMLCanvasElement.prototype.getContext = vi.fn(() => new Proxy({} as CanvasRenderingContext2D, { get: () => () => undefined, set: () => true })) as unknown as typeof HTMLCanvasElement.prototype.getContext;
  useUiStore.setState({ asset: "BTC", legs: { BTC: [], ETH: [], XAUT: [] }, drafts: [], draftsImported: true, tradeFlow: null, detailsId: null, paneSource: null, workspaceTab: "paper", builderTab: "builder", analysisTab: "payoff" });
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
    // the pane analyses the followed legs: no "No strategy yet" empty state
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
    // tick one → the pane analyses that position
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
