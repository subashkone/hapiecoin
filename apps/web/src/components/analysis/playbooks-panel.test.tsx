// Playbooks tab (ADR-101; HC-WS-119) against the in-memory mock API: one card per playbook for the workspace asset with
// its status and record, the control marked, the warning copy, and the two actions.
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PLAYBOOKS, playbookById } from "@hapiecoin/pricing";
import { installMockFetch, renderWithProviders, type MockFetch } from "../../../test/helpers";
import { useUiStore } from "@/lib/store";
import { PlaybooksPanel, planLine } from "./PlaybooksPanel";

let mock: MockFetch;
beforeEach(() => {
  mock = installMockFetch();
  mock.loginAs("playbooks@example.com");
  useUiStore.setState({ asset: "BTC", analysisTab: "playbooks", backtestPreset: null });
});
afterEach(() => mock.restore());

describe("HC-WS-119 the Playbooks tab", () => {
  it("shows one card per playbook with its status, record, evidence and warning; the control is marked; Open in Backtest hands the plan to the Backtest tab", async () => {
    renderWithProviders(<PlaybooksPanel />);
    await waitFor(() => expect(screen.getByTestId("playbooks-panel").dataset["state"]).toBe("ready"), { timeout: 8000 });
    const cards = screen.getAllByTestId("playbook-card");
    expect(cards).toHaveLength(PLAYBOOKS.filter((p) => p.assets.includes("BTC")).length);
    // twelve synthetic days cannot give twenty closed trades: every record says so, the control included
    for (const c of cards) expect(c.dataset["status"]).toBe("insufficient");
    expect(screen.getAllByTestId("playbook-status").every((s) => s.textContent === "Not enough trades yet")).toBe(true);
    expect(screen.getAllByTestId("playbook-record").length).toBe(cards.length);
    expect(screen.getByTestId("playbooks-intro").textContent).toContain("never a recommendation");
    const hero = cards.find((c) => c.dataset["playbook"] === "hero-or-zero")!;
    expect(hero.textContent).toContain("This card exists to lose");
    expect(hero.className).toContain("border-dashed");
    expect(mock.calls.some((c) => c.url.includes("/v1/playbooks"))).toBe(true);
    // every card names its evidence source and its trial count
    for (const c of cards) {
      expect(c.textContent).toContain("Evidence.");
      expect(c.textContent).toMatch(/configurations? looked at/);
    }
    // Open in Backtest on the trend-calls card hands over its template and rules and switches the tab
    const trend = cards.find((c) => c.dataset["playbook"] === "trend-calls")!;
    fireEvent.click(trend.querySelector('[data-testid="playbook-backtest"]')!);
    expect(useUiStore.getState().analysisTab).toBe("backtest");
    expect(useUiStore.getState().backtestPreset).toEqual({ template: "Bull Call Spread", lots: 10, range: "1Y", folds: 2, minDte: 14, smaDays: 50, smaSide: "above", ivRankMin: undefined, ivRankMax: undefined, targetPct: 50, stopPct: 50, timeStopDte: 2 });
    // the control's inline template is not in the Backtest catalogue: no button, a note instead
    expect(hero.querySelector('[data-testid="playbook-backtest"]')).toBeNull();
    expect(hero.querySelector('[data-testid="playbook-no-backtest"]')).not.toBeNull();
  });

  it("says when no playbook covers the asset", async () => {
    useUiStore.setState({ asset: "XAUT" });
    renderWithProviders(<PlaybooksPanel />);
    await waitFor(() => expect(screen.getByTestId("playbooks-none")).not.toBeNull(), { timeout: 8000 });
    expect(screen.queryAllByTestId("playbook-card")).toHaveLength(0);
  });

  it("says when no record exists yet and still lists the plans", async () => {
    mock.state.backtestDays = 0;
    renderWithProviders(<PlaybooksPanel />);
    await waitFor(() => expect(screen.getByTestId("playbooks-panel").dataset["state"]).toBe("empty"), { timeout: 8000 });
    expect(screen.getByTestId("playbooks-empty")).not.toBeNull();
    expect(screen.getAllByTestId("playbook-status").every((s) => s.textContent === "No record yet")).toBe(true);
    expect(screen.getAllByTestId("playbook-card").length).toBeGreaterThan(0);
  });

  it("planLine says the plan in words", () => {
    expect(planLine(playbookById("premium-harvest")!)).toBe("IV rank 50 to 100 · 30+ days to expiry · target 50% of max profit · stop at 50% of max loss · leave 21 days before settlement");
    expect(planLine(playbookById("hero-or-zero")!)).toBe("1+ days to expiry · hold to settlement");
  });
});
