import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { mockSystemDark } from "../test/setup";
import {
  THEME_STORAGE_KEY,
  ThemeProvider,
  applyTheme,
  themeInitScript,
  useOptionalTheme,
  useTheme,
} from "./ThemeProvider";

function Probe() {
  const { theme, resolvedTheme, setTheme, toggleTheme } = useTheme();
  return (
    <div>
      <output data-testid="theme">{theme}</output>
      <output data-testid="resolved">{resolvedTheme}</output>
      <button type="button" onClick={toggleTheme}>
        toggle
      </button>
      <button type="button" onClick={() => setTheme("system")}>
        system
      </button>
      <button type="button" onClick={() => setTheme("dark")}>
        dark
      </button>
    </div>
  );
}

const html = () => document.documentElement;

describe("HC-SH-011 ThemeProvider toggles the dark class and persists", () => {
  it("HC-SH-011 defaults to system (light here), toggles to dark, sets class + data-theme + color-scheme, persists", async () => {
    const user = userEvent.setup();
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    expect(screen.getByTestId("theme").textContent).toBe("system");
    expect(screen.getByTestId("resolved").textContent).toBe("light");
    expect(html().classList.contains("light")).toBe(true);
    expect(html().classList.contains("dark")).toBe(false);

    await user.click(screen.getByRole("button", { name: "toggle" }));
    expect(screen.getByTestId("theme").textContent).toBe("dark");
    expect(html().classList.contains("dark")).toBe(true);
    expect(html().classList.contains("light")).toBe(false);
    expect(html().dataset["theme"]).toBe("dark");
    expect(html().style.colorScheme).toBe("dark");
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");

    await user.click(screen.getByRole("button", { name: "toggle" }));
    expect(html().classList.contains("light")).toBe(true);
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");
  });

  it("HC-SH-011 restores the stored theme on mount (custom storage key)", () => {
    window.localStorage.setItem("k", "dark");
    render(
      <ThemeProvider storageKey="k">
        <Probe />
      </ThemeProvider>,
    );
    expect(screen.getByTestId("resolved").textContent).toBe("dark");
    expect(html().classList.contains("dark")).toBe(true);
  });

  it("HC-PB-022 ignores garbage in storage and follows the OS while in system mode", async () => {
    const user = userEvent.setup();
    window.localStorage.setItem(THEME_STORAGE_KEY, "purple");
    mockSystemDark(true);
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    expect(screen.getByTestId("theme").textContent).toBe("system");
    expect(screen.getByTestId("resolved").textContent).toBe("dark");
    act(() => mockSystemDark(false));
    expect(screen.getByTestId("resolved").textContent).toBe("light");
    expect(html().classList.contains("light")).toBe(true);

    await user.click(screen.getByRole("button", { name: "dark" }));
    act(() => mockSystemDark(true));
    act(() => mockSystemDark(false));
    expect(screen.getByTestId("resolved").textContent).toBe("dark");
    await user.click(screen.getByRole("button", { name: "system" }));
    expect(screen.getByTestId("resolved").textContent).toBe("light");
    mockSystemDark(false);
  });

  it("HC-SH-011 keeps working when localStorage throws", async () => {
    const user = userEvent.setup();
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    const getItem = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    try {
      render(
        <ThemeProvider defaultTheme="dark">
          <Probe />
        </ThemeProvider>,
      );
      expect(screen.getByTestId("resolved").textContent).toBe("dark");
      await user.click(screen.getByRole("button", { name: "toggle" }));
      expect(screen.getByTestId("resolved").textContent).toBe("light");
    } finally {
      setItem.mockRestore();
      getItem.mockRestore();
    }
  });

  it("HC-SH-011 useTheme throws outside a provider; useOptionalTheme returns null", () => {
    function Bad() {
      useTheme();
      return null;
    }
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(() => render(<Bad />)).toThrow(/inside <ThemeProvider>/);
    err.mockRestore();

    function Opt() {
      return <output>{useOptionalTheme() === null ? "null" : "provided"}</output>;
    }
    render(<Opt />);
    expect(screen.getByRole("status").textContent).toBe("null");
  });

  it("HC-SH-011 applyTheme and themeInitScript set the same class before hydration", () => {
    const root = document.createElement("div");
    applyTheme("dark", root);
    expect(root.className).toBe("dark");
    expect(root.dataset["theme"]).toBe("dark");
    applyTheme("light", root);
    expect(root.className).toBe("light");

    window.localStorage.setItem("init-key", "dark");
    const script = themeInitScript("init-key");
    expect(script).toContain('"init-key"');
    expect(script).not.toContain("\n");
    /* eslint-disable @typescript-eslint/no-implied-eval, @typescript-eslint/no-unsafe-call -- this test executes the inline <head> boot script exactly as a browser would */
    new Function(script)();
    expect(html().classList.contains("dark")).toBe(true);
    window.localStorage.removeItem("init-key");
    // system fallback with no stored value and a light OS
    new Function(themeInitScript("init-key", "system"))();
    /* eslint-enable @typescript-eslint/no-implied-eval, @typescript-eslint/no-unsafe-call */
    expect(html().classList.contains("light")).toBe(true);
  });
});
