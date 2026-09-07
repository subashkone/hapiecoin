import { screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeSocket, renderWithProviders } from "../../../test/helpers";
import { Workspace } from "./Workspace";
import { WorkspaceLoader } from "./WorkspaceLoader";

beforeEach(() => {
  FakeSocket.reset();
  vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("no gateway http"))));
});
afterEach(() => vi.unstubAllGlobals());

describe("[WORKSPACE] two-pane shell", () => {
  it("has Chain enabled, the other tabs disabled, and the Phase 2 right pane", () => {
    renderWithProviders(<Workspace />);
    expect(screen.getByTestId("tab-chain").hasAttribute("disabled")).toBe(false);
    for (const id of ["builder", "paper", "live", "journal"]) {
      expect(screen.getByTestId(`tab-${id}`).hasAttribute("disabled")).toBe(true);
      expect(screen.getByTestId(`tab-${id}`).getAttribute("title")).toBe("Arrives in Phase 2");
    }
    expect(screen.getByText("Payoff arrives in Phase 2")).toBeTruthy();
    expect(screen.getByTestId("chain-panel")).toBeTruthy();
  });
  it("WorkspaceLoader code-splits the workspace behind a spinner", async () => {
    renderWithProviders(<WorkspaceLoader />);
    await waitFor(() => expect(screen.getByTestId("workspace")).toBeTruthy());
  });
});
