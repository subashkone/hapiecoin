// Theme switching (HC-SH-011, HC-PB-003, HC-PB-022): sets `dark` / `light` on <html>, persists the choice,
// follows the OS when set to "system". tokens.css also honours prefers-color-scheme before hydration.
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

export type Theme = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

export interface ThemeContextValue {
  /** The stored preference. */
  theme: Theme;
  /** What is actually applied. */
  resolvedTheme: ResolvedTheme;
  setTheme: (theme: Theme) => void;
  /** Flip between light and dark (explicit; leaves "system"). */
  toggleTheme: () => void;
}

export const THEME_STORAGE_KEY = "hapiecoin.theme";
const MEDIA = "(prefers-color-scheme: dark)";

const ThemeContext = createContext<ThemeContextValue | null>(null);

function isTheme(v: unknown): v is Theme {
  return v === "light" || v === "dark" || v === "system";
}

function readStored(key: string): Theme | null {
  try {
    const v = window.localStorage.getItem(key);
    return isTheme(v) ? v : null;
  } catch {
    return null;
  }
}

function systemTheme(): ResolvedTheme {
  return typeof window !== "undefined" && window.matchMedia(MEDIA).matches ? "dark" : "light";
}

/** Apply a resolved theme to the document root. Exported for tests and for non-React callers. */
export function applyTheme(resolved: ResolvedTheme, root: HTMLElement = document.documentElement): void {
  root.classList.remove("light", "dark");
  root.classList.add(resolved);
  root.dataset["theme"] = resolved;
  root.style.colorScheme = resolved;
}

/**
 * Inline script for the document <head> so the first paint already has the right class (no flash).
 * Usage (Next.js): `<script dangerouslySetInnerHTML={{ __html: themeInitScript() }} />`.
 */
export function themeInitScript(
  storageKey: string = THEME_STORAGE_KEY,
  defaultTheme: Theme = "system",
): string {
  return (
    `(function(){try{var k=${JSON.stringify(storageKey)},d=${JSON.stringify(defaultTheme)},t=localStorage.getItem(k);` +
    `if(t!=="light"&&t!=="dark"&&t!=="system")t=d;` +
    `var r=t==="system"?(matchMedia(${JSON.stringify(MEDIA)}).matches?"dark":"light"):t;` +
    `var c=document.documentElement.classList;c.remove("light","dark");c.add(r);` +
    `document.documentElement.dataset.theme=r;document.documentElement.style.colorScheme=r;}catch(e){}})();`
  );
}

export interface ThemeProviderProps {
  children: ReactNode;
  /** Used when nothing is stored. Dark-first product (ADR-003) but "system" respects the visitor. */
  defaultTheme?: Theme;
  storageKey?: string;
}

export function ThemeProvider({
  children,
  defaultTheme = "system",
  storageKey = THEME_STORAGE_KEY,
}: ThemeProviderProps) {
  const [theme, setThemeState] = useState<Theme>(() =>
    typeof window === "undefined" ? defaultTheme : (readStored(storageKey) ?? defaultTheme),
  );
  const [system, setSystem] = useState<ResolvedTheme>(() =>
    typeof window === "undefined" ? "light" : systemTheme(),
  );

  const resolvedTheme: ResolvedTheme = theme === "system" ? system : theme;

  // Follow OS changes while in "system" mode.
  useEffect(() => {
    const mql = window.matchMedia(MEDIA);
    const onChange = (e: MediaQueryListEvent) => setSystem(e.matches ? "dark" : "light");
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    applyTheme(resolvedTheme);
  }, [resolvedTheme]);

  const setTheme = useCallback(
    (next: Theme) => {
      setThemeState(next);
      try {
        window.localStorage.setItem(storageKey, next);
      } catch {
        /* storage unavailable (private mode); the in-memory theme still applies */
      }
    },
    [storageKey],
  );

  const toggleTheme = useCallback(() => {
    setTheme(resolvedTheme === "dark" ? "light" : "dark");
  }, [resolvedTheme, setTheme]);

  const value = useMemo<ThemeContextValue>(
    () => ({ theme, resolvedTheme, setTheme, toggleTheme }),
    [theme, resolvedTheme, setTheme, toggleTheme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used inside <ThemeProvider>");
  return ctx;
}

/** Like useTheme but returns null outside a provider (used by Toaster). */
export function useOptionalTheme(): ThemeContextValue | null {
  return useContext(ThemeContext);
}
