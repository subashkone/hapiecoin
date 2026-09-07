import { beforeEach, describe, expect, it } from "vitest";
import { ASSET_META, UI_STORAGE_KEY, useUiStore } from "./store";

beforeEach(() => {
  useUiStore.setState({ asset: "BTC", expiry: {}, feedPaused: false, dialog: null, dialogsTouched: false, paletteOpen: false });
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
  it("persists only asset / expiry / feedPaused", () => {
    useUiStore.getState().setAsset("XAUT");
    useUiStore.getState().openDialog("profile");
    const raw = window.localStorage.getItem(UI_STORAGE_KEY);
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw!) as { state: Record<string, unknown> };
    expect(parsed.state).toEqual({ asset: "XAUT", expiry: {}, feedPaused: false });
  });
  it("has metadata for every underlying", () => {
    expect(ASSET_META.BTC.symbol).toBe("BTCUSD");
    expect(ASSET_META.XAUT.name).toBe("Tether Gold");
  });
});
