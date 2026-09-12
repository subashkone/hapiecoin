import { describe, expect, it } from "vitest";
import { guessTemplateName, isTemplateName } from "./templates";

// The catalogue and placement tests live with the code in packages/pricing/src/templates.test.ts (ADR-077); this file keeps the web-only naming.

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
