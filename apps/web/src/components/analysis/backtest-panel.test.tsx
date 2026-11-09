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
    expect(screen.getByTestId("backtest-coverage").textContent).toMatch(/12 days of history from .* · \d+ entries/);
    expect(screen.getByTestId("backtest-coverage").textContent).toContain("net of the venue's fees");
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

  it("HC-WS-117 the Rules row re-runs the backtest with fees off, a trend filter, a target and a weekday, and the trades show their fees and exit reason", async () => {
    renderWithProviders(<BacktestPanel />);
    await waitFor(() => expect(screen.getByTestId("backtest-panel").dataset["state"]).toBe("ready"), { timeout: 8000 });
    expect(screen.getAllByTestId("backtest-fees-cell").length).toBeGreaterThan(0);
    fireEvent.change(screen.getByTestId("backtest-fees"), { target: { value: "none" } });
    await waitFor(() => expect(mock.calls.some((c) => c.url.includes("fees=none"))).toBe(true));
    await waitFor(() => expect(screen.getByTestId("backtest-coverage").textContent).toContain("no fees, no slippage"));
    fireEvent.change(screen.getByTestId("backtest-sma"), { target: { value: "20" } });
    await waitFor(() => expect(mock.calls.some((c) => c.url.includes("smaDays=20") && c.url.includes("smaSide=above"))).toBe(true));
    expect(screen.getByTestId("backtest-sma-side")).not.toBeNull();
    fireEvent.change(screen.getByTestId("backtest-target"), { target: { value: "50" } });
    await waitFor(() => expect(mock.calls.some((c) => c.url.includes("targetPct=50"))).toBe(true));
    await waitFor(() => expect(screen.getByTestId("backtest-coverage").textContent).toMatch(/Exits: \d+ on target, \d+ on stop, \d+ on time, \d+ settled/));
    fireEvent.click(screen.getByTestId("backtest-weekday-2"));
    await waitFor(() => expect(mock.calls.some((c) => c.url.includes("weekdays=2"))).toBe(true));
    expect(screen.getByTestId("backtest-weekday-2").getAttribute("aria-pressed")).toBe("true");
    fireEvent.change(screen.getByTestId("backtest-ivrank"), { target: { value: "high" } });
    await waitFor(() => expect(mock.calls.some((c) => c.url.includes("ivRankMin=70") && c.url.includes("ivRankMax=100"))).toBe(true));
    fireEvent.change(screen.getByTestId("backtest-stop"), { target: { value: "100" } });
    await waitFor(() => expect(mock.calls.some((c) => c.url.includes("stopPct=100"))).toBe(true));
    // min days to expiry is 7: the time-stop select offers only values below it
    expect(Array.from(screen.getByTestId("backtest-timestop").querySelectorAll("option")).map((o) => o.getAttribute("value"))).toEqual(["", "1", "2"]);
    fireEvent.change(screen.getByTestId("backtest-timestop"), { target: { value: "2" } });
    await waitFor(() => expect(mock.calls.some((c) => c.url.includes("timeStopDte=2"))).toBe(true));
  });

  it("HC-WS-117 on a venue without a published fee rule the fees select is fixed to none and disabled, so the tab opens without an error", async () => {
    useUiStore.setState({ asset: "BTC", analysisTab: "backtest", venue: "deribit" });
    renderWithProviders(<BacktestPanel />);
    await waitFor(() => expect(screen.getByTestId("backtest-panel").dataset["state"]).toBe("ready"), { timeout: 8000 });
    expect(screen.getByTestId<HTMLSelectElement>("backtest-fees").disabled).toBe(true);
    expect(mock.calls.some((c) => c.url.includes("fees=none") && c.url.includes("venue=deribit"))).toBe(true);
    expect(screen.getByTestId("backtest-coverage").textContent).toContain("no fees, no slippage");
  });

  it("before any day is recorded the tab says so instead of showing zeros", async () => {
    mock.state.backtestDays = 0;
    renderWithProviders(<BacktestPanel />);
    await waitFor(() => expect(screen.getByTestId("backtest-panel").dataset["state"]).toBe("empty"), { timeout: 8000 });
    expect(screen.getByTestId("backtest-empty").textContent).toContain("No end-of-day chains recorded yet");
    expect(screen.queryByTestId("backtest-total")).toBeNull();
  });

  it("legsLine names the legs in order with side, kind and strike", () => {
    expect(legsLine({ entryDay: "2026-09-01", exitDay: "2026-09-06", expiry: "2026-09-06", legs: [{ kind: "call", side: "buy", strike: "80000", expiry: "2026-09-06", price: "400", quantity: "0.01", exitPrice: "3000" }, { kind: "future", side: "sell", strike: "0", expiry: "", price: "80000", quantity: "0.01", exitPrice: "83000" }], entryCost: "4", grossPnl: "0", fees: "0", exitReason: "settled", ruleInert: false, pnl: "26", status: "closed", modelled: false, daysHeld: 5 })).toBe("B C 80000 · S F");
  });
});
