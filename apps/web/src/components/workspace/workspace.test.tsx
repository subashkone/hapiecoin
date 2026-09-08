import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeSocket, renderWithProviders } from "../../../test/helpers";
import { useUiStore } from "@/lib/store";
import { Workspace, clampSplit } from "./Workspace";
import { WorkspaceLoader } from "./WorkspaceLoader";

const realFetch = globalThis.fetch;
beforeEach(() => {
  FakeSocket.reset();
  globalThis.fetch = vi.fn(() => Promise.reject(new Error("no gateway http")));
  useUiStore.setState({ asset: "BTC", legs: { BTC: [], ETH: [], XAUT: [] }, workspaceTab: "chain", analysisTab: "payoff", builderTab: "builder" });
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("[WORKSPACE] HC-WS-001..006 two-pane shell", () => {
  it("has every left tab enabled, the Paper tab live, Phase 3 / 4 placeholders on Live / Journal, and the analysis tabs on the right", async () => {
    renderWithProviders(<Workspace />);
    for (const id of ["chain", "builder", "paper", "live", "journal"]) expect(screen.getByTestId(`tab-${id}`).hasAttribute("disabled")).toBe(false);
    expect(screen.getByTestId("tab-paper").getAttribute("title")).toBeNull();
    expect(screen.getByTestId("tab-live").getAttribute("title")).toBe("Arrives in Phase 3");
    expect(screen.getByTestId("tab-journal").getAttribute("title")).toBe("Arrives in Phase 4");
    expect(screen.getByTestId("chain-panel")).toBeTruthy();
    expect(screen.getByTestId("workspace").dataset["layout"]).toBe("split");
    for (const id of ["payoff", "scenarios", "greeks", "vol", "structure", "ladder"]) expect(screen.getByTestId(`analysis-tab-${id}`)).toBeTruthy();
    expect(screen.getByTestId("payoff-panel").dataset["state"]).toBe("empty");
    const u = userEvent.setup();
    await u.click(screen.getByTestId("tab-paper"));
    expect(useUiStore.getState().workspaceTab).toBe("paper");
    expect(screen.getByTestId("paper-panel")).toBeTruthy();
    await u.click(screen.getByTestId("tab-live"));
    expect(screen.getByTestId("placeholder-live").textContent).toContain("Live arrives in Phase 3");
    await u.click(screen.getByTestId("analysis-tab-scenarios"));
    expect(useUiStore.getState().analysisTab).toBe("scenarios");
    expect(screen.getByTestId("analysis-placeholder-scenarios").textContent).toContain("Scenarios arrives in Phase 5");
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

  it("WorkspaceLoader code-splits the workspace behind a spinner", async () => {
    renderWithProviders(<WorkspaceLoader />);
    await waitFor(() => expect(screen.getByTestId("workspace")).toBeTruthy());
  });
});
