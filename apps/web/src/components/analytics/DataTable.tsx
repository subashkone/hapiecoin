"use client";
// Sortable, searchable analytics table (HC-MA-011, 099..101, 103): sticky header, right-aligned mono numbers, column
// visibility menu, CSV copy, watchlist star, row links. Columns render their own cells; sortVal drives ordering.
import { Button, Input, TBody, THead, Table, Td, Th, Tr, cn, toast } from "@hapiecoin/ui";
import { useRouter } from "next/navigation";
import { type ReactNode, useMemo, useState } from "react";
import { useUiStore } from "@/lib/store";

export interface Column<R> {
  key: string;
  label: string;
  align?: "l" | "r" | "c";
  render?: (row: R) => ReactNode;
  sortVal?: (row: R) => number | string | null;
  csv?: (row: R) => string;
  hidden?: boolean;
  sort?: boolean;
}
export interface DataTableProps<R> {
  id: string;
  rows: R[];
  cols: Column<R>[];
  rowKey: (row: R) => string;
  sortKey?: string;
  sortDir?: "asc" | "desc";
  search?: boolean;
  searchText?: (row: R) => string;
  searchPlaceholder?: string;
  columns?: boolean;
  csv?: string;
  star?: (row: R) => string;
  /** Checkbox column for compare mode (HC-MA-110): `max` selected at once, the rest are disabled. */
  select?: { get: (row: R) => string; selected: readonly string[]; onToggle: (id: string) => void; max?: number; label?: string };
  rowHref?: (row: R) => string;
  limit?: number;
  maxH?: number;
  empty?: string;
  compact?: boolean;
  foot?: ReactNode;
}

/** Primitive field text for search and CSV when a column has no renderer. */
function rawText<R>(row: R, key: string): string {
  const v = (row as Record<string, unknown>)[key];
  return typeof v === "string" || typeof v === "number" ? String(v) : "";
}
function cellText(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(cellText).join("");
  if (typeof node === "object" && "props" in node) {
    const props = (node as { props: { children?: ReactNode } }).props;
    return cellText(props.children);
  }
  return "";
}

export function DataTable<R>(p: DataTableProps<R>) {
  const router = useRouter();
  const [sortKey, setSortKey] = useState<string | null>(p.sortKey ?? null);
  const [dir, setDir] = useState<"asc" | "desc">(p.sortDir ?? "desc");
  const [q, setQ] = useState("");
  const [hidden, setHidden] = useState<Set<string>>(() => new Set(p.cols.filter((c) => c.hidden).map((c) => c.key)));
  const [colsOpen, setColsOpen] = useState(false);
  const watch = useUiStore((s) => s.watchlist);
  const toggleWatch = useUiStore((s) => s.toggleWatch);
  const visible = p.cols.filter((c) => !hidden.has(c.key));
  const rows = useMemo(() => {
    let out = [...p.rows];
    const needle = q.trim().toLowerCase();
    if (needle) out = out.filter((r) => (p.searchText ? p.searchText(r) : p.cols.map((c) => (c.render ? cellText(c.render(r)) : rawText(r, c.key))).join(" ")).toLowerCase().includes(needle));
    const col = p.cols.find((c) => c.key === sortKey);
    if (col) {
      const val = (r: R): number | string | null => (col.sortVal ? col.sortVal(r) : ((r as Record<string, unknown>)[col.key] as number | string | null | undefined) ?? null);
      out.sort((a, b) => {
        const av = val(a);
        const bv = val(b);
        if (av === null && bv === null) return 0;
        if (av === null) return 1;
        if (bv === null) return -1;
        const c = typeof av === "number" && typeof bv === "number" ? av - bv : String(av).localeCompare(String(bv));
        return dir === "asc" ? c : -c;
      });
    }
    return out;
  }, [p.rows, p.cols, p.searchText, q, sortKey, dir]);
  const shown = p.limit ? rows.slice(0, p.limit) : rows;
  const onSort = (key: string) => {
    if (sortKey === key) setDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setDir("desc");
    }
  };
  const copyCsv = () => {
    const cols = visible;
    const lines = [cols.map((c) => c.label).join(","), ...rows.map((r) => cols.map((c) => `"${(c.csv ? c.csv(r) : c.render ? cellText(c.render(r)) : rawText(r, c.key)).replace(/"/g, '""')}"`).join(","))];
    const text = lines.join("\n");
    void navigator.clipboard
      .writeText(text)
      .then(() => toast.success("Copied!", { description: `${rows.length} rows · ${p.csv ?? p.id}.csv` }))
      .catch(() => toast.error("Could not copy", { description: "Clipboard blocked by the browser" }));
  };
  const wantSearch = p.search === true || (p.search !== false && p.rows.length > 15);
  const wantBar = wantSearch || p.columns || p.csv;
  return (
    <div data-testid={`table-${p.id}`} data-rows={shown.length} data-sort={sortKey ?? ""} data-dir={dir}>
      {wantBar ? (
        <div className="mb-2 flex flex-wrap items-center gap-2">
          {wantSearch ? <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={p.searchPlaceholder ?? "Search…"} className="h-7 max-w-[220px] text-xs" aria-label="Search rows" data-testid="table-search" /> : null}
          <span className="micro">{rows.length} rows</span>
          <span className="flex-1" />
          {p.columns ? (
            <div className="relative">
              <Button size="sm" variant="outline" onClick={() => setColsOpen((o) => !o)} aria-expanded={colsOpen} data-testid="table-columns">Columns ▾</Button>
              {colsOpen ? (
                <div className="absolute right-0 top-full z-20 mt-1 w-[200px] rounded-md border border-border bg-popover p-2 text-xs shadow-md" role="menu" data-testid="table-columns-menu">
                  {p.cols.map((c) => (
                    <label key={c.key} className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 hover:bg-muted">
                      <input type="checkbox" checked={!hidden.has(c.key)} onChange={() => setHidden((s) => { const n = new Set(s); if (n.has(c.key)) n.delete(c.key); else n.add(c.key); return n; })} data-testid={`col-${c.key}`} />
                      {c.label}
                    </label>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
          {p.csv ? <Button size="sm" variant="outline" onClick={copyCsv} data-testid="table-csv">CSV</Button> : null}
        </div>
      ) : null}
      <div className={cn(p.maxH && "overflow-y-auto")} style={p.maxH ? { maxHeight: p.maxH } : undefined}>
      <Table compact={p.compact ?? false}>
        <THead className="sticky top-0 z-10 bg-card">
          <Tr>
            {p.star ? <Th className="w-7" aria-label="Watch" /> : null}
            {p.select ? <Th className="w-9 text-2xs">{p.select.label ?? "Cmp"}</Th> : null}
            {visible.map((c) => (
              <Th key={c.key} numeric={c.align === "r"} className={cn(c.align === "c" && "text-center", c.sort !== false && "cursor-pointer select-none hover:text-foreground")} onClick={c.sort === false ? undefined : () => onSort(c.key)} aria-sort={sortKey === c.key ? (dir === "asc" ? "ascending" : "descending") : "none"} data-testid={`th-${c.key}`}>
                {c.label}
                {sortKey === c.key ? <span className="ml-1 text-2xs">{dir === "asc" ? "▲" : "▼"}</span> : null}
              </Th>
            ))}
          </Tr>
        </THead>
        <TBody>
          {shown.length === 0 ? (
            <Tr>
              <Td colSpan={visible.length + (p.star ? 1 : 0) + (p.select ? 1 : 0)} className="py-6 text-center text-muted-foreground">
                {q ? `No rows match “${q}”` : (p.empty ?? "No data")}
              </Td>
            </Tr>
          ) : (
            shown.map((r) => {
              const href = p.rowHref?.(r);
              const sym = p.star?.(r);
              const sel = p.select;
              const selId = sel?.get(r);
              const selOn = selId !== undefined && sel !== undefined && sel.selected.includes(selId);
              const selFull = sel !== undefined && sel.max !== undefined && sel.selected.length >= sel.max;
              return (
                <Tr key={p.rowKey(r)} className={cn(href && "cursor-pointer")} onClick={href ? () => router.push(href) : undefined} data-testid="table-row" data-key={p.rowKey(r)}>
                  {sym !== undefined ? (
                    <Td className="w-7">
                      <button type="button" onClick={(e) => { e.stopPropagation(); toggleWatch(sym); }} aria-pressed={watch.includes(sym)} aria-label={watch.includes(sym) ? `Unwatch ${sym}` : `Watch ${sym}`} className={cn("text-[13px]", watch.includes(sym) ? "text-accent" : "text-muted-foreground/60 hover:text-foreground")} data-testid="star">
                        {watch.includes(sym) ? "★" : "☆"}
                      </button>
                    </Td>
                  ) : null}
                  {sel !== undefined && selId !== undefined ? (
                    <Td className="w-9">
                      <input type="checkbox" checked={selOn} disabled={!selOn && selFull} onClick={(e) => e.stopPropagation()} onChange={() => sel.onToggle(selId)} aria-label={`Compare ${selId}`} title={!selOn && selFull ? `Up to ${sel.max} at once` : "Compare"} data-testid="select-row" />
                    </Td>
                  ) : null}
                  {visible.map((c) => (
                    <Td key={c.key} numeric={c.align === "r"} className={cn(c.align === "c" && "text-center")}>
                      {c.render ? c.render(r) : rawText(r, c.key)}
                    </Td>
                  ))}
                </Tr>
              );
            })
          )}
        </TBody>
      </Table>
      </div>
      {p.foot}
    </div>
  );
}
