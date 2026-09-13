import { beforeEach, describe, expect, it } from "vitest";
import { newDraft } from "./adjust/model";
import { LAYOUT_IDS, defaultLayout } from "./chain/layout";
import { ASSET_META, UI_STORAGE_KEY, hasAdjustWork, useUiStore } from "./store";

beforeEach(() => {
  useUiStore.setState({
    venue: "delta_india",
    asset: "BTC",
    expiry: {},
    feedPaused: false,
    dialog: null,
    dialogsTouched: false,
    paletteOpen: false,
    chainRange: 12,
    chainRecentre: 0,
    legs: { BTC: [], ETH: [], XAUT: [] },
    chainLots: 10,
    lotsDefault: 100,
    optionDetail: null,
  });
});

describe("HC-SH-003 UI store", () => {
  it("switches asset and remembers an expiry per asset", () => {
    const s = useUiStore.getState();
    s.setAsset("ETH");
    s.setExpiry("ETH", "2026-09-25");
    expect(useUiStore.getState().asset).toBe("ETH");
    expect(useUiStore.getState().expiry).toEqual({ ETH: "2026-09-25" });
    s.setExpiry("ETH", null);
    expect(useUiStore.getState().expiry.ETH).toBeNull();
  });
  it("tracks feed pause, dialog and palette state", () => {
    const s = useUiStore.getState();
    s.setFeedPaused(true);
    s.openDialog("api");
    s.setPaletteOpen(true);
    expect(useUiStore.getState()).toMatchObject({ feedPaused: true, dialog: "api", dialogsTouched: true, paletteOpen: true });
    s.closeDialog();
    expect(useUiStore.getState().dialog).toBeNull();
  });
  it("persists only asset / expiry / feedPaused / chainRange / chartLayers", () => {
    useUiStore.getState().setAsset("XAUT");
    useUiStore.getState().openDialog("profile");
    const raw = window.localStorage.getItem(UI_STORAGE_KEY);
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw!) as { state: Record<string, unknown> };
    expect(parsed.state).toEqual({
      venue: "delta_india",
      asset: "XAUT",
      expiry: {},
      feedPaused: false,
      chainRange: 12,
      chartLayers: { expiry: true, target: true, fill: true, oi: false, band: true, breakeven: true, ivUp: false, ivDown: false },
      ladderStep: 1,
      analyseCollapse: null,
      brokerId: null,
      accountId: null,
      chainColumns: defaultLayout(),
      legs: { BTC: [], ETH: [], XAUT: [] },
      chainLots: 10,
      lotsDefault: 100,
      strategy: {
        BTC: { name: "", basket: false, priceMode: "live", draftId: null },
        ETH: { name: "", basket: false, priceMode: "live", draftId: null },
        XAUT: { name: "", basket: false, priceMode: "live", draftId: null },
      },
      adminCols: {},
      watchlist: [],
      workspaceTab: "chain",
      analysisTab: "payoff",
      targetDays: 0, templatesStrip: true, protectPrompt: true,
      riskAlerts: [],
    });
  });
  it("Builder meta per asset, legs limits, tabs and target (drafts themselves are server rows since ADR-024; the browser hopper went with ADR-088)", () => {
    const s = useUiStore.getState();
    const input = { asset: "BTC" as const, kind: "call" as const, side: "buy" as const, strike: "79400", expiry: "2026-09-07", lots: 10, price: "807.5", iv: 0.27 };
    s.addLeg(input);
    s.setStrategyMeta("BTC", { name: "My spread", basket: true, priceMode: "custom" });
    expect(useUiStore.getState().strategy.BTC).toMatchObject({ name: "My spread", basket: true, priceMode: "custom", draftId: null });
    expect(useUiStore.getState().strategy.ETH.basket).toBe(false);
    // limit on replace, tabs and target
    const many = Array.from({ length: 11 }, (_, i) => ({ ...useUiStore.getState().legs.BTC[0]!, id: `x${i}` }));
    expect(s.setLegs("BTC", many)).toBe(false);
    s.updateLegs("BTC", (legs) => legs.slice(0, 1));
    expect(useUiStore.getState().legs.BTC).toHaveLength(1);
    s.setWorkspaceTab("paper");
    s.setAnalysisTab("greeks");
    s.setBuilderTab("templates");
    s.setTarget({ price: 81_000, days: 3.6 });
    expect(useUiStore.getState()).toMatchObject({ workspaceTab: "paper", analysisTab: "greeks", builderTab: "templates", targetPrice: 81_000, targetDays: 4 });
    s.setTarget({ price: null });
    expect(useUiStore.getState().targetPrice).toBeNull();
    // persisted meta is normalised; the builder sub-tab and target price are not persisted; the Phase 2 draft keys of an old browser are ignored (ADR-088)
    const merge = useUiStore.persist.getOptions().merge;
    if (!merge) throw new Error("persist merge missing");
    const current = useUiStore.getState();
    const merged = merge(
      { drafts: [{ id: "a", name: "A", asset: "BTC", status: "weird", legs: "x" }], draftsImported: false, strategy: { BTC: { name: 42, priceMode: "custom" } }, workspaceTab: "nope", analysisTab: "ladder", targetDays: -2 },
      current,
    );
    expect(merged).not.toHaveProperty("drafts");
    expect(merged).not.toHaveProperty("draftsImported");
    expect(merged.strategy.BTC).toEqual({ name: "", basket: false, priceMode: "custom", draftId: null });
    // ADR-028: lots persisted under the old default are lifted to 100 once; a choice made under the new default sticks
    expect(merge({ chainLots: 10 }, current).chainLots).toBe(current.chainLots); // no lotsDefault marker: the current default wins
    expect(merge({ chainLots: 25, lotsDefault: 100 }, current).chainLots).toBe(25);
    expect(merge({ chainLots: 25, lotsDefault: 100 }, current).lotsDefault).toBe(100);
    expect(merged.workspaceTab).toBe(current.workspaceTab);
    expect(merged.analysisTab).toBe("ladder");
    expect(merged.targetDays).toBe(0);
    expect(merged.targetPrice).toBeNull();
  });
  it("HC-TR-017 / HC-TR-018 keeps legs per asset with the limit, remembers chain lots and opens the details dialog", () => {
    const s = useUiStore.getState();
    const input = { asset: "BTC" as const, kind: "call" as const, side: "buy" as const, strike: "79400", expiry: "2026-09-07", lots: 10, price: "807.5", iv: 0.27 };
    const r = s.addLeg(input);
    expect(r.ok).toBe(true);
    expect(useUiStore.getState().legs.BTC).toHaveLength(1);
    expect(useUiStore.getState().legs.ETH).toHaveLength(0);
    for (let i = 1; i < 10; i += 1) s.addLeg({ ...input, strike: String(79_400 + i * 200) });
    expect(s.addLeg(input)).toEqual({ ok: false, reason: "limit" });
    expect(useUiStore.getState().legs.BTC).toHaveLength(10);
    // another asset keeps its own list (ADR-010)
    expect(s.addLeg({ ...input, asset: "ETH", strike: "4200" }).ok).toBe(true);
    s.setAsset("ETH");
    expect(useUiStore.getState().legs.BTC).toHaveLength(10);
    const first = useUiStore.getState().legs.BTC[0]!;
    s.removeLeg("BTC", first.id);
    expect(useUiStore.getState().legs.BTC).toHaveLength(9);
    s.setChainLots(25);
    expect(useUiStore.getState().chainLots).toBe(25);
    s.setChainLots(7);
    expect(useUiStore.getState().chainLots).toBe(7);
    s.setChainLots(-3);
    expect(useUiStore.getState().chainLots).toBe(100);
    s.openOptionDetail({ asset: "BTC", expiry: "2026-09-07", strike: "79400", kind: "put" });
    expect(useUiStore.getState().dialog).toBe("option");
    expect(useUiStore.getState().optionDetail?.kind).toBe("put");
    // persisted legs are normalised on the way back in; the dialog target is not persisted
    const merge = useUiStore.persist.getOptions().merge;
    if (!merge) throw new Error("persist merge missing");
    const current = useUiStore.getState();
    const merged = merge({ legs: { BTC: [first, { id: "bad" }], ETH: "x" }, chainLots: 0, optionDetail: { asset: "BTC" } }, current);
    expect(merged.legs.BTC).toHaveLength(1);
    expect(merged.legs.ETH).toEqual([]);
    expect(merged.chainLots).toBe(current.chainLots);
    expect(merged.optionDetail).toBeNull();
  });
  it("HC-WS-014 stores a normalised column layout and migrates what it reads back", () => {
    const s = useUiStore.getState();
    s.setChainColumns({ v: 2, order: ["delta", "ask"], visible: ["delta", "nope" as never] });
    const l = useUiStore.getState().chainColumns;
    expect(l.order.slice(0, 2)).toEqual(["delta", "ask"]);
    expect(l.order).toHaveLength(LAYOUT_IDS.length);
    expect(l.visible).toEqual(["delta"]);
    const merge = useUiStore.persist.getOptions().merge;
    if (!merge) throw new Error("persist merge missing");
    const current = useUiStore.getState();
    expect(merge({ chainColumns: { v: 1, order: [], visible: [] } }, current).chainColumns).toEqual(defaultLayout());
    expect(merge({}, current).chainColumns).toEqual(current.chainColumns);
  });
  it("HC-WS-016 keeps the chain range (rejecting unknown values) and counts recentre requests", () => {
    const s = useUiStore.getState();
    s.setChainRange(6);
    expect(useUiStore.getState().chainRange).toBe(6);
    s.setChainRange(0);
    expect(useUiStore.getState().chainRange).toBe(0);
    s.setChainRange(7 as unknown as 6);
    expect(useUiStore.getState().chainRange).toBe(12);
    s.recentreChain();
    s.recentreChain();
    expect(useUiStore.getState().chainRecentre).toBe(2);
  });
  it("ignores a persisted chain range it does not recognise", () => {
    const merge = useUiStore.persist.getOptions().merge;
    if (!merge) throw new Error("persist merge missing");
    const current = useUiStore.getState();
    expect(merge({ chainRange: 99 }, current).chainRange).toBe(current.chainRange);
    expect(merge({ chainRange: 6 }, current).chainRange).toBe(6);
    expect(merge(undefined, current).chainRange).toBe(current.chainRange);
  });
  it("has metadata for every underlying", () => {
    expect(ASSET_META.BTC.symbol).toBe("BTCUSD");
    expect(ASSET_META.XAUT.name).toBe("Tether Gold");
  });
});

describe("HC-TR-148 adjustment workbench draft (ADR-044)", () => {
  it("opens on a strategy, follows it in the pane, updates through the pure model and closes; never persisted", () => {
    const st = useUiStore.getState();
    st.openDetails("strat_1");
    st.openAdjust("strat_1");
    expect(useUiStore.getState().adjust).toMatchObject({ strategyId: "strat_1", picks: [], lotsAfter: {}, valuation: null });
    expect(useUiStore.getState().paneSource).toEqual({ kind: "strategy", id: "strat_1" });
    expect(useUiStore.getState().detailsId).toBeNull();
    st.updateAdjust((d) => ({ ...d, lotsAfter: { leg_1: 40 } }));
    expect(useUiStore.getState().adjust?.lotsAfter).toEqual({ leg_1: 40 });
    expect(JSON.parse(localStorage.getItem(UI_STORAGE_KEY) ?? "{}")).not.toHaveProperty("state.adjust");
    // with work in the draft every route out asks first (ADR-058 addendum): the action waits in adjustDiscard
    st.closeAdjust();
    expect(useUiStore.getState().adjust?.lotsAfter).toEqual({ leg_1: 40 });
    expect(useUiStore.getState().adjustDiscard).toBeTypeOf("function");
    st.keepAdjust();
    expect(useUiStore.getState().adjustDiscard).toBeNull();
    st.followStrategy("strat_2");
    expect(useUiStore.getState().paneSource).toEqual({ kind: "strategy", id: "strat_1" });
    st.setWorkspaceTab("builder");
    expect(useUiStore.getState().workspaceTab).not.toBe("builder"); // parked, not switched
    st.analysePositions([7]);
    st.openAdjust("strat_2");
    expect(useUiStore.getState().adjust?.strategyId).toBe("strat_1");
    st.openAdjust("strat_1"); // the same strategy keeps the work
    expect(useUiStore.getState().adjust?.lotsAfter).toEqual({ leg_1: 40 });
    useUiStore.getState().adjustDiscard!(); // answering the last question runs it
    expect(useUiStore.getState().adjust?.strategyId).toBe("strat_2");
    expect(useUiStore.getState().adjustDiscard).toBeNull();
    st.closeAdjust();
    expect(useUiStore.getState().adjust).toBeNull();
    // what counts as work: an order key, a pick, or a saved plan; a forced close clears a pending question
    expect(hasAdjustWork(null)).toBe(false);
    expect(hasAdjustWork(newDraft("s"))).toBe(false);
    expect(hasAdjustWork({ ...newDraft("s"), lotsAfter: { leg_1: 40 } })).toBe(true);
    expect(hasAdjustWork({ ...newDraft("s"), plans: [{ id: "plan_1", name: "Plan A", lotsAfter: {}, picks: [], valuation: null }] })).toBe(true);
    st.openAdjust("strat_1");
    st.updateAdjust((d) => ({ ...d, plans: [{ id: "plan_1", name: "Plan A", lotsAfter: {}, picks: [], valuation: null }] }));
    st.closeAdjust();
    expect(useUiStore.getState().adjustDiscard).toBeTypeOf("function");
    st.closeAdjust(true);
    expect(useUiStore.getState().adjust).toBeNull();
    expect(useUiStore.getState().adjustDiscard).toBeNull();
    st.updateAdjust((d) => ({ ...d, valuation: "2026-09-25" })); // no draft: nothing happens
    expect(useUiStore.getState().adjust).toBeNull();
    // leaving the followed strategy discards the draft: another strategy, positions, or the Builder / Chain tab
    st.openAdjust("strat_1");
    st.followStrategy("strat_1");
    expect(useUiStore.getState().adjust?.strategyId).toBe("strat_1");
    st.followStrategy("strat_2");
    expect(useUiStore.getState().adjust).toBeNull();
    st.openAdjust("strat_1");
    st.analysePositions([7]);
    expect(useUiStore.getState().adjust).toBeNull();
    st.openAdjust("strat_1");
    st.setWorkspaceTab("live");
    expect(useUiStore.getState().adjust?.strategyId).toBe("strat_1");
    st.setWorkspaceTab("builder");
    expect(useUiStore.getState().adjust).toBeNull();
    expect(useUiStore.getState().paneSource).toBeNull();
    st.openAdjust("strat_1");
    st.followStrategy(null);
    expect(useUiStore.getState().adjust).toBeNull();
  });
});

describe("ADR-044 risk alert stub from the workbench", () => {
  it("keeps one alert per strategy as a negative USD threshold, persists it and drops bad entries on load", () => {
    const st = useUiStore.getState();
    const a = st.addRiskAlert("strat_1", 1200);
    expect(a.maxLoss).toBe(-1200);
    st.addRiskAlert("strat_2", -300);
    st.addRiskAlert("strat_1", 800); // replaces
    expect(useUiStore.getState().riskAlerts.map((x) => [x.strategyId, x.maxLoss])).toEqual([
      ["strat_2", -300],
      ["strat_1", -800],
    ]);
    const persisted = JSON.parse(localStorage.getItem(UI_STORAGE_KEY) ?? "{}") as { state: { riskAlerts: unknown[] } };
    expect(persisted.state.riskAlerts).toHaveLength(2);
    st.removeRiskAlert(a.id); // already replaced: nothing to remove
    st.removeRiskAlert(useUiStore.getState().riskAlerts[0]!.id);
    expect(useUiStore.getState().riskAlerts.map((x) => x.strategyId)).toEqual(["strat_1"]);
    const merge = useUiStore.persist.getOptions().merge;
    if (!merge) throw new Error("persist merge missing");
    const merged = merge({ riskAlerts: [{ id: "ra_ok", strategyId: "s", maxLoss: -5 }, { id: 7 }, "x"] }, useUiStore.getState());
    expect(merged.riskAlerts).toEqual([{ id: "ra_ok", strategyId: "s", maxLoss: -5, createdAt: 0 }]);
  });
});

describe("HC-WS-083 chart layers persist", () => {
  it("toggles one layer, keeps the rest, and normalises a partial persisted object", async () => {
    const { useUiStore, DEFAULT_LAYERS } = await import("./store");
    useUiStore.setState({ chartLayers: { ...DEFAULT_LAYERS } });
    useUiStore.getState().setChartLayer("ivUp", true);
    expect(useUiStore.getState().chartLayers.ivUp).toBe(true);
    expect(useUiStore.getState().chartLayers.expiry).toBe(true);
    const merged = (useUiStore.persist.getOptions().merge as (p: unknown, c: ReturnType<typeof useUiStore.getState>) => ReturnType<typeof useUiStore.getState>)({ chartLayers: { oi: true, ivDown: "yes" } }, useUiStore.getState());
    expect(merged.chartLayers).toEqual({ ...DEFAULT_LAYERS, oi: true });
  });
});

describe("HC-WS-065 / HC-WS-103 pane collapse and ladder step persist", () => {
  it("stores the collapsed pane and the ladder step, and drops bad persisted values", async () => {
    const { useUiStore } = await import("./store");
    useUiStore.getState().setAnalyseCollapse("right");
    useUiStore.getState().setLadderStep(4);
    expect(useUiStore.getState()).toMatchObject({ analyseCollapse: "right", ladderStep: 4 });
    useUiStore.getState().setLadderStep(3 as unknown as 1);
    expect(useUiStore.getState().ladderStep).toBe(1);
    const merge = useUiStore.persist.getOptions().merge as (p: unknown, c: ReturnType<typeof useUiStore.getState>) => ReturnType<typeof useUiStore.getState>;
    const merged = merge({ ladderStep: 9, analyseCollapse: "up", templateRequest: "Iron Condor" }, useUiStore.getState());
    expect(merged).toMatchObject({ ladderStep: 1, analyseCollapse: null, templateRequest: null });
    useUiStore.getState().requestTemplate("Iron Condor");
    expect(useUiStore.getState().templateRequest).toBe("Iron Condor");
    useUiStore.getState().setAnalyseCollapse(null);
  });
});

describe("HC-TR-140 / HC-TR-142 broker and save-draft request", () => {
  it("persists the chosen exchange and keeps the save request transient", async () => {
    const { useUiStore } = await import("./store");
    useUiStore.getState().setBroker("brk_delta");
    useUiStore.getState().requestSaveDraft(true);
    expect(useUiStore.getState()).toMatchObject({ brokerId: "brk_delta", saveDraftRequest: true });
    const merge = useUiStore.persist.getOptions().merge as (p: unknown, c: ReturnType<typeof useUiStore.getState>) => ReturnType<typeof useUiStore.getState>;
    expect(merge({ brokerId: "", saveDraftRequest: true }, useUiStore.getState())).toMatchObject({ brokerId: null, saveDraftRequest: false });
    expect(merge({ brokerId: "brk_x" }, useUiStore.getState()).brokerId).toBe("brk_x");
    expect(merge({ accountId: "crd_sub1" }, useUiStore.getState()).accountId).toBe("crd_sub1"); // the account chosen last (ADR-068)
    expect(merge({ accountId: "" }, useUiStore.getState()).accountId).toBeNull();
    useUiStore.getState().requestSaveDraft(false);
    useUiStore.getState().setBroker(null);
  });
});

describe("HC-SH-079 / HC-SH-100 alerts dialog and prefill", () => {
  it("opens the Alerts dialog on the list or on the form with a prefill; the prefill is transient", async () => {
    const { useUiStore } = await import("./store");
    useUiStore.getState().openAlerts();
    expect(useUiStore.getState()).toMatchObject({ dialog: "alerts", alertPrefill: null });
    useUiStore.getState().openAlerts({ kind: "pnl", strategyId: "strat_1", asset: "BTC" });
    expect(useUiStore.getState().alertPrefill).toEqual({ kind: "pnl", strategyId: "strat_1", asset: "BTC" });
    const merge = useUiStore.persist.getOptions().merge as (p: unknown, c: ReturnType<typeof useUiStore.getState>) => ReturnType<typeof useUiStore.getState>;
    expect(merge({ alertPrefill: { kind: "price" } }, useUiStore.getState()).alertPrefill).toBeNull();
    useUiStore.getState().closeDialog();
    useUiStore.setState({ alertPrefill: null });
  });
});

describe("HC-SH-124 the workspace venue (ADR-069)", () => {
  it("defaults to Delta India, persists, and a stale persisted id falls back to the default", () => {
    expect(useUiStore.getState().venue).toBe("delta_india");
    useUiStore.getState().setVenue("deribit");
    const parsed = JSON.parse(window.localStorage.getItem(UI_STORAGE_KEY)!) as { state: { venue: string } };
    expect(parsed.state.venue).toBe("deribit");
    const merge = useUiStore.persist.getOptions().merge;
    if (!merge) throw new Error("persist merge missing");
    const current = useUiStore.getState();
    expect(merge({ venue: "okx" }, current).venue).toBe("delta_india");
    expect(merge({ venue: "deribit" }, current).venue).toBe("deribit");
    expect(merge({}, current).venue).toBe("delta_india");
  });

  it("switching venue clears the Builder of every asset, drops adjust work and moves an asset the venue does not list", () => {
    const s = useUiStore.getState();
    s.setAsset("XAUT");
    expect(s.addLeg({ asset: "XAUT", kind: "call", side: "buy", strike: "4400", expiry: "2026-09-25", lots: 10, price: "10", iv: 0.3 }).ok).toBe(true);
    s.setStrategyMeta("XAUT", { name: "Gold call" });
    s.setTarget({ price: 4500 });
    s.setVenue("deribit");
    const after = useUiStore.getState();
    expect(after.venue).toBe("deribit");
    expect(after.asset).toBe("BTC"); // Deribit lists BTC and ETH only
    expect(after.legs).toEqual({ BTC: [], ETH: [], XAUT: [] });
    expect(after.strategy.XAUT.name).toBe("");
    expect(after.targetPrice).toBeNull();
    after.setAsset("ETH");
    after.setVenue("delta_india");
    expect(useUiStore.getState().asset).toBe("ETH"); // listed on both venues: kept
    useUiStore.getState().setVenue("delta_india"); // the same venue: a no-op
    expect(useUiStore.getState().venue).toBe("delta_india");
  });
});

describe("HC-SH-124 the workbench and the persisted asset follow the venue (ADR-069)", () => {
  it("requestVenue switches at once without Builder legs, parks the switch behind a question with them, and runs the follow-up", () => {
    const s = useUiStore.getState();
    const ran: string[] = [];
    s.requestVenue("delta_india", () => ran.push("same"));
    expect(ran).toEqual(["same"]); // the same venue: no switch, the follow-up runs
    s.requestVenue("deribit", () => ran.push("switched"));
    expect(useUiStore.getState().venue).toBe("deribit");
    expect(ran).toEqual(["same", "switched"]);
    expect(useUiStore.getState().addLeg({ asset: "BTC", kind: "call", side: "buy", strike: "70000", expiry: "2026-09-12", lots: 1, price: "800", iv: 0.5 }).ok).toBe(true);
    useUiStore.getState().requestVenue("delta_india", () => ran.push("back"));
    expect(useUiStore.getState().venue).toBe("deribit"); // legs exist: parked
    expect(useUiStore.getState().venueSwitch?.venue).toBe("delta_india");
    useUiStore.getState().cancelVenueSwitch();
    expect(useUiStore.getState().venueSwitch).toBeNull();
    expect(useUiStore.getState().legs.BTC).toHaveLength(1);
    useUiStore.getState().requestVenue("delta_india", () => ran.push("back"));
    useUiStore.getState().confirmVenueSwitch();
    expect(useUiStore.getState().venue).toBe("delta_india");
    expect(useUiStore.getState().legs.BTC).toEqual([]);
    expect(ran).toEqual(["same", "switched", "back"]);
    useUiStore.getState().confirmVenueSwitch(); // nothing parked: a no-op
  });

  it("openAdjust on another venue's strategy asks first when Builder legs exist, then opens the workbench on that venue", () => {
    const s = useUiStore.getState();
    expect(s.addLeg({ asset: "BTC", kind: "call", side: "buy", strike: "70000", expiry: "2026-09-25", lots: 1, price: "800", iv: 0.5 }).ok).toBe(true);
    s.openAdjust("strat_d", false, "deribit");
    expect(useUiStore.getState().venue).toBe("delta_india");
    expect(useUiStore.getState().adjust).toBeNull();
    expect(useUiStore.getState().venueSwitch?.venue).toBe("deribit");
    useUiStore.getState().confirmVenueSwitch();
    expect(useUiStore.getState().venue).toBe("deribit");
    expect(useUiStore.getState().adjust?.strategyId).toBe("strat_d");
    expect(useUiStore.getState().legs.BTC).toEqual([]);
    useUiStore.setState({ adjust: null, paneSource: null, venue: "delta_india" });
  });

  it("openAdjust with unsaved workbench work on another venue's strategy: the discard question first, then the venue question, nothing lost silently", () => {
    const s = useUiStore.getState();
    expect(s.addLeg({ asset: "BTC", kind: "call", side: "buy", strike: "70000", expiry: "2026-09-25", lots: 1, price: "800", iv: 0.5 }).ok).toBe(true);
    s.openAdjust("strat_a"); // on the workspace venue
    useUiStore.setState({ adjust: { ...useUiStore.getState().adjust!, lotsAfter: { leg_1: 2 } } }); // an order in the working change
    useUiStore.getState().openAdjust("strat_d", false, "deribit");
    expect(typeof useUiStore.getState().adjustDiscard).toBe("function"); // the discard question comes first
    expect(useUiStore.getState().venueSwitch).toBeNull();
    useUiStore.getState().adjustDiscard!(); // "Discard and leave"
    expect(useUiStore.getState().adjustDiscard).toBeNull(); // that question is closed
    expect(useUiStore.getState().venueSwitch?.venue).toBe("deribit"); // the venue question takes over
    expect(useUiStore.getState().adjust?.strategyId).toBe("strat_a"); // the draft is still there until the switch is confirmed
    useUiStore.getState().cancelVenueSwitch();
    expect(useUiStore.getState().adjust?.strategyId).toBe("strat_a");
    expect(useUiStore.getState().legs.BTC).toHaveLength(1);
    useUiStore.getState().openAdjust("strat_d", false, "deribit");
    useUiStore.getState().adjustDiscard!();
    useUiStore.getState().confirmVenueSwitch();
    expect(useUiStore.getState().venue).toBe("deribit");
    expect(useUiStore.getState().adjust?.strategyId).toBe("strat_d");
    expect(useUiStore.getState().adjustDiscard).toBeNull();
    expect(useUiStore.getState().legs.BTC).toEqual([]);
    useUiStore.setState({ adjust: null, paneSource: null, venue: "delta_india" });
  });

  it("openAdjust on another venue's strategy switches the workspace venue first; the same venue keeps it", () => {
    const s = useUiStore.getState();
    s.openAdjust("strat_d", false, "deribit");
    expect(useUiStore.getState().venue).toBe("deribit");
    expect(useUiStore.getState().adjust?.strategyId).toBe("strat_d");
    expect(useUiStore.getState().paneSource).toEqual({ kind: "strategy", id: "strat_d" });
    useUiStore.getState().openAdjust("strat_d2", false, "deribit");
    expect(useUiStore.getState().venue).toBe("deribit");
    useUiStore.getState().openAdjust("strat_x", false, "delta_india");
    expect(useUiStore.getState().venue).toBe("delta_india");
    expect(useUiStore.getState().adjust?.strategyId).toBe("strat_x");
  });
  it("a persisted asset the persisted venue does not list rehydrates as the venue's first asset", () => {
    const merge = useUiStore.persist.getOptions().merge;
    if (!merge) throw new Error("persist merge missing");
    const current = useUiStore.getState();
    expect(merge({ venue: "deribit", asset: "XAUT" }, current).asset).toBe("BTC");
    expect(merge({ venue: "deribit", asset: "ETH" }, current).asset).toBe("ETH");
    expect(merge({ venue: "delta_india", asset: "XAUT" }, current).asset).toBe("XAUT");
    expect(merge({ venue: "deribit" }, current).asset).toBe(current.asset === "XAUT" ? "BTC" : current.asset);
  });
});
