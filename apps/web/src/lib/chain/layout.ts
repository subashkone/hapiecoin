// Persisted chain column layout (HC-WS-012, HC-WS-013, HC-WS-014, HC-WS-073): which columns show and in
// what order, counted from the strike outward. Pure functions so the store, the dialog and the tests share
// one definition; the column ids themselves live in components/chain/columns.ts.

export const LAYOUT_VERSION = 2;

/** Column ids known to this build, in the default order (nearest the strike first). */
export const LAYOUT_IDS = [
  "ask",
  "mark",
  "bid",
  "oi",
  "delta",
  "gamma",
  "theta",
  "vega",
  "volume",
  "bidQty",
  "askQty",
  "chg24",
  "last",
] as const;
export type LayoutColumnId = (typeof LAYOUT_IDS)[number];

export const LAYOUT_ESSENTIALS: readonly LayoutColumnId[] = ["ask", "mark", "bid", "oi", "delta"];
export const LAYOUT_GREEKS: readonly LayoutColumnId[] = ["gamma", "theta", "vega"];

export interface ChainLayout {
  v: typeof LAYOUT_VERSION;
  order: LayoutColumnId[];
  visible: LayoutColumnId[];
}

export type LayoutPreset = "essentials" | "all" | "none" | "reset";

function isId(x: unknown): x is LayoutColumnId {
  return typeof x === "string" && (LAYOUT_IDS as readonly string[]).includes(x);
}

export function defaultLayout(): ChainLayout {
  return { v: LAYOUT_VERSION, order: [...LAYOUT_IDS], visible: [...LAYOUT_ESSENTIALS] };
}

/**
 * Bring any stored value to a complete, valid layout: unknown ids are dropped, missing ids appended in
 * default order, duplicates removed, and an older version (or garbage) falls back to the default.
 */
export function normaliseLayout(input: unknown): ChainLayout {
  const base = defaultLayout();
  if (typeof input !== "object" || input === null) return base;
  const o = input as { v?: unknown; order?: unknown; visible?: unknown };
  if (o.v !== LAYOUT_VERSION || !Array.isArray(o.order) || !Array.isArray(o.visible)) return base;
  const order: LayoutColumnId[] = [];
  for (const id of o.order) if (isId(id) && !order.includes(id)) order.push(id);
  for (const id of LAYOUT_IDS) if (!order.includes(id)) order.push(id);
  const visible: LayoutColumnId[] = [];
  for (const id of o.visible) if (isId(id) && !visible.includes(id)) visible.push(id);
  return { v: LAYOUT_VERSION, order, visible };
}

export function toggleColumn(layout: ChainLayout, id: LayoutColumnId): ChainLayout {
  const visible = layout.visible.includes(id) ? layout.visible.filter((x) => x !== id) : [...layout.visible, id];
  return { ...layout, visible };
}

/** Move a column one step towards (−1) or away from (+1) the strike, or to an absolute index; clamped. */
export function moveColumn(layout: ChainLayout, id: LayoutColumnId, delta: number): ChainLayout {
  const i = layout.order.indexOf(id);
  if (i < 0) return layout;
  const j = Math.max(0, Math.min(layout.order.length - 1, i + delta));
  if (j === i) return layout;
  const order = [...layout.order];
  order.splice(i, 1);
  order.splice(j, 0, id);
  return { ...layout, order };
}

/** Place `id` at the position of `beforeId` (drag and drop); no-op when either is unknown. */
export function moveColumnTo(layout: ChainLayout, id: LayoutColumnId, beforeId: LayoutColumnId): ChainLayout {
  if (id === beforeId) return layout;
  const without = layout.order.filter((x) => x !== id);
  const j = without.indexOf(beforeId);
  if (j < 0 || !layout.order.includes(id)) return layout;
  without.splice(j, 0, id);
  return { ...layout, order: without };
}

export function applyPreset(layout: ChainLayout, preset: LayoutPreset): ChainLayout {
  switch (preset) {
    case "essentials":
      return { ...layout, visible: [...LAYOUT_ESSENTIALS] };
    case "all":
      return { ...layout, visible: [...LAYOUT_IDS] };
    case "none":
      return { ...layout, visible: [] };
    case "reset":
      return defaultLayout();
  }
}

export function greeksShown(layout: ChainLayout): boolean {
  return LAYOUT_GREEKS.every((id) => layout.visible.includes(id));
}

/** Show or hide Γ Θ ν together (HC-WS-073). */
export function setGreeks(layout: ChainLayout, on: boolean): ChainLayout {
  const visible = on
    ? [...layout.visible, ...LAYOUT_GREEKS.filter((id) => !layout.visible.includes(id))]
    : layout.visible.filter((id) => !LAYOUT_GREEKS.includes(id));
  return { ...layout, visible };
}

export function sameLayout(a: ChainLayout, b: ChainLayout): boolean {
  return a.order.join(",") === b.order.join(",") && a.visible.join(",") === b.visible.join(",");
}
