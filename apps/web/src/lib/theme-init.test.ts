import { THEME_STORAGE_KEY as UI_KEY, themeInitScript } from "@hapiecoin/ui";
import { describe, expect, it } from "vitest";
import { THEME_INIT_SCRIPT, THEME_STORAGE_KEY } from "./theme-init";

describe("HC-SH-011 theme init script", () => {
  it("is byte-identical to @hapiecoin/ui themeInitScript(key, 'dark') so the two cannot drift", () => {
    expect(THEME_STORAGE_KEY).toBe(UI_KEY);
    expect(THEME_INIT_SCRIPT).toBe(themeInitScript(UI_KEY, "dark"));
  });
  it("defaults to dark (ADR-003) and honours an explicit stored light theme", () => {
    expect(THEME_INIT_SCRIPT).toContain('d="dark"');
    expect(THEME_INIT_SCRIPT).toContain('localStorage.getItem(k)');
    expect(THEME_INIT_SCRIPT).toContain("prefers-color-scheme: dark");
  });
});
