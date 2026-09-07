// UI state only (typescript rule 5): selected asset, expiry, feed pause, open dialog. Server data lives in
// TanStack Query. Persisted keys survive a reload so the trader lands where they left off.
import type { Underlying } from "@hapiecoin/schema";
import { create } from "zustand";
import { persist } from "zustand/middleware";

export type DialogKind = "profile" | "api" | "currency" | "lot" | "pnl" | "exchanges" | "logout" | null;

export interface UiState {
  asset: Underlying;
  /** Selected expiry per asset (ISO date) or null for "nearest". */
  expiry: Partial<Record<Underlying, string | null>>;
  feedPaused: boolean;
  dialog: DialogKind;
  /** True once any dialog has been opened this session (keeps the lazily loaded dialog chunk mounted). */
  dialogsTouched: boolean;
  paletteOpen: boolean;
  setAsset: (asset: Underlying) => void;
  setExpiry: (asset: Underlying, expiry: string | null) => void;
  setFeedPaused: (paused: boolean) => void;
  openDialog: (kind: DialogKind) => void;
  closeDialog: () => void;
  setPaletteOpen: (open: boolean) => void;
}

export const UI_STORAGE_KEY = "hapiecoin.ui";

export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      asset: "BTC",
      expiry: {},
      feedPaused: false,
      dialog: null,
      dialogsTouched: false,
      paletteOpen: false,
      setAsset: (asset) => set({ asset }),
      setExpiry: (asset, expiry) => set((s) => ({ expiry: { ...s.expiry, [asset]: expiry } })),
      setFeedPaused: (feedPaused) => set({ feedPaused }),
      openDialog: (dialog) => set({ dialog, dialogsTouched: true }),
      closeDialog: () => set({ dialog: null }),
      setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
    }),
    {
      name: UI_STORAGE_KEY,
      partialize: (s) => ({ asset: s.asset, expiry: s.expiry, feedPaused: s.feedPaused }),
    },
  ),
);

export const ASSET_META: Record<Underlying, { name: string; symbol: string; glyph: string }> = {
  BTC: { name: "Bitcoin", symbol: "BTCUSD", glyph: "₿" },
  ETH: { name: "Ethereum", symbol: "ETHUSD", glyph: "Ξ" },
  XAUT: { name: "Tether Gold", symbol: "XAUTUSD", glyph: "Au" },
};
