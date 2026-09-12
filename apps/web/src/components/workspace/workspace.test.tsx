import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeSocket, renderWithProviders } from "../../../test/helpers";
import { searchParamsMock } from "../../../test/next-mocks";
import { findRegistered, listShortcuts, resetShortcuts } from "@/lib/shortcuts";
import { useUiStore } from "@/lib/store";
import { Workspace, clampSplit } from "./Workspace";
import { WorkspaceLoader } from "./WorkspaceLoader";

const realFetch = globalThis.fetch;
beforeEach(() => {
  FakeSocket.reset();
  globalThis.fetch = vi.fn(() => Promise.reject(new Error("no gateway http")));
  useUiStore.setState({ asset: "BTC", legs: { BTC: [], ETH: [], XAUT: [] }, workspaceTab: "chain", analysisTab: "payoff", builderTab: "builder", analyseCollapse: null });
  searchParamsMock.value = new URLSearchParams();
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("[WORKSPACE] HC-WS-001..006 two-pane shell", () => {
  it("has every left tab enabled and live (Paper, Live, Journal) and the analysis tabs on the right", async () => {
    renderWithProviders(<Workspace />);
    for (const id of ["chain", "builder", "paper", "live", "journal"]) expect(screen.getByTestId(`tab-${id}`).hasAttribute("disabled")).toBe(false);
    expect(screen.getByTestId("tab-paper").getAttribute("title")).toBeNull();
    expect(screen.getByTestId("tab-live").getAttribute("title")).toBeNull();
    expect(screen.getByTestId("tab-journal").getAttribute("title")).toBeNull();
    expect(screen.getByTestId("chain-panel")).toBeTruthy();
    expect(screen.getByTestId("workspace").dataset["layout"]).toBe("split");
    for (const id of ["payoff", "scenarios", "greeks", "vol", "structure", "ladder"]) expect(screen.getByTestId(`analysis-tab-${id}`)).toBeTruthy();
    expect(screen.getByTestId("payoff-panel").dataset["state"]).toBe("empty");
    const u = userEvent.setup();
    await u.click(screen.getByTestId("tab-paper"));
    expect(useUiStore.getState().workspaceTab).toBe("paper");
    expect(screen.getByTestId("paper-panel")).toBeTruthy();
    await u.click(screen.getByTestId("tab-live"));
    expect(screen.getByTestId("live-panel")).toBeTruthy();
    await u.click(screen.getByTestId("tab-journal"));
    expect(screen.getByTestId("journal-panel")).toBeTruthy(); // Phase 5 item 1: the Journal is live
    await u.click(screen.getByTestId("analysis-tab-scenarios"));
    expect(useUiStore.getState().analysisTab).toBe("scenarios");
    expect(screen.getByTestId("scenarios-panel").dataset["state"]).toBe("empty"); // Phase 5 item 1: a live tab with its own empty state
  });

  it("HC-WS-005 the Builder tab carries the open-leg count and opens the Builder", async () => {
    useUiStore.getState().addLeg({ asset: "BTC", kind: "call", side: "buy", strike: "80000", expiry: "2026-09-25", lots: 10, price: "1200", iv: 0.5 });
    useUiStore.getState().addLeg({ asset: "BTC", kind: "put", side: "sell", strike: "78000", expiry: "2026-09-25", lots: 10, price: "900", iv: 0.5 });
    renderWithProviders(<Workspace />);
    expect(screen.getByTestId("builder-count").textContent).toBe("2");
    await userEvent.setup().click(screen.getByTestId("tab-builder"));
    expect(screen.getByTestId("builder-panel").dataset["legs"]).toBe("2");
    expect(screen.getAllByTestId("leg-row")).toHaveLength(2);
  });

  it("HC-WS-002 the divider resizes with the keyboard within 35–70 %, remembers the split and resets on double-click", () => {
    renderWithProviders(<Workspace />);
    const divider = screen.getByTestId("workspace-divider");
    expect(screen.getByTestId("workspace").dataset["split"]).toBe("0.55");
    fireEvent.keyDown(divider, { key: "ArrowRight" });
    expect(screen.getByTestId("workspace").dataset["split"]).toBe("0.57");
    expect(localStorage.getItem("hapiecoin.split")).toBe("0.57");
    for (let i = 0; i < 10; i += 1) fireEvent.keyDown(divider, { key: "ArrowRight" });
    expect(screen.getByTestId("workspace").dataset["split"]).toBe("0.70");
    fireEvent.doubleClick(divider);
    expect(screen.getByTestId("workspace").dataset["split"]).toBe("0.55");
    expect(clampSplit(0.1)).toBe(0.35);
    expect(clampSplit(Number.NaN)).toBe(0.55);
  });

  it("HC-WS-002 the divider follows a pointer drag and stores the split on release", () => {
    renderWithProviders(<Workspace />);
    const divider = screen.getByTestId("workspace-divider");
    const grid = screen.getByTestId("workspace");
    grid.getBoundingClientRect = () => ({ left: 0, width: 1000, top: 0, height: 800, right: 1000, bottom: 800, x: 0, y: 0, toJSON: () => ({}) });
    fireEvent.pointerDown(divider, { pointerId: 1, clientX: 550 });
    fireEvent.pointerMove(divider, { pointerId: 1, clientX: 400 });
    expect(grid.dataset["split"]).toBe("0.40");
    fireEvent.pointerMove(divider, { pointerId: 1, clientX: 100 });
    expect(grid.dataset["split"]).toBe("0.35");
    fireEvent.pointerUp(divider, { pointerId: 1 });
    expect(localStorage.getItem("hapiecoin.split")).toBe("0.35");
    // moving without the button down changes nothing
    fireEvent.pointerMove(divider, { pointerId: 1, clientX: 600 });
    expect(grid.dataset["split"]).toBe("0.35");
  });

  it("HC-WS-003 stacks the panes under 1000 px with a Chain & Builder | Analysis toggle", async () => {
    const original = Object.getOwnPropertyDescriptor(window, "matchMedia")!;
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      writable: true,
      value: (query: string) => ({ matches: query.includes("max-width"), media: query, onchange: null, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false }),
    });
    try {
      renderWithProviders(<Workspace />);
      await waitFor(() => expect(screen.getByTestId("workspace").dataset["layout"]).toBe("stacked"));
      expect(screen.getByTestId("chain-panel")).toBeTruthy();
      expect(screen.queryByTestId("analysis-pane")).toBeNull();
      await userEvent.setup().click(screen.getByTestId("stack-analysis"));
      expect(screen.getByTestId("analysis-pane")).toBeTruthy();
      expect(screen.queryByTestId("chain-panel")).toBeNull();
    } finally {
      Object.defineProperty(window, "matchMedia", original);
    }
  });

  it("HC-WS-006 deep links pick the tabs; HC-WS-065 collapse buttons give one pane the full width and the handle restores both; HC-WS-067 tab-bar info", async () => {
    searchParamsMock.value = new URLSearchParams("tab=paper&panel=ladder");
    const r = renderWithProviders(<Workspace />);
    expect(useUiStore.getState().workspaceTab).toBe("paper");
    expect(useUiStore.getState().analysisTab).toBe("ladder");
    expect(screen.getByTestId("left-tab-info").textContent).toMatch(/^Lot .* BTC · basis mark$/);
    expect(screen.getByTestId("pane-strategy-info").textContent).toBe("No strategy");
    expect(screen.getByTestId("share-open").hasAttribute("disabled")).toBe(true);
    const u = userEvent.setup();
    await u.click(screen.getByTestId("collapse-right"));
    expect(screen.getByTestId("workspace").dataset["collapse"]).toBe("right");
    expect(screen.getByTestId("right-pane").classList.contains("hidden")).toBe(true); // stays mounted, takes no width
    await u.click(screen.getByTestId("collapse-restore"));
    expect(screen.getByTestId("workspace").dataset["collapse"]).toBeUndefined();
    await u.click(screen.getByTestId("collapse-left"));
    expect(screen.getByTestId("workspace").dataset["collapse"]).toBe("left");
    expect(screen.getByTestId("left-pane").parentElement!.classList.contains("hidden")).toBe(true);
    expect(screen.getByTestId("right-pane").classList.contains("hidden")).toBe(false);
    r.unmount();
    // an unknown deep link is ignored
    searchParamsMock.value = new URLSearchParams("tab=nope&panel=zzz");
    useUiStore.setState({ workspaceTab: "chain", analysisTab: "payoff", analyseCollapse: null });
    renderWithProviders(<Workspace />);
    expect(useUiStore.getState().workspaceTab).toBe("chain");
    expect(useUiStore.getState().analysisTab).toBe("payoff");
  });

  it("HC-TR-178 registers W → Strategy wizard while mounted, listed under Analyse workspace (ADR-072)", () => {
    const { unmount } = renderWithProviders(<Workspace />);
    const row = listShortcuts().find((r) => r.key === "W");
    expect(row?.group).toBe("Analyse workspace");
    expect(row?.description).toContain("Strategy wizard");
    const reg = findRegistered({ key: "w", shiftKey: false, ctrlKey: false, metaKey: false, altKey: false }, false);
    expect(reg).not.toBeNull();
    reg!.handler(new KeyboardEvent("keydown", { key: "w" }));
    expect(useUiStore.getState()).toMatchObject({ workspaceTab: "builder", builderTab: "wizard" });
    // typing in a field never triggers it
    expect(findRegistered({ key: "w", shiftKey: false, ctrlKey: false, metaKey: false, altKey: false }, true)).toBeNull();
    unmount();
    expect(listShortcuts().some((r) => r.key === "W")).toBe(false);
    resetShortcuts();
  });

  it("WorkspaceLoader code-splits the workspace behind a spinner", async () => {
    renderWithProviders(<WorkspaceLoader />);
    await waitFor(() => expect(screen.getByTestId("workspace")).toBeTruthy());
  });
});
