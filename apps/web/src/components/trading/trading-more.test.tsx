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
  return { id: `strat_${i}`, name: `Paper ${i}`, asset: i % 2 ? "ETH" : "BTC", venue: "delta_india", status: "paper", tradingMode: "paper", templateName: "Custom", brokerId: "brk_delta", legs: [{ ...CALL, id: `leg_${i}` }], realizedPnl: String(i), pnlHistory: [], notes: "", tags: [], orderBatchId: null, orders: [], adjustments: [], startedAt: at, closedAt: null, createdAt: at, updatedAt: at, ...over };
}

beforeEach(() => {
  FakeSocket.reset();
  mock = installMockFetch();
  mock.loginAs(EMAIL);
  useUiStore.setState({ asset: "BTC", legs: { BTC: [], ETH: [], XAUT: [] }, tradeFlow: null, detailsId: null, workspaceTab: "paper", builderTab: "builder" });
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

describe("HC-TR-250..252 the Paper tab read by coin and by who opened the trade", () => {
  const AUTO = { autopilotPlaybookId: "evening-strangle-stop-3x" };
  const done = (i: number, pnl: string, closedAt: string, over: Partial<Strategy> = {}): Strategy =>
    strat(i, { status: "archived", tradingMode: "paper", closedAt, closeReason: "target", realizedPnl: pnl, legs: [{ ...CALL, id: `leg_${i}`, status: "squared_off", exitPrice: "1300", closedAt }], ...over });
  const ids = () => screen.queryAllByTestId("paper-card").map((c) => c.dataset["id"]);
  const count = (id: string) => screen.getByTestId(id).dataset["count"];

  it("HC-TR-250 HC-TR-251 chips for the coin and for Autopilot or the trader, each with the count it would show; they combine with the status chips", async () => {
    const acc = mock.state.accounts.get(EMAIL)!;
    acc.strategies.push(strat(1, AUTO), strat(2, AUTO), strat(3), strat(4)); // open: ETH auto, BTC auto, ETH mine, BTC mine
    acc.strategies.push(done(5, "7", "2026-09-06T12:00:00Z", AUTO), done(6, "-3", "2026-09-07T12:00:00Z")); // closed: ETH auto, BTC mine
    renderWithProviders(<Workspace />);
    act(() => FakeSocket.last().open());
    const u = userEvent.setup();
    await waitFor(() => expect(screen.getByTestId("paper-panel").dataset["count"]).toBe("4"));
    expect([count("paper-coin-all"), count("paper-coin-BTC"), count("paper-coin-ETH")]).toEqual(["4", "2", "2"]);
    expect(screen.queryByTestId("paper-coin-XAUT")).toBeNull(); // no gold trade: no gold chip
    expect([count("paper-source-all"), count("paper-source-autopilot"), count("paper-source-manual")]).toEqual(["4", "2", "2"]);
    expect(screen.queryByTestId("paper-summary")).toBeNull(); // nothing filtered on the open list: the strip above says it all
    // one coin
    await u.click(screen.getByTestId("paper-coin-ETH"));
    expect(screen.getByTestId("paper-coin-ETH").getAttribute("aria-pressed")).toBe("true");
    expect(ids().sort()).toEqual(["strat_1", "strat_3"]);
    expect([count("paper-source-all"), count("paper-source-autopilot"), count("paper-source-manual")]).toEqual(["2", "1", "1"]); // counted under the coin
    expect([count("paper-life-open"), count("paper-life-closed")]).toEqual(["2", "1"]);
    expect(screen.getByTestId("paper-summary").dataset["trades"]).toBe("2");
    expect(screen.getByTestId("paper-summary").textContent).toContain("ETH · Autopilot and by me");
    expect(screen.getByTestId("paper-summary").textContent).toContain("2 open trades");
    // and who opened it
    await u.click(screen.getByTestId("paper-source-autopilot"));
    expect(ids()).toEqual(["strat_1"]);
    expect(within(screen.getByTestId("paper-card")).getByTestId("card-autopilot").textContent).toBe("Autopilot");
    expect([count("paper-coin-all"), count("paper-coin-BTC"), count("paper-coin-ETH")]).toEqual(["2", "1", "1"]); // counted under Autopilot
    expect(screen.getByTestId("paper-summary").textContent).toContain("ETH · Autopilot");
    expect(screen.getByTestId("paper-summary").textContent).toContain("1 open tradebefore fees"); // singular
    await u.click(screen.getByTestId("paper-source-manual"));
    expect(ids()).toEqual(["strat_3"]);
    expect(within(screen.getByTestId("paper-card")).queryByTestId("card-autopilot")).toBeNull();
    // a combination with nothing in it says so and offers the way back
    await u.click(screen.getByTestId("paper-life-closed"));
    expect(ids()).toEqual([]);
    expect(screen.getByTestId<HTMLSelectElement>("paper-sort").value).toBe("date"); // the closed list's own sort
    expect(screen.getByTestId("paper-empty").textContent).toContain("No trades match these filters");
    expect(screen.getByTestId("paper-empty").textContent).toContain("ETH · By me: nothing under Closed");
    await u.click(screen.getByTestId("paper-filters-clear"));
    expect(ids()).toEqual(["strat_6", "strat_5"]);
    expect(screen.getByTestId("paper-coin-all").getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByTestId("paper-source-all").getAttribute("aria-pressed")).toBe("true");
    // a status with nothing in it at all is not blamed on a filter
    await u.click(screen.getByTestId("paper-coin-BTC"));
    await u.click(screen.getByTestId("paper-life-expiring"));
    expect(screen.getByTestId("paper-empty").textContent).toContain("Nothing expires within a day");
    expect(screen.queryByTestId("paper-filters-clear")).toBeNull();
    // back on Open the trader's own sort is untouched by the visit to Closed
    await u.click(screen.getByTestId("paper-life-open"));
    expect(screen.getByTestId<HTMLSelectElement>("paper-sort").value).toBe("pnl");
    // a search narrows the sum too, and the line says so
    await u.click(screen.getByTestId("paper-coin-all"));
    await u.type(screen.getByTestId("paper-search"), "Paper 4");
    expect(ids()).toEqual(["strat_4"]);
    expect(screen.getByTestId("paper-summary-scope").textContent).toBe('All coins · Autopilot and by me · matching "Paper 4"');
    expect(screen.getByTestId("paper-summary").dataset["trades"]).toBe("1");
  });

  it("HC-TR-251 a coin whose last trade is gone stops filtering: the list is not left empty behind a chip that no longer exists", async () => {
    const acc = mock.state.accounts.get(EMAIL)!;
    acc.strategies.push(strat(1), strat(2), strat(4, { asset: "XAUT" })); // ETH, BTC, XAUT
    renderWithProviders(<Workspace />);
    act(() => FakeSocket.last().open());
    const u = userEvent.setup();
    await waitFor(() => expect(screen.getByTestId("paper-panel").dataset["count"]).toBe("3"));
    await u.click(screen.getByTestId("paper-coin-ETH"));
    expect(ids()).toEqual(["strat_1"]);
    await u.click(within(screen.getByTestId("paper-card")).getByTestId("card-delete"));
    await u.click(screen.getByTestId("card-delete-confirm"));
    await waitFor(() => expect(screen.getByTestId("paper-panel").dataset["count"]).toBe("2"));
    expect(screen.queryByTestId("paper-coin-ETH")).toBeNull();
    expect(screen.getByTestId("paper-coin-all").getAttribute("aria-pressed")).toBe("true");
    expect(ids().sort()).toEqual(["strat_2", "strat_4"]);
  });

  it("HC-TR-252 Closed lists the newest exit first and adds the listed trades up: how many, how many won, the total before fees", async () => {
    const acc = mock.state.accounts.get(EMAIL)!;
    acc.strategies.push(strat(1, AUTO));
    // started in the order 5, 6, 7 and closed in the order 6, 7, 5
    acc.strategies.push(done(5, "7", "2026-09-09T12:00:00Z", AUTO), done(6, "20", "2026-09-07T12:00:00Z"), done(7, "-2.5", "2026-09-08T12:00:00Z", AUTO));
    renderWithProviders(<Workspace />);
    act(() => FakeSocket.last().open());
    const u = userEvent.setup();
    await waitFor(() => expect(screen.getByTestId("paper-panel").dataset["count"]).toBe("1"));
    await u.click(screen.getByTestId("paper-life-closed"));
    expect(screen.getByTestId<HTMLSelectElement>("paper-sort").value).toBe("date");
    expect(ids()).toEqual(["strat_5", "strat_7", "strat_6"]);
    const sum = screen.getByTestId("paper-summary");
    expect(sum.dataset["trades"]).toBe("3");
    expect(sum.dataset["won"]).toBe("2");
    expect(sum.textContent).toContain("All coins · Autopilot and by me");
    expect(sum.textContent).toContain("3 closed trades · 2 won");
    expect(screen.getByTestId("paper-summary-total").textContent).toBe("+$24.50");
    expect(sum.textContent).toContain("before fees");
    await u.click(screen.getByTestId("paper-source-autopilot"));
    expect(ids()).toEqual(["strat_5", "strat_7"]);
    expect(sum.textContent).toContain("2 closed trades · 1 won");
    expect(screen.getByTestId("paper-summary-total").textContent).toBe("+$4.50");
    // the trader's own choice of sort holds on the closed list: by P&L the order is 6, 5, 7, by exit it was 5, 7, 6
    await u.selectOptions(screen.getByTestId("paper-sort"), "pnl");
    await u.click(screen.getByTestId("paper-source-all"));
    expect(ids()).toEqual(["strat_6", "strat_5", "strat_7"]);
    await u.click(screen.getByTestId("paper-life-closed")); // a second click on the pressed chip changes nothing
    expect(screen.getByTestId<HTMLSelectElement>("paper-sort").value).toBe("pnl");
    expect(ids()).toEqual(["strat_6", "strat_5", "strat_7"]);
  });

  it("HC-TR-250 HC-TR-251 a tab with one coin and no Autopilot trade offers neither group", async () => {
    const acc = mock.state.accounts.get(EMAIL)!;
    acc.strategies.push(strat(2), strat(4));
    renderWithProviders(<Workspace />);
    act(() => FakeSocket.last().open());
    await waitFor(() => expect(screen.getByTestId("paper-panel").dataset["count"]).toBe("2"));
    expect(screen.queryByTestId("paper-coins")).toBeNull();
    expect(screen.queryByTestId("paper-sources")).toBeNull();
    expect(screen.queryByTestId("paper-summary")).toBeNull();
  });

  it("HC-TR-252 the date sort reads the exit time only when asked to", () => {
    const rows = [strat(1, { closedAt: "2026-09-20T10:00:00Z" }), strat(2, { closedAt: "2026-09-10T10:00:00Z" }), strat(3)];
    expect(sortStrategies(rows, "date", () => 0).map((s) => s.id)).toEqual(["strat_3", "strat_2", "strat_1"]);
    expect(sortStrategies(rows, "date", () => 0, true).map((s) => s.id)).toEqual(["strat_1", "strat_2", "strat_3"]); // an open one falls back to its start
  });
});

describe("HC-TR-253..256 capital, fees and the result after fees on the cards and for the tab", () => {
  const closedAt = "2026-09-06T12:00:00Z";
  const done = (i: number, pnl: string, over: Partial<Strategy> = {}): Strategy =>
    strat(i, { status: "archived", tradingMode: "paper", closedAt, closeReason: "target", realizedPnl: pnl, legs: [{ ...CALL, id: `leg_${i}`, status: "squared_off", exitPrice: "1300", closedAt, closeReason: "target" }], ...over });
  // 10 lots of 0.001 BTC at an 80 000 strike: 0.08 of notional fee and GST per fill
  const FILL = 800 * 0.0001 * 1.18;

  it("HC-TR-253 HC-TR-254 HC-TR-255 HC-TR-256 a closed card shows capital, fees and what is left; the summary and the Overall tile add them up; a win smaller than its fees has not won", async () => {
    const acc = mock.state.accounts.get(EMAIL)!;
    acc.strategies.push(strat(2)); // open, BTC, a bought call: realised 2, nothing unrealised without a price
    acc.strategies.push(done(6, "20"), done(4, "-0.1"), done(8, "0.1")); // 8 made 0.10 before fees of 0.19
    acc.strategies.push(done(10, "5", { legs: [{ ...CALL, id: "leg_10", side: "sell", status: "squared_off", exitPrice: "0", closedAt, closeReason: "expired" }], closeReason: "expired" })); // a sold call that expired worthless
    renderWithProviders(<Workspace />);
    act(() => {
      FakeSocket.last().open();
      FakeSocket.last().receive({ t: "spot", s: "BTC", p: "79521", c24: 0.4 }); // the capital figure prices the position once a spot is known
    });
    const u = userEvent.setup();
    await waitFor(() => expect(screen.getByTestId("paper-panel").dataset["count"]).toBe("1"));
    // the tab's one figure: (2 − one entry fee) + (20 − 0.1 + 0.1 − three round trips) + (5 − one entry fee: it expired worthless)
    const overall = 2 - FILL + 20 - 3 * 2 * FILL + 5 - FILL;
    expect(screen.getByTestId("paper-overall").textContent).toBe(`+$${overall.toFixed(2)}`);
    expect(screen.getByTestId("paper-overall-tile").textContent).toContain("4 closed + 1 open · after est. fees");
    // an open card keeps max loss / max profit / POP and gains the money line
    const openCard = screen.getByTestId("paper-card");
    expect(within(openCard).getByTestId("card-figures")).toBeTruthy();
    expect(within(openCard).getByTestId("card-capital").textContent).toBe("capital $12.00 worst loss"); // a bought call risks its premium: 1200 × 0.01
    expect(within(openCard).getByTestId("card-fees").textContent).toBe(`fees $${FILL.toFixed(2)} est.`);
    expect(within(openCard).getByTestId("card-net").textContent).toBe(`after fees +$${(2 - FILL).toFixed(2)}`);
    await u.click(screen.getByTestId("paper-life-closed"));
    const sum = screen.getByTestId("paper-summary");
    expect(sum.textContent).toContain("4 closed trades · 2 won"); // 6 and 10; 8 is under water after fees, 4 lost
    expect(screen.getByTestId("paper-summary-total").textContent).toBe("+$25.00");
    expect(screen.getByTestId("paper-summary-fees").textContent).toBe(`$${(7 * FILL).toFixed(2)}`);
    expect(screen.getByTestId("paper-summary-net").textContent).toBe(`+$${(25 - 7 * FILL).toFixed(2)}`);
    const card = (id: string) => screen.getAllByTestId("paper-card").find((c) => c.dataset["id"] === id)!;
    const six = card("strat_6");
    expect(within(six).queryByTestId("card-figures")).toBeNull(); // nothing left to risk on a closed trade
    expect(within(six).getByTestId("card-money").dataset["capital"]).toBe("worst-loss");
    expect(within(six).getByTestId("card-capital").textContent).toBe("capital $12.00 worst loss");
    expect(within(six).getByTestId("card-fees").textContent).toBe(`fees $${(2 * FILL).toFixed(2)} est.`);
    expect(within(six).getByTestId("card-net").textContent).toBe(`after fees +$${(20 - 2 * FILL).toFixed(2)}`);
    expect(within(six).getByTestId("card-return").textContent).toBe(`+${(((20 - 2 * FILL) / 12) * 100).toFixed(1)} % on capital`);
    expect(within(six).getByTestId("card-pnl").textContent).toBe("+$20.00"); // the big figure stays before fees, and says so
    expect(six.textContent).toContain("before fees · unreal");
    // a win smaller than its fees reads as a loss after them
    const eight = card("strat_8");
    expect(within(eight).getByTestId("card-net").textContent).toBe(`after fees −$${(2 * FILL - 0.1).toFixed(2)}`);
    // a sold option without cover: no capital figure is invented, and no return on it
    const ten = card("strat_10");
    expect(within(ten).getByTestId("card-money").dataset["capital"]).toBe("uncovered");
    expect(within(ten).getByTestId("card-capital").textContent).toBe("capital — sold without cover");
    expect(within(ten).queryByTestId("card-return")).toBeNull();
    expect(within(ten).getByTestId("card-fees").textContent).toBe(`fees $${FILL.toFixed(2)} est.`); // expired worthless: the entry alone
  });

  it("HC-TR-255 a sold put alone is sold without cover too; a closed card needs no price; an open card that closed a leg shows no return", async () => {
    const acc = mock.state.accounts.get(EMAIL)!;
    const PUT = { ...CALL, kind: "put" as const, symbol: "P-BTC-80000-250926" };
    acc.strategies.push(done(12, "5", { legs: [{ ...PUT, id: "leg_12", side: "sell", status: "squared_off", exitPrice: "0", closedAt, closeReason: "expired" }], closeReason: "expired" }));
    // a call spread: bought 80 000 at 1200, sold 81 000 at 700; worst loss (1200 − 700) × 0.01 = 5
    const SOLD = { ...CALL, side: "sell" as const, strike: "81000", symbol: "C-BTC-81000-250926", price: "700", entryPrice: "700" };
    acc.strategies.push(done(14, "3", { legs: [{ ...CALL, id: "leg_14a", status: "squared_off", exitPrice: "1300", closedAt, closeReason: "target" }, { ...SOLD, id: "leg_14b", status: "squared_off", exitPrice: "500", closedAt, closeReason: "target" }] }));
    // an open spread whose sold leg is already bought back
    acc.strategies.push(strat(16, { legs: [{ ...CALL, id: "leg_16a" }, { ...SOLD, id: "leg_16b", status: "squared_off", exitPrice: "500", closedAt, closeReason: "target" }] }));
    renderWithProviders(<Workspace />);
    // the feed never opens and no spot is ever served
    const u = userEvent.setup();
    await waitFor(() => expect(screen.getByTestId("paper-panel").dataset["count"]).toBe("1"));
    const open = screen.getByTestId("paper-card");
    expect(within(open).getByTestId("card-capital").textContent).toBe("capital $12.00 worst loss"); // the bought call still held
    expect(within(open).queryByTestId("card-return")).toBeNull();
    expect(screen.getByTestId("paper-overall-tile").textContent).toContain("open trades waiting for prices");
    await u.click(screen.getByTestId("paper-life-closed"));
    const card = (id: string) => screen.getAllByTestId("paper-card").find((c) => c.dataset["id"] === id)!;
    expect(within(card("strat_12")).getByTestId("card-money").dataset["capital"]).toBe("uncovered");
    expect(within(card("strat_12")).getByTestId("card-capital").textContent).toBe("capital — sold without cover");
    expect(within(card("strat_12")).queryByTestId("card-return")).toBeNull();
    expect(within(card("strat_14")).getByTestId("card-capital").textContent).toBe("capital $5.00 worst loss");
    expect(within(card("strat_14")).getByTestId("card-return").textContent).toMatch(/^\+\d+\.\d % on capital$/);
  });

  it("HC-TR-257 a trade sold without cover shows the margin estimated when it was entered as its capital, and the return on it; a covered trade keeps its worst loss", async () => {
    const acc = mock.state.accounts.get(EMAIL)!;
    const PUT = { ...CALL, kind: "put" as const, symbol: "P-BTC-80000-250926", side: "sell" as const };
    // a sold put that expired worthless: +5 before fees, one entry fee, 40 dollars of margin estimated at entry
    acc.strategies.push(done(12, "5", { marginEstimate: "40", legs: [{ ...PUT, id: "leg_12", status: "squared_off", exitPrice: "0", closedAt, closeReason: "expired" }], closeReason: "expired" }));
    // the same trade entered before the estimate was recorded
    acc.strategies.push(done(14, "5", { marginEstimate: null, legs: [{ ...PUT, id: "leg_14", status: "squared_off", exitPrice: "0", closedAt, closeReason: "expired" }], closeReason: "expired" }));
    // a bought call: its worst loss stays its capital whatever was recorded
    acc.strategies.push(done(6, "20", { marginEstimate: "999" }));
    renderWithProviders(<Workspace />);
    const u = userEvent.setup();
    await u.click(await screen.findByTestId("paper-life-closed"));
    const card = (id: string) => screen.getAllByTestId("paper-card").find((c) => c.dataset["id"] === id)!;
    await waitFor(() => expect(screen.getAllByTestId("paper-card")).toHaveLength(3));
    const twelve = card("strat_12");
    expect(within(twelve).getByTestId("card-money").dataset["capital"]).toBe("margin");
    expect(within(twelve).getByTestId("card-capital").textContent).toBe("capital $40.00 min. margin est.");
    expect(within(twelve).getByTestId("card-capital").title).toContain("An estimate, not the exchange's own figure: it may hold more");
    expect(within(twelve).getByTestId("card-return").textContent).toBe(`+${(((5 - FILL) / 40) * 100).toFixed(1)} % on est. margin`);
    expect(within(card("strat_14")).getByTestId("card-capital").textContent).toBe("capital — sold without cover");
    expect(within(card("strat_14")).getByTestId("card-capital").title).toContain("was not recorded when this trade was entered");
    expect(within(card("strat_14")).queryByTestId("card-return")).toBeNull();
    expect(within(card("strat_6")).getByTestId("card-capital").textContent).toBe("capital $12.00 worst loss");
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
    const brokers = [{ id: "b1", name: "Delta Exchange India", feePct: "0.05", gstPct: "18", feeCapPct: "10", scope: "GLOBAL" as const, venue: "delta_india" as const }];
    const { rerender } = renderWithProviders(<TradeModeDialog open title="x" asset="BTC" legs={legs} spot={80_000} lotSize="0.001" money={{ currency: "USD", rate: "1" }} brokers={[]} accounts={[]} connected={false} priceModeLabel="Live" onContinue={onContinue} onOpenChange={() => undefined} />);
    const u = userEvent.setup();
    await u.click(screen.getByTestId("trade-continue"));
    expect(screen.getByText("Please select an exchange")).toBeTruthy();
    rerender(<TradeModeDialog open title="x" asset="BTC" legs={legs} spot={80_000} lotSize="0.001" money={{ currency: "USD", rate: "1" }} brokers={brokers} accounts={[]} connected={false} priceModeLabel="Live" onContinue={onContinue} onOpenChange={() => undefined} />);
    await u.click(screen.getByTestId("mode-live"));
    expect(screen.getByTestId("trade-not-connected")).toBeTruthy();
    expect(screen.getByTestId("trade-real-money")).toBeTruthy();
    expect(screen.getByTestId("trade-continue").hasAttribute("disabled")).toBe(true);
    await u.click(screen.getByText("Open API Settings"));
    expect(useUiStore.getState().dialog).toBe("api");
    rerender(<TradeModeDialog open title="x" asset="BTC" legs={legs} spot={80_000} lotSize="0.001" money={{ currency: "USD", rate: "1" }} brokers={brokers} accounts={[]} connected={true} priceModeLabel="Live" onContinue={onContinue} onOpenChange={() => undefined} />);
    expect(screen.queryByTestId("trade-not-connected")).toBeNull();
    expect(screen.getByTestId("trade-continue").getAttribute("title")).toBeNull();
    expect(screen.getByTestId("trade-continue").hasAttribute("disabled")).toBe(false);
    expect(screen.getByTestId("trade-net").textContent).toContain("Debit");
  });

  it("HC-SH-124 a data-only venue blocks Live with the plain reason, paper stays open (ADR-069)", async () => {
    const legs = [{ id: "a", kind: "call" as const, side: "buy" as const, strike: "80000", expiry: "2026-09-25", symbol: "BTC-25SEP26-80000-C", lots: 10, price: "1200" }];
    const brokers = [{ id: "b2", name: "Deribit paper", feePct: "0", gstPct: "0", feeCapPct: "0", scope: "USER" as const, venue: "deribit" as const }];
    const note = "Deribit is data-only on HapieCoin: chains, analysis and paper trading. API keys and live orders are not available.";
    renderWithProviders(<TradeModeDialog open title="x" asset="BTC" legs={legs} spot={80_000} lotSize="0.1" money={{ currency: "USD", rate: "1" }} brokers={brokers} accounts={[]} connected={true} dataOnly={note} priceModeLabel="Live (Deribit)" onContinue={() => undefined} onOpenChange={() => undefined} />);
    expect(screen.getByTestId("trade-continue").hasAttribute("disabled")).toBe(false);
    const u = userEvent.setup();
    await u.click(screen.getByTestId("mode-live"));
    expect(screen.getByTestId("trade-data-only").textContent).toContain(note);
    expect(screen.queryByTestId("trade-not-connected")).toBeNull();
    expect(screen.getByTestId("trade-continue").hasAttribute("disabled")).toBe(true);
    expect(screen.getByTestId("trade-continue").getAttribute("title")).toBe(note);
  });
});

describe("HC-TR-078 Details for drafts and archived strategies", () => {
  it("draft: Load in builder and Activate; archived: Restore; delete with confirm", async () => {
    const acc = mock.state.accounts.get(EMAIL)!;
    acc.strategies.push(strat(1, { asset: "BTC", venue: "delta_india", status: "draft", tradingMode: null, startedAt: null, legs: [{ ...CALL, entryPrice: null, openedAt: null }] }), strat(2, { status: "archived", tradingMode: "paper", closedAt: "2026-09-05T10:00:00Z" }));
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
    // a debit with no loss figure (a calendar) still names the premium paid as the capital required (GAPS #81)
    const r4 = renderWithProviders(<TradePreviewDialog {...base} legs={[leg("buy", "1200")]} maxLoss={null} maxLossKnown={false} available={{ amount: 0.5, asset: "BTC" }} />);
    block = screen.getByTestId("preview-capital");
    expect(within(block).getByTestId("preview-capital-required").textContent).toBe("$1.20");
    expect(block.textContent).toContain("the premium paid");
    expect(within(block).getByTestId("preview-capital-available").textContent).toBe("0.5 BTC");
    expect(block.textContent).toContain("not a cash asset");
    r4.unmount();
    // a credit with no loss figure has nothing to promise
    renderWithProviders(<TradePreviewDialog {...base} legs={[leg("sell", "1200")]} maxLoss={null} maxLossKnown={false} available={{ amount: 0.5, asset: "BTC" }} />);
    block = screen.getByTestId("preview-capital");
    expect(within(block).getByTestId("preview-capital-required").textContent).toBe("not computed");
  });
});
