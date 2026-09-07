import { beforeEach, describe, expect, it } from "vitest";
import { LAYOUT_IDS, defaultLayout } from "./chain/layout";
import { ASSET_META, UI_STORAGE_KEY, useUiStore } from "./store";

beforeEach(() => {
  useUiStore.setState({
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
  it("persists only asset / expiry / feedPaused / chainRange", () => {
    useUiStore.getState().setAsset("XAUT");
    useUiStore.getState().openDialog("profile");
    const raw = window.localStorage.getItem(UI_STORAGE_KEY);
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw!) as { state: Record<string, unknown> };
    expect(parsed.state).toEqual({
      asset: "XAUT",
      expiry: {},
      feedPaused: false,
      chainRange: 12,
      chainColumns: defaultLayout(),
      legs: { BTC: [], ETH: [], XAUT: [] },
      chainLots: 10,
    });
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
    expect(useUiStore.getState().chainLots).toBe(10);
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
