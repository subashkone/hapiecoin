import { describe, expect, it } from "vitest";
import {
  LAYOUT_ESSENTIALS,
  LAYOUT_GREEKS,
  LAYOUT_IDS,
  applyPreset,
  defaultLayout,
  greeksShown,
  moveColumn,
  moveColumnTo,
  normaliseLayout,
  sameLayout,
  setGreeks,
  toggleColumn,
} from "./layout";

describe("HC-WS-014 normaliseLayout migrates, drops unknown ids and appends missing ones", () => {
  it("returns the default for garbage, older versions and missing arrays", () => {
    const d = defaultLayout();
    expect(normaliseLayout(undefined)).toEqual(d);
    expect(normaliseLayout(null)).toEqual(d);
    expect(normaliseLayout("x")).toEqual(d);
    expect(normaliseLayout({ v: 1, order: ["ask"], visible: ["ask"] })).toEqual(d);
    expect(normaliseLayout({ v: 2, order: "ask", visible: [] })).toEqual(d);
    expect(d.visible).toEqual([...LAYOUT_ESSENTIALS]);
    expect(d.order).toEqual([...LAYOUT_IDS]);
  });
  it("keeps a valid stored order, drops unknown ids, removes duplicates and appends new columns", () => {
    const stored = { v: 2, order: ["delta", "ask", "ask", "open", 7], visible: ["delta", "high", "delta", "gamma"] };
    const n = normaliseLayout(stored);
    expect(n.order.slice(0, 2)).toEqual(["delta", "ask"]);
    expect(n.order).toHaveLength(LAYOUT_IDS.length);
    expect(new Set(n.order).size).toBe(LAYOUT_IDS.length);
    expect(n.visible).toEqual(["delta", "gamma"]);
  });
});

describe("HC-WS-011 / HC-WS-012 toggles and presets", () => {
  it("toggles one column and applies each preset", () => {
    const d = defaultLayout();
    const off = toggleColumn(d, "ask");
    expect(off.visible).not.toContain("ask");
    expect(toggleColumn(off, "ask").visible).toContain("ask");
    expect(applyPreset(off, "essentials").visible).toEqual([...LAYOUT_ESSENTIALS]);
    expect(applyPreset(off, "all").visible).toEqual([...LAYOUT_IDS]);
    expect(applyPreset(off, "none").visible).toEqual([]);
    const moved = moveColumn(off, "last", -12);
    expect(applyPreset(moved, "reset")).toEqual(d);
    expect(sameLayout(applyPreset(moved, "reset"), d)).toBe(true);
    expect(sameLayout(moved, d)).toBe(false);
  });
});

describe("HC-WS-013 moveColumn clamps at the ends and moveColumnTo drops before a target", () => {
  it("moves by steps and clamps", () => {
    const d = defaultLayout();
    expect(moveColumn(d, "ask", -1).order[0]).toBe("ask");
    expect(moveColumn(d, "ask", 1).order.slice(0, 2)).toEqual(["mark", "ask"]);
    expect(moveColumn(d, "last", 5).order[d.order.length - 1]).toBe("last");
    expect(moveColumn(d, "delta", -4).order[0]).toBe("delta");
    expect(moveColumn(d, "delta", -99).order[0]).toBe("delta");
    expect(moveColumn(d, "open" as never, 1)).toBe(d);
  });
  it("drops a dragged column before the target", () => {
    const d = defaultLayout();
    expect(moveColumnTo(d, "last", "ask").order.slice(0, 2)).toEqual(["last", "ask"]);
    expect(moveColumnTo(d, "ask", "bid").order.slice(0, 3)).toEqual(["mark", "ask", "bid"]);
    expect(moveColumnTo(d, "ask", "ask")).toBe(d);
    expect(moveColumnTo(d, "ask", "open" as never)).toBe(d);
  });
});

describe("HC-WS-073 greeks toggle adds and removes Γ Θ ν together", () => {
  it("reports and sets the Greek trio", () => {
    const d = defaultLayout();
    expect(greeksShown(d)).toBe(false);
    const on = setGreeks(d, true);
    expect(greeksShown(on)).toBe(true);
    expect(on.visible.slice(-3)).toEqual([...LAYOUT_GREEKS]);
    expect(setGreeks(on, true).visible).toHaveLength(on.visible.length);
    const off = setGreeks(on, false);
    expect(greeksShown(off)).toBe(false);
    expect(off.visible).toEqual([...LAYOUT_ESSENTIALS]);
  });
});
