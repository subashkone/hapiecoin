// UI state only (typescript rule 5): selected asset, expiry, feed pause, open dialog. Server data lives in
// TanStack Query. Persisted keys survive a reload so the trader lands where they left off.
import { emitTour } from "@/lib/tour";
import { type AlertChannel, type AlertKind, type AlertOp, UNDERLYINGS, type Underlying, VENUES } from "@hapiecoin/schema";
import { DEFAULT_VENUE, type VenueId, getVenueCore } from "@hapiecoin/venues/core";
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
import { type AdjustDraft, newDraft } from "./adjust/model";
import { bindVenueSource } from "./venue";

/** Orders or saved plans a trader would lose if the draft went away (lots-after entries equal to the leg's lots are dropped by the hook, so a key means an order). */
export function hasAdjustWork(a: AdjustDraft | null): boolean {
  return a !== null && (a.picks.length > 0 || Object.keys(a.lotsAfter).length > 0 || a.plans.length > 0);
}

export type DialogKind = "profile" | "public" | "api" | "currency" | "lot" | "pnl" | "mindful" | "security" | "exchanges" | "logout" | "columns" | "option" | "upgrade" | "alerts" | "shortcuts" | null;

/** What the Alerts dialog's New alert form starts with (HC-SH-100): a "Set alert" button passes the strategy. Transient. */
export interface AlertPrefill {
  kind?: AlertKind;
  asset?: Underlying;
  strategyId?: string;
  op?: AlertOp;
  value?: string;
  channels?: AlertChannel[];
}

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

export type WorkspaceTab = "chain" | "builder" | "paper" | "live" | "journal" | "screener";
export interface ChartLayers {
  expiry: boolean;
  target: boolean;
  fill: boolean;
  oi: boolean;
  band: boolean;
  breakeven: boolean;
  /** Dashed target-date curves with every leg's IV shifted ±5 vol points (HC-WS-083). */
  ivUp: boolean;
  ivDown: boolean;
}
export const DEFAULT_LAYERS: ChartLayers = { expiry: true, target: true, fill: true, oi: false, band: true, breakeven: true, ivUp: false, ivDown: false };
export const LAYER_KEYS = Object.keys(DEFAULT_LAYERS) as (keyof ChartLayers)[];
export type LadderStep = 1 | 2 | 4;
export const isLadderStep = (v: unknown): v is LadderStep => v === 1 || v === 2 || v === 4;
export type PaneCollapse = "left" | "right" | null;
function normaliseLayers(raw: unknown): ChartLayers {
  const out = { ...DEFAULT_LAYERS };
  if (raw && typeof raw === "object") for (const k of LAYER_KEYS) if (typeof (raw as Record<string, unknown>)[k] === "boolean") out[k] = (raw as Record<string, boolean>)[k]!;
  return out;
}
export type AnalysisTab = "payoff" | "scenarios" | "greeks" | "vol" | "structure" | "ladder" | "backtest" | "replay";
export type BuilderSubTab = "builder" | "templates" | "wizard";
/** What the analysis pane shows (ADR-026): the Builder legs (null), a paper / live strategy, or ticked exchange positions. */
export type PaneSource = { kind: "strategy"; id: string } | { kind: "positions"; productIds: number[] } | null;

function normaliseLegsByAsset(input: unknown): LegsByAsset {
  const o = (typeof input === "object" && input !== null ? input : {}) as Partial<Record<Underlying, unknown>>;
  return { BTC: normaliseLegs(o.BTC), ETH: normaliseLegs(o.ETH), XAUT: normaliseLegs(o.XAUT) };
}

export interface UiState {
  /** The venue the workspace works against (ADR-069): every chain topic, symbol, calendar, lot size and create body follows it. Persisted. */
  venue: VenueId;
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
  /** Payoff chart layers (HC-WS-042, 083); persisted so the IV ±5 % curves and the OI bars stay as the trader left them. */
  chartLayers: ChartLayers;
  /** Ladder step multiplier (HC-WS-103). Persisted. */
  ladderStep: LadderStep;
  /** Which workspace pane is collapsed (HC-WS-065): the other takes the full width. Persisted. */
  analyseCollapse: PaneCollapse;
  /** A template the palette asked the Builder to load once the chain is ready (HC-WS-069); cleared on load. */
  templateRequest: string | null;
  /** Exchange chosen in the trade dialogs; the Builder ticket's fee estimate follows it (HC-TR-142). Persisted. */
  brokerId: string | null;
  /** The exchange key (account, ADR-068) chosen last in a trade dialog or the net-positions panel; the chrome reads it. Persisted. */
  accountId: string | null;
  /** The palette asked the Builder to save the current legs as a draft (HC-TR-140); cleared once handled. */
  saveDraftRequest: boolean;
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
  /** Visible admin table columns per page (HC-AD-093); null or absent = the page's default. Persisted. */
  adminCols: Record<string, string[] | null>;
  /** Bumped by the palette's "Show announcements" (HC-SH-055); the flyer popup reopens every live banner. */
  flyersRequested: number;
  /** Analytics watchlist symbols (HC-MA-103, 105). Persisted. */
  watchlist: string[];
  /** Bumped by "Take a tour" (settings menu, palette); the tour starts on /analyse. */
  tourRequested: number;
  /** Bumped to open the assistant, optionally with a question to ask (palette, tour). */
  assistantRequested: number;
  assistantQuestion: string | null;
  /** Trading flow dialogs (HC-TR-050..057): null = closed; strategyId null = trade the Builder legs. */
  tradeFlow: { strategyId: string | null; mode?: "paper" | "live" | undefined } | null;
  /** Strategy Details dialog (HC-TR-068): the open strategy id or null. */
  detailsId: string | null;
  /** Protect dialog (HC-TR-167): the strategy whose stop / target is being set; afterTrade marks the Protect step of the trade flow. Not persisted. */
  rulesFor: { strategyId: string; afterTrade: boolean } | null;
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
  /** Adjustment workbench draft (ADR-044, HC-TR-148): the strategy being adjusted and its proposed changes. Not persisted. */
  adjust: AdjustDraft | null;
  /** "Alert me if max loss exceeds X" saved from the workbench (ADR-044 extra 5); a local note, separate from the server alerts (ADR-052). Persisted. */
  riskAlerts: RiskAlert[];
  /** Null = the Alerts dialog opens on the list; an object opens it on the New alert form with these values (HC-SH-100). Transient. */
  alertPrefill: AlertPrefill | null;
  setAsset: (asset: Underlying) => void;
  /** Switch venue (ADR-069): clears the builder legs, strategy meta and adjust state of every asset and moves the asset to one the venue lists. Callers use `requestVenue`, which asks first when legs exist. */
  setVenue: (venue: VenueId) => void;
  /** A venue switch waiting for the trader because Builder legs exist; `then` runs after the switch. */
  venueSwitch: { venue: VenueId; then?: (() => void) | undefined } | null;
  /** Switch venue, asking first when Builder legs exist (the venue-switch dialog); `then` runs after the switch, or at once on the same venue. */
  requestVenue: (venue: VenueId, then?: () => void) => void;
  confirmVenueSwitch: () => void;
  cancelVenueSwitch: () => void;
  /** Replace the asset's legs (templates, drafts, Clear); returns false when over the limit. */
  setLegs: (asset: Underlying, legs: StrategyLeg[]) => boolean;
  updateLegs: (asset: Underlying, fn: (legs: StrategyLeg[]) => StrategyLeg[]) => void;
  setStrategyMeta: (asset: Underlying, patch: Partial<StrategyMeta>) => void;
  openTrade: (target: { strategyId: string | null; mode?: "paper" | "live" | undefined }) => void;
  closeTrade: () => void;
  openDetails: (id: string | null) => void;
  openRules: (strategyId: string, opts?: { afterTrade?: boolean }) => void;
  closeRules: () => void;
  /** Offer the Protect step after every trade from the Builder (HC-TR-167). Persisted. */
  protectPrompt: boolean;
  setProtectPrompt: (on: boolean) => void;
  /** Open the Alerts center (HC-SH-079); with a prefill, straight on the New alert form (HC-SH-100, HC-TR-139). */
  openAlerts: (prefill?: AlertPrefill | null) => void;
  /** Follow a paper / live strategy in the analysis pane (null = back to the Builder legs). */
  /** `force` skips the discard question (used by the workbench once the trader has answered it). */
  followStrategy: (id: string | null, force?: boolean) => void;
  /** Analyse ticked exchange positions (HC-TR-144); an empty list returns to the Builder legs. */
  analysePositions: (productIds: number[], force?: boolean) => void;
  setTemplatesStrip: (open: boolean) => void;
  setWorkspaceTab: (tab: WorkspaceTab, force?: boolean) => void;
  setAnalysisTab: (tab: AnalysisTab) => void;
  setBuilderTab: (tab: BuilderSubTab) => void;
  setTarget: (patch: { price?: number | null; days?: number }) => void;
  setChainRange: (range: ChainRange) => void;
  setChartLayer: (key: keyof ChartLayers, on: boolean) => void;
  setLadderStep: (step: LadderStep) => void;
  setAnalyseCollapse: (pane: PaneCollapse) => void;
  requestTemplate: (name: string | null) => void;
  setBroker: (id: string | null) => void;
  setAccount: (id: string | null) => void;
  requestSaveDraft: (on: boolean) => void;
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
  requestTour: () => void;
  toggleWatch: (symbol: string) => void;
  openAssistant: (question?: string) => void;
  /** Open the workbench on a paper / live strategy: the pane follows it and the Builder legs stay untouched (ADR-026), unless `venue` (the strategy's, ADR-069) differs from the workspace venue: then the switch is requested first (asked when legs exist) so the chain and the pick symbols are the strategy's. */
  openAdjust: (strategyId: string, force?: boolean, venue?: VenueId) => void;
  closeAdjust: (force?: boolean) => void;
  /** The action that would discard the adjustment work, waiting for the trader's answer (ADR-058 addendum). */
  adjustDiscard: (() => void) | null;
  keepAdjust: () => void;
  updateAdjust: (fn: (draft: AdjustDraft) => AdjustDraft) => void;
  addRiskAlert: (strategyId: string, maxLoss: number) => RiskAlert;
  removeRiskAlert: (id: string) => void;
}

export interface RiskAlert {
  id: string;
  strategyId: string;
  /** Alert when the position's max loss (USD, negative) falls below this. */
  maxLoss: number;
  createdAt: number;
}

function normaliseRiskAlerts(input: unknown): RiskAlert[] {
  if (!Array.isArray(input)) return [];
  const out: RiskAlert[] = [];
  for (const x of input) {
    if (typeof x !== "object" || x === null) continue;
    const a = x as Partial<RiskAlert>;
    if (typeof a.id === "string" && typeof a.strategyId === "string" && typeof a.maxLoss === "number" && Number.isFinite(a.maxLoss)) out.push({ id: a.id, strategyId: a.strategyId, maxLoss: a.maxLoss, createdAt: typeof a.createdAt === "number" ? a.createdAt : 0 });
  }
  return out;
}

export const UI_STORAGE_KEY = "hapiecoin.ui";

export const useUiStore = create<UiState>()(
  persist(
    (set, get) => ({
      venue: DEFAULT_VENUE,
      asset: "BTC",
      expiry: {},
      feedPaused: false,
      dialog: null,
      upgradeMessage: "",
      dialogsTouched: false,
      paletteOpen: false,
      chartLayers: { ...DEFAULT_LAYERS },
      ladderStep: 1,
      analyseCollapse: null,
      templateRequest: null,
      brokerId: null,
      accountId: null,
      saveDraftRequest: false,
      chainRange: 12,
      chainRecentre: 0,
      chainColumns: defaultLayout(),
      legs: emptyLegs(),
      chainLots: DEFAULT_LOTS,
      lotsDefault: DEFAULT_LOTS,
      adminCols: {},
      flyersRequested: 0,
      tourRequested: 0,
      watchlist: [],
      assistantRequested: 0,
      assistantQuestion: null,
      optionDetail: null,
      strategy: emptyMetaByAsset(),
      tradeFlow: null,
      detailsId: null,
      rulesFor: null,
      protectPrompt: true,
      paneSource: null,
      templatesStrip: true,
      workspaceTab: "chain",
      analysisTab: "payoff",
      builderTab: "builder",
      targetPrice: null,
      targetDays: 0,
      adjust: null,
      adjustDiscard: null,
      riskAlerts: [],
      alertPrefill: null,
      setAsset: (asset) => set({ asset, targetPrice: null }),
      setVenue: (venue) => {
        const s = get();
        if (venue === s.venue) return;
        // a workspace reset: legs, names and adjust work belong to the venue they were built on; the asset moves to one the venue lists
        const listed = getVenueCore(venue).underlyings;
        const asset = (listed as readonly string[]).includes(s.asset) ? s.asset : (listed[0] ?? s.asset);
        set({ venue, asset, legs: emptyLegs(), strategy: emptyMetaByAsset(), adjust: null, adjustDiscard: null, paneSource: null, targetPrice: null, optionDetail: null, templateRequest: null, venueSwitch: null });
      },
      venueSwitch: null,
      requestVenue: (venue, then) => {
        const s = get();
        if (venue === s.venue) {
          then?.();
          return;
        }
        if (UNDERLYINGS.some((a) => s.legs[a].length > 0)) {
          set({ venueSwitch: { venue, then } });
          return;
        }
        get().setVenue(venue);
        then?.();
      },
      confirmVenueSwitch: () => {
        const pending = get().venueSwitch;
        if (!pending) return;
        set({ venueSwitch: null });
        get().setVenue(pending.venue);
        pending.then?.();
      },
      cancelVenueSwitch: () => set({ venueSwitch: null }),
      setLegs: (asset, legs) => {
        const open = legs.filter((l) => l.status === "open");
        if (open.length > MAX_ACTIVE_LEGS) return false;
        set((s) => ({ legs: { ...s.legs, [asset]: normaliseLegs(legs) } }));
        return true;
      },
      updateLegs: (asset, fn) => set((s) => ({ legs: { ...s.legs, [asset]: fn(s.legs[asset]) } })),
      setStrategyMeta: (asset, patch) => set((s) => ({ strategy: { ...s.strategy, [asset]: { ...s.strategy[asset], ...patch } } })),
      openTrade: (target) => set({ tradeFlow: target }),
      closeTrade: () => set({ tradeFlow: null }),
      openDetails: (detailsId) => set({ detailsId }),
      openRules: (strategyId, opts = {}) => set({ rulesFor: { strategyId, afterTrade: opts.afterTrade ?? false } }),
      closeRules: () => set({ rulesFor: null }),
      setProtectPrompt: (protectPrompt) => set({ protectPrompt }),
      openAlerts: (prefill = null) => set({ dialog: "alerts", alertPrefill: prefill, dialogsTouched: true }),
      // an adjustment draft lives on the followed strategy (ADR-044): following anything else, or a tab that clears the pane source, discards it
      // ADR-058 addendum: any route that would throw the work away asks first; the workbench shows the question
      followStrategy: (id, force = false) => {
        const s = get();
        if (!force && s.adjust && s.adjust.strategyId !== id && hasAdjustWork(s.adjust)) {
          set({ adjustDiscard: () => get().followStrategy(id, true) });
          return;
        }
        set({ paneSource: id === null ? null : { kind: "strategy", id }, adjust: s.adjust && s.adjust.strategyId === id ? s.adjust : null, adjustDiscard: null });
      },
      analysePositions: (productIds, force = false) => {
        if (!force && hasAdjustWork(get().adjust)) {
          set({ adjustDiscard: () => get().analysePositions(productIds, true) });
          return;
        }
        set({ paneSource: productIds.length ? { kind: "positions", productIds: [...productIds] } : null, adjust: null, adjustDiscard: null });
      },
      setTemplatesStrip: (templatesStrip) => set({ templatesStrip }),
      setWorkspaceTab: (workspaceTab, force = false) => {
        const clears = workspaceTab === "builder" || workspaceTab === "chain";
        if (clears && !force && hasAdjustWork(get().adjust)) {
          set({ adjustDiscard: () => get().setWorkspaceTab(workspaceTab, true) });
          return;
        }
        set(clears ? { workspaceTab, paneSource: null, adjust: null, adjustDiscard: null } : { workspaceTab });
      },
      setAnalysisTab: (analysisTab) => set({ analysisTab }),
      setBuilderTab: (builderTab) => set({ builderTab }),
      setTarget: (patch) =>
        set((st) => ({
          targetPrice: patch.price === undefined ? st.targetPrice : patch.price,
          targetDays: patch.days === undefined ? st.targetDays : Math.max(0, Math.round(patch.days)),
        })),
      setChainRange: (chainRange) => set({ chainRange: isChainRange(chainRange) ? chainRange : 12 }),
      setChartLayer: (key, on) => set((s) => ({ chartLayers: { ...s.chartLayers, [key]: on } })),
      setLadderStep: (ladderStep) => set({ ladderStep: isLadderStep(ladderStep) ? ladderStep : 1 }),
      setAnalyseCollapse: (analyseCollapse) => set({ analyseCollapse }),
      requestTemplate: (templateRequest) => set({ templateRequest }),
      setBroker: (brokerId) => set({ brokerId }),
      setAccount: (accountId) => set({ accountId }),
      requestSaveDraft: (saveDraftRequest) => set({ saveDraftRequest }),
      recentreChain: () => set((s) => ({ chainRecentre: s.chainRecentre + 1 })),
      setChainColumns: (layout) => set({ chainColumns: normaliseLayout(layout) }),
      addLeg: (input) => {
        const result = addLegPure(get().legs[input.asset], input);
        if (result.ok) {
          set((s) => ({ legs: { ...s.legs, [input.asset]: result.legs } }));
          emitTour("leg-added"); // the tour's "add a leg" step advances (HC-SH-068)
        }
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
      requestTour: () => set((s) => ({ tourRequested: s.tourRequested + 1 })),
      toggleWatch: (symbol) => set((s) => ({ watchlist: s.watchlist.includes(symbol) ? s.watchlist.filter((x) => x !== symbol) : [...s.watchlist, symbol] })),
      openAssistant: (question) => set((s) => ({ assistantRequested: s.assistantRequested + 1, assistantQuestion: question ?? null })),
      openAdjust: (strategyId, force = false, venue) => {
        const s = get();
        if (s.adjust?.strategyId === strategyId) {
          set({ paneSource: { kind: "strategy", id: strategyId }, detailsId: null }); // already adjusting it: keep the work
          return;
        }
        if (!force && hasAdjustWork(s.adjust)) {
          set({ adjustDiscard: () => get().openAdjust(strategyId, true, venue) });
          return;
        }
        if (venue !== undefined && venue !== s.venue) {
          set({ adjustDiscard: null }); // the discard question (if there was one) is answered; the venue question takes over, the draft stays until it is confirmed
          get().requestVenue(venue, () => get().openAdjust(strategyId, true, venue)); // the workbench picks from the strategy's own chain
          return;
        }
        set({ adjust: newDraft(strategyId), paneSource: { kind: "strategy", id: strategyId }, detailsId: null, adjustDiscard: null });
      },
      closeAdjust: (force = false) => {
        if (!force && hasAdjustWork(get().adjust)) {
          set({ adjustDiscard: () => get().closeAdjust(true) });
          return;
        }
        set({ adjust: null, adjustDiscard: null });
      },
      keepAdjust: () => set({ adjustDiscard: null }),
      updateAdjust: (fn) => set((s) => (s.adjust ? { adjust: fn(s.adjust) } : {})),
      addRiskAlert: (strategyId, maxLoss) => {
        const alert: RiskAlert = { id: `ra_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`, strategyId, maxLoss: -Math.abs(maxLoss), createdAt: Date.now() };
        // one alert per strategy: a new threshold replaces the old one
        set((s) => ({ riskAlerts: [...s.riskAlerts.filter((a) => a.strategyId !== strategyId), alert] }));
        return alert;
      },
      removeRiskAlert: (id) => set((s) => ({ riskAlerts: s.riskAlerts.filter((a) => a.id !== id) })),
    }),
    {
      name: UI_STORAGE_KEY,
      partialize: (s) => ({
        venue: s.venue,
        asset: s.asset,
        expiry: s.expiry,
        feedPaused: s.feedPaused,
        chainRange: s.chainRange,
        chartLayers: s.chartLayers,
        ladderStep: s.ladderStep,
        analyseCollapse: s.analyseCollapse,
        brokerId: s.brokerId,
        accountId: s.accountId,
        chainColumns: s.chainColumns,
        legs: s.legs,
        chainLots: s.chainLots,
        lotsDefault: s.lotsDefault,
        strategy: s.strategy,
        adminCols: s.adminCols,
        watchlist: s.watchlist,
        workspaceTab: s.workspaceTab,
        analysisTab: s.analysisTab,
        targetDays: s.targetDays,
        templatesStrip: s.templatesStrip,
        protectPrompt: s.protectPrompt,
        riskAlerts: s.riskAlerts,
      }),
      merge: (persisted, current) => {
        // ADR-088: an old browser's Phase 2 draft keys are dropped here, never carried into the state
        const raw = { ...((persisted ?? {}) as Record<string, unknown>) };
        delete raw["drafts"];
        delete raw["draftsImported"];
        const p = raw as Partial<UiState>;
        const venue = (VENUES as readonly string[]).includes(p.venue ?? "") ? (p.venue as VenueId) : DEFAULT_VENUE;
        const tabs: WorkspaceTab[] = ["chain", "builder", "paper", "live", "journal", "screener"];
        const atabs: AnalysisTab[] = ["payoff", "scenarios", "greeks", "vol", "structure", "ladder", "backtest", "replay"];
        return {
          ...current,
          ...p,
          venue,
          asset: (getVenueCore(venue).underlyings as readonly string[]).includes(p.asset ?? current.asset) ? (p.asset ?? current.asset) : (getVenueCore(venue).underlyings[0] ?? current.asset),
          chainRange: isChainRange(p.chainRange) ? p.chainRange : current.chainRange,
          chartLayers: normaliseLayers(p.chartLayers),
          ladderStep: isLadderStep(p.ladderStep) ? p.ladderStep : 1,
          analyseCollapse: p.analyseCollapse === "left" || p.analyseCollapse === "right" ? p.analyseCollapse : null,
          templateRequest: null,
          alertPrefill: null,
          brokerId: typeof p.brokerId === "string" && p.brokerId ? p.brokerId : null,
          accountId: typeof p.accountId === "string" && p.accountId ? p.accountId : null,
          saveDraftRequest: false,
          chainColumns: p.chainColumns === undefined ? current.chainColumns : normaliseLayout(p.chainColumns),
          legs: p.legs === undefined ? current.legs : normaliseLegsByAsset(p.legs),
          // a browser that persisted lots under an older default (10) gets the new default once; later choices stick
          chainLots: p.lotsDefault === DEFAULT_LOTS && typeof p.chainLots === "number" && Number.isInteger(p.chainLots) && p.chainLots > 0 ? p.chainLots : current.chainLots,
          lotsDefault: DEFAULT_LOTS,
          optionDetail: null,
          strategy: p.strategy === undefined ? current.strategy : normaliseMetaByAsset(p.strategy),
          adminCols: p.adminCols && typeof p.adminCols === "object" ? p.adminCols : {},
          watchlist: Array.isArray(p.watchlist) ? p.watchlist.filter((x): x is string => typeof x === "string") : [],
          templatesStrip: p.templatesStrip !== false,
          workspaceTab: tabs.includes(p.workspaceTab as WorkspaceTab) ? (p.workspaceTab as WorkspaceTab) : current.workspaceTab,
          analysisTab: atabs.includes(p.analysisTab as AnalysisTab) ? (p.analysisTab as AnalysisTab) : current.analysisTab,
          builderTab: current.builderTab,
          targetPrice: null,
          targetDays: typeof p.targetDays === "number" && p.targetDays >= 0 ? Math.round(p.targetDays) : 0,
          adjust: null,
          venueSwitch: null,
          riskAlerts: normaliseRiskAlerts(p.riskAlerts),
        };
      },
    },
  ),
);

// the plain modules (symbol codec, calendar, lot sizes) read the venue through lib/venue without importing the store
bindVenueSource(() => useUiStore.getState().venue);

export const ASSET_META: Record<Underlying, { name: string; symbol: string; glyph: string }> = {
  BTC: { name: "Bitcoin", symbol: "BTCUSD", glyph: "₿" },
  ETH: { name: "Ethereum", symbol: "ETHUSD", glyph: "Ξ" },
  XAUT: { name: "Tether Gold", symbol: "XAUTUSD", glyph: "Au" },
};
