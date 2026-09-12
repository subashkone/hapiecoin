// Journal tab (HC-TR-121, 128..137) against the in-memory API: seeded archived trades and an active strategy with a
// squared-off leg; stats, equity curve, chips, search, tags, notes, CSV, rows → Details, empty states.
import type { Strategy, StrategyLeg } from "@hapiecoin/schema";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { installMockFetch, renderWithProviders, type MockFetch } from "../../../test/helpers";
import { USD } from "@/lib/money";
import { useUiStore } from "@/lib/store";
import type { PaperBook } from "@/lib/strategy/usePaper";
import { JournalPanel } from "./JournalPanel";

const EMAIL = "journal@example.com";
let mock: MockFetch;
const mine = () => mock.state.accounts.get(EMAIL)!.strategies;
const leg = (o: Partial<StrategyLeg> = {}): StrategyLeg => ({ id: "leg_1", kind: "call", side: "buy", strike: "80000", expiry: "2026-09-25", symbol: "C-BTC-80000-250926", lots: 10, price: "1000", entryPrice: "1000", exitPrice: "1100", iv: null, status: "squared_off", isAdjustment: false, position: 0, openedAt: "2026-07-30T00:00:00Z", closedAt: "2026-08-28T00:00:00Z", orderId: null, ...o });
const strat = (o: Partial<Strategy> = {}): Strategy => ({ id: "s1", name: "BTC Iron Butterfly · Aug", asset: "BTC", venue: "delta_india", status: "archived", tradingMode: "paper", templateName: "Iron Butterfly", brokerId: null, legs: [leg()], realizedPnl: "1.44", pnlHistory: [], notes: "", tags: ["range"], orderBatchId: null, orders: [], adjustments: [], startedAt: "2026-07-30T00:00:00Z", closedAt: "2026-08-28T00:00:00Z", createdAt: "2026-07-30T00:00:00Z", updatedAt: "2026-08-28T00:00:00Z", ...o });
const book: PaperBook = { priceOf: () => null, pnlOf: () => ({ unrealized: 0, realized: 0, total: 0, openLegs: 0, byLeg: new Map() }), spotOf: () => null, lotSizeOf: () => "0.001", money: USD, accountLabel: () => null, brokerName: () => "Delta India", version: 0 };

beforeEach(() => {
  mock = installMockFetch();
  mock.loginAs(EMAIL);
  useUiStore.setState({ workspaceTab: "journal", detailsId: null });
});
afterEach(() => mock.restore());

function seed() {
  mine().push(
    strat(),
    strat({ id: "s2", name: "ETH Short Straddle · Jul", asset: "ETH", tradingMode: "live", templateName: "Short Straddle", realizedPnl: "-1.32", startedAt: "2026-07-10T00:00:00Z", closedAt: "2026-07-24T00:00:00Z", tags: ["earnings", "hedge"], notes: "Straddle sold into the ETF headline." }),
    strat({ id: "s3", name: "never traded", startedAt: null, tradingMode: null }),
    strat({ id: "s4", name: "BTC test", status: "paper", closedAt: null, legs: [leg({ id: "a", status: "open", exitPrice: null, closedAt: null }), leg({ id: "b", side: "sell", lots: 1, price: "1255.9", entryPrice: "1255.9", exitPrice: "980", closedAt: "2026-08-20T00:00:00Z" })] }),
  );
}

describe("HC-TR-128..131, 134..137 journal", () => {
  it("lists the traded archived strategies with stats, the equity curve, closed legs, chips and search", async () => {
    seed();
    renderWithProviders(<JournalPanel book={book} />);
    await waitFor(() => expect(screen.getByTestId("journal-panel").dataset["count"]).toBe("2"), { timeout: 4000 });
    const rows = screen.getAllByTestId("journal-trade");
    expect(rows.map((r) => r.dataset["id"])).toEqual(["s1", "s2"]); // newest close first; the archived draft is not a trade
    expect(rows[0]!.dataset["win"]).toBe("true");
    expect(within(rows[1]!).getByTestId("trade-mode").dataset["mode"]).toBe("live");
    expect(screen.getByTestId("stat-trades").textContent).toBe("2");
    expect(screen.getByTestId("stat-winrate").textContent).toBe("50%");
    expect(screen.getByTestId("stat-best").textContent).toBe("+$1.44");
    expect(screen.getByTestId("stat-worst").textContent).toBe("−$1.32");
    expect(screen.getByTestId("stat-pf").textContent).toBe("1.09");
    expect(screen.getByTestId("journal-equity").dataset["points"]).toBe("3");
    expect(screen.getByTestId("journal-net").textContent).toContain("+$0.12");
    await waitFor(() => expect(screen.getByTestId("chart-equity").dataset["state"]).toBe("ready"));
    expect(screen.getByTestId("journal-closed-legs").dataset["count"]).toBe("1");
    expect(screen.getByTestId("closed-leg-pnl").textContent).toBe("+$0.28");
    const u = userEvent.setup();
    await u.click(within(screen.getByTestId("journal-filter")).getByText("Wins"));
    expect(screen.getByTestId("journal-panel").dataset["shown"]).toBe("1");
    expect(screen.getByTestId("stat-pf").textContent).toBe("∞");
    await u.click(within(screen.getByTestId("journal-filter")).getByText("Losses"));
    expect(screen.getAllByTestId("journal-trade")[0]!.dataset["id"]).toBe("s2");
    await u.click(within(screen.getByTestId("journal-filter")).getByText("XAUT"));
    expect(screen.getByTestId("journal-empty-filter")).toBeTruthy();
    await u.click(within(screen.getByTestId("journal-filter")).getByText("All"));
    fireEvent.change(screen.getByTestId("journal-search"), { target: { value: "headline" } });
    expect(screen.getByTestId("journal-panel").dataset["shown"]).toBe("1");
    fireEvent.change(screen.getByTestId("journal-search"), { target: { value: "" } });
    // rows and closed legs open Strategy Details
    await u.click(within(screen.getAllByTestId("journal-trade")[0]!).getByTestId("trade-row"));
    expect(useUiStore.getState().detailsId).toBe("s1");
    await u.click(screen.getByTestId("closed-leg"));
    expect(useUiStore.getState().detailsId).toBe("s4");
  });

  it("tags and notes are saved on the strategy; CSV copies the filtered rows", async () => {
    seed();
    renderWithProviders(<JournalPanel book={book} />);
    await waitFor(() => expect(screen.getAllByTestId("journal-trade")).toHaveLength(2), { timeout: 4000 });
    const first = () => screen.getAllByTestId("journal-trade")[0]!;
    const u = userEvent.setup();
    expect(within(first()).getByTestId("tag-range").getAttribute("aria-pressed")).toBe("true");
    await u.click(within(first()).getByTestId("tag-hedge"));
    await waitFor(() => expect(mine()[0]!.tags).toEqual(["range", "hedge"]));
    await u.click(within(first()).getByTestId("tag-range"));
    await waitFor(() => expect(mine()[0]!.tags).toEqual(["hedge"]));
    await u.type(within(first()).getByTestId("tag-input"), "Gamma Scalp{Enter}");
    await waitFor(() => expect(mine()[0]!.tags).toEqual(["hedge", "gamma-scalp"]));
    await waitFor(() => expect(within(first()).getByTestId("tag-custom").textContent).toContain("gamma-scalp"));
    await u.click(within(first()).getByTestId("tag-remove"));
    await waitFor(() => expect(mine()[0]!.tags).toEqual(["hedge"]));
    const notes = within(first()).getByTestId("trade-notes");
    fireEvent.change(notes, { target: { value: "Sold the wings early." } });
    fireEvent.blur(notes);
    await waitFor(() => expect(mine()[0]!.notes).toBe("Sold the wings early."));
    await u.click(within(screen.getByTestId("journal-filter")).getByText("Live"));
    await u.click(screen.getByTestId("journal-csv")); // user-event installs the clipboard stub
    await waitFor(async () => expect(await navigator.clipboard.readText()).toContain("id,name,mode"));
    const csv = await navigator.clipboard.readText();
    expect(csv.split("\n")).toHaveLength(2);
    expect(csv).toContain("s2,ETH Short Straddle · Jul,live,ETH,Short Straddle,1,2026-07-10,2026-07-24,14,-1.32,,earnings hedge,Straddle sold into the ETF headline.");
  });

  it("empty state points at the Paper tab", async () => {
    renderWithProviders(<JournalPanel book={book} />);
    await waitFor(() => expect(screen.getByTestId("journal-empty")).toBeTruthy(), { timeout: 4000 });
    await userEvent.setup().click(screen.getByTestId("journal-open-paper"));
    expect(useUiStore.getState().workspaceTab).toBe("paper");
    act(() => undefined);
  });
});

describe("HC-TR-173 the journal per account (ADR-068)", () => {
  it("with two keys each trade names its account, the select keeps one account's trades, and the CSV carries the column", async () => {
    const u = userEvent.setup();
    mock.state.accounts.get(EMAIL)!.credentials = [
      { id: "crd_main", label: "Main", brokerId: "brk_delta", apiKeyMasked: "****ab12", connectedAt: "2026-09-08T09:00:00Z", whitelistedIp: "203.0.113.10" },
      { id: "crd_sub1", label: "Sub 1", brokerId: "brk_delta", apiKeyMasked: "****cd34", connectedAt: "2026-09-09T09:00:00Z", whitelistedIp: "203.0.113.10" },
    ];
    mine().push(strat({ id: "j_main", name: "Main book", accountId: "crd_main" }), strat({ id: "j_sub", name: "Sub book", accountId: "crd_sub1", realizedPnl: "-3" }));
    renderWithProviders(<JournalPanel book={book} />);
    await waitFor(() => expect(screen.getAllByTestId("journal-trade")).toHaveLength(2));
    expect(screen.getAllByTestId("trade-account").map((el) => el.textContent)).toEqual(["Main", "Sub 1"]);
    await u.selectOptions(screen.getByTestId("journal-account"), "crd_sub1");
    await waitFor(() => expect(screen.getAllByTestId("journal-trade").map((t) => t.dataset["id"])).toEqual(["j_sub"]));
    await u.click(screen.getByTestId("journal-csv"));
    await waitFor(async () => expect(await navigator.clipboard.readText()).toContain(",account"));
    const lines = (await navigator.clipboard.readText()).split(String.fromCharCode(10));
    expect(lines).toHaveLength(2);
    expect(lines[1]?.endsWith(",Sub 1")).toBe(true);
  });
});

describe("HC-TR-181 verified P&L on the Journal (ADR-073)", () => {
  it("shows the figures from the exchange fills per account with the agreement line, and Refresh re-reads", async () => {
    const u = userEvent.setup();
    const acc = mock.state.accounts.get(EMAIL)!;
    acc.credentials = [
      { id: "crd_main", label: "Main", brokerId: "brk_delta", apiKeyMasked: "****ab12", connectedAt: "2026-09-08T09:00:00.000Z", whitelistedIp: "203.0.113.10" },
      { id: "crd_sub1", label: "Sub 1", brokerId: "brk_delta", apiKeyMasked: "****cd34", connectedAt: "2026-09-09T09:00:00.000Z", whitelistedIp: "203.0.113.10" },
    ];
    const dayAgo = new Date(Date.now() - 86_400_000).toISOString();
    acc.fills = [
      { id: "f-1", accountId: "crd_main", productId: 101, symbol: "C-BTC-80000-250926", side: "buy", size: 10, price: "1200", commission: "0.6", filledAt: new Date(Date.now() - 2 * 86_400_000).toISOString() },
      { id: "f-2", accountId: "crd_main", productId: 101, symbol: "C-BTC-80000-250926", side: "sell", size: 10, price: "1500", commission: "0.75", filledAt: dayAgo },
      { id: "s-1", accountId: "crd_sub1", productId: 102, symbol: "P-BTC-78000-250926", side: "sell", size: 5, price: "1000", commission: "0", filledAt: dayAgo },
      { id: "s-2", accountId: "crd_sub1", productId: 102, symbol: "P-BTC-78000-250926", side: "buy", size: 5, price: "900", commission: "0.1", filledAt: dayAgo },
    ];
    acc.verifiedReads = 1;
    mine().push(strat({ id: "j_live", status: "archived", tradingMode: "live", realizedPnl: "3", closedAt: dayAgo, accountId: "crd_main" })); // the Journal's own figure for Main's round trip: gross, as HapieCoin books it
    renderWithProviders(<JournalPanel book={book} />);
    const block = await screen.findByTestId("verified-block");
    await waitFor(() => expect(block.dataset["state"]).toBe("ready"));
    expect(screen.getByTestId("verified-total").textContent).toBe("+$2.05"); // 1.65 (Main) + 0.40 (Sub 1)
    expect(screen.getByTestId("verified-d7").textContent).toBe("+$2.05");
    expect(screen.getByTestId("verified-commission").textContent).toBe("$1.45");
    expect(screen.getByTestId("verified-since").textContent).toContain("4 fills since");
    expect(screen.getByTestId("verified-agree").dataset["diff"]).toBe("0.5"); // gross 3.50 against the Journal's 3.00: the sub-account's manual trade
    expect(screen.getByTestId("verified-agree").textContent).toContain("before fees +$3.50, differs from the Journal's +$3.00 by +$0.50");
    expect(screen.getAllByTestId("verified-account").map((r) => r.dataset["label"])).toEqual(["Main", "Sub 1"]);
    await u.click(screen.getByTestId("verified-refresh"));
    await waitFor(() => expect(acc.verifiedReads).toBe(2));
    expect(await screen.findByText("Fills refreshed")).toBeTruthy();
    // the exchange stops answering: the block names the accounts' errors and Refresh says so
    acc.verifiedDown = true;
    await u.click(screen.getByTestId("verified-refresh"));
    expect(await screen.findByText("Some accounts could not be read")).toBeTruthy();
    await waitFor(() => expect(screen.getAllByTestId("verified-account")[0]!.textContent).toContain("The exchange did not answer the fills read"));
  });

  it("without a connected key there is no block; with a key and no fills it says so", async () => {
    renderWithProviders(<JournalPanel book={book} />);
    await waitFor(() => expect(screen.getByTestId("journal-panel")).toBeTruthy());
    expect(screen.queryByTestId("verified-block")).toBeNull();
    mock.state.accounts.get(EMAIL)!.credentials = [{ id: "crd_main", label: "Main", brokerId: "brk_delta", apiKeyMasked: "****ab12", connectedAt: "2026-09-08T09:00:00.000Z", whitelistedIp: "203.0.113.10" }];
    renderWithProviders(<JournalPanel book={book} />);
    const block = await screen.findByTestId("verified-block");
    await waitFor(() => expect(block.dataset["state"]).toBe("empty"));
    expect(screen.getByTestId("verified-empty").textContent).toContain("No fills read yet");
  });
});
