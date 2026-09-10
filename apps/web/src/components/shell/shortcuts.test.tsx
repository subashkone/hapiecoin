// Global shortcuts dispatcher and the ? help (ADR-053; HC-SH-101..104).
import { act, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installMockFetch, renderWithProviders, type MockFetch } from "../../../test/helpers";
import { registerShortcut, resetShortcuts } from "@/lib/shortcuts";
import { useUiStore } from "@/lib/store";
import { ShortcutsDialog } from "@/components/dialogs/ShortcutsDialog";
import { ShortcutsDispatcher } from "./ShortcutsDispatcher";

function Harness() {
  const dialog = useUiStore((s) => s.dialog);
  const close = useUiStore((s) => s.closeDialog);
  return (
    <>
      <ShortcutsDispatcher />
      <input aria-label="Field" />
      <ShortcutsDialog open={dialog === "shortcuts"} onOpenChange={(o) => !o && close()} />
    </>
  );
}

let mock: MockFetch;
beforeEach(() => {
  mock = installMockFetch();
  useUiStore.setState({ dialog: null, paletteOpen: false, tradeFlow: null, detailsId: null, dialogsTouched: false });
  document.documentElement.classList.remove("light", "compact");
});
afterEach(() => {
  mock.restore();
  resetShortcuts();
});

describe("HC-SH-101..104 shortcuts", () => {
  it("? opens the help with the grouped rows; T and D toggle theme and density; fields and open dialogs are ignored", () => {
    renderWithProviders(<Harness />);
    fireEvent.keyDown(window, { key: "t" });
    expect(document.documentElement.classList.contains("light")).toBe(true);
    fireEvent.keyDown(window, { key: "d" });
    expect(document.documentElement.classList.contains("compact")).toBe(true);
    // typing in a field never triggers
    fireEvent.keyDown(screen.getByLabelText("Field"), { key: "t" });
    expect(document.documentElement.classList.contains("light")).toBe(true);
    // modifiers never trigger
    fireEvent.keyDown(window, { key: "t", ctrlKey: true });
    expect(document.documentElement.classList.contains("light")).toBe(true);
    // ? opens the help (HC-SH-102) with the Global and Analyse workspace groups (HC-SH-103, HC-WS-070)
    fireEvent.keyDown(window, { key: "?", shiftKey: true });
    expect(useUiStore.getState().dialog).toBe("shortcuts");
    const dialog = screen.getByTestId("shortcuts-dialog");
    expect(within(dialog).getAllByTestId("shortcuts-group").map((g) => g.dataset["group"])).toEqual(["Global", "Analyse workspace"]);
    expect(within(dialog).getByText("Toggle theme (dark / light)")).toBeTruthy();
    expect(within(dialog).getByText("Buy put at the highlighted strike")).toBeTruthy();
    // while the dialog is open, T is ignored
    fireEvent.keyDown(window, { key: "t" });
    expect(document.documentElement.classList.contains("light")).toBe(true);
    act(() => useUiStore.getState().closeDialog());
    fireEvent.keyDown(window, { key: "t" });
    expect(document.documentElement.classList.contains("light")).toBe(false);
  });

  it("HC-SH-104 registered shortcuts run and show in the help; `always` ones run even while typing", () => {
    renderWithProviders(<Harness />);
    const x = vi.fn();
    const y = vi.fn();
    const off = registerShortcut("X", "Do the X thing", x, { group: "Journal" });
    registerShortcut("Shift+Y", "Do Y anywhere", y, { always: true });
    fireEvent.keyDown(window, { key: "x" });
    expect(x).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(screen.getByLabelText("Field"), { key: "x" });
    expect(x).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(screen.getByLabelText("Field"), { key: "Y", shiftKey: true });
    expect(y).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(window, { key: "?", shiftKey: true });
    const dialog = screen.getByTestId("shortcuts-dialog");
    expect(within(dialog).getAllByTestId("shortcuts-group").map((g) => g.dataset["group"])).toEqual(["Global", "Analyse workspace", "Journal"]);
    expect(within(dialog).getByText("Do the X thing")).toBeTruthy();
    act(() => off());
    expect(within(dialog).queryByText("Do the X thing")).toBeNull();
  });
});
