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

  it("HC-WS-120 today's proposals: the plans that enter on the latest synthetic day with their record status; one tap loads the legs into the Builder and opens the paper flow (nothing placed); dismiss hides", async () => {
    renderWithProviders(<PlaybooksPanel />);
    await waitFor(() => expect(screen.getByTestId("proposals-strip").dataset["state"]).toBe("ready"), { timeout: 8000 });
    const cards = screen.getAllByTestId("proposal-card");
    expect(cards.length).toBeGreaterThan(0);
    for (const c of cards) {
      expect(c.dataset["status"]).toBe("new");
      expect(c.dataset["playbook"]).not.toBe("hero-or-zero"); // the control never proposes
      expect(c.querySelector('[data-testid="proposal-record-status"]')).not.toBeNull();
      expect(c.querySelector('[data-testid="proposal-legs"]')!.textContent).toMatch(/[BS] (?:[CP] \d+|PERP)/);
      expect(c.textContent).toContain("not a forecast");
    }
    expect(screen.getAllByTestId("playbook-card").length).toBeGreaterThan(0); // the records still show below the strip
    // one tap into paper: the exact legs land in the Builder, the trade flow opens on paper, the mark says taken
    const [first] = cards;
    if (!first) throw new Error("no proposal card");
    const legCount = (first.querySelector('[data-testid="proposal-legs"]')?.textContent ?? "").split(" · ").length;
    fireEvent.click(first.querySelector('[data-testid="proposal-open"]')!);
    const st = useUiStore.getState();
    expect(st.legs["BTC"]).toHaveLength(legCount);
    expect((st.legs["BTC"] ?? []).every((l) => l.status === "open")).toBe(true);
    expect(st.tradeFlow).toEqual({ strategyId: null, mode: "paper" });
    expect(st.workspaceTab).toBe("builder");
    expect(st.builderTab).toBe("builder");
    await waitFor(() => expect(screen.getAllByTestId("proposal-card")[0]!.dataset["status"]).toBe("taken"));
    expect(mock.calls.some((c) => c.url.includes("/v1/proposals/") && c.url.endsWith("/mark"))).toBe(true);
    expect(mock.calls.some((c) => c.url.includes("/v1/strategies") && c.method !== "GET")).toBe(false); // nothing was placed, not even on paper
    // dismiss every card: the strip says so and keeps the count
    for (const c of screen.getAllByTestId("proposal-card")) fireEvent.click(c.querySelector('[data-testid="proposal-dismiss"]')!);
    await waitFor(() => expect(screen.queryAllByTestId("proposal-card")).toHaveLength(0));
    expect(screen.getByTestId("proposals-none").textContent).toContain(`${cards.length} dismissed`);
  });

  it("HC-WS-120 / HC-SH-141 the Telegram opt-in is disabled until the chat is linked, then saves through settings", async () => {
    renderWithProviders(<PlaybooksPanel />);
    await waitFor(() => expect(screen.getByTestId("proposals-strip").dataset["state"]).toBe("ready"), { timeout: 8000 });
    const toggle = screen.getByTestId("proposals-telegram-toggle");
    expect(toggle.hasAttribute("disabled") || toggle.getAttribute("aria-disabled") === "true" || toggle.getAttribute("data-disabled") !== null).toBe(true);
    expect(screen.getByTestId("proposals-telegram").textContent).toContain("link Telegram");
  });

  it("HC-SH-141 once the chat is linked the opt-in is live and saves proposalsTelegram through settings", async () => {
    // the mock links on the second status read after Connect (ADR-057)
    await fetch("/v1/me/telegram/link", { method: "POST" });
    await fetch("/v1/me/telegram");
    await fetch("/v1/me/telegram");
    renderWithProviders(<PlaybooksPanel />);
    await waitFor(() => expect(screen.getByTestId("proposals-strip").dataset["state"]).toBe("ready"), { timeout: 8000 });
    await waitFor(() => expect(screen.getByTestId("proposals-telegram").textContent).not.toContain("link Telegram"), { timeout: 8000 });
    const toggle = screen.getByTestId("proposals-telegram-toggle");
    await waitFor(() => expect(toggle.hasAttribute("disabled")).toBe(false));
    fireEvent.click(toggle);
    await waitFor(() => expect(mock.calls.some((c) => c.method === "PUT" && c.url.includes("/v1/settings") && (c.body ?? "").includes('"proposalsTelegram":true'))).toBe(true), { timeout: 8000 });
  });

  it("HC-WS-120 with no recorded day the strip says no plan enters", async () => {
    mock.state.backtestDays = 0;
    renderWithProviders(<PlaybooksPanel />);
    await waitFor(() => expect(screen.getByTestId("proposals-strip").dataset["state"]).toBe("empty"), { timeout: 8000 });
    expect(screen.getByTestId("proposals-none").textContent).toContain("No plan enters BTC");
  });

  it("planLine says the plan in words", () => {
    expect(planLine(playbookById("premium-harvest")!)).toBe("IV rank 50 to 100 · 30+ days to expiry · target 50% of max profit · stop at 50% of max loss · leave 21 days before settlement");
    expect(planLine(playbookById("hero-or-zero")!)).toBe("1+ days to expiry · hold to settlement");
  });
});
