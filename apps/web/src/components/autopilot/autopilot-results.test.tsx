// Autopilot results on its screen (ADR-111; HC-TR-224), against the in-memory mock API.
import type { AutopilotResults } from "@hapiecoin/schema";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { installMockFetch, renderWithProviders, type MockFetch } from "../../../test/helpers";
import { USD } from "@/lib/money";
import { AutopilotPage } from "./AutopilotPage";
import { AutopilotResultsPanel, exitTotals } from "./AutopilotResultsPanel";

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
    expect(exitTotals(RESULTS.rows)).toEqual([{ exit: "trail", closed: 3, wins: 2, netUsd: 3.2 }, { exit: "target", closed: 1, wins: 0, netUsd: -0.2 }]);
    expect(exitTotals([])).toEqual([{ exit: "trail", closed: 0, wins: 0, netUsd: 0 }, { exit: "target", closed: 0, wins: 0, netUsd: 0 }]);
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
    expect(exits.map((e) => e.dataset["exit"])).toEqual(["trail", "target"]);
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
    expect(cells(trades[0]!).slice(1)).toEqual(["Trend with puts · ETH", "1,600 / 1,500 · 11 Dec · 20d out", "Target", "closed", "+$0.30", "$0.50", "−$0.20"]);
    expect(cells(trades[1]!).slice(1)).toEqual(["Pin butterfly · BTC", "57,600 / 58,000 / 58,400 · 22 Nov · 1d out", "Trail", "target hit", "+$5.00", "$0.40", "+$4.60"]);
    expect(cells(trades[2]!).slice(1)).toEqual(["gone-playbook · BTC", "—", "Trail", "squared off", "+$1.00", "$0.00", "+$1.00"]);
    expect(screen.getByTestId("results-since").textContent).toContain("Counted since");
  });

  it("HC-TR-224 long holds read in days and a long list of closed trades is cut to the newest", async () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ ...RESULTS.trades[1]!, strategyId: `m_${i}` }));
    acc().autopilotResults = { ...RESULTS, rows: [{ ...RESULTS.rows[0]!, avgHoldMinutes: 4320 }], trades: many };
    renderWithProviders(<AutopilotResultsPanel money={USD} />);
    await waitFor(() => expect(screen.getAllByTestId("results-trade")).toHaveLength(25));
    expect(screen.getByTestId("results-trades").textContent).toContain("(the newest 25)");
    expect(screen.getByTestId("results-row").textContent).toContain("3.0 d");
  });
});
