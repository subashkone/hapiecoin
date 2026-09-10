import { describe, expect, it } from "vitest";
import { TEMPLATES, TEMPLATE_CATEGORIES, guessTemplateName, isTemplateName, materialiseTemplate, templateByName } from "./templates";

const rows = Array.from({ length: 11 }, (_, i) => {
  const strike = String(79_000 + i * 200);
  return { strike, call: { mark: String(1000 - i * 50), markIv: 0.3 }, put: { mark: String(500 + i * 50), markIv: 0.35 } };
});
const base = { asset: "BTC" as const, expiry: "2026-09-25", expiries: ["2026-09-25", "2026-10-30", "2026-11-27"], rows, atm: 5, lots: 10 };

describe("HC-TR-037 / HC-TR-039 the 28 templates", () => {
  it("has 28 named templates across the four categories with ATM-relative legs", () => {
    expect(TEMPLATES).toHaveLength(28);
    expect(new Set(TEMPLATES.map((t) => t.name)).size).toBe(28);
    expect(TEMPLATE_CATEGORIES).toEqual(["All", "Bullish", "Bearish", "Neutral", "Others"]);
    for (const cat of ["Bullish", "Bearish", "Neutral", "Others"]) expect(TEMPLATES.some((t) => t.category === cat)).toBe(true);
    expect(templateByName("Iron Condor")?.legs).toHaveLength(4);
    expect(templateByName("nope")).toBeUndefined();
  });
});

describe("HC-TR-040 materialiseTemplate places legs on the venue ladder around ATM (ADR-006)", () => {
  it("uses rows away from ATM, multiplies lots and copies mark and IV", () => {
    const r = materialiseTemplate(templateByName("Bull Call Spread")!, base);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error("expected ok");
    expect(r.legs.map((l) => [l.kind, l.side, l.strike, l.lots, l.price])).toEqual([
      ["call", "buy", "80000", 10, "750"],
      ["call", "sell", "80400", 10, "650"],
    ]);
    const fly = materialiseTemplate(templateByName("Long Call Butterfly")!, base);
    if (!fly.ok) throw new Error("expected ok");
    expect(fly.legs.map((l) => l.lots)).toEqual([10, 20, 10]);
    expect(fly.legs[1]?.strike).toBe("80000");
  });
  it("calendars take the next listed expiry and fall back to the base rows when that chain is unknown", () => {
    const cal = materialiseTemplate(templateByName("Long Calendar with Calls")!, base);
    if (!cal.ok) throw new Error("expected ok");
    expect(cal.legs.map((l) => l.expiry)).toEqual(["2026-09-25", "2026-10-30"]);
    const other = { rows: rows.slice(2), atm: 3 };
    const withRows = materialiseTemplate(templateByName("Long Calendar with Puts")!, { ...base, rowsByExpiry: { "2026-10-30": other } });
    if (!withRows.ok) throw new Error("expected ok");
    expect(withRows.legs[1]?.strike).toBe(other.rows[3]!.strike);
    const last = materialiseTemplate(templateByName("Long Calendar with Calls")!, { ...base, expiry: "2026-11-27" });
    if (!last.ok) throw new Error("expected ok");
    expect(last.legs.map((l) => l.expiry)).toEqual(["2026-11-27", "2026-11-27"]);
  });
  it("refuses instead of inventing a strike when the ladder is too short or a side is unquoted", () => {
    expect(materialiseTemplate(templateByName("Iron Condor")!, { ...base, atm: 1 })).toEqual({ ok: false, reason: "out-of-range" });
    expect(materialiseTemplate(templateByName("Buy Call")!, { ...base, rows: [], atm: -1 })).toEqual({ ok: false, reason: "no-chain" });
    const unquoted = rows.map((r) => ({ strike: r.strike, call: r.call }));
    expect(materialiseTemplate(templateByName("Buy Put")!, { ...base, rows: unquoted })).toEqual({ ok: false, reason: "no-quote" });
  });
});

describe("HC-TR-044 guessTemplateName", () => {
  it("names common shapes", () => {
    expect(guessTemplateName([])).toBe("Empty");
    expect(guessTemplateName([{ kind: "call", side: "buy", strike: "1" }])).toBe("Buy Call");
    expect(guessTemplateName([{ kind: "future", side: "sell", strike: "" }])).toBe("Futures");
    expect(guessTemplateName([{ kind: "put", side: "buy", strike: "1" }, { kind: "put", side: "sell", strike: "2" }])).toBe("Put Spread");
    expect(guessTemplateName([{ kind: "call", side: "buy", strike: "1" }, { kind: "put", side: "buy", strike: "1" }])).toBe("Long Straddle");
    expect(guessTemplateName([{ kind: "call", side: "sell", strike: "2" }, { kind: "put", side: "sell", strike: "1" }])).toBe("Short Strangle");
    expect(guessTemplateName(new Array(4).fill({ kind: "call", side: "buy", strike: "1" }))).toBe("Condor / Butterfly");
    expect(guessTemplateName(new Array(3).fill({ kind: "call", side: "buy", strike: "1" }))).toBe("Custom");
  });
});

describe("HC-TR-155 a template name is not a trader's name", () => {
  it("matches the template list case-insensitively and nothing else", () => {
    expect(isTemplateName("Iron Butterfly")).toBe(true);
    expect(isTemplateName("  short strangle ")).toBe(true);
    expect(isTemplateName("My iron fly")).toBe(false);
    expect(isTemplateName("")).toBe(false);
  });
});

describe("HC-WS-109 two legs across expiries are a calendar or a diagonal, not a spread (ADR-059)", () => {
  it("names by strike and expiry", () => {
    const l = (side: "buy" | "sell", strike: string, expiry: string, kind: "call" | "put" = "call") => ({ kind, side, strike, expiry });
    expect(guessTemplateName([l("sell", "77200", "2026-09-12"), l("buy", "77200", "2026-09-13")])).toBe("Call Calendar");
    expect(guessTemplateName([l("sell", "77200", "2026-09-12", "put"), l("buy", "77200", "2026-09-13", "put")])).toBe("Put Calendar");
    expect(guessTemplateName([l("sell", "77200", "2026-09-12"), l("buy", "78000", "2026-09-13")])).toBe("Call Diagonal");
    expect(guessTemplateName([l("sell", "77200", "2026-09-12"), l("buy", "78000", "2026-09-12")])).toBe("Call Spread");
  });
});
