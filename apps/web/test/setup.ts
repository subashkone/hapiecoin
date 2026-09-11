// Vitest setup: RTL cleanup plus the browser APIs jsdom lacks (matchMedia, ResizeObserver, pointer capture,
// clipboard, requestAnimationFrame) that Radix, sonner and the gateway hooks need.
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";
import { navigationModule, resetNextMocks } from "./next-mocks";

vi.mock("next/navigation", () => navigationModule);

// sonner's deleteToast schedules a 200 ms removeToast after a toast closes and never clears it, so a toast that
// closes late in a file's last test fires a state update after jsdom is torn down ("window is not defined", an
// unhandled error that fails the whole run on the slower CI runner; GAPS #80). Real timers still pending when a
// test ends are cleared here; fake-timer tests are untouched because vi.useFakeTimers swaps these globals.
const pendingTimers = new Set<ReturnType<typeof setTimeout>>();
const realSetTimeout = globalThis.setTimeout;
const realClearTimeout = globalThis.clearTimeout;
const trackingSetTimeout = ((handler: (...a: unknown[]) => void, ms?: number, ...args: unknown[]) => {
  const id = realSetTimeout(() => {
    pendingTimers.delete(id);
    handler(...args);
  }, ms);
  pendingTimers.add(id);
  return id;
}) as typeof setTimeout;
trackingSetTimeout.__promisify__ = realSetTimeout.__promisify__;
globalThis.setTimeout = trackingSetTimeout;
globalThis.clearTimeout = (id: Parameters<typeof clearTimeout>[0]) => {
  if (id !== undefined && typeof id !== "string" && typeof id !== "number") pendingTimers.delete(id);
  realClearTimeout(id);
};

afterEach(() => {
  cleanup();
  for (const id of pendingTimers) realClearTimeout(id);
  pendingTimers.clear();
  resetNextMocks();
  window.localStorage.clear();
  window.sessionStorage.clear();
  document.documentElement.className = "";
  document.documentElement.removeAttribute("data-density");
  document.documentElement.removeAttribute("data-theme");
  document.documentElement.removeAttribute("style");
});

type MqlListener = (ev: MediaQueryListEvent) => void;
const mqlListeners = new Set<MqlListener>();
Object.defineProperty(window, "matchMedia", {
  writable: true,
  configurable: true,
  value: (query: string): MediaQueryList =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: (_: string, l: MqlListener) => mqlListeners.add(l),
      removeEventListener: (_: string, l: MqlListener) => mqlListeners.delete(l),
      addListener: (l: MqlListener) => mqlListeners.add(l),
      removeListener: (l: MqlListener) => mqlListeners.delete(l),
      dispatchEvent: () => false,
    }) as unknown as MediaQueryList,
});

class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
vi.stubGlobal("ResizeObserver", ResizeObserverStub);
Element.prototype.scrollIntoView = vi.fn();
Element.prototype.hasPointerCapture = vi.fn(() => false);
Element.prototype.setPointerCapture = vi.fn();
Element.prototype.releasePointerCapture = vi.fn();

if (!("clipboard" in navigator)) {
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: vi.fn(() => Promise.resolve()) },
  });
}

// jsdom has no layout: TanStack Virtual measures the viewport through offsetWidth/offsetHeight, which jsdom
// reports as 0 and would leave the chain empty. Give elements a plausible box from their inline style.
for (const [prop, fallback] of [["offsetHeight", 520], ["offsetWidth", 1200]] as const) {
  Object.defineProperty(HTMLElement.prototype, prop, {
    configurable: true,
    get(this: HTMLElement) {
      const inline = this.style[prop === "offsetHeight" ? "height" : "width"];
      const n = inline ? Number.parseFloat(inline) : Number.NaN;
      return Number.isFinite(n) ? n : fallback;
    },
  });
}
