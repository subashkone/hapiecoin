// Shortcuts registry (ADR-053; HC-SH-101, 103, 104; HC-WS-070).
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SHORTCUTS, findRegistered, isTypingTarget, listShortcuts, matchesKey, registerShortcut, resetShortcuts, unregisterShortcut } from "./shortcuts";

afterEach(() => resetShortcuts());

describe("HC-SH-103 / HC-WS-070 default rows", () => {
  it("lists the global keys and the workspace keys", () => {
    const keys = DEFAULT_SHORTCUTS.map((r) => r.key);
    for (const k of ["Ctrl K", "?", "T", "D", "Esc", "J", "K", "↑", "↓", "B", "S", "Shift+B", "Shift+S", "E", "Shift+E", "Enter"]) expect(keys).toContain(k);
    expect(DEFAULT_SHORTCUTS.filter((r) => r.group === "Global")).toHaveLength(5);
    expect(listShortcuts()).toEqual(DEFAULT_SHORTCUTS);
  });
});

describe("HC-SH-104 registry", () => {
  it("registers, lists after the defaults, replaces on the same key and unregisters", () => {
    const handler = vi.fn();
    const off = registerShortcut("X", "Do X", handler, { group: "Other" });
    expect(listShortcuts().at(-1)).toMatchObject({ key: "X", description: "Do X", group: "Other" });
    registerShortcut("X", "Do X again", handler);
    expect(listShortcuts().filter((r) => r.key === "X")).toHaveLength(1);
    expect(listShortcuts().at(-1)?.group).toBe("Global");
    off();
    expect(listShortcuts()).toHaveLength(DEFAULT_SHORTCUTS.length);
    unregisterShortcut("nope"); // no throw
  });
  it("finds the handler for a keydown, honouring always for blocked contexts", () => {
    const a = vi.fn();
    const b = vi.fn();
    registerShortcut("X", "x", a);
    registerShortcut("Shift+Y", "y", b, { always: true });
    expect(findRegistered({ key: "x", shiftKey: false, ctrlKey: false, metaKey: false, altKey: false }, false)?.handler).toBe(a);
    expect(findRegistered({ key: "x", shiftKey: false, ctrlKey: false, metaKey: false, altKey: false }, true)).toBeNull();
    expect(findRegistered({ key: "Y", shiftKey: true, ctrlKey: false, metaKey: false, altKey: false }, true)?.handler).toBe(b);
    expect(findRegistered({ key: "y", shiftKey: false, ctrlKey: false, metaKey: false, altKey: false }, false)).toBeNull();
  });
});

describe("HC-SH-101 matching and typing targets", () => {
  it("matchesKey compares letters case-insensitively, needs Shift for Shift+ combos and refuses other modifiers", () => {
    const k = (key: string, mods: Partial<{ shiftKey: boolean; ctrlKey: boolean; metaKey: boolean; altKey: boolean }> = {}) => ({ key, shiftKey: false, ctrlKey: false, metaKey: false, altKey: false, ...mods });
    expect(matchesKey(k("t"), "T")).toBe(true);
    expect(matchesKey(k("T", { shiftKey: true }), "T")).toBe(false);
    expect(matchesKey(k("E", { shiftKey: true }), "Shift+E")).toBe(true);
    expect(matchesKey(k("e"), "Shift+E")).toBe(false);
    expect(matchesKey(k("t", { ctrlKey: true }), "T")).toBe(false);
    expect(matchesKey(k("?", { shiftKey: true }), "?")).toBe(true);
    expect(matchesKey(k("Enter"), "Enter")).toBe(true);
  });
  it("isTypingTarget covers inputs, textareas, selects and contenteditable", () => {
    expect(isTypingTarget(document.createElement("input"))).toBe(true);
    expect(isTypingTarget(document.createElement("textarea"))).toBe(true);
    expect(isTypingTarget(document.createElement("select"))).toBe(true);
    const div = document.createElement("div");
    expect(isTypingTarget(div)).toBe(false);
    div.setAttribute("contenteditable", "true");
    expect(isTypingTarget(div)).toBe(true);
    expect(isTypingTarget(null)).toBe(false);
  });
});
