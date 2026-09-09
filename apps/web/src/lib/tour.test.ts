// Tour data and helpers (HC-SH-064..076): step shape, events, anchor lookup with the visible fallback, done flag.
import { describe, expect, it, vi } from "vitest";
import { TOUR_DONE_KEY, TOUR_STEPS, emitTour, findTourTarget, markTourDone, onTourEvent, tourDone } from "./tour";

describe("tour steps", () => {
  it("has 16 steps that walk from the asset picker to the command palette, each with a title and copy", () => {
    expect(TOUR_STEPS).toHaveLength(16);
    expect(TOUR_STEPS[0]?.target).toBeUndefined();
    expect(TOUR_STEPS[1]?.target).toBe("asset-select");
    expect(TOUR_STEPS.at(-1)?.target).toBe("command-palette");
    for (const s of TOUR_STEPS) {
      expect(s.title.length).toBeGreaterThan(3);
      expect(s.desc.length).toBeGreaterThan(20);
      expect(s.desc).not.toMatch(/coin\s?greeks/i);
    }
    expect(TOUR_STEPS.filter((s) => s.waitFor).map((s) => Object.keys(s.waitFor!))).toEqual([["leg-added"], ["trade-mode-open"], ["trade-preview-open"], ["save-dialog-open", "paper-started"], ["paper-started"]]);
  });

  it("emits and listens to app events, and unsubscribes", () => {
    const h = vi.fn();
    const off = onTourEvent("leg-added", h);
    emitTour("leg-added");
    emitTour("paper-started");
    expect(h).toHaveBeenCalledTimes(1);
    off();
    emitTour("leg-added");
    expect(h).toHaveBeenCalledTimes(1);
  });

  it("finds the first visible anchor, falls back to alt, and returns null for centred steps", () => {
    document.body.innerHTML = `<button data-tour="a"></button><button data-tour="a"></button><div data-tour="b"></div>`;
    const els = document.querySelectorAll<HTMLElement>("[data-tour]");
    const rect = (w: number) => ({ width: w, height: w, top: 0, left: 0, right: w, bottom: w, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
    els[0]!.getBoundingClientRect = () => rect(0);
    els[1]!.getBoundingClientRect = () => rect(10);
    els[2]!.getBoundingClientRect = () => rect(10);
    expect(findTourTarget({ title: "", desc: "", target: "a" })).toBe(els[1]);
    expect(findTourTarget({ title: "", desc: "", target: "zzz", alt: "b" })).toBe(els[2]);
    expect(findTourTarget({ title: "", desc: "", target: "zzz" })).toBeNull();
    expect(findTourTarget({ title: "", desc: "" })).toBeNull();
    document.body.innerHTML = "";
  });

  it("remembers that the tour ran in its own storage key", () => {
    expect(tourDone()).toBe(false);
    markTourDone();
    expect(localStorage.getItem(TOUR_DONE_KEY)).toBe("done");
    expect(tourDone()).toBe(true);
    const getItem = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
    expect(tourDone()).toBe(true); // no storage → never auto-start
    expect(() => markTourDone()).not.toThrow();
    getItem.mockRestore();
    setItem.mockRestore();
  });
});
