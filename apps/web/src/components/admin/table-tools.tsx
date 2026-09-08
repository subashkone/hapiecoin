"use client";
// Shared admin table tools (HC-AD-092..096; docs/design/admin.md §6): sortable headers, a Columns menu whose choice
// persists per page, Copy CSV of the visible columns, and the floating bulk bar. Used by User Management first;
// the other admin tables adopt them as they are touched.
import { Button, cn, toast } from "@hapiecoin/ui";
import { useState, type ReactNode } from "react";
import { Menu, MenuItem, MenuSeparator } from "@/components/shell/Menu";
import { useUiStore } from "@/lib/store";

export interface ColumnDef<Row> {
  key: string;
  label: string;
  /** Hidden until switched on in the Columns menu (HC-AD-109). */
  hidden?: boolean;
  /** Sort key on the server; undefined = not sortable. */
  sort?: string;
  align?: "left" | "right";
  /** Text for the CSV (HC-AD-096); the cell renders separately. */
  csv: (row: Row) => string;
}

/** Visible column keys for a page, persisted in the UI store; at least one column always stays (HC-AD-093). */
export function useAdminColumns<Row>(page: string, defs: readonly ColumnDef<Row>[]): { visible: ColumnDef<Row>[]; shown: Set<string>; toggle: (key: string) => void; reset: () => void; isDefault: boolean } {
  const stored = useUiStore((s) => s.adminCols[page]);
  const setAdminCols = useUiStore((s) => s.setAdminCols);
  const defaults = defs.filter((d) => !d.hidden).map((d) => d.key);
  const shown = new Set(stored ?? defaults);
  const visible = defs.filter((d) => shown.has(d.key));
  return {
    visible,
    shown,
    toggle: (key) => {
      const next = new Set(shown);
      if (next.has(key)) {
        if (next.size === 1) return toast("At least one column must stay");
        next.delete(key);
      } else next.add(key);
      setAdminCols(page, defs.filter((d) => next.has(d.key)).map((d) => d.key));
    },
    reset: () => setAdminCols(page, null),
    isDefault: stored === undefined || stored === null,
  };
}

export function ColumnsMenu<Row>({ defs, columns, testId = "columns" }: { defs: readonly ColumnDef<Row>[]; columns: ReturnType<typeof useAdminColumns<Row>>; testId?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <Button size="sm" variant="ghost" onClick={() => setOpen((o) => !o)} aria-haspopup="menu" aria-expanded={open} data-testid={`${testId}-button`}>
        Columns ▾
      </Button>
      <Menu open={open} onClose={() => setOpen(false)} label="Columns" testId={`${testId}-menu`}>
        {defs.map((d) => (
          <label key={d.key} className="flex items-center gap-2 rounded-sm px-2 py-1 text-xs hover:bg-muted" data-testid={`${testId}-${d.key}`}>
            <input type="checkbox" checked={columns.shown.has(d.key)} onChange={() => columns.toggle(d.key)} aria-label={`Show ${d.label}`} />
            {d.label}
          </label>
        ))}
        <MenuSeparator />
        <MenuItem onSelect={() => { columns.reset(); setOpen(false); }} testId={`${testId}-reset`}>Reset to default</MenuItem>
      </Menu>
    </div>
  );
}

export interface SortState {
  sort: string;
  dir: "asc" | "desc";
}
/** Click toggles direction; a first click on a date or number column starts descending (HC-AD-094). */
export function nextSort(current: SortState, key: string, numeric: boolean): SortState {
  if (current.sort === key) return { sort: key, dir: current.dir === "asc" ? "desc" : "asc" };
  return { sort: key, dir: numeric ? "desc" : "asc" };
}
export function SortHeader({ label, sortKey, state, onSort, numeric = false, align = "left", testId }: { label: string; sortKey?: string | undefined; state: SortState; onSort: (s: SortState) => void; numeric?: boolean; align?: "left" | "right"; testId?: string }) {
  if (!sortKey) return <span className={cn(align === "right" && "block text-right")}>{label}</span>;
  const active = state.sort === sortKey;
  return (
    <button type="button" className={cn("micro hover:text-foreground", align === "right" && "w-full text-right", active && "text-foreground")} onClick={() => onSort(nextSort(state, sortKey, numeric))} aria-sort={active ? (state.dir === "asc" ? "ascending" : "descending") : "none"} data-testid={testId}>
      {label} {active ? (state.dir === "asc" ? "▲" : "▼") : ""}
    </button>
  );
}

/** CSV of the given rows over the visible columns (HC-AD-096). */
export function rowsCsv<Row>(rows: readonly Row[], columns: readonly ColumnDef<Row>[]): string {
  const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
  return [columns.map((c) => esc(c.label)).join(","), ...rows.map((r) => columns.map((c) => esc(c.csv(r))).join(","))].join("\n");
}
export async function copyCsv<Row>(rows: readonly Row[], columns: readonly ColumnDef<Row>[], what: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(rowsCsv(rows, columns));
    toast.success("Copied!", { description: `${rows.length} ${rows.length === 1 ? "row" : "rows"} × ${columns.length} columns · ${what}` });
  } catch {
    toast.error("Could not copy", { description: "Your browser blocked the clipboard" });
  }
}

/** Floating bar under the table while rows are selected (HC-AD-095). */
export function FloatingBar({ count, onClear, children, testId = "floating-bar" }: { count: number; onClear: () => void; children: ReactNode; testId?: string }) {
  if (count === 0) return null;
  return (
    <div className="sticky bottom-3 z-20 mt-3 flex flex-wrap items-center gap-2 rounded border border-border bg-popover px-3 py-2 text-xs shadow-[0_14px_40px_-14px_rgba(0,0,0,0.7)]" role="toolbar" aria-label="Bulk actions" data-testid={testId}>
      <span className="font-medium" data-testid={`${testId}-count`}>{count} selected</span>
      {children}
      <span className="flex-1" />
      <Button size="sm" variant="ghost" onClick={onClear} data-testid={`${testId}-clear`}>Clear</Button>
    </div>
  );
}
