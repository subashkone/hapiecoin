// Product tour (HC-SH-064..076, 112): overlay steps, anchoring, tab switching, event-driven advance, keyboard,
// the once-only auto start after the flyer, and the menu/palette replay.
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installMockFetch, renderWithProviders, type MockFetch } from "../../../test/helpers";
import { pathnameMock } from "../../../test/next-mocks";
import { useUiStore } from "@/lib/store";
import { TOUR_DONE_KEY, TOUR_STEPS, emitTour } from "@/lib/tour";
import { Tour, TourOverlay } from "./Tour";

let mock: MockFetch;
const rect = (w: number, top = 100) => ({ width: w, height: 20, top, left: 50, right: 50 + w, bottom: top + 20, x: 50, y: top, toJSON: () => ({}) }) as DOMRect;
function anchors(...keys: string[]) {
  const root = document.createElement("div");
  for (const k of keys) {
    const el = document.createElement("button");
    el.dataset["tour"] = k;
    el.getBoundingClientRect = () => rect(120);
    root.appendChild(el);
  }
  document.body.appendChild(root);
  return root;
}
beforeEach(() => {
  mock = installMockFetch();
  useUiStore.setState({ workspaceTab: "chain", tourRequested: 0 });
});
afterEach(() => {
  mock.restore();
  document.body.innerHTML = "";
});

describe("HC-SH-064..075 TourOverlay", () => {
  it("walks the steps with Next/Previous, anchors to visible targets, switches tabs and finishes with Done", async () => {
    anchors("asset-select", "options-chain", "paper-tab");
    const onClose = vi.fn();
    renderWithProviders(<TourOverlay onClose={onClose} />);
    const u = userEvent.setup();
    const tour = screen.getByTestId("tour");
    expect(tour.dataset["step"]).toBe("1");
    expect(tour.dataset["anchored"]).toBe("false"); // welcome step is centred
    expect(screen.queryByTestId("tour-prev")).toBeNull();
    expect(screen.getByTestId("tour-next").textContent).toBe("Start");
    expect(screen.getByTestId("tour-progress").textContent).toBe(`1 / ${TOUR_STEPS.length}`);
    await u.click(screen.getByTestId("tour-next"));
    expect(tour.dataset["step"]).toBe("2");
    expect(tour.dataset["target"]).toBe("asset-select");
    await waitFor(() => expect(tour.dataset["anchored"]).toBe("true"));
    expect(screen.getByTestId("tour-ring")).toBeTruthy();
    await u.click(screen.getByTestId("tour-prev"));
    expect(tour.dataset["step"]).toBe("1");
    fireEvent.keyDown(document, { key: "ArrowRight" });
    fireEvent.keyDown(document, { key: "ArrowRight" });
    expect(tour.dataset["step"]).toBe("3");
    expect(useUiStore.getState().workspaceTab).toBe("chain");
    fireEvent.keyDown(document, { key: "ArrowLeft" });
    expect(tour.dataset["step"]).toBe("2");
    // jump to the paper steps: the tab follows
    for (let i = 0; i < 9; i++) fireEvent.keyDown(document, { key: "ArrowRight" });
    expect(tour.dataset["step"]).toBe("11");
    expect(useUiStore.getState().workspaceTab).toBe("paper");
    for (let i = 0; i < 5; i++) fireEvent.keyDown(document, { key: "ArrowRight" });
    expect(tour.dataset["step"]).toBe("16");
    expect(screen.getByTestId("tour-next").textContent).toBe("Done");
    await u.click(screen.getByTestId("tour-next"));
    expect(onClose).toHaveBeenCalledWith(true);
  });

  it("advances on app events for the do-it steps and closes on Escape or ✕ without completing", async () => {
    const onClose = vi.fn();
    renderWithProviders(<TourOverlay onClose={onClose} />);
    const tour = screen.getByTestId("tour");
    for (let i = 0; i < 3; i++) fireEvent.keyDown(document, { key: "ArrowRight" });
    expect(tour.dataset["step"]).toBe("4"); // add a leg
    act(() => emitTour("paper-started")); // wrong event: ignored
    expect(tour.dataset["step"]).toBe("4");
    act(() => emitTour("leg-added"));
    expect(tour.dataset["step"]).toBe("5");
    expect(useUiStore.getState().workspaceTab).toBe("builder");
    fireEvent.keyDown(document, { key: "ArrowRight" });
    fireEvent.keyDown(document, { key: "ArrowRight" });
    expect(tour.dataset["step"]).toBe("7"); // click Paper Trade
    act(() => emitTour("trade-mode-open"));
    expect(tour.dataset["step"]).toBe("8"); // paper or live
    act(() => emitTour("trade-preview-open"));
    expect(tour.dataset["step"]).toBe("9"); // review and start
    act(() => emitTour("paper-started")); // a named strategy skips the name dialog
    expect(tour.dataset["step"]).toBe("11");
    fireEvent.keyDown(document, { key: "ArrowLeft" });
    fireEvent.keyDown(document, { key: "ArrowLeft" });
    act(() => emitTour("save-dialog-open"));
    expect(tour.dataset["step"]).toBe("10"); // name your strategy
    act(() => emitTour("paper-started"));
    expect(tour.dataset["step"]).toBe("11");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledWith(false);
    await userEvent.setup().click(screen.getByTestId("tour-close"));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("places the popover below, above or beside the anchor and re-places on resize", async () => {
    const root = anchors("asset-select");
    const el = root.firstElementChild as HTMLElement;
    renderWithProviders(<TourOverlay onClose={vi.fn()} />);
    fireEvent.keyDown(document, { key: "ArrowRight" });
    const pop = screen.getByTestId("tour-popover");
    await waitFor(() => expect(pop.style.top).toBe("134px")); // below: 100 + 20 + 14
    el.getBoundingClientRect = () => rect(120, window.innerHeight - 30); // no room below → above
    act(() => { window.dispatchEvent(new Event("resize")); });
    await waitFor(() => expect(Number.parseFloat(pop.style.top)).toBeLessThan(window.innerHeight - 30));
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 120 });
    el.getBoundingClientRect = () => rect(120, 50); // no room above or below → beside
    act(() => { window.dispatchEvent(new Event("resize")); });
    await waitFor(() => expect(Number.parseFloat(pop.style.left)).toBeGreaterThanOrEqual(8));
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 768 });
  });
});

describe("HC-SH-076 / HC-SH-112 Tour mount", () => {
  it("starts once on /analyse after the flyer closes, remembers it, and replays on request", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mock.loginAs("trader@example.com");
    pathnameMock.value = "/analyse";
    const flyer = document.createElement("div");
    flyer.dataset["testid"] = "flyer";
    document.body.appendChild(flyer);
    renderWithProviders(<Tour />);
    await act(async () => { await vi.advanceTimersByTimeAsync(1500); });
    expect(screen.queryByTestId("tour")).toBeNull(); // flyer still open
    flyer.remove();
    await act(async () => { await vi.advanceTimersByTimeAsync(700); });
    expect(screen.getByTestId("tour")).toBeTruthy();
    expect(localStorage.getItem(TOUR_DONE_KEY)).toBe("done");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByTestId("tour")).toBeNull();
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(screen.queryByTestId("tour")).toBeNull(); // once only
    act(() => useUiStore.getState().requestTour());
    expect(screen.getByTestId("tour")).toBeTruthy();
    for (let i = 0; i < TOUR_STEPS.length; i++) fireEvent.keyDown(document, { key: "ArrowRight" });
    expect(screen.queryByTestId("tour")).toBeNull();
    await waitFor(() => expect(screen.getAllByText("Tour complete").length).toBeGreaterThan(0));
    vi.useRealTimers();
  });

  it("does not start when signed out, already done, or off /analyse; a request off /analyse is ignored", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    pathnameMock.value = "/analyse";
    const r = renderWithProviders(<Tour />);
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(screen.queryByTestId("tour")).toBeNull(); // visitor
    r.unmount();
    mock.loginAs("trader@example.com");
    localStorage.setItem(TOUR_DONE_KEY, "done");
    const r2 = renderWithProviders(<Tour />);
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(screen.queryByTestId("tour")).toBeNull(); // done before
    r2.unmount();
    localStorage.clear();
    pathnameMock.value = "/subscription";
    renderWithProviders(<Tour />);
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(screen.queryByTestId("tour")).toBeNull();
    act(() => useUiStore.getState().requestTour());
    expect(screen.queryByTestId("tour")).toBeNull();
    vi.useRealTimers();
  });
});
