// /payoff-preview page (HC-PB-042..051, 063, 064): presets, legend and layer toggles, zoom, SD header, sliders, summary.
import { act, fireEvent, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "../../../test/helpers";
import { PayoffPreview } from "./PayoffPreview";

beforeEach(() => {
  // jsdom has no canvas: a no-op 2D context lets the chart mount.
  HTMLCanvasElement.prototype.getContext = vi.fn(() => new Proxy({} as CanvasRenderingContext2D, { get: () => () => undefined, set: () => true })) as unknown as typeof HTMLCanvasElement.prototype.getContext;
});

describe("HC-PB-042..051 payoff preview", () => {
  it("renders the presets, SD header and summary for the iron condor, and switches presets with a reset", async () => {
    renderWithProviders(<PayoffPreview />);
    const u = userEvent.setup();
    const root = screen.getByTestId("payoff-preview");
    expect(screen.getAllByTestId("pp-preset")).toHaveLength(4);
    expect(root.dataset["preset"]).toBe("0");
    expect(root.dataset["day"]).toBe("15");
    expect(screen.getByTestId("pp-sd").textContent).toContain("Current$100kExpected move by target date (15d)");
    expect(screen.getByTestId("pp-summary").textContent).toContain("@ $100k (+0.0%)");
    expect(screen.getByTestId("pp-summary-expiry").textContent).toBe("+$1.2k");
    expect(screen.getByTestId("pp-pill").textContent).toBe("Profit: $1.2k");
    // zoom and target move, then a preset switch resets both
    await u.click(screen.getByTestId("pp-zoom-in"));
    await u.click(screen.getByTestId("pp-target-plus"));
    expect(root.dataset["zoom"]).toBe("125");
    expect(screen.getByTestId("pp-target-value").textContent).toBe("$100,500");
    await u.click(screen.getAllByTestId("pp-preset")[3]!);
    expect(root.dataset["preset"]).toBe("3");
    expect(root.dataset["zoom"]).toBe("100");
    expect(screen.getByTestId("pp-target-value").textContent).toBe("$78,000");
    expect(screen.getByTestId("pp-sd").textContent).toContain("Current$78.0k");
  });

  it("zooms in ×1.25 steps, resets on the label, and keeps the target inside the axis", async () => {
    renderWithProviders(<PayoffPreview />);
    const u = userEvent.setup();
    const root = screen.getByTestId("payoff-preview");
    fireEvent.change(screen.getByTestId("pp-target"), { target: { value: "117000" } });
    expect(screen.getByTestId("pp-target-pct").textContent).toBe("+17.0%");
    for (let i = 0; i < 6; i++) await u.click(screen.getByTestId("pp-zoom-in"));
    expect(root.dataset["zoom"]).toBe("381");
    expect(Number(screen.getByTestId("pp-target-value").textContent.replace(/[$,]/g, ""))).toBeLessThanOrEqual(104_800); // clamped to the narrower axis
    await u.click(screen.getByTestId("pp-zoom-out"));
    expect(root.dataset["zoom"]).toBe("305");
    await u.click(screen.getByTestId("pp-zoom-label"));
    expect(root.dataset["zoom"]).toBe("100");
    fireEvent.change(screen.getByTestId("pp-target"), { target: { value: "96000" } });
    await u.click(screen.getByTestId("pp-target-minus"));
    expect(screen.getByTestId("pp-target-value").textContent).toBe("$95,500");
    expect(screen.getByTestId("pp-target-pct").className).toContain("text-loss"); // below spot
  });

  it("legend items and the Layers popover toggle the same layers; the popover closes on an outside click", async () => {
    renderWithProviders(<PayoffPreview />);
    const u = userEvent.setup();
    const items = screen.getAllByTestId("pp-legend-item");
    expect(items).toHaveLength(6);
    await u.click(items[0]!); // On Expiry off
    expect(items[0]!.dataset["on"]).toBe("false");
    expect(items[0]!.className).toContain("line-through");
    await u.click(screen.getByTestId("pp-layers-button"));
    expect(screen.getByTestId("pp-layers")).toBeTruthy();
    expect(screen.getByTestId("pp-layer-expiry").getAttribute("aria-checked")).toBe("false");
    await u.click(screen.getByTestId("pp-layer-oi"));
    expect(screen.getAllByTestId("pp-legend-item")[4]!.dataset["on"]).toBe("false"); // Call OI follows
    await u.click(screen.getByTestId("pp-layer-expiry"));
    expect(screen.getAllByTestId("pp-legend-item")[0]!.dataset["on"]).toBe("true");
    act(() => {
      document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    });
    expect(screen.queryByTestId("pp-layers")).toBeNull();
  });

  it("the date slider moves the target-date curve: day 0 reads Today and SD bands switch to expiry; the summary follows", () => {
    renderWithProviders(<PayoffPreview />);
    const root = screen.getByTestId("payoff-preview");
    fireEvent.change(screen.getByTestId("pp-day"), { target: { value: "0" } });
    expect(root.dataset["day"]).toBe("0");
    expect(screen.getByTestId("pp-summary").textContent).toContain("Today:");
    expect(screen.getByTestId("pp-sd").textContent).toContain("Expected move by expiry (30d)");
    fireEvent.click(screen.getByTestId("pp-day-next"));
    fireEvent.click(screen.getByTestId("pp-day-next"));
    expect(root.dataset["day"]).toBe("2");
    expect(screen.getByTestId("pp-summary").textContent).toContain("2D:");
    fireEvent.click(screen.getByTestId("pp-day-prev"));
    expect(screen.getByTestId("pp-day-label").textContent).toMatch(/\d{2}:\d{2} [AP]M/);
    for (let i = 0; i < 40; i++) fireEvent.click(screen.getByTestId("pp-day-next"));
    expect(root.dataset["day"]).toBe("30"); // clamped to expiry
    // a short strangle at spot is a credit: the pill is Profit; a long call at spot at expiry loses the premium
    fireEvent.click(screen.getAllByTestId("pp-preset")[1]!);
    expect(screen.getByTestId("pp-pill").textContent).toBe("Loss: $1.5k");
    expect(screen.getByTestId("pp-summary-expiry").textContent).toBe("-$1.5k");
  });
});
