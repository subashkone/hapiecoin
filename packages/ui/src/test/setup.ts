// Vitest setup: RTL cleanup and the browser APIs jsdom lacks but Radix/sonner need.
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  document.documentElement.className = "";
  document.documentElement.removeAttribute("data-density");
  document.documentElement.removeAttribute("data-theme");
  document.documentElement.removeAttribute("style");
});

// matchMedia: default "light" system preference; tests override via `mockSystemDark()`.
type MqlListener = (ev: MediaQueryListEvent) => void;
const mqlListeners = new Set<MqlListener>();
let systemDark = false;

export function mockSystemDark(dark: boolean): void {
  systemDark = dark;
  for (const l of mqlListeners) l({ matches: dark } as MediaQueryListEvent);
}

Object.defineProperty(window, "matchMedia", {
  writable: true,
  configurable: true,
  value: (query: string): MediaQueryList => {
    const isDarkQuery = query.includes("prefers-color-scheme: dark");
    return {
      matches: isDarkQuery ? systemDark : false,
      media: query,
      onchange: null,
      addEventListener: (_: string, l: MqlListener) => mqlListeners.add(l),
      removeEventListener: (_: string, l: MqlListener) => mqlListeners.delete(l),
      addListener: (l: MqlListener) => mqlListeners.add(l),
      removeListener: (l: MqlListener) => mqlListeners.delete(l),
      dispatchEvent: () => false,
    } as unknown as MediaQueryList;
  },
});

// Radix Select / Popper / Tooltip
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
