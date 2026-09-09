// Adjustment workbench (ADR-044; HC-TR-148..152) against the in-memory API and the fake gateway: open from a
// card, edit lots after on open legs and picks, net chain picks against the position, value at another
// expiry, keyboard picking, guard rails, review and apply on paper, history and badge afterwards.
import { chainTopic } from "@hapiecoin/schema";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeSocket, installMockFetch, renderWithProviders, type MockFetch } from "../../../test/helpers";
import { buildChain } from "../../../test/fixtures/chain";
import { useUiStore } from "@/lib/store";
import { Workspace } from "@/components/workspace/Workspace";
import { lotStep } from "./PositionTicket";

const EXPIRY = "2026-09-25";
const LATER = "2026-10-30";
const TOPIC = chainTopic("delta_india", "BTC", EXPIRY);
const TOPIC2 = chainTopic("delta_india", "BTC", LATER);
const rows = buildChain("BTC", EXPIRY);
const rows2 = buildChain("BTC", LATER);
const EMAIL = "adjust@example.com";
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
async function paperTradeFromBuilder(u: ReturnType<typeof userEvent.setup>) {
  await u.click(screen.getByTestId("builder-paper-trade"));
  const mode = screen.getByTestId("trade-mode");
  await waitFor(() => expect(within(mode).getByTestId<HTMLSelectElement>("trade-broker").value).toBe("brk_delta"));
  await u.click(within(mode).getByTestId("trade-continue"));
  await u.click(within(screen.getByTestId("trade-preview")).getByTestId("trade-now"));
  const name = screen.getByTestId("save-draft-dialog");
  await u.type(within(name).getByTestId("save-draft-name"), "Risk reversal");
  await u.click(within(name).getByTestId("save-draft-confirm"));
  await waitFor(() => expect(mine()[0]?.status).toBe("paper"));
  return mine()[0]!;
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
    adjust: null,
    paneSource: null,
    workspaceTab: "builder",
    builderTab: "builder",
    targetPrice: null,
    targetDays: 0,
  });
});
afterEach(() => mock.restore());

describe("HC-TR-148..152 adjustment workbench on a paper strategy", () => {
  it("opens from the card, edits lots after in both places with netting, values at another expiry, reviews and applies", async () => {
    const { call, put } = seedLegs();
    renderWithProviders(<Workspace />);
    serveMarket();
    const u = userEvent.setup();
    const s = await paperTradeFromBuilder(u);
    const card = await screen.findByTestId("paper-card");
    await waitFor(() => expect(within(card).getByTestId("card-figures").dataset["state"]).toBe("ready"));
    expect(within(card).queryByTestId("adjusted-badge")).toBeNull();
    // open the workbench: the left tabs give way, the pane follows the strategy "after the change"
    await u.click(within(card).getByTestId("card-adjust"));
    const wb = await screen.findByTestId("adjust-workbench");
    serveMarket(); // the workbench subscribes to the chain when it mounts
    expect(screen.queryByTestId("left-pane")).toBeNull();
    expect(wb.dataset["empty"]).toBe("true");
    expect(within(wb).getByTestId<HTMLButtonElement>("adjust-review").disabled).toBe(true);
    await waitFor(() => expect(screen.getByTestId("pane-adjusting")).toBeTruthy());
    const legs = within(wb).getAllByTestId("wb-leg");
    expect(legs).toHaveLength(2);
    expect(within(wb).getAllByTestId("effect-none")).toHaveLength(2);
    // lots after on the bought call: one step down trims by one (10 lots → step 1), the field can close it, up reopens a lot
    const callRow = legs[0]!;
    await u.click(within(callRow).getByTestId("lots-after-down"));
    expect(within(callRow).getByTestId("effect").dataset["kind"]).toBe("trim");
    expect(within(callRow).getByTestId("effect").textContent).toContain("by 1");
    expect(wb.dataset["empty"]).toBe("false");
    await waitFor(() => expect(within(wb).getByTestId("adjust-summary").textContent).toContain("This change"));
    await waitFor(() => expect(screen.getByTestId("before-after")).toBeTruthy());
    expect(screen.getByTestId("tile-max-loss").textContent).toContain("after");
    fireEvent.change(within(callRow).getByTestId("lots-after-input"), { target: { value: "" } }); // an emptied field changes nothing
    expect(within(callRow).getByTestId("effect").dataset["kind"]).toBe("trim");
    fireEvent.change(within(callRow).getByTestId("lots-after-input"), { target: { value: "0" } });
    expect(within(callRow).getByTestId("effect").dataset["kind"]).toBe("close");
    await u.click(within(callRow).getByTestId("lots-after-up"));
    expect(within(callRow).getByTestId("effect").textContent).toMatch(/^TRIMS .* by 9$/);
    expect(within(callRow).getByTestId("lots-after").dataset["value"]).toBe("1");
    fireEvent.change(within(callRow).getByTestId("lots-after-input"), { target: { value: "25" } });
    expect(within(callRow).getByTestId("effect").textContent).toMatch(/^ADDS \+15 to /);
    expect(within(wb).getByTestId("adjust-cash").textContent).toContain("debit");
    // reset clears every change
    await u.click(within(wb).getByTestId("adjust-reset"));
    expect(wb.dataset["empty"]).toBe("true");
    // the chain: a held strike shows its lots and B / S add to or trim it; another strike proposes a new leg
    await waitFor(() => expect(within(wb).getAllByTestId("wb-chain-row").length).toBeGreaterThan(0), { timeout: 5000 });
    const heldRow = within(wb).getAllByTestId("wb-chain-row").find((r) => r.dataset["strike"] === call.strike)!;
    expect(within(heldRow).getAllByTestId("wb-chain-held")).toHaveLength(1);
    await u.click(within(heldRow).getByTestId("wb-chain-buy-call")); // same side: adds 100 lots (the chain preset)
    expect(within(legs[0]!).getByTestId("effect").textContent).toContain("ADDS +100");
    await u.click(within(heldRow).getByTestId("wb-chain-sell-call")); // opposite side: trims them back
    expect(within(legs[0]!).getByTestId("effect-none")).toBeTruthy();
    await u.click(within(heldRow).getByTestId("wb-chain-sell-call")); // trims below zero: closes, the rest flips
    expect(within(legs[0]!).getByTestId("effect").dataset["kind"]).toBe("close");
    expect(within(wb).getAllByTestId("wb-pick")).toHaveLength(1);
    expect(within(within(wb).getByTestId("wb-pick")).getByTestId("effect").dataset["kind"]).toBe("flip");
    expect(within(heldRow).getByTestId("wb-chain-held").dataset["after"]).toBe("0");
    await u.click(within(within(wb).getByTestId("wb-pick")).getByTestId("wb-pick-remove"));
    await u.click(within(wb).getByTestId("adjust-reset"));
    const freeRow = within(wb).getAllByTestId("wb-chain-row").find((r) => r.dataset["strike"] !== call.strike && r.dataset["strike"] !== put.strike && r.dataset["strike"]! > call.strike)!;
    await u.click(within(freeRow).getByTestId("wb-chain-sell-call"));
    const pick = within(wb).getByTestId("wb-pick");
    expect(within(pick).getByTestId("effect").textContent).toBe("NEW LEG");
    expect(within(freeRow).getByTestId("wb-chain-sell-call").getAttribute("aria-pressed")).toBe("true");
    await u.click(within(pick).getByTestId("pick-lots-up"));
    expect(within(pick).getByTestId("pick-lots").dataset["value"]).toBe(String(100 + lotStep(100)));
    await u.click(within(freeRow).getByTestId("wb-chain-sell-call")); // same side again deselects
    expect(within(wb).queryByTestId("wb-pick")).toBeNull();
    // another expiry: the "value at" chips grow with the combined position (today is always offered)
    expect(within(within(wb).getByTestId("value-at")).getAllByTestId("value-at-chip").map((c) => c.dataset["expiry"])).toEqual(["today", EXPIRY]);
    await u.click(within(wb).getAllByTestId("wb-chain-expiry").find((b) => b.dataset["expiry"] === LATER)!);
    act(() => {
      FakeSocket.last().receive({ t: "snap", topic: TOPIC2, seq: 0, rows: rows2 });
    });
    await waitFor(() => expect(within(wb).getByTestId("wb-chain-table").dataset["rows"]).not.toBe("0"), { timeout: 5000 });
    await u.click(within(within(wb).getAllByTestId("wb-chain-row")[2]!).getByTestId("wb-chain-buy-call"));
    const chips = within(within(wb).getByTestId("value-at")).getAllByTestId("value-at-chip");
    expect(chips.map((c) => c.dataset["expiry"])).toEqual(["today", EXPIRY, LATER]);
    expect(chips[2]!.getAttribute("aria-pressed")).toBe("true"); // the latest expiry by default
    await u.click(chips[1]!);
    expect(chips[1]!.getAttribute("aria-pressed")).toBe("true");
    await waitFor(() => expect(screen.getByTestId("before-after").textContent).toContain("valued at"));
    await u.click(chips[0]!);
    expect(chips[0]!.getAttribute("aria-pressed")).toBe("true");
    await waitFor(() => expect(screen.getByTestId("before-after").textContent).toContain("valued at"));
    await u.click(within(wb).getByTestId("adjust-reset"));
    // keyboard on the chain: ↓ then s picks a sell call on the next row; Esc resets
    await u.click(within(wb).getAllByTestId("wb-chain-expiry").find((b) => b.dataset["expiry"] === EXPIRY)!);
    await waitFor(() => expect(within(wb).getAllByTestId("wb-chain-row").length).toBeGreaterThan(0));
    const box = within(wb).getByTestId("wb-chain-box");
    fireEvent.keyDown(box, { key: "ArrowDown" });
    expect(within(wb).getAllByTestId("wb-chain-row").some((r) => r.dataset["focused"] === "true")).toBe(true);
    fireEvent.keyDown(box, { key: "s" });
    expect(wb.dataset["empty"]).toBe("false");
    fireEvent.keyDown(box, { key: "Escape" });
    expect(wb.dataset["empty"]).toBe("true");
    // the change to apply: trim the sold put to 5 and sell a call two strikes up; Enter reviews
    const putRow = within(wb).getAllByTestId("wb-leg")[1]!;
    fireEvent.change(within(putRow).getByTestId("lots-after-input"), { target: { value: "5" } });
    const freeAgain = within(wb).getAllByTestId("wb-chain-row").find((r) => r.dataset["strike"] === freeRow.dataset["strike"])!;
    await u.click(within(freeAgain).getByTestId("wb-chain-sell-call"));
    expect(within(wb).getByTestId("adjust-review").textContent).toContain("2 changes");
    fireEvent.keyDown(box, { key: "Enter" });
    const confirm = await screen.findByTestId("adjust-confirm");
    expect(confirm.dataset["mode"]).toBe("paper");
    const crows = within(confirm).getAllByTestId("adjust-confirm-row");
    expect(crows.map((r) => r.dataset["kind"])).toEqual(["trim", "add"]);
    expect(within(confirm).getByTestId("adjust-paper-note")).toBeTruthy();
    await u.type(within(confirm).getByTestId("adjust-reason"), "spot ran above the wings");
    await u.click(within(confirm).getByTestId("adjust-apply"));
    await waitFor(() => expect(mine()[0]!.adjustments).toHaveLength(1));
    expect(mine()[0]!.adjustments[0]).toMatchObject({ added: 1, trimmed: 1, closed: 0, reason: "spot ran above the wings" });
    expect(mine()[0]!.legs.filter((l) => l.status === "open").map((l) => [l.side, l.lots])).toEqual([
      ["buy", 10],
      ["sell", 5],
      ["sell", 100],
    ]);
    expect(mine()[0]!.legs.find((l) => l.status === "squared_off")).toMatchObject({ lots: 5, side: "sell" });
    expect(mine()[0]!.adjustments[0]!.realizedPnl).toBe("0"); // the mark has not moved since entry
    // the workbench closes, Details reopens with the history, the card wears the badge
    await waitFor(() => expect(screen.queryByTestId("adjust-workbench")).toBeNull());
    const details = await screen.findByTestId("strategy-details");
    await waitFor(() => expect(within(details).getAllByTestId("details-adjustment")).toHaveLength(1));
    expect(within(details).getByTestId("details-adjustment").textContent).toContain("spot ran above the wings");
    expect(within(details).getByTestId("adjusted-badge")).toBeTruthy();
    await u.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByTestId("strategy-details")).toBeNull());
    await waitFor(() => expect(within(screen.getByTestId("paper-card")).getByTestId("adjusted-badge").dataset["count"]).toBe("1"));
    expect(s.id).toBe(mine()[0]!.id);
  });

  it("A on a focused card opens the workbench, Exit discards the draft, the cap and Details' button are guarded", async () => {
    seedLegs();
    renderWithProviders(<Workspace />);
    serveMarket();
    const u = userEvent.setup();
    await paperTradeFromBuilder(u);
    const card = await screen.findByTestId("paper-card");
    card.focus();
    fireEvent.keyDown(card, { key: "a" });
    const wb = await screen.findByTestId("adjust-workbench");
    serveMarket();
    expect(within(wb).getByTestId("adjust-mark-age").textContent).toMatch(/marks \d+s ago/);
    // ten picks over the cap: Review is refused with the guard rail
    await waitFor(() => expect(within(wb).getAllByTestId("wb-chain-row").length).toBeGreaterThan(8), { timeout: 5000 });
    const free = within(wb).getAllByTestId("wb-chain-row").filter((r) => within(r).queryByTestId("wb-chain-held") === null).slice(0, 9);
    for (const r of free) await u.click(within(r).getByTestId("wb-chain-buy-put"));
    expect(within(wb).getAllByTestId("wb-pick")).toHaveLength(9);
    expect(within(wb).getByTestId("adjust-warnings").textContent).toContain("open-leg cap");
    expect(within(wb).getByTestId<HTMLButtonElement>("adjust-review").disabled).toBe(true);
    await u.click(within(wb).getByTestId("adjust-exit"));
    await waitFor(() => expect(screen.queryByTestId("adjust-workbench")).toBeNull());
    expect(useUiStore.getState().adjust).toBeNull();
    expect(screen.getByTestId("left-pane")).toBeTruthy();
    expect(mine()[0]!.adjustments).toEqual([]);
    // Details: the button opens the same workbench
    await u.click(within(screen.getByTestId("paper-card")).getByTestId("card-details"));
    const details = await screen.findByTestId("strategy-details");
    expect(within(details).getByTestId("details-adjust").textContent).toContain("Adjust");
    await u.click(within(details).getByTestId("details-adjust"));
    await screen.findByTestId("adjust-workbench");
    expect(useUiStore.getState().adjust?.strategyId).toBe(mine()[0]!.id);
  });
});
