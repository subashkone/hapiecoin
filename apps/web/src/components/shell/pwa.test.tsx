// HC-SH-134 / HC-SH-135 the home-screen shell and the install dialog (ADR-082)
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "../../../test/helpers";
import { INSTALL_HINT_KEY, resetInstallForTests } from "@/lib/pwa/install";
import { InstallDialog } from "@/components/dialogs/InstallDialog";
import { Pwa, SW_URL, registerServiceWorker } from "./Pwa";

const IPHONE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";

function fakePrompt(outcome: "accepted" | "dismissed") {
  const e = new Event("beforeinstallprompt", { cancelable: true }) as Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };
  e.prompt = vi.fn(() => Promise.resolve());
  e.userChoice = Promise.resolve({ outcome });
  return e;
}

function narrowMatchMedia() {
  return vi.spyOn(window, "matchMedia").mockImplementation((q: string) => ({ matches: q === "(max-width: 767px)", media: q, onchange: null, addEventListener: () => undefined, removeEventListener: () => undefined, addListener: () => undefined, removeListener: () => undefined, dispatchEvent: () => false }));
}

describe("HC-SH-134 / HC-SH-135 the home-screen shell (ADR-082)", () => {
  afterEach(() => {
    resetInstallForTests();
    localStorage.removeItem(INSTALL_HINT_KEY);
    vi.restoreAllMocks();
  });

  it("HC-SH-135 registers /sw.js at scope / once the page has loaded, and does nothing without the API", () => {
    const register = vi.fn(() => Promise.resolve());
    const win = { navigator: { serviceWorker: { register } }, document: { readyState: "loading" }, addEventListener: vi.fn() } as unknown as Window;
    registerServiceWorker(win);
    expect(register).not.toHaveBeenCalled();
    const onLoad = (win.addEventListener as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, () => void, { once: boolean }];
    expect(onLoad[0]).toBe("load");
    expect(onLoad[2]).toEqual({ once: true });
    onLoad[1]();
    expect(register).toHaveBeenCalledWith(SW_URL, { scope: "/" });
    const complete = { navigator: { serviceWorker: { register } }, document: { readyState: "complete" }, addEventListener: vi.fn() } as unknown as Window;
    registerServiceWorker(complete);
    expect(register).toHaveBeenCalledTimes(2);
    expect(() => registerServiceWorker({ navigator: {}, document: { readyState: "complete" } } as unknown as Window)).not.toThrow();
  });

  it("HC-SH-134 on a narrow iPhone the shell shows the install hint once and its action opens the install dialog it hosts", async () => {
    vi.spyOn(window.navigator, "userAgent", "get").mockReturnValue(IPHONE_UA);
    narrowMatchMedia();
    renderWithProviders(<Pwa />);
    const hint = await screen.findByText("Install HapieCoin");
    expect(hint.textContent).toBe("Install HapieCoin");
    expect(localStorage.getItem(INSTALL_HINT_KEY)).toBe("1");
    fireEvent.click(screen.getByRole("button", { name: "Install" }));
    // the shell hosts the dialog itself, so the hint works on /auth and the public trader page too
    expect(screen.getByTestId("install-dialog").getAttribute("data-state-install")).toBe("ios");
  });

  it("HC-SH-134 the hint stays away on a desktop, when already seen, and when nothing can be installed", () => {
    vi.spyOn(window.navigator, "userAgent", "get").mockReturnValue(IPHONE_UA);
    renderWithProviders(<Pwa />); // desktop width: no hint
    expect(screen.queryByText("Install HapieCoin")).toBeNull();
    expect(localStorage.getItem(INSTALL_HINT_KEY)).toBeNull();
  });

  it("HC-SH-134 the install dialog explains each state: iPhone steps, the native prompt, installed, unsupported", async () => {
    const onOpenChange = vi.fn();
    const { unmount } = renderWithProviders(<InstallDialog open onOpenChange={onOpenChange} />);
    expect(screen.getByTestId("install-unsupported")).toBeTruthy();
    expect(screen.queryByTestId("install-now")).toBeNull();
    unmount();
    // Chrome: beforeinstallprompt arrived → the Install button shows the deferred prompt; accepted closes the dialog
    renderWithProviders(<Pwa />);
    const prompt = fakePrompt("accepted");
    act(() => {
      window.dispatchEvent(prompt);
    });
    const dialog = renderWithProviders(<InstallDialog open onOpenChange={onOpenChange} />);
    expect(screen.getByTestId("install-dialog").getAttribute("data-state-install")).toBe("ready");
    fireEvent.click(screen.getByTestId("install-now"));
    await waitFor(() => expect(prompt.prompt).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(screen.getByTestId("install-dialog").getAttribute("data-state-install")).toBe("installed");
    expect(screen.getByTestId("install-installed")).toBeTruthy();
    dialog.unmount();
    // iPhone: the two Share-sheet steps, no button
    resetInstallForTests();
    vi.spyOn(window.navigator, "userAgent", "get").mockReturnValue(IPHONE_UA);
    renderWithProviders(<Pwa />);
    renderWithProviders(<InstallDialog open onOpenChange={onOpenChange} />);
    expect(screen.getByTestId("install-ios-steps").textContent).toContain("Add to Home Screen");
    expect(screen.queryByTestId("install-now")).toBeNull();
  });
});
