// Command palette registry and recents (Phase 5 item 3, ADR-053; HC-SH-086, 087, 089). Other parts register commands
// at runtime (custom groups are appended after the defaults); the palette remembers the last commands run.

export type PaletteGroup = "Recent" | "Navigate" | "Actions" | "Settings" | (string & {});

export interface PaletteCommand {
  id: string;
  label: string;
  group: PaletteGroup;
  hint?: string;
  keywords?: string[];
  /** Hidden while false (a command that only makes sense on some screens). */
  when?: () => boolean;
  run: () => void;
}

const registered = new Map<string, PaletteCommand>();
const listeners = new Set<() => void>();
let snapshot: PaletteCommand[] = [];

function notify() {
  snapshot = [...registered.values()];
  for (const l of listeners) l();
}
/** Register a command (HC-SH-089); returns the unregister function. Same id replaces. */
export function registerCommand(cmd: PaletteCommand): () => void {
  registered.set(cmd.id, cmd);
  notify();
  return () => unregisterCommand(cmd.id);
}
export function unregisterCommand(id: string): void {
  if (registered.delete(id)) notify();
}
export function listRegistered(): readonly PaletteCommand[] {
  return snapshot;
}
export function subscribeCommands(l: () => void): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}
export function resetCommands(): void {
  registered.clear();
  notify();
}

export const RECENT_KEY = "hapiecoin.palette.recent";
export const RECENT_MAX = 5;

export function readRecent(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string").slice(0, RECENT_MAX) : [];
  } catch {
    return [];
  }
}
/** Move `id` to the front of the recents; returns the new list. */
export function pushRecent(id: string): string[] {
  const next = [id, ...readRecent().filter((x) => x !== id)].slice(0, RECENT_MAX);
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    /* private mode */
  }
  return next;
}

/** Character indices of `query` inside `text` (case-insensitive): the substring when present, else the subsequence; [] when no match. */
export function matchIndices(text: string, query: string): number[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const t = text.toLowerCase();
  const at = t.indexOf(q);
  if (at >= 0) return Array.from({ length: q.length }, (_, i) => at + i);
  const out: number[] = [];
  let i = 0;
  for (let j = 0; j < t.length && i < q.length; j++) {
    if (t[j] === q[i]) {
      out.push(j);
      i++;
    }
  }
  return i === q.length ? out : [];
}

/** Score a command for a query (HC-SH-086): substring beats subsequence; a match at a word start scores higher; -1 when no match. */
export function scoreCommand(cmd: PaletteCommand, query: string): number {
  const q = query.trim().toLowerCase();
  if (!q) return 0;
  const hay = [cmd.label, ...(cmd.keywords ?? []), cmd.hint ?? ""].map((s) => s.toLowerCase());
  let best = -1;
  for (const h of hay) {
    const at = h.indexOf(q);
    if (at >= 0) best = Math.max(best, 100 - at + (at === 0 || h[at - 1] === " " ? 20 : 0));
    else {
      const idx = matchIndices(h, q);
      if (idx.length) best = Math.max(best, 10 + (idx[0] === 0 || h[(idx[0] ?? 0) - 1] === " " ? 5 : 0));
    }
  }
  return best;
}

export function filterCommands(cmds: readonly PaletteCommand[], query: string): PaletteCommand[] {
  const visible = cmds.filter((c) => (c.when ? c.when() : true));
  if (!query.trim()) return visible;
  return visible
    .map((c) => ({ c, s: scoreCommand(c, query) }))
    .filter((x) => x.s >= 0)
    .sort((a, b) => b.s - a.s)
    .map((x) => x.c);
}

const GROUP_ORDER: readonly string[] = ["Recent", "Navigate", "Actions", "Settings"];
/** Order commands by group (Recent · Navigate · Actions · Settings · custom groups appended), stable within a group. */
export function groupOrder(group: string): number {
  const i = GROUP_ORDER.indexOf(group);
  return i < 0 ? GROUP_ORDER.length : i;
}
