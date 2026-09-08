"use client";
// Admin · Coupon Code Master (HC-AD-029..041, 115, 116; ADR-034; docs/design/billing.md "Checkout"): discounts with
// a scope (plans × intervals, public or assigned users), a window, use limits, and bulk actions.
import { BILLING_INTERVALS, type BillingInterval, COUPON_SCOPE_LABELS, type Coupon, type CouponInput, type CouponScope, type DiscountType } from "@hapiecoin/schema";
import { Button, Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, EmptyState, Pencil, Switch, Trash, cn, toast } from "@hapiecoin/ui";
import { useMemo, useState } from "react";
import { AdminHeader } from "./AdminShell";
import { type ColumnDef, FloatingBar, copyCsv } from "./table-tools";
import { useAdminUsersList } from "@/lib/api/admin";
import { useAdminPlans } from "@/lib/api/billing";
import { useAdminCoupons, useBulkCoupons, useCreateCoupon, useDeleteCoupon, useReplaceCoupon, useSwitchCoupon } from "@/lib/api/payments";
import { INTERVAL_LABELS, fmtInr } from "@/lib/billing/format";
import { fmtDate } from "@/lib/format";

const inputClass = "h-8 w-full rounded border border-input bg-background px-2 text-xs";
const toLocal = (iso: string | null) => (iso ? new Date(iso).toISOString().slice(0, 16) : "");
const fromLocal = (v: string) => (v ? new Date(`${v}:00Z`).toISOString() : null);
const discountText = (c: Coupon) => (c.discountType === "percent" ? `${Number(c.discountValue)}%` : fmtInr(c.discountValue));
const expired = (c: Coupon, now = Date.now()) => c.endsAt !== null && new Date(c.endsAt).getTime() < now;
const COLUMNS: ColumnDef<Coupon>[] = [
  { key: "code", label: "Code", csv: (c) => c.code },
  { key: "description", label: "Description", csv: (c) => c.description },
  { key: "discount", label: "Discount", csv: (c) => discountText(c) },
  { key: "type", label: "Type", csv: (c) => COUPON_SCOPE_LABELS[c.scope] },
  { key: "starts", label: "Starts", csv: (c) => c.startsAt ?? "" },
  { key: "ends", label: "Ends", csv: (c) => c.endsAt ?? "" },
  { key: "plans", label: "Plans", csv: (c) => c.planIds.join("|") },
  { key: "uses", label: "Uses", csv: (c) => `${c.usedCount}/${c.maxUses ?? "∞"}` },
  { key: "active", label: "Active", csv: (c) => (c.active ? "yes" : "no") },
];

interface Form { code: string; description: string; discountType: DiscountType; discountValue: string; minOrderInr: string; maxUses: string; perUserLimit: string; startsAt: string; endsAt: string; scope: CouponScope; grid: Record<string, BillingInterval[]>; assigned: string[]; active: boolean }
const emptyForm = (): Form => ({ code: "", description: "", discountType: "percent", discountValue: "", minOrderInr: "0", maxUses: "", perUserLimit: "1", startsAt: "", endsAt: "", scope: "public", grid: {}, assigned: [], active: true });
const formOf = (c: Coupon): Form => ({ code: c.code, description: c.description, discountType: c.discountType, discountValue: c.discountValue, minOrderInr: c.minOrderInr, maxUses: c.maxUses === null ? "" : String(c.maxUses), perUserLimit: String(c.perUserLimit), startsAt: toLocal(c.startsAt), endsAt: toLocal(c.endsAt), scope: c.scope, grid: Object.fromEntries(c.planIds.map((p) => [p, [...c.intervals]])), assigned: [...c.assignedUserIds], active: c.active });

function AssignUsers({ selected, onChange }: { selected: string[]; onChange: (ids: string[]) => void }) {
  const [q, setQ] = useState("");
  const users = useAdminUsersList({ q, status: "all", plan: "all", sort: "name", dir: "asc", page: 1 });
  const rows = users.data?.items ?? [];
  return (
    <div className="rounded border border-border p-2" data-testid="coupon-assign">
      <div className="flex items-center gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search users…" className="h-7 flex-1 rounded border border-input bg-background px-2 text-xs" aria-label="Search users" data-testid="coupon-assign-search" />
        <Button size="sm" variant="ghost" onClick={() => onChange([...new Set([...selected, ...rows.map((u) => u.id)])])} data-testid="coupon-assign-all">Select all</Button>
        <Button size="sm" variant="ghost" onClick={() => onChange(selected.filter((id) => !rows.some((u) => u.id === id)))} data-testid="coupon-assign-none">Deselect all</Button>
      </div>
      <ul className="mt-1 max-h-32 space-y-0.5 overflow-y-auto text-xs">
        {rows.map((u) => (
          <li key={u.id}><label className="flex items-center gap-2"><input type="checkbox" checked={selected.includes(u.id)} onChange={(e) => onChange(e.target.checked ? [...selected, u.id] : selected.filter((x) => x !== u.id))} data-testid="coupon-assign-user" /> {u.name} <span className="micro">{u.email}</span></label></li>
        ))}
        {rows.length === 0 ? <li className="micro">No users match</li> : null}
      </ul>
      <p className="micro mt-1">{selected.length} assigned</p>
    </div>
  );
}

function CouponDialog({ coupon, onOpenChange }: { coupon: Coupon | null; onOpenChange: (o: boolean) => void }) {
  const plans = useAdminPlans();
  const [form, setForm] = useState<Form>(coupon ? formOf(coupon) : emptyForm());
  const [error, setError] = useState<string | null>(null);
  const create = useCreateCoupon();
  const replace = useReplaceCoupon();
  const busy = create.isPending || replace.isPending;
  const toggleCell = (planId: string, interval: BillingInterval) => setForm((f) => {
    const cur = f.grid[planId] ?? [];
    const next = cur.includes(interval) ? cur.filter((i) => i !== interval) : [...cur, interval];
    const grid = { ...f.grid };
    if (next.length) grid[planId] = next; else delete grid[planId];
    return { ...f, grid };
  });
  const submit = () => {
    const code = form.code.trim().toUpperCase();
    if (!code) return fail("Code is required");
    if (!/^[A-Z0-9_-]{3,24}$/.test(code)) return fail("Code: 3–24 letters, digits, _ or -");
    const v = Number(form.discountValue);
    if (form.discountType === "percent" ? !(v > 0 && v <= 100) : !(v > 0)) return fail(form.discountType === "percent" ? "Percent must be 1–100" : "Amount must be above 0");
    const planIds = Object.keys(form.grid);
    if (planIds.length === 0) return fail("Pick at least one plan and interval");
    if (form.startsAt && form.endsAt && new Date(`${form.endsAt}:00Z`).getTime() <= new Date(`${form.startsAt}:00Z`).getTime()) return fail("End must be after start");
    setError(null);
    const intervals = [...new Set(planIds.flatMap((p) => form.grid[p] ?? []))] as BillingInterval[];
    const body: CouponInput = { code, description: form.description.trim(), discountType: form.discountType, discountValue: String(v), minOrderInr: form.minOrderInr || "0", maxUses: form.maxUses ? Math.max(1, Math.floor(Number(form.maxUses))) : null, perUserLimit: Math.max(1, Math.floor(Number(form.perUserLimit) || 1)), startsAt: fromLocal(form.startsAt), endsAt: fromLocal(form.endsAt), scope: form.scope, planIds, intervals, assignedUserIds: form.scope === "community" ? form.assigned : [], active: form.active };
    const done = (what: string) => { toast.success(what, { description: code }); onOpenChange(false); };
    const onError = (e: Error) => fail(e.message);
    if (coupon) replace.mutate({ id: coupon.id, body }, { onSuccess: () => done("Updated"), onError });
    else create.mutate(body, { onSuccess: () => done("Created"), onError });
  };
  const fail = (msg: string) => { setError(msg); toast.error("Validation", { description: msg }); };
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px]" data-testid="coupon-dialog">
        <DialogHeader>
          <DialogTitle>{coupon ? "Edit Coupon" : "New Coupon"}</DialogTitle>
          <DialogDescription>Where the coupon applies and how much it takes off, before GST.</DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-3 text-xs">
          <div className="grid grid-cols-2 gap-2">
            <label className="block"><span className="micro">Code *</span><input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase().replace(/[^A-Z0-9_-]/g, "") })} className={`num ${inputClass} uppercase`} placeholder="BASIC20" data-testid="coupon-code" /></label>
            <label className="block"><span className="micro">Coupon type</span>
              <select value={form.scope} onChange={(e) => setForm({ ...form, scope: e.target.value as CouponScope })} className={inputClass} aria-label="Coupon type" data-testid="coupon-scope">
                <option value="public">Public (all listed)</option>
                <option value="community">Community (assigned to specific users)</option>
              </select>
            </label>
          </div>
          {form.scope === "community" ? <AssignUsers selected={form.assigned} onChange={(assigned) => setForm({ ...form, assigned })} /> : null}
          <label className="block"><span className="micro">Description</span><input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className={inputClass} placeholder="Get 20% off your first plan" data-testid="coupon-description" /></label>
          <div className="grid grid-cols-3 gap-2">
            <label className="block"><span className="micro">Discount type</span>
              <select value={form.discountType} onChange={(e) => setForm({ ...form, discountType: e.target.value as DiscountType })} className={inputClass} aria-label="Discount type" data-testid="coupon-discount-type"><option value="percent">Percent</option><option value="fixed">Fixed ₹</option></select>
            </label>
            <label className="block"><span className="micro">Discount value</span><input type="number" min={0} value={form.discountValue} onChange={(e) => setForm({ ...form, discountValue: e.target.value })} className={`num ${inputClass}`} data-testid="coupon-discount-value" /></label>
            <label className="block"><span className="micro">Min order ₹</span><input type="number" min={0} value={form.minOrderInr} onChange={(e) => setForm({ ...form, minOrderInr: e.target.value })} className={`num ${inputClass}`} data-testid="coupon-min-order" /></label>
            <label className="block"><span className="micro">Max uses (blank = unlimited)</span><input type="number" min={1} value={form.maxUses} onChange={(e) => setForm({ ...form, maxUses: e.target.value })} className={`num ${inputClass}`} data-testid="coupon-max-uses" /></label>
            <label className="block"><span className="micro">Per-user limit</span><input type="number" min={1} value={form.perUserLimit} onChange={(e) => setForm({ ...form, perUserLimit: e.target.value })} className={`num ${inputClass}`} data-testid="coupon-per-user" /></label>
            <span />
            <label className="block"><span className="micro">Starts (UTC)</span><input type="datetime-local" value={form.startsAt} onChange={(e) => setForm({ ...form, startsAt: e.target.value })} className={`num ${inputClass}`} data-testid="coupon-starts" /></label>
            <label className="block"><span className="micro">Ends (UTC)</span><input type="datetime-local" value={form.endsAt} onChange={(e) => setForm({ ...form, endsAt: e.target.value })} className={`num ${inputClass}`} data-testid="coupon-ends" /></label>
          </div>
          <div>
            <span className="micro">Applicable plans &amp; intervals *</span>
            <table className="mt-1 w-full" data-testid="coupon-grid">
              <thead><tr className="micro text-left"><th className="py-0.5">Plan</th>{BILLING_INTERVALS.map((i) => <th key={i} className="py-0.5 text-center">{INTERVAL_LABELS[i]}</th>)}</tr></thead>
              <tbody>
                {(plans.data ?? []).filter((p) => p.active).map((p) => (
                  <tr key={p.id} className="border-t border-border">
                    <td className="py-0.5">{p.name}</td>
                    {BILLING_INTERVALS.map((i) => <td key={i} className="py-0.5 text-center"><input type="checkbox" checked={(form.grid[p.id] ?? []).includes(i)} onChange={() => toggleCell(p.id, i)} aria-label={`${p.name} ${INTERVAL_LABELS[i]}`} data-testid={`coupon-cell-${p.id}-${i}`} /></td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <label className="flex items-center gap-2"><Switch checked={form.active} onCheckedChange={(on) => setForm({ ...form, active: on })} aria-label="Active" data-testid="coupon-active" /> Active</label>
          {error ? <p className="text-loss" role="alert" data-testid="coupon-error">{error}</p> : null}
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button loading={busy} onClick={submit} data-testid="coupon-save">{coupon ? "Update" : "Create"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function CouponsAdmin() {
  const coupons = useAdminCoupons();
  const plans = useAdminPlans();
  const sw = useSwitchCoupon();
  const del = useDeleteCoupon();
  const bulk = useBulkCoupons();
  const [q, setQ] = useState("");
  const [type, setType] = useState<"all" | CouponScope>("all");
  const [status, setStatus] = useState<"all" | "active" | "inactive" | "expired">("all");
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<Coupon | null | "new">(null);
  const [deleting, setDeleting] = useState<Coupon[] | null>(null);
  const all = useMemo(() => coupons.data ?? [], [coupons.data]);
  const planName = (id: string) => plans.data?.find((p) => p.id === id)?.name ?? id;
  const rows = all.filter((c) => (!q || `${c.code} ${c.description}`.toLowerCase().includes(q.toLowerCase())) && (type === "all" || c.scope === type) && (status === "all" || (status === "expired" ? expired(c) : status === "active" ? c.active && !expired(c) : !c.active)));
  const filtered = q !== "" || type !== "all" || status !== "all";
  const clear = () => { setQ(""); setType("all"); setStatus("all"); };
  const toggle = (c: Coupon, on: boolean) => sw.mutate({ id: c.id, active: on }, { onSuccess: () => toast.success("Updated", { description: `${c.code} · ${on ? "active" : "inactive"}` }), onError: (e) => toast.error("Failed", { description: e.message }) });
  const runBulk = (action: "activate" | "deactivate" | "delete") => bulk.mutate({ ids: [...sel], action }, { onSuccess: (r) => { setSel(new Set()); setDeleting(null); toast.success("Updated", { description: `${r.updated} ${r.updated === 1 ? "coupon" : "coupons"} ${action === "delete" ? "deleted" : action + "d"}` }); }, onError: (e) => toast.error("Failed", { description: e.message }) });
  return (
    <div data-testid="admin-coupons" data-count={all.length} data-state={coupons.isLoading ? "loading" : coupons.isError ? "error" : "ready"}>
      <AdminHeader title="Coupon Code Master" subtitle="Discount codes, their scope and how far they have been used" action={<Button size="sm" onClick={() => setEditing("new")} data-testid="coupon-new">+ New Coupon</Button>} />
      <div className="sticky top-0 z-10 -mx-1 mb-2 flex flex-wrap items-center gap-2 bg-background px-1 py-2" data-testid="coupon-filters">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search code or description" className="h-7 w-[220px] rounded border border-input bg-background px-2 text-xs" aria-label="Search coupons" data-testid="coupon-search" />
        <select value={type} onChange={(e) => setType(e.target.value as typeof type)} className="h-7 rounded border border-input bg-background px-2 text-xs" aria-label="Type" data-testid="coupon-type-filter"><option value="all">All types</option><option value="public">Public</option><option value="community">Community</option></select>
        <select value={status} onChange={(e) => setStatus(e.target.value as typeof status)} className="h-7 rounded border border-input bg-background px-2 text-xs" aria-label="Status" data-testid="coupon-status-filter"><option value="all">All status</option><option value="active">Active</option><option value="inactive">Inactive</option><option value="expired">Expired</option></select>
        {filtered ? <Button size="sm" variant="ghost" onClick={clear} data-testid="coupon-clear">Clear</Button> : null}
        <span className="flex-1" />
        <span className="micro">{rows.length} of {all.length}</span>
        <Button size="sm" variant="outline" disabled={rows.length === 0} onClick={() => void copyCsv(rows, COLUMNS, "coupons")} data-testid="coupon-csv">Copy CSV</Button>
      </div>
      {coupons.isLoading ? <div className="h-24 animate-pulse rounded bg-muted" /> : coupons.isError ? (
        <EmptyState title="Couldn't load coupons" description={coupons.error.message} className="py-10" action={<Button size="sm" onClick={() => void coupons.refetch()}>Retry</Button>} data-testid="coupon-load-error" />
      ) : all.length === 0 ? (
        <EmptyState title="No Coupons" description="Create your first coupon code" className="py-10" action={<Button size="sm" onClick={() => setEditing("new")}>+ Create Coupon</Button>} data-testid="coupon-empty" />
      ) : rows.length === 0 ? (
        <EmptyState title="No coupons match" description="Try another search, type or status" className="py-10" action={<Button size="sm" variant="outline" onClick={clear}>Clear filters</Button>} data-testid="coupon-empty-filtered" />
      ) : (
        <div className="overflow-x-auto rounded border border-border">
          <table className="w-full text-xs" data-testid="coupon-table">
            <thead><tr className="micro text-left"><th className="w-6 px-2 py-1"><input type="checkbox" aria-label="Select all coupons" checked={rows.every((c) => sel.has(c.id))} onChange={(e) => setSel(e.target.checked ? new Set(rows.map((c) => c.id)) : new Set())} data-testid="coupon-select-all" /></th><th className="py-1 pr-2">Code</th><th className="py-1 pr-2">Discount</th><th className="py-1 pr-2">Type</th><th className="py-1 pr-2">Validity</th><th className="py-1 pr-2">Plans</th><th className="py-1 pr-2 text-right">Uses</th><th className="py-1 pr-2">Active</th><th className="py-1 pr-2 text-right">Actions</th></tr></thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id} className={cn("h-row border-t border-border", !c.active && "opacity-70", sel.has(c.id) && "bg-accent/10")} data-testid="coupon-row" data-code={c.code}>
                  <td className="px-2 py-1"><input type="checkbox" checked={sel.has(c.id)} onChange={(e) => setSel((s) => { const n = new Set(s); if (e.target.checked) n.add(c.id); else n.delete(c.id); return n; })} aria-label={`Select ${c.code}`} data-testid="coupon-select" /></td>
                  <td className="py-1 pr-2"><div className="font-mono">{c.code}</div><div className="micro truncate">{c.description}</div></td>
                  <td className="num py-1 pr-2">{discountText(c)}{Number(c.minOrderInr) > 0 ? <div className="micro">min {fmtInr(c.minOrderInr)}</div> : null}</td>
                  <td className="py-1 pr-2"><span className="rounded border border-border px-1.5 py-0.5 font-mono text-3xs">{COUPON_SCOPE_LABELS[c.scope]}</span>{c.scope === "community" ? <span className="micro ml-1">{c.assignedUserIds.length} users</span> : null}</td>
                  <td className="num py-1 pr-2">{c.startsAt ? fmtDate(c.startsAt) : "…"} → {c.endsAt ? fmtDate(c.endsAt) : "…"}{expired(c) ? <span className="ml-1 text-loss">Expired</span> : null}</td>
                  <td className="py-1 pr-2"><span className="flex flex-wrap gap-1" title={c.intervals.map((i) => INTERVAL_LABELS[i]).join(", ")}>{c.planIds.map((p) => <span key={p} className="rounded border border-border px-1 font-mono text-3xs">{planName(p)}</span>)}</span></td>
                  <td className="num whitespace-nowrap py-1 pr-2 text-right" data-testid="coupon-uses">{c.usedCount} / {c.maxUses ?? "∞"}</td>
                  <td className="py-1 pr-2"><Switch checked={c.active} onCheckedChange={(on) => toggle(c, on)} aria-label={`${c.code} active`} data-testid="coupon-toggle" /></td>
                  <td className="py-1 pr-2 text-right whitespace-nowrap">
                    <button type="button" className="inline-flex rounded px-1 py-0.5 text-muted-foreground hover:text-foreground" title="Edit" aria-label={`Edit ${c.code}`} onClick={() => setEditing(c)} data-testid="coupon-edit"><Pencil className="size-3.5" aria-hidden="true" /></button>
                    <button type="button" className="inline-flex rounded px-1 py-0.5 text-muted-foreground hover:text-loss" title="Delete" aria-label={`Delete ${c.code}`} onClick={() => setDeleting([c])} data-testid="coupon-delete"><Trash className="size-3.5" aria-hidden="true" /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <FloatingBar count={sel.size} onClear={() => setSel(new Set())} testId="coupon-bulk">
        <Button size="sm" variant="outline" loading={bulk.isPending} onClick={() => runBulk("activate")} data-testid="coupon-bulk-activate">Activate</Button>
        <Button size="sm" variant="outline" loading={bulk.isPending} onClick={() => runBulk("deactivate")} data-testid="coupon-bulk-deactivate">Deactivate</Button>
        <Button size="sm" variant="outline" onClick={() => setDeleting(all.filter((c) => sel.has(c.id)))} data-testid="coupon-bulk-delete">Delete</Button>
      </FloatingBar>
      {editing ? <CouponDialog key={editing === "new" ? "new" : editing.id} coupon={editing === "new" ? null : editing} onOpenChange={(o) => { if (!o) setEditing(null); }} /> : null}
      <Dialog open={deleting !== null} onOpenChange={(o) => { if (!o) setDeleting(null); }}>
        <DialogContent className="sm:max-w-[420px]" data-testid="coupon-delete-dialog">
          <DialogHeader>
            <DialogTitle>Delete {deleting && deleting.length > 1 ? `${deleting.length} coupons` : "Coupon"}?</DialogTitle>
            <DialogDescription>This action cannot be undone. {deleting?.map((c) => c.code).join(", ")} will stop working immediately; past payments keep their record.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleting(null)}>Cancel</Button>
            <Button variant="destructive" loading={del.isPending || bulk.isPending} onClick={() => { if (!deleting) return; if (deleting.length === 1 && !sel.has(deleting[0]!.id)) del.mutate(deleting[0]!.id, { onSuccess: () => { toast.success("Deleted", { description: deleting[0]!.code }); setDeleting(null); }, onError: (e) => toast.error("Failed", { description: e.message }) }); else runBulk("delete"); }} data-testid="coupon-delete-confirm">Delete</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
