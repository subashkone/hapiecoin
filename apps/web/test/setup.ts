// Vitest setup: RTL cleanup plus the browser APIs jsdom lacks (matchMedia, ResizeObserver, pointer capture,
// clipboard, requestAnimationFrame) that Radix, sonner and the gateway hooks need.
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";
import { navigationModule, resetNextMocks } from "./next-mocks";

vi.mock("next/navigation", () => navigationModule);

afterEach(() => {
  cleanup();
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
