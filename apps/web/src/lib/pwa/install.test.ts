// HC-SH-134 install state (ADR-082)
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  INSTALL_HINT_KEY,
  bindInstall,
  getInstallState,
  installHintSeen,
  isIos,
  isStandalone,
  markInstallHintSeen,
  promptInstall,
  resetInstallForTests,
  useInstallState,
} from "./install";

function fakePrompt(outcome: "accepted" | "dismissed") {
  const e = new Event("beforeinstallprompt", { cancelable: true }) as Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };
  e.prompt = vi.fn(() => Promise.resolve());
  e.userChoice = Promise.resolve({ outcome });
  return e;
}

describe("HC-SH-134 install state (ADR-082)", () => {
  afterEach(() => {
    resetInstallForTests();
    localStorage.removeItem(INSTALL_HINT_KEY);
  });

  it("HC-SH-134 starts unsupported, becomes ready on beforeinstallprompt (kept, default prevented) and installed after appinstalled", () => {
    const { result } = renderHook(() => useInstallState());
    expect(result.current).toBe("unsupported");
    const unbind = bindInstall(window);
    const e = fakePrompt("dismissed");
    act(() => {
      window.dispatchEvent(e);
    });
    expect(e.defaultPrevented).toBe(true);
    expect(result.current).toBe("ready");
    act(() => {
      window.dispatchEvent(new Event("appinstalled"));
    });
    expect(result.current).toBe("installed");
    unbind();
    act(() => {
      window.dispatchEvent(fakePrompt("accepted"));
    });
    expect(getInstallState()).toBe("installed"); // detached: the late event changes nothing
  });

  it("HC-SH-134 promptInstall shows the deferred prompt once: accepted flips to installed, dismissed keeps it ready, none is unavailable", async () => {
    expect(await promptInstall()).toBe("unavailable");
    const unbind = bindInstall(window);
    const dismissed = fakePrompt("dismissed");
    act(() => {
      window.dispatchEvent(dismissed);
    });
    expect(await promptInstall()).toBe("dismissed");
    expect(dismissed.prompt).toHaveBeenCalledTimes(1);
    expect(getInstallState()).toBe("ready");
    const accepted = fakePrompt("accepted");
    act(() => {
      window.dispatchEvent(accepted);
    });
    expect(await promptInstall()).toBe("accepted");
    expect(getInstallState()).toBe("installed");
    expect(await promptInstall()).toBe("unavailable"); // consumed
    unbind();
  });

  it("HC-SH-134 an iPhone reports ios, an installed app reports installed, and the hint is remembered per browser", () => {
    const ua = vi.spyOn(window.navigator, "userAgent", "get").mockReturnValue("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1");
    expect(isIos(window.navigator)).toBe(true);
    const unbind = bindInstall(window);
    expect(getInstallState()).toBe("ios");
    unbind();
    ua.mockReturnValue("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Safari/605.1.15");
    const setTouch = (n: number) => Object.defineProperty(window.navigator, "maxTouchPoints", { value: n, configurable: true }); // jsdom has no maxTouchPoints
    setTouch(5);
    expect(isIos(window.navigator)).toBe(true); // iPadOS masquerading as a Mac
    setTouch(0);
    expect(isIos(window.navigator)).toBe(false);
    ua.mockRestore();
    expect(isStandalone(window)).toBe(false);
    const mm = vi.spyOn(window, "matchMedia").mockImplementation((q: string) => ({ matches: q === "(display-mode: standalone)", media: q, onchange: null, addEventListener: () => undefined, removeEventListener: () => undefined, addListener: () => undefined, removeListener: () => undefined, dispatchEvent: () => false }));
    expect(isStandalone(window)).toBe(true);
    resetInstallForTests();
    const unbind2 = bindInstall(window);
    expect(getInstallState()).toBe("installed");
    unbind2();
    mm.mockRestore();
    expect(installHintSeen(localStorage)).toBe(false);
    markInstallHintSeen(localStorage);
    expect(installHintSeen(localStorage)).toBe(true);
  });
});
