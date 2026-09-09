// Paper tab list behaviour, the trade-mode dialog's live branch, and the Details draft / archived variants.
import type { Strategy } from "@hapiecoin/schema";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FakeSocket, installMockFetch, renderWithProviders, type MockFetch } from "../../../test/helpers";
import { useUiStore } from "@/lib/store";
import { Workspace } from "@/components/workspace/Workspace";
import { PAGE, Sparkline, sortStrategies } from "./PaperPanel";
import { TradeModeDialog } from "./TradeModeDialog";

const EMAIL = "more@example.com";
let mock: MockFetch;
const CALL = { id: "leg_a", kind: "call" as const, side: "buy" as const, strike: "80000", expiry: "2026-09-25", symbol: "C-BTC-80000-250926", lots: 10, price: "1200", entryPrice: "1200", exitPrice: null, iv: 0.5, status: "open" as const, isAdjustment: false, position: 0, openedAt: "2026-09-08T10:00:00Z", closedAt: null, orderId: null };
function strat(i: number, over: Partial<Strategy> = {}): Strategy {
  const at = `2026-09-0${(i % 8) + 1}T10:00:00Z`;
  return { id: `strat_${i}`, name: `Paper ${i}`, asset: i % 2 ? "ETH" : "BTC", status: "paper", tradingMode: "paper", templateName: "Custom", brokerId: "brk_delta", legs: [{ ...CALL, id: `leg_${i}` }], realizedPnl: String(i), pnlHistory: [], notes: "", tags: [], orderBatchId: null, orders: [], adjustments: [], startedAt: at, closedAt: null, createdAt: at, updatedAt: at, ...over };
}

beforeEach(() => {
  FakeSocket.reset();
  mock = installMockFetch();
  mock.loginAs(EMAIL);
  useUiStore.setState({ asset: "BTC", legs: { BTC: [], ETH: [], XAUT: [] }, drafts: [], draftsImported: true, tradeFlow: null, detailsId: null, workspaceTab: "paper", builderTab: "builder" });
});
afterEach(() => mock.restore());

describe("HC-TR-058..066 Paper tab list", () => {
  it("sorts by P&L / date / name and draws a sparkline", () => {
    const rows = [strat(1), strat(2), strat(3)];
    expect(sortStrategies(rows, "pnl", (s) => Number(s.realizedPnl)).map((s) => s.id)).toEqual(["strat_3", "strat_2", "strat_1"]);
    expect(sortStrategies(rows, "date", () => 0).map((s) => s.id)).toEqual(["strat_3", "strat_2", "strat_1"]);
    expect(sortStrategies(rows, "name", () => 0).map((s) => s.id)).toEqual(["strat_1", "strat_2", "strat_3"]);
    render(<Sparkline series={[0, 2, -1]} />);
    expect(screen.getByTestId("sparkline").querySelector("polyline")?.getAttribute("stroke")).toContain("--loss");
  });

  it("search, sort, pagination, refresh and delete from the card", async () => {
    const acc = mock.state.accounts.get(EMAIL)!;
    for (let i = 1; i <= PAGE + 2; i += 1) acc.strategies.push(strat(i));
    renderWithProviders(<Workspace />);
    act(() => FakeSocket.last().open());
    const u = userEvent.setup();
    await waitFor(() => expect(screen.getByTestId("paper-panel").dataset["count"]).toBe(String(PAGE + 2)));
    expect(screen.getAllByTestId("paper-card")).toHaveLength(PAGE);
    expect(screen.getByTestId("paper-pager").textContent).toContain("Page 1 of 2");
    await u.click(within(screen.getByTestId("paper-pager")).getByText("Next ›"));
    expect(screen.getAllByTestId("paper-card")).toHaveLength(2);
    await u.selectOptions(screen.getByTestId("paper-sort"), "name");
    expect(screen.getAllByTestId("paper-card")[0]!.textContent).toContain("Paper 1");
    await u.type(screen.getByTestId("paper-search"), "Paper 12");
    expect(screen.getAllByTestId("paper-card")).toHaveLength(1);
    await u.clear(screen.getByTestId("paper-search"));
    await u.type(screen.getByTestId("paper-search"), "zzz");
    expect(screen.getByTestId("paper-empty").textContent).toContain("No matching paper trades");
    await u.clear(screen.getByTestId("paper-search"));
    await u.click(screen.getByTestId("paper-refresh"));
    expect(screen.getByTestId("paper-total").textContent).toMatch(/\$/);
    // delete the first card with confirm
    await u.click(screen.getAllByTestId("card-delete")[0]!);
    await u.click(screen.getByTestId("card-delete-confirm"));
    await waitFor(() => expect(acc.strategies).toHaveLength(PAGE + 1));
  });
});

describe("HC-TR-050..055 trading mode dialog branches", () => {
  it("live needs a connected exchange; once connected Continue is enabled; a missing exchange shows the error", async () => {
    const onContinue = () => undefined;
    const legs = [{ id: "a", kind: "call" as const, side: "buy" as const, strike: "80000", expiry: "2026-09-25", symbol: "C", lots: 10, price: "1200" }];
    const brokers = [{ id: "b1", name: "Delta Exchange India", feePct: "0.05", gstPct: "18", feeCapPct: "10", scope: "GLOBAL" as const }];
    const { rerender } = renderWithProviders(<TradeModeDialog open title="x" asset="BTC" legs={legs} spot={80_000} lotSize="0.001" money={{ currency: "USD", rate: "1" }} brokers={[]} connected={false} priceModeLabel="Live" onContinue={onContinue} onOpenChange={() => undefined} />);
    const u = userEvent.setup();
    await u.click(screen.getByTestId("trade-continue"));
    expect(screen.getByText("Please select an exchange")).toBeTruthy();
    rerender(<TradeModeDialog open title="x" asset="BTC" legs={legs} spot={80_000} lotSize="0.001" money={{ currency: "USD", rate: "1" }} brokers={brokers} connected={false} priceModeLabel="Live" onContinue={onContinue} onOpenChange={() => undefined} />);
    await u.click(screen.getByTestId("mode-live"));
    expect(screen.getByTestId("trade-not-connected")).toBeTruthy();
    expect(screen.getByTestId("trade-real-money")).toBeTruthy();
    expect(screen.getByTestId("trade-continue").hasAttribute("disabled")).toBe(true);
    await u.click(screen.getByText("Open API Settings"));
    expect(useUiStore.getState().dialog).toBe("api");
    rerender(<TradeModeDialog open title="x" asset="BTC" legs={legs} spot={80_000} lotSize="0.001" money={{ currency: "USD", rate: "1" }} brokers={brokers} connected={true} priceModeLabel="Live" onContinue={onContinue} onOpenChange={() => undefined} />);
    expect(screen.queryByTestId("trade-not-connected")).toBeNull();
    expect(screen.getByTestId("trade-continue").getAttribute("title")).toBeNull();
    expect(screen.getByTestId("trade-continue").hasAttribute("disabled")).toBe(false);
    expect(screen.getByTestId("trade-net").textContent).toContain("Debit");
  });
});

describe("HC-TR-078 Details for drafts and archived strategies", () => {
  it("draft: Load in builder and Activate; archived: Restore; delete with confirm", async () => {
    const acc = mock.state.accounts.get(EMAIL)!;
    acc.strategies.push(strat(1, { asset: "BTC", status: "draft", tradingMode: null, startedAt: null, legs: [{ ...CALL, entryPrice: null, openedAt: null }] }), strat(2, { status: "archived", tradingMode: "paper", closedAt: "2026-09-05T10:00:00Z" }));
    renderWithProviders(<Workspace />);
    act(() => FakeSocket.last().open());
    const u = userEvent.setup();
    await waitFor(() => expect(screen.getByTestId("paper-panel").dataset["count"]).toBe("0"));
    act(() => useUiStore.getState().openDetails("strat_1"));
    const details = screen.getByTestId("strategy-details");
    expect(details.dataset["status"]).toBe("draft");
    await u.click(within(details).getByTestId("details-load"));
    expect(useUiStore.getState().legs.BTC).toHaveLength(1);
    expect(useUiStore.getState().strategy.BTC.draftId).toBe("strat_1");
    expect(useUiStore.getState().workspaceTab).toBe("builder");
    act(() => useUiStore.getState().openDetails("strat_1"));
    await u.click(within(screen.getByTestId("strategy-details")).getByTestId("details-activate"));
    expect(useUiStore.getState().tradeFlow).toEqual({ strategyId: "strat_1" });
    act(() => useUiStore.getState().closeTrade());
    act(() => useUiStore.getState().openDetails("strat_2"));
    const archived = screen.getByTestId("strategy-details");
    expect(archived.dataset["status"]).toBe("archived");
    await u.click(within(archived).getByTestId("details-restore"));
    await waitFor(() => expect(acc.strategies.find((s) => s.id === "strat_2")?.status).toBe("draft"));
    await u.click(within(archived).getByTestId("details-delete"));
    await u.click(within(archived).getByTestId("details-delete-confirm"));
    await waitFor(() => expect(acc.strategies.find((s) => s.id === "strat_2")).toBeUndefined());
    await waitFor(() => expect(screen.queryByTestId("strategy-details")).toBeNull());
  });
});
