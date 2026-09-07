// UI state only (typescript rule 5): selected asset, expiry, feed pause, open dialog. Server data lives in
// TanStack Query. Persisted keys survive a reload so the trader lands where they left off.
import type { Underlying } from "@hapiecoin/schema";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { type ChainLayout, defaultLayout, normaliseLayout } from "./chain/layout";
import { type ChainRange, isChainRange } from "./chain/range";
import {
  type AddLegResult,
  DEFAULT_LOTS,
  type LegKind,
  type NewLegInput,
  type StrategyLeg,
  addLeg as addLegPure,
  isLotPreset,
  normaliseLegs,
  removeLeg as removeLegPure,
} from "./strategy/legs";

export type DialogKind = "profile" | "api" | "currency" | "lot" | "pnl" | "exchanges" | "logout" | "columns" | "option" | null;

/** Which option the details dialog shows (HC-WS-026); transient. */
export interface OptionDetailTarget {
  asset: Underlying;
  expiry: string;
  strike: string;
  kind: LegKind;
}

export type LegsByAsset = Record<Underlying, StrategyLeg[]>;

function emptyLegs(): LegsByAsset {
  return { BTC: [], ETH: [], XAUT: [] };
}

function normaliseLegsByAsset(input: unknown): LegsByAsset {
  const o = (typeof input === "object" && input !== null ? input : {}) as Partial<Record<Underlying, unknown>>;
  return { BTC: normaliseLegs(o.BTC), ETH: normaliseLegs(o.ETH), XAUT: normaliseLegs(o.XAUT) };
}

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
  /** Strategy legs per asset (ADR-010: switching assets never clears them). Persisted (ADR-022). */
  legs: LegsByAsset;
  /** Lots the chain's B / S buttons add (HC-WS-025). Persisted. */
  chainLots: number;
  /** The option the details dialog is showing, when `dialog === "option"`. */
  optionDetail: OptionDetailTarget | null;
  setAsset: (asset: Underlying) => void;
  setChainRange: (range: ChainRange) => void;
  recentreChain: () => void;
  setChainColumns: (layout: ChainLayout) => void;
  addLeg: (input: NewLegInput) => AddLegResult;
  removeLeg: (asset: Underlying, id: string) => void;
  setChainLots: (lots: number) => void;
  openOptionDetail: (target: OptionDetailTarget) => void;
  setExpiry: (asset: Underlying, expiry: string | null) => void;
  setFeedPaused: (paused: boolean) => void;
  openDialog: (kind: DialogKind) => void;
  closeDialog: () => void;
  setPaletteOpen: (open: boolean) => void;
}

export const UI_STORAGE_KEY = "hapiecoin.ui";

export const useUiStore = create<UiState>()(
  persist(
    (set, get) => ({
      asset: "BTC",
      expiry: {},
      feedPaused: false,
      dialog: null,
      dialogsTouched: false,
      paletteOpen: false,
      chainRange: 12,
      chainRecentre: 0,
      chainColumns: defaultLayout(),
      legs: emptyLegs(),
      chainLots: DEFAULT_LOTS,
      optionDetail: null,
      setAsset: (asset) => set({ asset }),
      setChainRange: (chainRange) => set({ chainRange: isChainRange(chainRange) ? chainRange : 12 }),
      recentreChain: () => set((s) => ({ chainRecentre: s.chainRecentre + 1 })),
      setChainColumns: (layout) => set({ chainColumns: normaliseLayout(layout) }),
      addLeg: (input) => {
        const result = addLegPure(get().legs[input.asset], input);
        if (result.ok) set((s) => ({ legs: { ...s.legs, [input.asset]: result.legs } }));
        return result;
      },
      removeLeg: (asset, id) => set((s) => ({ legs: { ...s.legs, [asset]: removeLegPure(s.legs[asset], id) } })),
      setChainLots: (lots) => set({ chainLots: isLotPreset(lots) ? lots : Number.isInteger(lots) && lots > 0 ? lots : DEFAULT_LOTS }),
      openOptionDetail: (target) => set({ optionDetail: target, dialog: "option", dialogsTouched: true }),
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
        legs: s.legs,
        chainLots: s.chainLots,
      }),
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<UiState>;
        return {
          ...current,
          ...p,
          chainRange: isChainRange(p.chainRange) ? p.chainRange : current.chainRange,
          chainColumns: p.chainColumns === undefined ? current.chainColumns : normaliseLayout(p.chainColumns),
          legs: p.legs === undefined ? current.legs : normaliseLegsByAsset(p.legs),
          chainLots: typeof p.chainLots === "number" && Number.isInteger(p.chainLots) && p.chainLots > 0 ? p.chainLots : current.chainLots,
          optionDetail: null,
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
