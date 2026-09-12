// Backtest tab (ADR-077; HC-TR-185) against the in-memory mock API's synthetic end-of-day chains: controls, the
// coverage line, the stat tiles, the equity chart and the trade rows; the honest empty state before any day is recorded.
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { installMockFetch, renderWithProviders, type MockFetch } from "../../../test/helpers";
import { useUiStore } from "@/lib/store";
import { BacktestPanel, legsLine } from "./BacktestPanel";

let mock: MockFetch;
beforeEach(() => {
  mock = installMockFetch();
  mock.loginAs("backtest@example.com");
  useUiStore.setState({ asset: "BTC", analysisTab: "backtest" });
});
afterEach(() => mock.restore());

describe("HC-TR-185 the Backtest tab", () => {
  it("runs the default template over the recorded days and shows coverage, stats, the curve and the trades; the template and range re-run it", async () => {
    renderWithProviders(<BacktestPanel />);
    await waitFor(() => expect(screen.getByTestId("backtest-panel").dataset["state"]).toBe("ready"), { timeout: 8000 });
    expect(screen.getByTestId("backtest-coverage").textContent).toMatch(/12 recorded days from .* · \d+ entries/);
    expect(screen.getByTestId("backtest-coverage").textContent).toContain("no fees, no slippage");
    expect(screen.getByTestId("backtest-total").textContent).toMatch(/[\d$]/);
    expect(screen.getByTestId("backtest-winrate").textContent).toMatch(/^(\d+%|—)$/);
    expect(screen.getByTestId("chart-backtest")).not.toBeNull();
    const rows = screen.getAllByTestId("backtest-trade");
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0]!.textContent).toMatch(/B C \d+ · S C \d+/); // a bull call spread's legs
    expect(mock.calls.some((c) => c.url.includes("/v1/backtest?asset=BTC&template=Bull+Call+Spread&lots=100&minDte=7&from="))).toBe(true);
    fireEvent.change(screen.getByTestId("backtest-template"), { target: { value: "Buy Call" } });
    await waitFor(() => expect(mock.calls.some((c) => c.url.includes("template=Buy+Call"))).toBe(true));
    await waitFor(() => expect(screen.getAllByTestId("backtest-trade")[0]!.textContent).not.toContain("S C")); // a single bought call
    expect(screen.getAllByTestId("backtest-trade")[0]!.textContent).toMatch(/B C \d+/);
    fireEvent.click(screen.getByTestId("backtest-range-7D"));
    await waitFor(() => expect(mock.calls.filter((c) => c.url.includes("/v1/backtest")).length).toBeGreaterThanOrEqual(3));
    expect(screen.getByTestId("backtest-range-7D").getAttribute("aria-pressed")).toBe("true");
  });

  it("before any day is recorded the tab says so instead of showing zeros", async () => {
    mock.state.backtestDays = 0;
    renderWithProviders(<BacktestPanel />);
    await waitFor(() => expect(screen.getByTestId("backtest-panel").dataset["state"]).toBe("empty"), { timeout: 8000 });
    expect(screen.getByTestId("backtest-empty").textContent).toContain("No end-of-day chains recorded yet");
    expect(screen.queryByTestId("backtest-total")).toBeNull();
  });

  it("legsLine names the legs in order with side, kind and strike", () => {
    expect(legsLine({ entryDay: "2026-09-01", exitDay: "2026-09-06", expiry: "2026-09-06", legs: [{ kind: "call", side: "buy", strike: "80000", expiry: "2026-09-06", price: "400", quantity: "0.01", exitPrice: "3000" }, { kind: "future", side: "sell", strike: "0", expiry: "", price: "80000", quantity: "0.01", exitPrice: "83000" }], entryCost: "4", pnl: "26", status: "closed", modelled: false, daysHeld: 5 })).toBe("B C 80000 · S F");
  });
});
