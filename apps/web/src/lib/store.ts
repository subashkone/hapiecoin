// UI state only (typescript rule 5): selected asset, expiry, feed pause, open dialog. Server data lives in
// TanStack Query. Persisted keys survive a reload so the trader lands where they left off.
import type { Underlying } from "@hapiecoin/schema";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { type ChainLayout, defaultLayout, normaliseLayout } from "./chain/layout";
import { type ChainRange, isChainRange } from "./chain/range";

export type DialogKind = "profile" | "api" | "currency" | "lot" | "pnl" | "exchanges" | "logout" | "columns" | null;

export interface UiState {
  asset: Underlying;
  /** Selected expiry per asset (ISO date) or null for "nearest". */
  expiry: Partial<Record<Underlying, string | null>>;
  feedPaused: boolean;
  dialog: DialogKind;
  /** True once any dialog has been opened this session (keeps the lazily loaded dialog chunk mounted). */
  dialogsTouched: boolean;
  paletteOpen: boolean;
  /** Strikes shown each side of ATM in the chain (HC-WS-016); 0 = every listed strike. Persisted. */
  chainRange: ChainRange;
  /** Bumped by "recentre on ATM" (keyboard A, palette); the chain scrolls the ATM row into the middle. */
  chainRecentre: number;
  /** Which chain columns show and in what order from the strike outward (HC-WS-014). Persisted. */
  chainColumns: ChainLayout;
  setAsset: (asset: Underlying) => void;
  setChainRange: (range: ChainRange) => void;
  recentreChain: () => void;
  setChainColumns: (layout: ChainLayout) => void;
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
      chainRange: 12,
      chainRecentre: 0,
      chainColumns: defaultLayout(),
      setAsset: (asset) => set({ asset }),
      setChainRange: (chainRange) => set({ chainRange: isChainRange(chainRange) ? chainRange : 12 }),
      recentreChain: () => set((s) => ({ chainRecentre: s.chainRecentre + 1 })),
      setChainColumns: (layout) => set({ chainColumns: normaliseLayout(layout) }),
      setExpiry: (asset, expiry) => set((s) => ({ expiry: { ...s.expiry, [asset]: expiry } })),
      setFeedPaused: (feedPaused) => set({ feedPaused }),
      openDialog: (dialog) => set({ dialog, dialogsTouched: true }),
      closeDialog: () => set({ dialog: null }),
      setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
    }),
    {
      name: UI_STORAGE_KEY,
      partialize: (s) => ({
        asset: s.asset,
        expiry: s.expiry,
        feedPaused: s.feedPaused,
        chainRange: s.chainRange,
        chainColumns: s.chainColumns,
      }),
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<UiState>;
        return {
          ...current,
          ...p,
          chainRange: isChainRange(p.chainRange) ? p.chainRange : current.chainRange,
          chainColumns: p.chainColumns === undefined ? current.chainColumns : normaliseLayout(p.chainColumns),
        };
      },
    },
  ),
);

export const ASSET_META: Record<Underlying, { name: string; symbol: string; glyph: string }> = {
  BTC: { name: "Bitcoin", symbol: "BTCUSD", glyph: "₿" },
  ETH: { name: "Ethereum", symbol: "ETHUSD", glyph: "Ξ" },
  XAUT: { name: "Tether Gold", symbol: "XAUTUSD", glyph: "Au" },
};
