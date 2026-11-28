// Autopilot results on its screen (ADR-111, ADR-139; HC-TR-224, HC-TR-267), against the in-memory mock API.
import type { AutopilotResults } from "@hapiecoin/schema";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { installMockFetch, renderWithProviders, type MockFetch } from "../../../test/helpers";
import { fmtDateTime } from "@/lib/format";
import { USD } from "@/lib/money";
import { AutopilotPage } from "./AutopilotPage";
import { tradeCapital } from "@/lib/strategy/autopilot";
import { AutopilotResultsPanel, TRADES_PAGE, byDay, dayOf, exitTotals, totalOf, won } from "./AutopilotResultsPanel";

const EMAIL = "autopilot-results@example.com";
let mock: MockFetch;
const acc = () => mock.state.accounts.get(EMAIL)!;
const zero = { open: 0, closed: 0, wins: 0, grossUsd: "0.00", feesUsd: "0.00", netUsd: "0.00" };
const RESULTS: AutopilotResults = {
  since: "2026-11-21T09:36:00.000Z",
  total: { open: 1, closed: 4, wins: 2, grossUsd: "4.30", feesUsd: "1.30", netUsd: "3.00" },
  rows: [
    { playbookId: "pin-butterfly", asset: "BTC", exit: "trail", open: 0, closed: 3, wins: 2, grossUsd: "4.00", feesUsd: "0.80", netUsd: "3.20", bestNetUsd: "4.60", worstNetUsd: "-2.40", avgHoldMinutes: 40, reasons: { target: 1, stopped: 1, squared_off: 1 } },
    { playbookId: "trend-puts", asset: "ETH", exit: "target", open: 1, closed: 1, wins: 0, grossUsd: "0.30", feesUsd: "0.50", netUsd: "-0.20", bestNetUsd: "-0.20", worstNetUsd: "-0.20", avgHoldMinutes: 200, reasons: { unknown: 1 } },
    { playbookId: "premium-harvest", asset: "BTC", exit: "trail", open: 2, closed: 0, wins: 0, grossUsd: "0.00", feesUsd: "0.00", netUsd: "0.00", bestNetUsd: null, worstNetUsd: null, avgHoldMinutes: null, reasons: {} },
  ],
  byDte: [
    { band: "0-1", open: 0, closed: 3, wins: 2, grossUsd: "4.00", feesUsd: "0.80", netUsd: "3.20" },
    { band: "2-7", ...zero },
    { band: "8-30", open: 1, closed: 1, wins: 0, grossUsd: "0.30", feesUsd: "0.50", netUsd: "-0.20" },
    { band: "31+", ...zero, open: 2 },
  ],
  trades: [
    { strategyId: "res_4", playbookId: "trend-puts", asset: "ETH", exit: "target", strikes: ["1600", "1500"], expiry: "2026-12-11", dte: 20, openedAt: "2026-11-21T10:00:00.000Z", closedAt: "2026-11-21T13:20:00.000Z", closeReason: null, grossUsd: "0.30", feesUsd: "0.50", netUsd: "-0.20" },
    { strategyId: "res_1", playbookId: "pin-butterfly", asset: "BTC", exit: "trail", strikes: ["57600", "58000", "58000", "58400"], expiry: "2026-11-22", dte: 1, openedAt: "2026-11-21T09:36:00.000Z", closedAt: "2026-11-21T10:06:00.000Z", closeReason: "target", grossUsd: "5.00", feesUsd: "0.40", netUsd: "4.60" },
    { strategyId: "res_5", playbookId: "gone-playbook", asset: "BTC", exit: "trail", strikes: [], expiry: null, dte: null, openedAt: "2026-11-21T09:00:00.000Z", closedAt: "2026-11-21T09:30:00.000Z", closeReason: "squared_off", grossUsd: "1.00", feesUsd: "0.00", netUsd: "1.00" },
  ],
};

beforeEach(() => {
  mock = installMockFetch();
  mock.loginAs(EMAIL);
});
afterEach(() => mock.restore());

describe("HC-TR-224 Autopilot results", () => {
  it("HC-TR-224 trail against target is added up over every strategy and coin, in cents", () => {
    expect(exitTotals(RESULTS.rows)).toEqual([{ exit: "trail", closed: 3, wins: 2, netUsd: 3.2 }, { exit: "target", closed: 1, wins: 0, netUsd: -0.2 }, { exit: "own", closed: 0, wins: 0, netUsd: 0 }]);
    expect(exitTotals([]).map((x) => x.closed)).toEqual([0, 0, 0]);
  });

  it("HC-TR-224 before any trade the screen says so; a failed read offers a retry", async () => {
    renderWithProviders(<AutopilotPage />);
    const panel = await screen.findByTestId("autopilot-results");
    await waitFor(() => expect(panel.dataset["state"]).toBe("ready"));
    expect(within(panel).getByText("No trade yet")).toBeTruthy();
    expect(within(panel).queryByTestId("results-by-strategy")).toBeNull();
  });

  it("HC-TR-224 a failed read of the results offers a retry that works once signed in again", async () => {
    const kept = new Map(mock.state.sessions);
    mock.state.sessions.clear();
    renderWithProviders(<AutopilotResultsPanel money={USD} />);
    await waitFor(() => expect(screen.getByTestId("autopilot-results").dataset["state"]).toBe("error"), { timeout: 8000 });
    for (const [k, v] of kept) mock.state.sessions.set(k, v);
    acc().autopilotResults = { ...RESULTS, total: { ...RESULTS.total, closed: 0, wins: 0 }, trades: [] };
    await userEvent.setup().click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(screen.getByTestId("autopilot-results").dataset["state"]).toBe("ready"));
    // trades are open and none has closed: counted, with the note that the money comes later
    expect(screen.getByTestId("results-closed").textContent).toBe("0");
    expect(screen.getByTestId("results-won").textContent).toBe("0 · —");
    expect(screen.getByTestId("autopilot-results").textContent).toContain("No trade has closed yet");
    expect(screen.queryByTestId("results-trades")).toBeNull();
  });

  it("HC-TR-224 shows the totals, trail against target, each strategy with its coin and exit style, the days-to-expiry bands and the closed trades", async () => {
    acc().autopilotResults = RESULTS;
    renderWithProviders(<AutopilotResultsPanel money={USD} />);
    await waitFor(() => expect(screen.getByTestId("results-closed").textContent).toBe("4"));
    const panel = screen.getByTestId("autopilot-results");
    expect(panel.textContent).toContain("1 still open");
    expect(screen.getByTestId("results-won").textContent).toBe("2 · 50%");
    expect(screen.getByTestId("results-net").textContent).toBe("+$3.00");
    expect(screen.getByTestId("results-net").className).toContain("text-profit");
    expect(panel.textContent).toContain("+$4.30 before $1.30 of fees");
    const exits = screen.getAllByTestId("results-exit");
    expect(exits.map((e) => e.dataset["exit"])).toEqual(["trail", "target", "own"]);
    expect(exits[2]!.textContent).toBe("Own exit—0 closed · — won"); // the evening strategies: nothing closed yet
    expect(exits[0]!.textContent).toBe("Trail exit+$3.203 closed · 67% won");
    expect(exits[1]!.textContent).toBe("Target exit−$0.201 closed · 0% won");

    const rows = screen.getAllByTestId("results-row");
    expect(rows).toHaveLength(3);
    const cells = (row: HTMLElement) => [...row.querySelectorAll("th,td")].map((c) => c.textContent);
    expect(cells(rows[0]!)).toEqual(["Pin butterfly", "BTC", "Trail", "0", "3", "2 · 67%", "+$3.20", "+$1.07", "+$4.60", "−$2.40", "40 min", "1 target hit, 1 stopped, 1 squared off"]);
    expect(cells(rows[1]!)).toEqual(["Trend with puts", "ETH", "Target", "1", "1", "0 · 0%", "−$0.20", "−$0.20", "−$0.20", "−$0.20", "3.3 h", "1 unknown"]);
    // nothing closed yet: counts only, no money made up
    expect(cells(rows[2]!).slice(3)).toEqual(["2", "0", "—", "—", "—", "—", "—", "—", "—"]);

    const bands = screen.getAllByTestId("results-dte");
    expect(bands.map((b) => b.dataset["band"])).toEqual(["0-1", "2-7", "8-30", "31+"]);
    expect(cells(bands[0]!)).toEqual(["Expiry day or the day before", "0", "3", "2 · 67%", "$0.80", "+$3.20"]);
    expect(cells(bands[1]!)).toEqual(["2 to 7 days", "0", "0", "—", "—", "—"]);
    expect(cells(bands[3]!)).toEqual(["More than 30 days", "2", "0", "—", "—", "—"]);

    const trades = screen.getAllByTestId("results-trade");
    expect(trades.map((x) => x.dataset["id"])).toEqual(["res_4", "res_1", "res_5"]);
    // HC-TR-267: the time it closed (its day is the group's heading), then the trade, with when it was opened
    expect(cells(trades[0]!)).toEqual([fmtDateTime(RESULTS.trades[0]!.closedAt).split(", ")[1], "Trend with puts · ETH", "1,600 / 1,500 · 11 Dec · 20d out", fmtDateTime(RESULTS.trades[0]!.openedAt), "Target", "closed", "—", "+$0.30", "$0.50", "−$0.20"]);
    expect(cells(trades[1]!).slice(1)).toEqual(["Pin butterfly · BTC", "57,600 / 58,000 / 58,400 · 22 Nov · 1d out", fmtDateTime(RESULTS.trades[1]!.openedAt), "Trail", "target hit", "—", "+$5.00", "$0.40", "+$4.60"]);
    expect(cells(trades[2]!).slice(1)).toEqual(["gone-playbook · BTC", "—", fmtDateTime(RESULTS.trades[2]!.openedAt), "Trail", "squared off", "—", "+$1.00", "$0.00", "+$1.00"]);
    expect(screen.getByTestId("results-since").textContent).toContain("Counted since");
  });

  it("HC-TR-232 a selection shows its own rows, totals and closed trades, and leaves out the days-to-expiry table", async () => {
    expect(totalOf(RESULTS.rows)).toEqual({ open: 3, closed: 4, wins: 2, grossUsd: "4.30", feesUsd: "1.30", netUsd: "3.00" });
    expect(totalOf([])).toEqual({ open: 0, closed: 0, wins: 0, grossUsd: "0.00", feesUsd: "0.00", netUsd: "0.00" });
    acc().autopilotResults = RESULTS;
    const first = renderWithProviders(<AutopilotResultsPanel money={USD} show={(playbookId, asset) => playbookId === "trend-puts" && asset === "ETH"} />);
    await waitFor(() => expect(screen.getByTestId("results-closed").textContent).toBe("1"));
    expect(screen.getByTestId("results-net").textContent).toBe("−$0.20");
    expect(screen.getAllByTestId("results-row").map((r) => r.dataset["playbook"])).toEqual(["trend-puts"]);
    expect(screen.getAllByTestId("results-trade").map((x) => x.dataset["id"])).toEqual(["res_4"]);
    expect(screen.queryByTestId("results-by-dte")).toBeNull();
    first.unmount();
    renderWithProviders(<AutopilotResultsPanel money={USD} show={() => false} />);
    await waitFor(() => expect(screen.getByText("No trade in this selection yet")).toBeTruthy());
  });

  it("HC-TR-224 HC-TR-267 long holds read in days; a long list of closed trades is drawn a page at a time and every one can be reached; what the server did not send is said", async () => {
    const many = Array.from({ length: 130 }, (_, i) => ({ ...RESULTS.trades[1]!, strategyId: `m_${i}` }));
    acc().autopilotResults = { ...RESULTS, total: { ...RESULTS.total, closed: 140 }, rows: [{ ...RESULTS.rows[0]!, avgHoldMinutes: 4320 }], trades: many };
    renderWithProviders(<AutopilotResultsPanel money={USD} />);
    await waitFor(() => expect(screen.getAllByTestId("results-trade")).toHaveLength(TRADES_PAGE));
    expect(screen.getByTestId("results-trades").textContent).toContain("(the newest 130 of 140)");
    expect(screen.getByTestId("results-day-note").textContent).toContain("10 older closed trades are counted in the totals and not listed.");
    expect(screen.getByTestId("results-more").textContent).toBe("Show 30 more of 130");
    await userEvent.setup().click(screen.getByTestId("results-more"));
    expect(screen.getAllByTestId("results-trade")).toHaveLength(130);
    expect(screen.queryByTestId("results-more")).toBeNull();
    expect(screen.getByTestId("results-row").textContent).toContain("3.0 d");
    // older trades were left out, so the oldest day listed may be a part of that day: its heading says so
    expect(screen.getAllByTestId("results-day").at(-1)!.textContent).toContain("only the part of this day that is listed");
  });

  it("HC-TR-267 a page of closed trades runs across the days in order, and a selection says what it does not list", async () => {
    const on = (day: string) => (_: unknown, i: number) => ({ ...RESULTS.trades[1]!, strategyId: `${day}_${i}`, closedAt: `2026-11-${day}T10:00:00.000Z` });
    const trades = [...Array.from({ length: 60 }, on("23")), ...Array.from({ length: 70 }, on("21"))];
    acc().autopilotResults = { ...RESULTS, total: { ...RESULTS.total, closed: 130 }, trades };
    const first = renderWithProviders(<AutopilotResultsPanel money={USD} />);
    await waitFor(() => expect(screen.getAllByTestId("results-trade")).toHaveLength(TRADES_PAGE));
    // the whole of the newer day, then the first 40 of the older one, whose heading still counts all 70
    expect(screen.getAllByTestId("results-trade").filter((x) => x.dataset["id"]?.startsWith("23_"))).toHaveLength(60);
    expect(screen.getAllByTestId("results-day").map((d) => d.textContent.split(" · ")[1])).toEqual(["60 closed", "70 closed"]);
    expect(screen.getAllByTestId("results-day").at(-1)!.textContent).not.toContain("only the part"); // everything closed is listed
    expect(screen.getByTestId("results-trades").textContent).not.toContain("the newest");
    await userEvent.setup().click(screen.getByTestId("results-more"));
    expect(screen.getAllByTestId("results-trade")).toHaveLength(130);
    first.unmount();

    // a selection: its strategy closed 3 trades and the list holds 1 of them
    acc().autopilotResults = RESULTS;
    renderWithProviders(<AutopilotResultsPanel money={USD} show={(playbookId) => playbookId === "pin-butterfly"} />);
    await waitFor(() => expect(screen.getByTestId("results-closed").textContent).toBe("3"));
    expect(screen.getAllByTestId("results-trade").map((x) => x.dataset["id"])).toEqual(["res_1"]);
    expect(screen.getByTestId("results-trades").textContent).toContain("(the newest 1 of 3)");
    expect(screen.getByTestId("results-day-note").textContent).toContain("2 older closed trades are counted in the totals and not listed.");
    expect(screen.getByTestId("results-day").textContent).toContain("only the part of this day that is listed");
  });

  it("HC-TR-267 the closed trades are grouped by the day they closed, each day with its count, its won and lost and its net; one day and the won or the lost ones can be picked", async () => {
    // two days far enough apart to be two days on any clock; the second day has one win and one loss
    const t = (id: string, closedAt: string, netUsd: string) => ({ ...RESULTS.trades[1]!, strategyId: id, closedAt, grossUsd: netUsd, feesUsd: "0.00", netUsd });
    const trades = [t("d2_win", "2026-11-23T10:30:00.000Z", "4.00"), t("d2_loss", "2026-11-23T10:00:00.000Z", "-6.50"), t("d1_flat", "2026-11-21T10:00:00.000Z", "0.00")];
    const D2 = dayOf(trades[0]!.closedAt);
    const D1 = dayOf(trades[2]!.closedAt);
    expect(D1).not.toBe(D2);
    expect(won(trades[0]!)).toBe(true);
    expect(won(trades[2]!)).toBe(false); // nothing made after fees is not a win
    expect(byDay(trades)).toEqual([{ day: D2, trades: [trades[0], trades[1]], wins: 1, netUsd: -2.5 }, { day: D1, trades: [trades[2]], wins: 0, netUsd: 0 }]);
    expect(byDay([])).toEqual([]);

    acc().autopilotResults = { ...RESULTS, total: { ...RESULTS.total, closed: 3 }, trades };
    renderWithProviders(<AutopilotResultsPanel money={USD} />);
    const u = userEvent.setup();
    await waitFor(() => expect(screen.getAllByTestId("results-trade")).toHaveLength(3));
    const days = () => screen.getAllByTestId("results-day");
    expect(days().map((d) => d.dataset["day"])).toEqual([D2, D1]);
    expect(days()[0]!.textContent).toBe(`${D2} · 2 closed · 1 won · 1 lost−$2.50`);
    expect(days()[1]!.textContent).toBe(`${D1} · 1 closed · 0 won · 1 lost$0.00`);
    expect(within(days()[0]!).getByTestId("results-day-net").className).toContain("text-loss");
    const pick = screen.getByTestId<HTMLSelectElement>("results-day-pick");
    expect([...pick.options].map((o) => o.textContent)).toEqual(["All days · 3 trades", `${D2} · 2 trades`, `${D1} · 1 trade`]);
    const ids = () => screen.queryAllByTestId("results-trade").map((x) => x.dataset["id"]);

    await u.selectOptions(pick, D2);
    expect(ids()).toEqual(["d2_win", "d2_loss"]);
    expect(days().map((d) => d.dataset["day"])).toEqual([D2]);
    const press = (v: string) => u.click(screen.getAllByTestId("results-outcome").find((b) => b.dataset["value"] === v)!);
    await press("lost");
    expect(ids()).toEqual(["d2_loss"]);
    // the day's heading still counts the whole day
    expect(days()[0]!.textContent).toBe(`${D2} · 2 closed · 1 won · 1 lost−$2.50`);
    await press("won");
    expect(ids()).toEqual(["d2_win"]);
    expect(screen.getByTestId("results-trades").querySelector("[data-won=true]")).toBeTruthy();
    await u.selectOptions(pick, D1);
    expect(ids()).toEqual([]);
    expect(screen.getByTestId("results-none").textContent).toBe(`No won trade on ${D1}.`);
    await press("all");
    expect(ids()).toEqual(["d1_flat"]);
    await u.selectOptions(pick, "all");
    expect(ids()).toEqual(["d2_win", "d2_loss", "d1_flat"]);
  });
});

describe("HC-TR-314 the capital of a closed Autopilot trade", () => {
  it("HC-TR-314 one figure and what it is: the most a covered trade could lose, otherwise the margin estimated at entry, otherwise nothing", () => {
    expect(tradeCapital("114.35", "291.67")).toEqual({ usd: 114.35, basis: "max loss" });
    expect(tradeCapital(null, "291.67")).toEqual({ usd: 291.67, basis: "est. margin" });
    expect(tradeCapital(undefined, "108.5")).toEqual({ usd: 108.5, basis: "est. margin" });
    // nothing recorded, or a figure that is not a positive amount: no capital, never a made-up one
    for (const [a, b] of [[null, null], [undefined, undefined], ["0", "0"], ["x", "-3"], ["0.00", null]] as const) expect(tradeCapital(a, b)).toBeNull();
  });

  it("HC-TR-314 the closed trades table has a Capital column that says which figure it shows, and a note that the margin is an unchecked estimate", async () => {
    const [a, b, c] = RESULTS.trades;
    acc().autopilotResults = { ...RESULTS, trades: [{ ...a!, maxLossUsd: "114.35", marginUsd: "291.67" }, { ...b!, maxLossUsd: null, marginUsd: "108.50" }, { ...c!, maxLossUsd: null, marginUsd: null }] };
    renderWithProviders(<AutopilotResultsPanel money={USD} />);
    await waitFor(() => expect(screen.getAllByTestId("results-trade")).toHaveLength(3));
    const heads = [...screen.getByTestId("results-trades").querySelectorAll("thead th")].map((h) => h.textContent);
    expect(heads).toEqual(["Closed at", "Strategy", "Strikes", "Opened", "Exit", "Ended", "Capital", "Before fees", "Fees", "Net"]);
    const caps = screen.getAllByTestId("results-trade-capital");
    expect(caps.map((x) => x.textContent)).toEqual(["$114.35 max loss", "$108.50 est. margin", "—"]);
    expect(caps.map((x) => x.dataset["basis"])).toEqual(["max loss", "est. margin", undefined]);
    const note = screen.getByTestId("results-capital-note").textContent;
    expect(note).toContain("has not been checked against what the exchange blocks");
    expect(note).toContain("can lose more than that");
    // a day's heading still spans to its net
    expect(screen.getAllByTestId("results-day")[0]!.querySelector("th")!.colSpan).toBe(9);
  });
});

