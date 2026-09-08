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
  MAX_ACTIVE_LEGS,
  type NewLegInput,
  type StrategyLeg,
  addLeg as addLegPure,
  isLotPreset,
  normaliseLegs,
  removeLeg as removeLegPure,
} from "./strategy/legs";

export type DialogKind = "profile" | "api" | "currency" | "lot" | "pnl" | "exchanges" | "logout" | "columns" | "option" | "upgrade" | null;

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

/** Builder state that is not the legs themselves (HC-TR-004, 007, 090); kept per asset like the legs (ADR-010). */
export interface StrategyMeta {
  name: string;
  /** Lot / price edits apply to every leg (HC-TR-004). */
  basket: boolean;
  /** "live" follows the feed; "custom" keeps typed prices (HC-TR-003). */
  priceMode: "live" | "custom";
  /** Id of the loaded draft when editing one (HC-TR-020, 045), else null. */
  draftId: string | null;
}
export type StrategyMetaByAsset = Record<Underlying, StrategyMeta>;
function emptyMeta(): StrategyMeta {
  return { name: "", basket: false, priceMode: "live", draftId: null };
}
function emptyMetaByAsset(): StrategyMetaByAsset {
  return { BTC: emptyMeta(), ETH: emptyMeta(), XAUT: emptyMeta() };
}
function normaliseMetaByAsset(input: unknown): StrategyMetaByAsset {
  const o = (typeof input === "object" && input !== null ? input : {}) as Partial<Record<Underlying, Partial<StrategyMeta>>>;
  const one = (m: Partial<StrategyMeta> | undefined): StrategyMeta => ({
    name: typeof m?.name === "string" ? m.name.slice(0, 80) : "",
    basket: m?.basket === true,
    priceMode: m?.priceMode === "custom" ? "custom" : "live",
    draftId: typeof m?.draftId === "string" ? m.draftId : null,
  });
  return { BTC: one(o.BTC), ETH: one(o.ETH), XAUT: one(o.XAUT) };
}

/** A saved strategy (HC-TR-020, 036, 041..049): local until the Phase 3 strategy API (ADR-023). */
export interface SavedStrategy {
  id: string;
  name: string;
  asset: Underlying;
  status: "draft" | "archived";
  templateName: string;
  legs: StrategyLeg[];
  createdAt: number;
  updatedAt: number;
  archivedAt?: number | undefined;
}
function normaliseDrafts(input: unknown): SavedStrategy[] {
  if (!Array.isArray(input)) return [];
  const out: SavedStrategy[] = [];
  for (const x of input) {
    if (typeof x !== "object" || x === null) continue;
    const s = x as Partial<SavedStrategy>;
    if (typeof s.id !== "string" || typeof s.name !== "string" || (s.asset !== "BTC" && s.asset !== "ETH" && s.asset !== "XAUT")) continue;
    out.push({
      id: s.id,
      name: s.name,
      asset: s.asset,
      status: s.status === "archived" ? "archived" : "draft",
      templateName: typeof s.templateName === "string" ? s.templateName : "Custom",
      legs: normaliseLegs(s.legs),
      createdAt: typeof s.createdAt === "number" ? s.createdAt : 0,
      updatedAt: typeof s.updatedAt === "number" ? s.updatedAt : 0,
      archivedAt: typeof s.archivedAt === "number" ? s.archivedAt : undefined,
    });
  }
  return out;
}

export type WorkspaceTab = "chain" | "builder" | "paper" | "live" | "journal";
export type AnalysisTab = "payoff" | "scenarios" | "greeks" | "vol" | "structure" | "ladder";
export type BuilderSubTab = "builder" | "templates";
/** What the analysis pane shows (ADR-026): the Builder legs (null), a paper / live strategy, or ticked exchange positions. */
export type PaneSource = { kind: "strategy"; id: string } | { kind: "positions"; productIds: number[] } | null;

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
  /** Message of the Upgrade Required dialog (HC-SH-054); set by openUpgrade. */
  upgradeMessage: string;
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
  /** Default lots the persisted `chainLots` was last aligned to; a change of DEFAULT_LOTS re-applies once (ADR-028). Persisted. */
  lotsDefault: number;
  /** The option the details dialog is showing, when `dialog === "option"`. */
  optionDetail: OptionDetailTarget | null;
  /** Builder meta per asset (name, basket, price mode, loaded draft). Persisted. */
  strategy: StrategyMetaByAsset;
  /** Drafts saved before Phase 3 (ADR-023), read once from the old persisted state and imported to the API (ADR-024). */
  drafts: SavedStrategy[];
  /** True once the browser-local drafts were imported (or there were none), so a reload never imports twice. Persisted. */
  draftsImported: boolean;
  /** Visible admin table columns per page (HC-AD-093); null or absent = the page's default. Persisted. */
  adminCols: Record<string, string[] | null>;
  /** Bumped by the palette's "Show announcements" (HC-SH-055); the flyer popup reopens every live banner. */
  flyersRequested: number;
  /** Trading flow dialogs (HC-TR-050..057): null = closed; strategyId null = trade the Builder legs. */
  tradeFlow: { strategyId: string | null; mode?: "paper" | "live" | undefined } | null;
  /** Strategy Details dialog (HC-TR-068): the open strategy id or null. */
  detailsId: string | null;
  /** Analysis pane source (HC-TR-143, ADR-026); cleared when the Builder or Chain tab is opened. Not persisted. */
  paneSource: PaneSource;
  /** Strategy templates strip under the Builder legs (HC-TR-040, ADR-027): open or collapsed. Persisted. */
  templatesStrip: boolean;
  /** Left-pane tab, right-pane tab and the Builder sub-tab (HC-WS-005, HC-TR-001). */
  workspaceTab: WorkspaceTab;
  analysisTab: AnalysisTab;
  builderTab: BuilderSubTab;
  /** Payoff target price (USD per unit) and days ahead (HC-WS-047/048); null price = spot. */
  targetPrice: number | null;
  targetDays: number;
  setAsset: (asset: Underlying) => void;
  /** Replace the asset's legs (templates, drafts, Clear); returns false when over the limit. */
  setLegs: (asset: Underlying, legs: StrategyLeg[]) => boolean;
  updateLegs: (asset: Underlying, fn: (legs: StrategyLeg[]) => StrategyLeg[]) => void;
  setStrategyMeta: (asset: Underlying, patch: Partial<StrategyMeta>) => void;
  saveDraft: (asset: Underlying, name: string, templateName: string) => SavedStrategy;
  loadDraft: (id: string) => SavedStrategy | null;
  archiveDraft: (id: string, archived: boolean) => void;
  deleteDraft: (id: string) => void;
  markDraftsImported: () => void;
  openTrade: (target: { strategyId: string | null; mode?: "paper" | "live" | undefined }) => void;
  closeTrade: () => void;
  openDetails: (id: string | null) => void;
  /** Follow a paper / live strategy in the analysis pane (null = back to the Builder legs). */
  followStrategy: (id: string | null) => void;
  /** Analyse ticked exchange positions (HC-TR-144); an empty list returns to the Builder legs. */
  analysePositions: (productIds: number[]) => void;
  setTemplatesStrip: (open: boolean) => void;
  setWorkspaceTab: (tab: WorkspaceTab) => void;
  setAnalysisTab: (tab: AnalysisTab) => void;
  setBuilderTab: (tab: BuilderSubTab) => void;
  setTarget: (patch: { price?: number | null; days?: number }) => void;
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
  /** Open the Upgrade Required dialog with the API's reason (403 UPGRADE_REQUIRED). */
  openUpgrade: (message: string) => void;
  closeDialog: () => void;
  setPaletteOpen: (open: boolean) => void;
  setAdminCols: (page: string, cols: string[] | null) => void;
  requestFlyers: () => void;
}

export const UI_STORAGE_KEY = "hapiecoin.ui";

export const useUiStore = create<UiState>()(
  persist(
    (set, get) => ({
      asset: "BTC",
      expiry: {},
      feedPaused: false,
      dialog: null,
      upgradeMessage: "",
      dialogsTouched: false,
      paletteOpen: false,
      chainRange: 12,
      chainRecentre: 0,
      chainColumns: defaultLayout(),
      legs: emptyLegs(),
      chainLots: DEFAULT_LOTS,
      lotsDefault: DEFAULT_LOTS,
      adminCols: {},
      flyersRequested: 0,
      optionDetail: null,
      strategy: emptyMetaByAsset(),
      drafts: [],
      draftsImported: false,
      tradeFlow: null,
      detailsId: null,
      paneSource: null,
      templatesStrip: true,
      workspaceTab: "chain",
      analysisTab: "payoff",
      builderTab: "builder",
      targetPrice: null,
      targetDays: 0,
      setAsset: (asset) => set({ asset, targetPrice: null }),
      setLegs: (asset, legs) => {
        const open = legs.filter((l) => l.status === "open");
        if (open.length > MAX_ACTIVE_LEGS) return false;
        set((s) => ({ legs: { ...s.legs, [asset]: normaliseLegs(legs) } }));
        return true;
      },
      updateLegs: (asset, fn) => set((s) => ({ legs: { ...s.legs, [asset]: fn(s.legs[asset]) } })),
      setStrategyMeta: (asset, patch) => set((s) => ({ strategy: { ...s.strategy, [asset]: { ...s.strategy[asset], ...patch } } })),
      saveDraft: (asset, name, templateName) => {
        const s = get();
        const now = Date.now();
        const existingId = s.strategy[asset].draftId;
        const existing = existingId ? s.drafts.find((d) => d.id === existingId) : undefined;
        const legs = s.legs[asset].map((l) => ({ ...l }));
        const draft: SavedStrategy = existing
          ? { ...existing, name, templateName, legs, updatedAt: now }
          : { id: `strat_${now.toString(36)}_${Math.random().toString(36).slice(2, 6)}`, name, asset, status: "draft", templateName, legs, createdAt: now, updatedAt: now };
        set((st) => ({
          drafts: existing ? st.drafts.map((d) => (d.id === draft.id ? draft : d)) : [draft, ...st.drafts],
          strategy: { ...st.strategy, [asset]: { ...st.strategy[asset], name, draftId: draft.id } },
        }));
        return draft;
      },
      loadDraft: (id) => {
        const d = get().drafts.find((x) => x.id === id);
        if (!d) return null;
        set((st) => ({
          asset: d.asset,
          legs: { ...st.legs, [d.asset]: d.legs.map((l) => ({ ...l })) },
          strategy: { ...st.strategy, [d.asset]: { ...st.strategy[d.asset], name: d.name, draftId: d.id } },
          workspaceTab: "builder",
          builderTab: "builder",
        }));
        return d;
      },
      archiveDraft: (id, archived) =>
        set((st) => ({
          drafts: st.drafts.map((d) => (d.id === id ? { ...d, status: archived ? "archived" : "draft", archivedAt: archived ? Date.now() : undefined, updatedAt: Date.now() } : d)),
        })),
      deleteDraft: (id) =>
        set((st) => ({
          drafts: st.drafts.filter((d) => d.id !== id),
          strategy: Object.fromEntries(
            Object.entries(st.strategy).map(([k, m]) => [k, m.draftId === id ? { ...m, draftId: null } : m]),
          ) as StrategyMetaByAsset,
        })),
      markDraftsImported: () => set({ drafts: [], draftsImported: true }),
      openTrade: (target) => set({ tradeFlow: target }),
      closeTrade: () => set({ tradeFlow: null }),
      openDetails: (detailsId) => set({ detailsId }),
      followStrategy: (id) => set({ paneSource: id === null ? null : { kind: "strategy", id } }),
      analysePositions: (productIds) => set({ paneSource: productIds.length ? { kind: "positions", productIds: [...productIds] } : null }),
      setTemplatesStrip: (templatesStrip) => set({ templatesStrip }),
      setWorkspaceTab: (workspaceTab) => set((s) => ({ workspaceTab, paneSource: workspaceTab === "builder" || workspaceTab === "chain" ? null : s.paneSource })),
      setAnalysisTab: (analysisTab) => set({ analysisTab }),
      setBuilderTab: (builderTab) => set({ builderTab }),
      setTarget: (patch) =>
        set((st) => ({
          targetPrice: patch.price === undefined ? st.targetPrice : patch.price,
          targetDays: patch.days === undefined ? st.targetDays : Math.max(0, Math.round(patch.days)),
        })),
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
      openUpgrade: (upgradeMessage) => set({ dialog: "upgrade", upgradeMessage, dialogsTouched: true }),
      closeDialog: () => set({ dialog: null }),
      setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
      setAdminCols: (page, cols) => set((s) => ({ adminCols: { ...s.adminCols, [page]: cols } })),
      requestFlyers: () => set((s) => ({ flyersRequested: s.flyersRequested + 1 })),
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
        lotsDefault: s.lotsDefault,
        strategy: s.strategy,
        draftsImported: s.draftsImported,
        adminCols: s.adminCols,
        workspaceTab: s.workspaceTab,
        analysisTab: s.analysisTab,
        targetDays: s.targetDays,
        templatesStrip: s.templatesStrip,
      }),
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<UiState>;
        const tabs: WorkspaceTab[] = ["chain", "builder", "paper", "live", "journal"];
        const atabs: AnalysisTab[] = ["payoff", "scenarios", "greeks", "vol", "structure", "ladder"];
        return {
          ...current,
          ...p,
          chainRange: isChainRange(p.chainRange) ? p.chainRange : current.chainRange,
          chainColumns: p.chainColumns === undefined ? current.chainColumns : normaliseLayout(p.chainColumns),
          legs: p.legs === undefined ? current.legs : normaliseLegsByAsset(p.legs),
          // a browser that persisted lots under an older default (10) gets the new default once; later choices stick
          chainLots: p.lotsDefault === DEFAULT_LOTS && typeof p.chainLots === "number" && Number.isInteger(p.chainLots) && p.chainLots > 0 ? p.chainLots : current.chainLots,
          lotsDefault: DEFAULT_LOTS,
          optionDetail: null,
          strategy: p.strategy === undefined ? current.strategy : normaliseMetaByAsset(p.strategy),
          draftsImported: p.draftsImported === true,
          adminCols: p.adminCols && typeof p.adminCols === "object" ? p.adminCols : {},
          templatesStrip: p.templatesStrip !== false,
          drafts: p.draftsImported === true || p.drafts === undefined ? [] : normaliseDrafts(p.drafts),
          workspaceTab: tabs.includes(p.workspaceTab as WorkspaceTab) ? (p.workspaceTab as WorkspaceTab) : current.workspaceTab,
          analysisTab: atabs.includes(p.analysisTab as AnalysisTab) ? (p.analysisTab as AnalysisTab) : current.analysisTab,
          builderTab: current.builderTab,
          targetPrice: null,
          targetDays: typeof p.targetDays === "number" && p.targetDays >= 0 ? Math.round(p.targetDays) : 0,
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
