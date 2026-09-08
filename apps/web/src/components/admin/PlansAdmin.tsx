"use client";
// Admin · Subscription Plans (HC-AD-004..019, 110..112): table, status switch, edit, search + filter, bulk, and the
// plan dialog with features chips, per-interval prices + limits, menu items and the active switch.
import { BILLING_INTERVALS, type BillingInterval, LIMIT_KEYS, LIMIT_LABELS, type MenuItem, type Plan, type PlanInput, type PlanLimits } from "@hapiecoin/schema";
import { Button, Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, EmptyState, Input, Switch, cn, toast } from "@hapiecoin/ui";
import { useMemo, useState } from "react";
import { useAdminMenuItems, useAdminPlans, useBulkPlans, useCreatePlan, useUpdatePlan } from "@/lib/api/billing";
import { INTERVAL_LABELS, fmtInr } from "@/lib/billing/format";
import { AdminHeader, BulkBar } from "./AdminShell";

type Form = PlanInput;
const emptyInterval = () => ({ priceInr: "0", discountPriceInr: null as string | null, limits: {} as PlanLimits });
const emptyForm = (): Form => ({ name: "", description: "", features: [], intervals: { monthly: emptyInterval(), quarterly: emptyInterval(), yearly: emptyInterval() }, menuItemIds: [], active: true, sortOrder: 100 });
const toForm = (p: Plan): Form => ({ name: p.name, description: p.description, features: [...p.features], intervals: { monthly: { ...p.intervals.monthly, limits: { ...p.intervals.monthly.limits } }, quarterly: { ...p.intervals.quarterly, limits: { ...p.intervals.quarterly.limits } }, yearly: { ...p.intervals.yearly, limits: { ...p.intervals.yearly.limits } } }, menuItemIds: [...p.menuItemIds], active: p.active, sortOrder: p.sortOrder });

export function PlanDialog({ open, onOpenChange, editing, menu }: { open: boolean; onOpenChange: (o: boolean) => void; editing: Plan | null; menu: MenuItem[] }) {
  const [form, setForm] = useState<Form>(() => (editing ? toForm(editing) : emptyForm()));
  const [feature, setFeature] = useState("");
  const create = useCreatePlan();
  const update = useUpdatePlan();
  const busy = create.isPending || update.isPending;
  const setInterval = (k: BillingInterval, patch: Partial<Form["intervals"]["monthly"]>) => setForm((f) => ({ ...f, intervals: { ...f.intervals, [k]: { ...f.intervals[k], ...patch } } }));
  const setLimit = (k: BillingInterval, key: (typeof LIMIT_KEYS)[number], raw: string) =>
    setForm((f) => {
      const limits = { ...f.intervals[k].limits };
      if (raw.trim() === "") delete limits[key];
      else limits[key] = Math.max(0, Math.floor(Number(raw)));
      return { ...f, intervals: { ...f.intervals, [k]: { ...f.intervals[k], limits } } };
    });
  const addFeature = () => {
    const v = feature.trim();
    if (!v) return;
    setForm((f) => ({ ...f, features: [...f.features, v] }));
    setFeature("");
  };
  const save = () => {
    if (!form.name.trim()) {
      toast.error("Validation", { description: "Plan name is required" });
      return;
    }
    const opts = { onSuccess: () => { toast.success(editing ? "Updated" : "Created", { description: form.name }); onOpenChange(false); }, onError: (e: Error) => toast.error("Failed to save", { description: e.message }) };
    if (editing) update.mutate({ id: editing.id, body: form }, opts);
    else create.mutate(form, opts);
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[760px]" data-testid="plan-dialog">
        <DialogHeader>
          <DialogTitle>{editing ? "Edit Plan" : "New Plan"}</DialogTitle>
          <DialogDescription>Prices in ₹ per interval; a limit left empty means the feature is not included, 0 means unlimited.</DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-[1fr_1fr_120px]">
            <label className="text-xs">
              <span className="micro">Plan Name *</span>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Basic Plan" data-testid="plan-name" />
            </label>
            <label className="text-xs">
              <span className="micro">Description</span>
              <Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} data-testid="plan-description" />
            </label>
            <label className="text-xs">
              <span className="micro">Sort order</span>
              <Input type="number" value={form.sortOrder} onChange={(e) => setForm({ ...form, sortOrder: Math.max(0, Number(e.target.value)) })} data-testid="plan-sort" />
            </label>
          </div>
          <div className="text-xs">
            <span className="micro">Features</span>
            <div className="flex flex-wrap gap-1" data-testid="plan-features">
              {form.features.map((f, i) => (
                <span key={`${f}-${i}`} className="inline-flex items-center gap-1 rounded border border-border px-1.5 py-0.5">
                  {f}
                  <button type="button" aria-label={`Remove ${f}`} onClick={() => setForm({ ...form, features: form.features.filter((_, j) => j !== i) })}>✕</button>
                </span>
              ))}
            </div>
            <div className="mt-1 flex gap-1">
              <Input value={feature} onChange={(e) => setFeature(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addFeature(); } }} placeholder="Add a feature" data-testid="plan-feature-input" />
              <Button size="sm" variant="outline" onClick={addFeature} data-testid="plan-feature-add">Add</Button>
            </div>
          </div>
          <div className="grid gap-2 sm:grid-cols-3">
            {BILLING_INTERVALS.map((k) => (
              <div key={k} className="rounded border border-border p-2 text-xs" data-testid={`plan-interval-${k}`}>
                <div className="micro mb-1">{INTERVAL_LABELS[k]}</div>
                <label className="block">
                  <span className="micro">Price (₹)</span>
                  <Input type="number" min={0} value={form.intervals[k].priceInr} onChange={(e) => setInterval(k, { priceInr: e.target.value })} data-testid={`plan-price-${k}`} />
                </label>
                <label className="mt-1 block">
                  <span className="micro">Discount price (₹)</span>
                  <Input type="number" min={0} value={form.intervals[k].discountPriceInr ?? ""} onChange={(e) => setInterval(k, { discountPriceInr: e.target.value === "" ? null : e.target.value })} placeholder="none" data-testid={`plan-discount-${k}`} />
                </label>
                <div className="micro mt-2">Feature limits · per month · 0 = unlimited</div>
                {LIMIT_KEYS.map((key) => (
                  <label key={key} className="mt-1 flex items-center gap-1">
                    <span className="w-[120px] truncate text-muted-foreground" title={LIMIT_LABELS[key]}>{LIMIT_LABELS[key]}</span>
                    <Input type="number" min={0} className="h-6" value={form.intervals[k].limits[key] ?? ""} onChange={(e) => setLimit(k, key, e.target.value)} placeholder="not incl." data-testid={`plan-limit-${k}-${key}`} />
                  </label>
                ))}
              </div>
            ))}
          </div>
          <div className="text-xs">
            <div className="micro">Menu items · {form.menuItemIds.length} of {menu.length} linked</div>
            <div className="mt-1 grid gap-1 sm:grid-cols-2" data-testid="plan-menu-items">
              {menu.map((m) => (
                <label key={m.id} className="flex items-center gap-2">
                  <input type="checkbox" checked={form.menuItemIds.includes(m.id)} onChange={(e) => setForm({ ...form, menuItemIds: e.target.checked ? [...form.menuItemIds, m.id] : form.menuItemIds.filter((x) => x !== m.id) })} />
                  <span>{m.displayName}</span>
                  <span className="micro">{m.category} · {fmtInr(m.priceInr)}</span>
                </label>
              ))}
            </div>
          </div>
          <label className="flex items-center gap-2 text-xs">
            <Switch checked={form.active} onCheckedChange={(on) => setForm({ ...form, active: on })} aria-label="Active" data-testid="plan-active" />
            Active · Plan visible to users
          </label>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button loading={busy} onClick={save} data-testid="plan-save">{editing ? "Update" : "Create"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function PlansAdmin() {
  const plans = useAdminPlans();
  const menu = useAdminMenuItems();
  const update = useUpdatePlan();
  const bulk = useBulkPlans();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<"all" | "active" | "inactive">("all");
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [dialog, setDialog] = useState<{ editing: Plan | null } | null>(null);
  const rows = useMemo(() => (plans.data ?? []).filter((p) => !q || p.name.toLowerCase().includes(q.toLowerCase())).filter((p) => status === "all" || (status === "active") === p.active), [plans.data, q, status]);
  const toggle = (p: Plan, active: boolean) => update.mutate({ id: p.id, body: { name: p.name, description: p.description, features: p.features, intervals: p.intervals, menuItemIds: p.menuItemIds, active, sortOrder: p.sortOrder } }, { onSuccess: () => toast.success("Updated", { description: `${p.name} is ${active ? "active" : "inactive"}` }), onError: (e) => toast.error("Failed to save", { description: e.message }) });
  const doBulk = (active: boolean) => bulk.mutate({ ids: [...sel], active }, { onSuccess: () => { setSel(new Set()); toast.success("Updated", { description: `${sel.size} ${sel.size === 1 ? "plan" : "plans"} ${active ? "activated" : "deactivated"}` }); }, onError: (e) => toast.error("Failed", { description: e.message }) });
  return (
    <div data-testid="admin-plans" data-count={plans.data?.length ?? 0}>
      <AdminHeader title="Subscription Plans" subtitle="What customers can buy and what each plan allows" action={<Button size="sm" onClick={() => setDialog({ editing: null })} data-testid="plan-new">+ New Plan</Button>} />
      <div className="mb-2 flex flex-wrap gap-2" data-testid="admin-filters">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search plans..." className="h-7 w-[200px] rounded border border-input bg-background px-2 text-xs" aria-label="Search plans" data-testid="plans-search" />
        <select value={status} onChange={(e) => setStatus(e.target.value as typeof status)} className="h-7 rounded border border-input bg-background px-2 text-xs" aria-label="Status" data-testid="plans-status">
          <option value="all">All status</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </select>
      </div>
      <BulkBar count={sel.size} busy={bulk.isPending} onActivate={() => doBulk(true)} onDeactivate={() => doBulk(false)} onClear={() => setSel(new Set())} />
      {plans.isLoading ? (
        <div className="h-24 animate-pulse rounded bg-muted" />
      ) : rows.length === 0 ? (
        <EmptyState title={plans.data?.length ? "No plans match" : "No Plans Yet"} description={plans.data?.length ? "Try another search" : "Create your first subscription plan"} className="py-10" action={plans.data?.length ? undefined : <Button size="sm" onClick={() => setDialog({ editing: null })}>+ Create Plan</Button>} data-testid="plans-empty" />
      ) : (
        <div className="overflow-x-auto rounded border border-border">
          <table className="w-full text-xs" data-testid="plans-table">
            <thead>
              <tr className="micro text-left">
                <th className="w-6 px-2 py-1"><input type="checkbox" aria-label="Select all plans" checked={rows.every((p) => sel.has(p.id))} onChange={(e) => setSel(e.target.checked ? new Set(rows.map((p) => p.id)) : new Set())} data-testid="plans-select-all" /></th>
                <th className="py-1 pr-2">Name</th>
                {BILLING_INTERVALS.map((k) => <th key={k} className="py-1 pr-2 text-right">{INTERVAL_LABELS[k]}</th>)}
                <th className="py-1 pr-2">Limits · monthly</th>
                <th className="py-1 pr-2">Features</th>
                <th className="py-1 pr-2">Status</th>
                <th className="py-1 pr-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id} className="border-t border-border" data-testid="plan-row" data-plan={p.name} data-active={p.active}>
                  <td className="px-2 py-1"><input type="checkbox" checked={sel.has(p.id)} onChange={(e) => setSel((s) => { const n = new Set(s); if (e.target.checked) n.add(p.id); else n.delete(p.id); return n; })} aria-label={`Select ${p.name}`} data-testid="plan-select" /></td>
                  <td className="py-1 pr-2"><div className="font-medium">{p.name}</div><div className="micro">{p.description}</div></td>
                  {BILLING_INTERVALS.map((k) => {
                    const i = p.intervals[k];
                    return (
                      <td key={k} className="num py-1 pr-2 text-right">
                        {i.discountPriceInr !== null ? <><span>{fmtInr(i.discountPriceInr)}</span> <span className="text-muted-foreground line-through">{fmtInr(i.priceInr)}</span></> : fmtInr(i.priceInr)}
                      </td>
                    );
                  })}
                  <td className="py-1 pr-2">
                    <div className="flex flex-wrap gap-1">
                      {LIMIT_KEYS.map((key) => {
                        const l = p.intervals.monthly.limits[key];
                        return l === undefined ? null : <span key={key} className="micro rounded border border-border px-1" title={LIMIT_LABELS[key]}>{key.replace("_", " ")} {l === 0 ? "∞" : l}</span>;
                      })}
                    </div>
                  </td>
                  <td className="py-1 pr-2 text-muted-foreground">{p.features.length} · {p.menuItemIds.length} menu</td>
                  <td className="py-1 pr-2">
                    <label className="flex items-center gap-1">
                      <Switch checked={p.active} onCheckedChange={(on) => toggle(p, on)} aria-label={`${p.name} active`} data-testid="plan-toggle" />
                      <span className={cn("micro", p.active ? "text-profit" : "text-muted-foreground")}>{p.active ? "Active" : "Inactive"}</span>
                    </label>
                  </td>
                  <td className="py-1 pr-2 text-right">
                    <button type="button" className="rounded px-1 text-muted-foreground hover:text-foreground" title="Edit" aria-label={`Edit ${p.name}`} onClick={() => setDialog({ editing: p })} data-testid="plan-edit">✎</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {dialog ? <PlanDialog key={dialog.editing?.id ?? "new"} open onOpenChange={(o) => !o && setDialog(null)} editing={dialog.editing} menu={menu.data ?? []} /> : null}
    </div>
  );
}
