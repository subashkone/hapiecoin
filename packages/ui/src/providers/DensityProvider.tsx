// Density (HC-SH-080, HC-SH-113): comfortable rows 36px, compact rows 28px via `--row-h` (theme.css).
// Sets `compact` class and `data-density` on <html>; persisted.
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

export type Density = "comfortable" | "compact";

export interface DensityContextValue {
  density: Density;
  setDensity: (density: Density) => void;
  toggleDensity: () => void;
}

export const DENSITY_STORAGE_KEY = "hapiecoin.density";

const DensityContext = createContext<DensityContextValue | null>(null);

function isDensity(v: unknown): v is Density {
  return v === "comfortable" || v === "compact";
}

function readStored(key: string): Density | null {
  try {
    const v = window.localStorage.getItem(key);
    return isDensity(v) ? v : null;
  } catch {
    return null;
  }
}

/** Apply a density to the document root. Exported for tests and non-React callers. */
export function applyDensity(density: Density, root: HTMLElement = document.documentElement): void {
  root.classList.toggle("compact", density === "compact");
  root.dataset["density"] = density;
}

export interface DensityProviderProps {
  children: ReactNode;
  defaultDensity?: Density;
  storageKey?: string;
}

export function DensityProvider({
  children,
  defaultDensity = "comfortable",
  storageKey = DENSITY_STORAGE_KEY,
}: DensityProviderProps) {
  const [density, setDensityState] = useState<Density>(() =>
    typeof window === "undefined" ? defaultDensity : (readStored(storageKey) ?? defaultDensity),
  );

  useEffect(() => {
    applyDensity(density);
  }, [density]);

  const setDensity = useCallback(
    (next: Density) => {
      setDensityState(next);
      try {
        window.localStorage.setItem(storageKey, next);
      } catch {
        /* storage unavailable; in-memory density still applies */
      }
    },
    [storageKey],
  );

  const toggleDensity = useCallback(() => {
    setDensity(density === "compact" ? "comfortable" : "compact");
  }, [density, setDensity]);

  const value = useMemo<DensityContextValue>(
    () => ({ density, setDensity, toggleDensity }),
    [density, setDensity, toggleDensity],
  );

  return <DensityContext.Provider value={value}>{children}</DensityContext.Provider>;
}

export function useDensity(): DensityContextValue {
  const ctx = useContext(DensityContext);
  if (!ctx) throw new Error("useDensity must be used inside <DensityProvider>");
  return ctx;
}
