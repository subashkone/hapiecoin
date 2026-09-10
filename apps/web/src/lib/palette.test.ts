// Palette registry, recents, matching and grouping (ADR-053; HC-SH-086, 087, 089).
import { afterEach, describe, expect, it, vi } from "vitest";
import { RECENT_KEY, filterCommands, groupOrder, listRegistered, matchIndices, pushRecent, readRecent, registerCommand, resetCommands, scoreCommand, unregisterCommand, type PaletteCommand } from "./palette";

const cmd = (id: string, label: string, group: PaletteCommand["group"] = "Actions", extra: Partial<PaletteCommand> = {}): PaletteCommand => ({ id, label, group, run: vi.fn(), ...extra });

afterEach(() => {
  resetCommands();
  localStorage.removeItem(RECENT_KEY);
});

describe("HC-SH-086 matching", () => {
  it("matchIndices returns the substring span, else the subsequence, else nothing", () => {
    expect(matchIndices("Open Journal", "jour")).toEqual([5, 6, 7, 8]);
    expect(matchIndices("Open Journal", "ojl")).toEqual([0, 5, 11]);
    expect(matchIndices("Open Journal", "zz")).toEqual([]);
    expect(matchIndices("Open Journal", "")).toEqual([]);
  });
  it("scoreCommand ranks substrings above subsequences and word starts above mid-word hits", () => {
    const journal = cmd("a", "Open Journal");
    const alerts = cmd("b", "Alerts center", "Actions", { keywords: ["bell"] });
    expect(scoreCommand(journal, "journal")).toBeGreaterThan(scoreCommand(journal, "jnl"));
    expect(scoreCommand(journal, "open")).toBeGreaterThan(scoreCommand(journal, "pen"));
    expect(scoreCommand(alerts, "bell")).toBeGreaterThan(0); // keywords count
    expect(scoreCommand(alerts, "xyz")).toBe(-1);
    expect(scoreCommand(alerts, "")).toBe(0);
  });
  it("filterCommands drops commands whose `when` is false and sorts matches by score", () => {
    const list = [cmd("a", "Open Journal"), cmd("b", "Journal: export", "Actions", { when: () => false }), cmd("c", "Analytics: Whales")];
    expect(filterCommands(list, "").map((c) => c.id)).toEqual(["a", "c"]);
    expect(filterCommands(list, "journal").map((c) => c.id)).toEqual(["a"]);
  });
});

describe("HC-SH-087 / HC-SH-089 groups, recents and the registry", () => {
  it("orders Recent · Navigate · Actions · Settings, custom groups last", () => {
    expect([groupOrder("Recent"), groupOrder("Navigate"), groupOrder("Actions"), groupOrder("Settings"), groupOrder("Terminal")]).toEqual([0, 1, 2, 3, 4]);
  });
  it("remembers the last five commands, most recent first, deduplicated", () => {
    expect(readRecent()).toEqual([]);
    for (const id of ["a", "b", "c", "d", "e", "f"]) pushRecent(id);
    expect(readRecent()).toEqual(["f", "e", "d", "c", "b"]);
    expect(pushRecent("d")).toEqual(["d", "f", "e", "c", "b"]);
    localStorage.setItem(RECENT_KEY, "not json");
    expect(readRecent()).toEqual([]);
  });
  it("registers commands for the palette, replaces on id and unregisters", () => {
    const off = registerCommand(cmd("x", "Custom one", "Terminal"));
    expect(listRegistered().map((c) => c.id)).toEqual(["x"]);
    registerCommand(cmd("x", "Custom two", "Terminal"));
    expect(listRegistered()).toHaveLength(1);
    expect(listRegistered()[0]?.label).toBe("Custom two");
    off();
    expect(listRegistered()).toEqual([]);
    unregisterCommand("none");
  });
});
