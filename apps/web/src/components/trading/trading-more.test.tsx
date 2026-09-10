// Paper tab list behaviour, the trade-mode dialog's live branch, and the Details draft / archived variants.
import type { Strategy } from "@hapiecoin/schema";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeSocket, installMockFetch, renderWithProviders, type MockFetch } from "../../../test/helpers";
import { useUiStore } from "@/lib/store";
import { Workspace } from "@/components/workspace/Workspace";
import { PAGE, Sparkline, sortStrategies } from "./PaperPanel";
import { TradeModeDialog } from "./TradeModeDialog";
import { TradePreviewDialog } from "./TradePreviewDialog";
import { USD } from "@/lib/money";

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
afterEach(() => {
  vi.useRealTimers();
  mock.restore();
});

describe("HC-TR-156 / HC-TR-157 lifecycle on the Paper tab", () => {
  it("chips filter open, expiring and closed; the card shows start and expiry; sort by expiry", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-10T08:00:00Z")); // strat(2) settles at 12:00 UTC today: 0.2 days left
    const acc = mock.state.accounts.get(EMAIL)!;
    acc.strategies.push(strat(1)); // expires 25 Sep: open
    acc.strategies.push(strat(2, { legs: [{ ...CALL, id: "leg_2", expiry: "2026-09-10", symbol: "C-BTC-80000-100926" }] })); // within a day
    acc.strategies.push(strat(3, { status: "archived", tradingMode: "paper", closedAt: "2026-09-09T10:00:00Z", legs: [{ ...CALL, id: "leg_3", status: "squared_off", exitPrice: "1300", closedAt: "2026-09-09T10:00:00Z" }] }));
    acc.strategies.push(strat(4, { status: "archived", tradingMode: "live", closedAt: "2026-09-09T10:00:00Z" })); // a live one: not on this tab
    renderWithProviders(<Workspace />);
    act(() => FakeSocket.last().open());
    const u = userEvent.setup();
    await waitFor(() => expect(screen.getByTestId("paper-panel").dataset["count"]).toBe("2"));
    const chips = within(screen.getByTestId("paper-life"));
    expect(chips.getByTestId("paper-life-open").dataset["count"]).toBe("2");
    expect(chips.getByTestId("paper-life-expiring").dataset["count"]).toBe("1");
    expect(chips.getByTestId("paper-life-closed").dataset["count"]).toBe("1");
    // open cards: start and expiry with days left; the expiring one is marked
    const cards = screen.getAllByTestId("paper-card");
    expect(cards.map((c) => c.dataset["life"]).sort()).toEqual(["expiring", "open"]);
    const far = cards.find((c) => c.dataset["id"] === "strat_1")!;
    expect(within(far).getByTestId("card-expiry").textContent).toContain("expires 25 Sep");
    expect(within(far).getByTestId("card-expiry").textContent).toContain("started 02 Sep"); // strat(1) starts on the 2nd
    const near = cards.find((c) => c.dataset["id"] === "strat_2")!;
    expect(Number(within(near).getByTestId("card-expiry").dataset["days"])).toBeLessThanOrEqual(1);
    // expiring chip
    await u.click(chips.getByTestId("paper-life-expiring"));
    expect(screen.getAllByTestId("paper-card").map((c) => c.dataset["id"])).toEqual(["strat_2"]);
    // closed chip: the archived paper strategy, read-only actions, "closed · squared off"
    await u.click(chips.getByTestId("paper-life-closed"));
    const closedCards = screen.getAllByTestId("paper-card");
    expect(closedCards.map((c) => c.dataset["id"])).toEqual(["strat_3"]);
    expect(within(closedCards[0]!).getByTestId("card-expiry").textContent).toContain("closed 09 Sep");
    expect(within(closedCards[0]!).queryByTestId("card-adjust")).toBeNull();
    expect(within(closedCards[0]!).queryByTestId("card-stop")).toBeNull();
    expect(within(closedCards[0]!).getByTestId("card-journal")).toBeTruthy();
    // back to open, sorted by expiry: the one that settles first leads
    await u.click(chips.getByTestId("paper-life-open"));
    await u.selectOptions(screen.getByTestId("paper-sort"), "expiry");
    expect(screen.getAllByTestId("paper-card").map((c) => c.dataset["id"])).toEqual(["strat_2", "strat_1"]);
    expect(sortStrategies([strat(1), strat(5, { legs: [] })], "expiry", () => 0).map((s) => s.id)).toEqual(["strat_1", "strat_5"]); // nothing open sorts last
    vi.useRealTimers();
  });
});

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

describe("HC-TR-158 capital on the trade preview", () => {
  const leg = (side: "buy" | "sell", price: string) => ({ id: `l_${side}`, kind: "call" as const, side, strike: "80000", expiry: "2026-09-25", symbol: "C-BTC-80000-250926", lots: 1, price });
  const fees = { fee: 0.08, gst: 0.02, total: 0.1, per: [] };
  const base = { open: true, onOpenChange: () => undefined, mode: "paper" as const, asset: "BTC" as const, spot: 79_000, lotSize: "0.001", money: USD, broker: undefined, fees, customPrices: false, busy: false, venue: null, onTrade: () => undefined };
  it("a debit trade puts the premium at risk; a credit trade the worst loss net of the credit; undefined risk says so", () => {
    // long call: premium 1200 × 1 lot × 0.001 = $1.20 at risk; the wallet is $10,000
    const { unmount } = renderWithProviders(<TradePreviewDialog {...base} legs={[leg("buy", "1200")]} maxLoss={-1.2} available={{ amount: 10_000, asset: "USD" }} />);
    let block = screen.getByTestId("preview-capital");
    expect(within(block).getByTestId("preview-capital-required").textContent).toBe("$1.20");
    expect(within(block).getByTestId("preview-capital-available").textContent).toBe("$10,000.00");
    expect(within(block).getByTestId("preview-capital-after").textContent).toBe("$9,998.70"); // 10,000 − 1.20 − 0.10
    expect(block.dataset["pct"]).toBe("0");
    unmount();
    // short call spread reported as maxLoss −800 with a $200 credit: $800 at risk, worst case leaves 10,000 − 800 − 0.10
    const r2 = renderWithProviders(<TradePreviewDialog {...base} legs={[leg("sell", "200000")]} maxLoss={-800} available={{ amount: 10_000, asset: "USD" }} />);
    block = screen.getByTestId("preview-capital");
    expect(within(block).getByTestId("preview-capital-required").textContent).toBe("$800.00");
    expect(within(block).getByTestId("preview-capital-after").textContent).toBe("$9,199.90");
    expect(block.dataset["pct"]).toBe("8");
    r2.unmount();
    // undefined risk: nothing capped, nothing promised; an INR wallet converts at the rate; a coin wallet shows raw
    const r3 = renderWithProviders(<TradePreviewDialog {...base} legs={[leg("sell", "200000")]} maxLoss={null} available={{ amount: 830_000, asset: "INR" }} money={{ currency: "USD", rate: "83" }} />);
    block = screen.getByTestId("preview-capital");
    expect(within(block).getByTestId("preview-capital-required").textContent).toBe("not capped");
    expect(within(block).getByTestId("preview-capital-available").textContent).toBe("$10,000.00");
    expect(within(block).getByTestId("preview-capital-after").textContent).toBe("—");
    r3.unmount();
    renderWithProviders(<TradePreviewDialog {...base} legs={[leg("buy", "1200")]} maxLoss={null} maxLossKnown={false} available={{ amount: 0.5, asset: "BTC" }} />);
    block = screen.getByTestId("preview-capital");
    expect(within(block).getByTestId("preview-capital-required").textContent).toBe("not computed");
    expect(within(block).getByTestId("preview-capital-available").textContent).toBe("0.5 BTC");
    expect(block.textContent).toContain("not a cash asset");
  });
});
