// Paper trading end to end against the in-memory API and the fake gateway (HC-TR-022, 050..057, 058..081).
import { chainTopic } from "@hapiecoin/schema";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeSocket, installMockFetch, renderWithProviders, type MockFetch , typeLiveIf } from "../../../test/helpers";
import { buildChain } from "../../../test/fixtures/chain";
import { useUiStore } from "@/lib/store";
import { Workspace } from "@/components/workspace/Workspace";

const EXPIRY = "2026-09-25";
const TOPIC = chainTopic("delta_india", "BTC", EXPIRY);
const rows = buildChain("BTC", EXPIRY);
const EMAIL = "trader@example.com";
let mock: MockFetch;
const mine = () => mock.state.accounts.get(EMAIL)!.strategies;

function seedLegs() {
  const s = useUiStore.getState();
  const atm = rows.findIndex((r) => Number(r.strike) >= 79521);
  const call = rows[atm]!;
  const put = rows[atm - 2]!;
  s.addLeg({ asset: "BTC", kind: "call", side: "buy", strike: call.strike, expiry: EXPIRY, lots: 10, price: call.call!.mark, iv: call.call!.markIv });
  s.addLeg({ asset: "BTC", kind: "put", side: "sell", strike: put.strike, expiry: EXPIRY, lots: 10, price: put.put!.mark, iv: put.put!.markIv });
  return { call, put };
}
function serveMarket() {
  const ws = FakeSocket.last();
  act(() => {
    ws.open();
    ws.receive({ t: "spot", s: "BTC", p: "79521", c24: 0.4 });
    ws.receive({ t: "snap", topic: TOPIC, seq: 0, rows });
  });
  return ws;
}
/** Re-serve the chain with every mark scaled, so open legs move. */
function moveMarket(factor: number) {
  const ws = FakeSocket.last();
  const moved = rows.map((r) => ({
    ...r,
    call: r.call ? { ...r.call, mark: (Number(r.call.mark) * factor).toFixed(1) } : r.call,
    put: r.put ? { ...r.put, mark: (Number(r.put.mark) * factor).toFixed(1) } : r.put,
  }));
  act(() => {
    ws.receive({ t: "snap", topic: TOPIC, seq: 1, rows: moved });
  });
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
    tradeFlow: null,
    protectPrompt: false, // the Protect step is covered by rules.test.tsx
    detailsId: null,
    workspaceTab: "builder",
    builderTab: "builder",
    targetPrice: null,
    targetDays: 0,
  });
});
afterEach(() => mock.restore());

async function paperTradeFromBuilder(u: ReturnType<typeof userEvent.setup>) {
  // HC-TR-155: a Builder name that is only the loaded template's name gives way to the suggested format
  act(() => useUiStore.getState().setStrategyMeta("BTC", { name: "Iron Butterfly" }));
  await u.click(screen.getByTestId("builder-paper-trade"));
  const mode = screen.getByTestId("trade-mode");
  expect(within(mode).getByTestId("mode-paper").getAttribute("aria-pressed")).toBe("true");
  expect(within(mode).getByTestId("mode-check")).toBeTruthy(); // HC-TR-122
  fireEvent.change(within(mode).getByTestId("trade-broker"), { target: { value: within(mode).getByTestId<HTMLSelectElement>("trade-broker").value } });
  expect(useUiStore.getState().brokerId).toBe(within(mode).getByTestId<HTMLSelectElement>("trade-broker").value); // HC-TR-142
  await waitFor(() => expect(within(mode).getByTestId<HTMLSelectElement>("trade-broker").value).toBe("brk_delta"));
  expect(within(mode).getByTestId("fee-summary").textContent).toContain("Delta India · fee 0.05% of notional");
  await u.click(within(mode).getByTestId("trade-continue"));
  const preview = screen.getByTestId("trade-preview");
  // HC-TR-158: capital on the preview (worst loss, fees, wallet when connected)
  expect(within(preview).getByTestId("preview-capital")).toBeTruthy();
  expect(within(preview).getByTestId("preview-capital-required").textContent).toMatch(/\$|not capped/);
  expect(within(preview).getAllByTestId("preview-row")).toHaveLength(2);
  expect(within(preview).getByTestId("preview-note").textContent).toContain("Paper trade");
  await typeLiveIf(u, preview);
  await u.click(within(preview).getByTestId("trade-now"));
  // the name is always confirmed: the template name is not a trader's name, so the suggested format shows
  const name = screen.getByTestId("save-draft-dialog");
  expect(within(name).getByTestId<HTMLInputElement>("save-draft-name").value).toMatch(/^BTC-[A-Z0-9]+-[0-9]{2}[A-Z]{3}[0-9]{2}-[0-9]{4}$/);
  await u.clear(within(name).getByTestId("save-draft-name")); // the box arrives pre-filled (HC-TR-155)
  await u.type(within(name).getByTestId("save-draft-name"), "Risk reversal");
  await u.click(within(name).getByTestId("save-draft-confirm"));
  await waitFor(() => expect(mine()).toHaveLength(1));
  await waitFor(() => expect(mine()[0]!.status).toBe("paper"));
  return mine()[0]!;
}

describe("HC-TR-022 / HC-TR-050..057 paper trade from the Builder", () => {
  it("Select Trading Mode → Trade Preview → name → the strategy starts as paper at the live marks and the Paper tab shows it", async () => {
    const { call, put } = seedLegs();
    renderWithProviders(<Workspace />);
    serveMarket();
    const u = userEvent.setup();
    const s = await paperTradeFromBuilder(u);
    // HC-TR-113 / 138: the summary strip carries the net delta and the margin estimate once the worker has priced the book
    await waitFor(() => expect(screen.getByTestId("paper-strip").dataset["portfolio"]).toBe("ready"), { timeout: 8000 });
    expect(screen.getByTestId("paper-net-delta").textContent).toMatch(/^[+-]\d\.\d{4}$/);
    expect(screen.getByTestId("paper-margin-used").textContent).toMatch(/\$|—/);
    expect(s.name).toBe("Risk reversal");
    expect(s.brokerId).toBe("brk_delta");
    expect(s.legs.map((l) => l.entryPrice)).toEqual([call.call!.mark, put.put!.mark]);
    // Builder cleared, Paper tab selected with the count pill and the card
    expect(useUiStore.getState().legs.BTC).toHaveLength(0);
    expect(useUiStore.getState().workspaceTab).toBe("paper");
    await waitFor(() => expect(screen.getByTestId("paper-count").textContent).toBe("1"));
    const card = screen.getByTestId("paper-card");
    expect(within(card).getByTestId("mode-pill").dataset["status"]).toBe("paper");
    expect(within(card).getByTestId("card-pnl").textContent).toMatch(/\$0\.00/);
    // marks rise 10 %: long call gains, short put loses; the buy leg is priced higher than the sell leg here
    moveMarket(1.1);
    const callPnl = Number(call.call!.mark) * 0.1 * 10 * 0.001;
    const putPnl = -Number(put.put!.mark) * 0.1 * 10 * 0.001;
    const expected = callPnl + putPnl;
    await waitFor(() => expect(within(card).getByTestId("card-pnl").textContent).toContain(Math.abs(expected).toFixed(2)));
    expect(screen.getByTestId("paper-total").textContent).toContain(Math.abs(expected).toFixed(2));
    // live trade is not available yet: the mode dialog says so
    expect(screen.getByTestId("card-golive").hasAttribute("disabled")).toBe(true);
  });

  it("HC-TR-046 Activate on a draft in My templates starts it as paper", async () => {
    seedLegs();
    renderWithProviders(<Workspace />);
    serveMarket();
    const u = userEvent.setup();
    await u.click(screen.getByTestId("builder-save"));
    const dialog = screen.getByTestId("save-draft-dialog");
    await u.clear(within(dialog).getByTestId("save-draft-name")); // the box arrives pre-filled (HC-TR-155)
    await u.type(within(dialog).getByTestId("save-draft-name"), "Draft one");
    await u.click(within(dialog).getByTestId("save-draft-confirm"));
    await waitFor(() => expect(mine()).toHaveLength(1));
    await u.click(screen.getByTestId("builder-tab-templates"));
    await waitFor(() => expect(screen.getByTestId("mine-activate")).toBeTruthy());
    await u.click(screen.getByTestId("mine-activate"));
    const mode = screen.getByTestId("trade-mode");
    expect(mode.textContent).toContain("“Draft one”");
    await waitFor(() => expect(within(mode).getByTestId<HTMLSelectElement>("trade-broker").value).toBe("brk_delta"));
    await u.click(within(mode).getByTestId("trade-continue"));
    await typeLiveIf(u, screen.getByTestId("trade-preview"));
    await u.click(within(screen.getByTestId("trade-preview")).getByTestId("trade-now"));
    await waitFor(() => expect(mine()[0]!.status).toBe("paper"));
    expect(useUiStore.getState().workspaceTab).toBe("paper");
  });
});

describe("HC-TR-068..081 details, square off, partial exit, adjustment, stop", () => {
  it("Details shows the tiles and legs; square off realises P&L; partial exit splits a leg; stop archives", async () => {
    seedLegs();
    renderWithProviders(<Workspace />);
    serveMarket();
    const u = userEvent.setup();
    const s = await paperTradeFromBuilder(u);
    await waitFor(() => expect(screen.getByTestId("paper-card")).toBeTruthy());
    // HC-TR-114 Set alert on the card opens the Alerts center on a P&L form for this strategy
    await u.click(screen.getByTestId("card-alert"));
    expect(useUiStore.getState()).toMatchObject({ dialog: "alerts", alertPrefill: { kind: "pnl", strategyId: s.id, asset: "BTC" } });
    useUiStore.setState({ dialog: null, alertPrefill: null });
    await u.click(screen.getByTestId("card-details"));
    const details = screen.getByTestId("strategy-details");
    expect(details.dataset["status"]).toBe("paper");
    expect(within(details).getAllByTestId("details-leg")).toHaveLength(2);
    // HC-TR-120 the same from Details
    await u.click(within(details).getByTestId("details-alert"));
    expect(useUiStore.getState().alertPrefill).toEqual({ kind: "pnl", strategyId: s.id, asset: "BTC" });
    useUiStore.setState({ dialog: null, alertPrefill: null });
    expect(within(details).getByTestId("details-total").textContent).toMatch(/\$0\.00/);
    // square off the first leg at a higher exit → realised P&L +1.00 for 10 lots × 0.001 × 100
    await u.click(within(details).getAllByTestId("details-sqoff")[0]!);
    const sq = screen.getByTestId("square-off");
    const entry = Number(s.legs[0]!.entryPrice);
    fireEvent.change(within(sq).getByTestId("sqoff-exit"), { target: { value: String(entry + 100) } });
    expect(within(sq).getByTestId("sqoff-pnl").textContent).toContain("1.00");
    await u.click(within(sq).getByTestId("sqoff-confirm"));
    await waitFor(() => expect(mine()[0]!.realizedPnl).toBe("1"));
    await waitFor(() => expect(within(details).getByTestId("details-realized").textContent).toContain("1.00"));
    await u.click(within(details).getByTestId("details-tab-closed"));
    expect(within(details).getAllByTestId("details-leg")).toHaveLength(1);
    await u.click(within(details).getByTestId("details-tab-active"));
    // partial exit of the remaining leg: 50 % of 10 lots = 5, leg splits
    await u.click(within(details).getByTestId("details-partial"));
    const pe = screen.getByTestId("partial-exit");
    expect(within(pe).getAllByTestId("pe-row")).toHaveLength(1);
    await u.click(within(pe).getByTestId("pe-check"));
    expect(within(pe).getByTestId("pe-lots").textContent).toBe("5");
    await u.click(within(pe).getByTestId("pe-go"));
    await waitFor(() => expect(mine()[0]!.legs).toHaveLength(3));
    expect(mine()[0]!.legs.filter((l) => l.status === "open").map((l) => l.lots)).toEqual([5]);
    // adjustment through the workbench (ADR-044): Details closes, the left pane becomes the workbench
    await u.click(within(details).getByTestId("details-adjust"));
    const wb = await screen.findByTestId("adjust-workbench");
    await waitFor(() => expect(screen.queryByTestId("strategy-details")).toBeNull());
    serveMarket();
    await waitFor(() => expect(within(wb).getAllByTestId("wb-chain-row").length).toBeGreaterThan(0), { timeout: 5000 });
    await u.click(within(within(wb).getAllByTestId("wb-chain-row")[3]!).getByTestId("wb-chain-sell-call"));
    expect(within(wb).getAllByTestId("wb-pick")).toHaveLength(1);
    await u.click(within(wb).getByTestId("adjust-review"));
    const confirm = await screen.findByTestId("adjust-confirm");
    expect(confirm.dataset["mode"]).toBe("paper");
    await typeLiveIf(u, confirm);
    await u.click(within(confirm).getByTestId("adjust-apply"));
    await waitFor(() => expect(mine()[0]!.legs).toHaveLength(4));
    expect(mine()[0]!.legs.at(-1)).toMatchObject({ isAdjustment: true, status: "open", side: "sell" });
    expect(mine()[0]!.adjustments).toHaveLength(1);
    // Details reopens on the adjusted strategy with its history
    const after = await screen.findByTestId("strategy-details");
    await waitFor(() => expect(within(after).getAllByTestId("details-adjustment")).toHaveLength(1));
    // stop → archive at live prices
    // HC-TR-118 / 119: six tiles and the payoff mini chart at the entry premiums
    expect(within(after).getByTestId("details-tiles").children).toHaveLength(6);
    expect(within(after).getByTestId("details-legs-tile").textContent).toMatch(/\d\/\d/);
    await waitFor(() => expect(within(after).getByTestId("details-margin-tile").textContent).toContain("POP"), { timeout: 8000 });
    expect(within(after).getByTestId("details-chart")).toBeTruthy();
    await u.click(within(after).getByTestId("details-stop"));
    const stop = screen.getByTestId("stop-paper");
    expect(within(stop).getAllByTestId("stop-leg")).toHaveLength(2);
    expect(within(stop).getByTestId<HTMLInputElement>("stop-archive").checked).toBe(true);
    await u.click(within(stop).getByTestId("stop-go"));
    await waitFor(() => expect(mine()[0]!.status).toBe("archived"));
    expect(mine()[0]!.legs.every((l) => l.status === "squared_off")).toBe(true);
    await waitFor(() => expect(screen.queryByTestId("strategy-details")).toBeNull());
    await waitFor(() => expect(screen.getByTestId("paper-empty")).toBeTruthy());
    // HC-TR-164: the Closed chip shows why it closed
    await u.click(screen.getByTestId("paper-life-closed"));
    await waitFor(() => expect(screen.getByTestId("card-close-reason").textContent).toBe("squared off"));
    expect(screen.getByTestId("card-close-reason").dataset["reason"]).toBe("squared_off");
  });

  it("HC-TR-064 Stop from the card keeps the strategy as a draft when unticked; HC-TR-065 delete with confirm", async () => {
    seedLegs();
    renderWithProviders(<Workspace />);
    serveMarket();
    const u = userEvent.setup();
    await paperTradeFromBuilder(u);
    await waitFor(() => expect(screen.getByTestId("paper-card")).toBeTruthy());
    await u.click(screen.getByTestId("card-stop"));
    const stop = screen.getByTestId("stop-paper");
    await u.click(within(stop).getByTestId("stop-archive"));
    expect(within(stop).getByTestId("stop-hint").textContent).toContain("remain in Draft Strategies");
    await u.click(within(stop).getByTestId("stop-go"));
    await waitFor(() => expect(mine()[0]!.status).toBe("draft"));
    expect(mine()[0]!.legs.every((l) => l.entryPrice === null)).toBe(true);
    await waitFor(() => expect(screen.getByTestId("paper-empty")).toBeTruthy());
    // delete the draft from My templates
    await u.click(screen.getByTestId("tab-builder"));
    await u.click(screen.getByTestId("builder-tab-templates"));
    await waitFor(() => expect(screen.getByTestId("mine-delete")).toBeTruthy());
    await u.click(screen.getByTestId("mine-delete"));
    await u.click(screen.getByTestId("mine-delete-confirm"));
    await waitFor(() => expect(mine()).toHaveLength(0));
  });
});
