"use client";
// Admin · Menu Pricing Master (HC-AD-020..028, 113, 114): priced items a plan can link, with linked-plan counts.
import type { MenuItem, MenuItemInput } from "@hapiecoin/schema";
import { Button, Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, EmptyState, Input, Switch, cn, toast } from "@hapiecoin/ui";
import { useMemo, useState } from "react";
import { useAdminMenuItems, useBulkMenuItems, useCreateMenuItem, useUpdateMenuItem } from "@/lib/api/billing";
import { fmtInr } from "@/lib/billing/format";
import { AdminHeader, BulkBar } from "./AdminShell";

function MenuItemDialog({ open, onOpenChange, editing }: { open: boolean; onOpenChange: (o: boolean) => void; editing: MenuItem | null }) {
  const [form, setForm] = useState<MenuItemInput>(() => (editing ? { displayName: editing.displayName, category: editing.category, priceInr: editing.priceInr, active: editing.active } : { displayName: "", category: "Trading", priceInr: "0", active: true }));
  const create = useCreateMenuItem();
  const update = useUpdateMenuItem();
  const save = () => {
    if (!form.displayName.trim()) {
      toast.error("Validation", { description: "Display Name is required" });
      return;
    }
    const opts = { onSuccess: () => { toast.success(editing ? "Updated" : "Created", { description: form.displayName }); onOpenChange(false); }, onError: (e: Error) => toast.error("Failed to save", { description: e.message }) };
    if (editing) update.mutate({ id: editing.id, body: form }, opts);
    else create.mutate(form, opts);
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[440px]" data-testid="menu-item-dialog">
        <DialogHeader>
          <DialogTitle>{editing ? "Edit Menu Item" : "New Menu Item"}</DialogTitle>
          <DialogDescription>Items are linked to plans from the plan dialog.</DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-2">
          <label className="block text-xs"><span className="micro">Display Name *</span><Input value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} placeholder="e.g. Reports Export" data-testid="menu-name" /></label>
          <label className="block text-xs"><span className="micro">Category</span><Input value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} placeholder="e.g. Trading, Analytics, Data" data-testid="menu-category" /></label>
          <label className="block text-xs"><span className="micro">Price (₹)</span><Input type="number" min={0} value={form.priceInr} onChange={(e) => setForm({ ...form, priceInr: e.target.value })} data-testid="menu-price" /></label>
          <label className="flex items-center gap-2 text-xs"><Switch checked={form.active} onCheckedChange={(on) => setForm({ ...form, active: on })} aria-label="Active" /> Active</label>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button loading={create.isPending || update.isPending} onClick={save} data-testid="menu-save">{editing ? "Update" : "Create"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function MenuItemsAdmin() {
  const items = useAdminMenuItems();
  const update = useUpdateMenuItem();
  const bulk = useBulkMenuItems();
  const [q, setQ] = useState("");
  const [category, setCategory] = useState("all");
  const [status, setStatus] = useState<"all" | "active" | "inactive">("all");
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [dialog, setDialog] = useState<{ editing: MenuItem | null } | null>(null);
  const categories = useMemo(() => [...new Set((items.data ?? []).map((m) => m.category))].sort(), [items.data]);
  const rows = useMemo(() => (items.data ?? []).filter((m) => !q || m.displayName.toLowerCase().includes(q.toLowerCase())).filter((m) => category === "all" || m.category === category).filter((m) => status === "all" || (status === "active") === m.active), [items.data, q, category, status]);
  const toggle = (m: MenuItem, active: boolean) => update.mutate({ id: m.id, body: { displayName: m.displayName, category: m.category, priceInr: m.priceInr, active } }, { onError: (e) => toast.error("Failed to save", { description: e.message }) });
  const doBulk = (active: boolean) => bulk.mutate({ ids: [...sel], active }, { onSuccess: () => setSel(new Set()), onError: (e) => toast.error("Failed", { description: e.message }) });
  return (
    <div data-testid="admin-menu" data-count={items.data?.length ?? 0}>
      <AdminHeader title="Menu Pricing Master" subtitle="Priced modules that plans can include" action={<Button size="sm" onClick={() => setDialog({ editing: null })} data-testid="menu-new">+ New Item</Button>} />
      <div className="mb-2 flex flex-wrap gap-2" data-testid="admin-filters">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search items..." className="h-7 w-[200px] rounded border border-input bg-background px-2 text-xs" aria-label="Search menu items" data-testid="menu-search" />
        <select value={category} onChange={(e) => setCategory(e.target.value)} className="h-7 rounded border border-input bg-background px-2 text-xs" aria-label="Category" data-testid="menu-category-filter">
          <option value="all">All categories</option>
          {categories.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value as typeof status)} className="h-7 rounded border border-input bg-background px-2 text-xs" aria-label="Status" data-testid="menu-status">
          <option value="all">All status</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </select>
      </div>
      <BulkBar count={sel.size} busy={bulk.isPending} onActivate={() => doBulk(true)} onDeactivate={() => doBulk(false)} onClear={() => setSel(new Set())} />
      {items.isLoading ? (
        <div className="h-24 animate-pulse rounded bg-muted" />
      ) : rows.length === 0 ? (
        <EmptyState title={items.data?.length ? "No items match" : "No Menu Items"} description={items.data?.length ? "Try another search" : "Add menu items that can be linked to plans"} className="py-10" action={items.data?.length ? undefined : <Button size="sm" onClick={() => setDialog({ editing: null })}>+ Add Item</Button>} data-testid="menu-empty" />
      ) : (
        <div className="overflow-x-auto rounded border border-border">
          <table className="w-full text-xs" data-testid="menu-table">
            <thead>
              <tr className="micro text-left">
                <th className="w-6 px-2 py-1"><input type="checkbox" aria-label="Select all items" checked={rows.every((m) => sel.has(m.id))} onChange={(e) => setSel(e.target.checked ? new Set(rows.map((m) => m.id)) : new Set())} /></th>
                <th className="py-1 pr-2">Display Name</th>
                <th className="py-1 pr-2">Category</th>
                <th className="py-1 pr-2 text-right">Price (₹)</th>
                <th className="py-1 pr-2 text-right">Linked plans</th>
                <th className="py-1 pr-2">Status</th>
                <th className="py-1 pr-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((m) => (
                <tr key={m.id} className="border-t border-border" data-testid="menu-row" data-name={m.displayName} data-active={m.active}>
                  <td className="px-2 py-1"><input type="checkbox" checked={sel.has(m.id)} onChange={(e) => setSel((s) => { const n = new Set(s); if (e.target.checked) n.add(m.id); else n.delete(m.id); return n; })} aria-label={`Select ${m.displayName}`} data-testid="menu-select" /></td>
                  <td className="py-1 pr-2 font-medium">{m.displayName}</td>
                  <td className="py-1 pr-2 text-muted-foreground">{m.category}</td>
                  <td className="num py-1 pr-2 text-right">{fmtInr(m.priceInr)}</td>
                  <td className="num py-1 pr-2 text-right" data-testid="menu-linked">{m.linkedPlans}</td>
                  <td className="py-1 pr-2"><label className="flex items-center gap-1"><Switch checked={m.active} onCheckedChange={(on) => toggle(m, on)} aria-label={`${m.displayName} active`} data-testid="menu-toggle" /><span className={cn("micro", m.active ? "text-profit" : "text-muted-foreground")}>{m.active ? "Active" : "Inactive"}</span></label></td>
                  <td className="py-1 pr-2 text-right"><button type="button" className="rounded px-1 text-muted-foreground hover:text-foreground" title="Edit" aria-label={`Edit ${m.displayName}`} onClick={() => setDialog({ editing: m })} data-testid="menu-edit">✎</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {dialog ? <MenuItemDialog key={dialog.editing?.id ?? "new"} open onOpenChange={(o) => !o && setDialog(null)} editing={dialog.editing} /> : null}
    </div>
  );
}
