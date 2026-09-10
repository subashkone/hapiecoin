// Keyboard shortcuts registry (Phase 5 item 3, ADR-053; HC-SH-101..104, HC-WS-070). The default rows describe the
// keys the shell and the workspace already handle; other parts register their own with `registerShortcut`, which
// also lists them in the "?" help. The dispatcher (components/shell/ShortcutsDispatcher.tsx) runs the handlers.

export type ShortcutGroup = "Global" | "Analyse workspace" | (string & {});

export interface ShortcutRow {
  /** The key as shown, e.g. "T", "Shift+E", "Ctrl K", "?". */
  key: string;
  description: string;
  group: ShortcutGroup;
}

export interface RegisteredShortcut extends ShortcutRow {
  /** Runs on keydown when the key matches (case-insensitive single characters; "Shift+X" needs Shift). */
  handler: (e: KeyboardEvent) => void;
  /** Run even while typing in a field or with a dialog open. */
  always: boolean;
}

/** The rows the shell and the workspace handle themselves (HC-SH-103, HC-WS-070). */
export const DEFAULT_SHORTCUTS: readonly ShortcutRow[] = [
  { key: "Ctrl K", description: "Command palette", group: "Global" },
  { key: "?", description: "Keyboard shortcuts help", group: "Global" },
  { key: "T", description: "Toggle theme (dark / light)", group: "Global" },
  { key: "D", description: "Toggle density (comfortable / compact)", group: "Global" },
  { key: "Esc", description: "Close dialogs, menus and panels", group: "Global" },
  { key: "J", description: "Next strike", group: "Analyse workspace" },
  { key: "K", description: "Previous strike", group: "Analyse workspace" },
  { key: "↓", description: "Next strike", group: "Analyse workspace" },
  { key: "↑", description: "Previous strike", group: "Analyse workspace" },
  { key: "B", description: "Buy call at the highlighted strike", group: "Analyse workspace" },
  { key: "S", description: "Sell call at the highlighted strike", group: "Analyse workspace" },
  { key: "Shift+B", description: "Buy put at the highlighted strike", group: "Analyse workspace" },
  { key: "Shift+S", description: "Sell put at the highlighted strike", group: "Analyse workspace" },
  { key: "E", description: "Next expiry", group: "Analyse workspace" },
  { key: "Shift+E", description: "Previous expiry", group: "Analyse workspace" },
  { key: "Enter", description: "Option details for the highlighted strike", group: "Analyse workspace" },
  { key: "A", description: "Recentre the chain on ATM", group: "Analyse workspace" },
  { key: "P", description: "Paper trade the Builder legs", group: "Analyse workspace" },
];

const registered = new Map<string, RegisteredShortcut>();
const listeners = new Set<() => void>();
let snapshot: ShortcutRow[] = [...DEFAULT_SHORTCUTS];

function notify() {
  snapshot = [...DEFAULT_SHORTCUTS, ...registered.values()];
  for (const l of listeners) l();
}

/** Add a shortcut (HC-SH-104); returns the unregister function. A second registration of the same key replaces the first. */
export function registerShortcut(key: string, description: string, handler: (e: KeyboardEvent) => void, opts: { group?: ShortcutGroup; always?: boolean } = {}): () => void {
  registered.set(key, { key, description, handler, group: opts.group ?? "Global", always: opts.always ?? false });
  notify();
  return () => unregisterShortcut(key);
}
export function unregisterShortcut(key: string): void {
  if (registered.delete(key)) notify();
}
/** Every row for the help dialog: the defaults, then whatever other parts registered. */
export function listShortcuts(): readonly ShortcutRow[] {
  return snapshot;
}
export function subscribeShortcuts(l: () => void): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}
/** Tests: drop every registration. */
export function resetShortcuts(): void {
  registered.clear();
  notify();
}

/** Whether a keydown happened while typing (HC-SH-101): inputs, textareas, selects, contenteditable. */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable === true || target.getAttribute("contenteditable") === "true";
}

/** Match a keydown against a row key ("T", "Shift+E", "?"). Modifier combos other than Shift never match a registered row. */
export function matchesKey(e: Pick<KeyboardEvent, "key" | "shiftKey" | "ctrlKey" | "metaKey" | "altKey">, key: string): boolean {
  if (e.ctrlKey || e.metaKey || e.altKey) return false;
  const wantShift = key.startsWith("Shift+");
  const base = wantShift ? key.slice(6) : key;
  if (base.length === 1 && /[a-z]/i.test(base)) {
    if (e.key.toLowerCase() !== base.toLowerCase()) return false;
    return wantShift ? e.shiftKey : !e.shiftKey;
  }
  return e.key === base;
}

/** The registered handler for a keydown, honouring `always` for typing targets and open dialogs. */
export function findRegistered(e: Pick<KeyboardEvent, "key" | "shiftKey" | "ctrlKey" | "metaKey" | "altKey">, blocked: boolean): RegisteredShortcut | null {
  for (const r of registered.values()) {
    if (blocked && !r.always) continue;
    if (matchesKey(e, r.key)) return r;
  }
  return null;
}
