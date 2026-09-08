"use client";
// Admin · User Subscriptions, Users tab (HC-AD-042..051, 117, 120): plan and expiry per user, inline validity /
// commission edits, account toggle, feature-limit overrides and per-user lot sizes, 10 per page. The Commissions
// tab arrives with referrals (item 3).
import { type AdminUserRow, LIMIT_KEYS, LIMIT_LABELS, type PlanLimits } from "@hapiecoin/schema";
import { Button, Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, EmptyState, Input, cn, toast } from "@hapiecoin/ui";
import { useState } from "react";
import { useAdminUsers, useBulkAdminUsers, usePatchAdminUser } from "@/lib/api/billing";
import { fmtDate } from "@/lib/format";
import { AdminHeader, BulkBar } from "./AdminShell";

/** Click → number input; Enter saves, Escape or blur cancels (HC-AD-046). */
function InlineNumber({ value, suffix, onSave, testId, title }: { value: number | null; suffix: string; onSave: (v: number) => void; testId: string; title: string }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  if (!editing) {
    return (
      <button type="button" className="num rounded px-1 hover:bg-muted" title={title} onClick={() => { setDraft(value === null ? "" : String(value)); setEditing(true); }} data-testid={testId}>
        {value === null ? "—" : `${value}${suffix}`}
      </button>
    );
  }
  return (
    <input
      autoFocus
      type="number"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          const n = Number(draft);
          if (Number.isFinite(n)) onSave(n);
          setEditing(false);
        }
        if (e.key === "Escape") setEditing(false);
      }}
      onBlur={() => setEditing(false)}
      className="num h-6 w-20 rounded border border-input bg-background px-1"
      aria-label={title}
      data-testid={`${testId}-input`}
    />
  );
}

function expiryText(u: AdminUserRow, now = Date.now()): { text: string; tone: string } {
  if (!u.planName) return { text: "—", tone: "text-muted-foreground" };
  if (!u.expiresAt) return { text: "No end date", tone: "" };
  const days = Math.ceil((new Date(u.expiresAt).getTime() - now) / 86_400_000);
  if (days <= 0) return { text: `${fmtDate(u.expiresAt)} · Expired ${-days} d ago`, tone: "text-loss" };
  return { text: `${fmtDate(u.expiresAt)} · ${days} d left${days < 7 ? " (Soon)" : ""}`, tone: days < 7 ? "text-warning" : "" };
}

function LimitsDialog({ user, onOpenChange }: { user: AdminUserRow; onOpenChange: (o: boolean) => void }) {
  const [form, setForm] = useState<PlanLimits>({ ...user.limitOverrides });
  const patch = usePatchAdminUser();
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[440px]" data-testid="limits-dialog">
        <DialogHeader>
          <DialogTitle>Feature Limits · {user.name}</DialogTitle>
          <DialogDescription>Set to 0 for plan default. Higher values override the plan limit for this user.</DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-2">
          {LIMIT_KEYS.map((k) => (
            <label key={k} className="flex items-center gap-2 text-xs">
              <span className="w-[160px] text-muted-foreground">{LIMIT_LABELS[k]}</span>
              <Input type="number" min={0} className="h-7 w-24" value={form[k] ?? 0} onChange={(e) => setForm({ ...form, [k]: Math.max(0, Math.floor(Number(e.target.value))) })} data-testid={`limit-${k}`} />
              <span className="micro">/ month</span>
            </label>
          ))}
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button loading={patch.isPending} onClick={() => patch.mutate({ id: user.id, body: { limitOverrides: Object.fromEntries(Object.entries(form).filter(([, v]) => v > 0)) } }, { onSuccess: () => { toast.success("Updated", { description: "Feature limits saved" }); onOpenChange(false); }, onError: (e) => toast.error("Failed", { description: e.message }) })} data-testid="limits-save">
            {patch.isPending ? "Saving..." : "Save Limits"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function LotSizesDialog({ user, onOpenChange }: { user: AdminUserRow; onOpenChange: (o: boolean) => void }) {
  const [form, setForm] = useState<Record<"BTC" | "ETH" | "XAUT", string>>({ BTC: user.lotSizes?.BTC ?? "0.001", ETH: user.lotSizes?.ETH ?? "0.01", XAUT: user.lotSizes?.XAUT ?? "0.001" });
  const patch = usePatchAdminUser();
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[400px]" data-testid="lot-sizes-dialog">
        <DialogHeader>
          <DialogTitle>Lot size settings · {user.name}</DialogTitle>
          <DialogDescription>Units of the underlying per lot for this user.</DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-2">
          {(["BTC", "ETH", "XAUT"] as const).map((a) => (
            <label key={a} className="flex items-center gap-2 text-xs"><span className="w-16">{a}</span><Input type="number" step="0.001" min={0} className="h-7 w-28" value={form[a]} onChange={(e) => setForm({ ...form, [a]: e.target.value })} data-testid={`lot-${a}`} /></label>
          ))}
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button loading={patch.isPending} onClick={() => patch.mutate({ id: user.id, body: { lotSizes: form } }, { onSuccess: () => { toast.success("Updated", { description: "Lot sizes saved" }); onOpenChange(false); }, onError: (e) => toast.error("Failed", { description: e.message }) })} data-testid="lot-save">Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function UserSubscriptionsAdmin() {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("all");
  const [page, setPage] = useState(1);
  const [tab, setTab] = useState<"users" | "commissions">("users");
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [limitsFor, setLimitsFor] = useState<AdminUserRow | null>(null);
  const [lotsFor, setLotsFor] = useState<AdminUserRow | null>(null);
  const users = useAdminUsers(q, status, page);
  const patch = usePatchAdminUser();
  const bulk = useBulkAdminUsers();
  const rows = users.data?.items ?? [];
  const pages = users.data ? Math.max(1, Math.ceil(users.data.total / users.data.pageSize)) : 1;
  const save = (u: AdminUserRow, body: Parameters<typeof patch.mutate>[0]["body"], what: string) => patch.mutate({ id: u.id, body }, { onSuccess: () => toast.success("Updated", { description: `${what} · ${u.name}` }), onError: (e) => toast.error("Failed", { description: e.message }) });
  const doBulk = (active: boolean) => bulk.mutate({ ids: [...sel], active }, { onSuccess: (r) => { setSel(new Set()); toast.success("Updated", { description: `${r.updated} ${r.updated === 1 ? "account" : "accounts"} ${active ? "activated" : "deactivated"}` }); }, onError: (e) => toast.error("Failed", { description: e.message }) });
  return (
    <div data-testid="admin-subscriptions" data-count={users.data?.total ?? 0}>
      <AdminHeader title="User Subscriptions" subtitle="Who is on which plan, until when, and what they may do" />
      <div className="mb-3 flex gap-1 border-b border-border" role="tablist">
        {(["users", "commissions"] as const).map((t) => (
          <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={cn("px-3 py-1.5 text-xs capitalize", tab === t ? "border-b-2 border-accent text-foreground" : "text-muted-foreground hover:text-foreground")} data-testid={`subs-tab-${t}`}>
            {t}
          </button>
        ))}
      </div>
      {tab === "commissions" ? (
        <EmptyState title="Commissions arrive with referrals" description="Phase 4 item 3: referral commissions, mark paid and bulk pay." className="py-10" data-testid="commissions-placeholder" />
      ) : (
        <>
          <div className="mb-2 flex flex-wrap items-center gap-2" data-testid="admin-filters">
            <span className="text-xs font-medium">Users ({users.data?.total ?? 0})</span>
            <input value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} placeholder="Search by name or email..." className="h-7 w-[220px] rounded border border-input bg-background px-2 text-xs" aria-label="Search users" data-testid="users-search" />
            <select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} className="h-7 rounded border border-input bg-background px-2 text-xs" aria-label="Status" data-testid="users-status">
              <option value="all">All Status</option>
              <option value="active">Active plan</option>
              <option value="expired">Expired</option>
              <option value="free">Free</option>
              <option value="deactivated">Deactivated</option>
            </select>
          </div>
          <BulkBar count={sel.size} busy={bulk.isPending} onActivate={() => doBulk(true)} onDeactivate={() => doBulk(false)} onClear={() => setSel(new Set())} />
          {users.isLoading ? (
            <div className="h-24 animate-pulse rounded bg-muted" />
          ) : rows.length === 0 ? (
            <EmptyState title="No users found" description="Try another search or status" className="py-10" data-testid="users-empty" />
          ) : (
            <div className="overflow-x-auto rounded border border-border">
              <table className="w-full text-xs" data-testid="users-table">
                <thead>
                  <tr className="micro text-left">
                    <th className="w-6 px-2 py-1"><input type="checkbox" aria-label="Select all users" checked={rows.every((u) => sel.has(u.id))} onChange={(e) => setSel(e.target.checked ? new Set(rows.map((u) => u.id)) : new Set())} /></th>
                    <th className="py-1 pr-2">User</th>
                    <th className="py-1 pr-2">Plan</th>
                    <th className="py-1 pr-2">Expiry</th>
                    <th className="py-1 pr-2 text-right">Validity</th>
                    <th className="py-1 pr-2 text-right">Referrals</th>
                    <th className="py-1 pr-2 text-right">Commission</th>
                    <th className="py-1 pr-2">Account</th>
                    <th className="py-1 pr-2 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((u) => {
                    const exp = expiryText(u);
                    return (
                      <tr key={u.id} className={cn("border-t border-border", !u.active && "opacity-60")} data-testid="user-row" data-email={u.email} data-active={u.active}>
                        <td className="px-2 py-1"><input type="checkbox" checked={sel.has(u.id)} onChange={(e) => setSel((s) => { const n = new Set(s); if (e.target.checked) n.add(u.id); else n.delete(u.id); return n; })} aria-label={`Select ${u.email}`} data-testid="user-select" /></td>
                        <td className="py-1 pr-2"><div className="font-medium">{u.name}</div><div className="micro">{u.email}{u.role === "admin" ? " · admin" : ""}</div></td>
                        <td className="py-1 pr-2"><span className={cn("rounded border px-1.5 py-0.5 font-mono text-3xs", u.planName ? "border-accent/60 text-accent" : "border-border text-muted-foreground")} data-testid="user-plan">{u.planName ?? "Free Plan"}</span></td>
                        <td className={cn("num py-1 pr-2", exp.tone)} data-testid="user-expiry">{exp.text}</td>
                        <td className="py-1 pr-2 text-right"><InlineNumber value={u.validityDays} suffix=" d" title="Click to edit validity (days)" testId="user-validity" onSave={(v) => save(u, { validityDays: Math.max(1, Math.floor(v)) }, "Validity")} /></td>
                        <td className="num py-1 pr-2 text-right" data-testid="user-referrals">{u.referrals}</td>
                        <td className="py-1 pr-2 text-right"><InlineNumber value={Number(u.commissionPct)} suffix="%" title="Click to edit commission %" testId="user-commission" onSave={(v) => save(u, { commissionPct: String(Math.min(100, Math.max(0, v))) }, "Commission")} /></td>
                        <td className="py-1 pr-2">
                          <button type="button" className={cn("rounded border px-1.5 py-0.5 font-mono text-3xs", u.active ? "border-profit/60 text-profit" : "border-loss/60 text-loss")} onClick={() => save(u, { active: !u.active }, u.active ? "Deactivated" : "Activated")} data-testid="user-toggle">
                            {u.active ? "Active" : "Deactive"}
                          </button>
                        </td>
                        <td className="py-1 pr-2 text-right">
                          <button type="button" className="rounded px-1 text-muted-foreground hover:text-foreground" title="Edit feature limits" aria-label={`Edit feature limits for ${u.email}`} onClick={() => setLimitsFor(u)} data-testid="user-limits">⚙</button>
                          <button type="button" className="rounded px-1 text-muted-foreground hover:text-foreground" title="Lot size settings" aria-label={`Lot sizes for ${u.email}`} onClick={() => setLotsFor(u)} data-testid="user-lots">▤</button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground" data-testid="users-pager">
            <span>Page {page} of {pages} · {users.data?.total ?? 0} users</span>
            <span className="flex-1" />
            <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>← Previous</Button>
            <Button size="sm" variant="outline" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>Next →</Button>
          </div>
        </>
      )}
      {limitsFor ? <LimitsDialog user={limitsFor} onOpenChange={(o) => !o && setLimitsFor(null)} /> : null}
      {lotsFor ? <LotSizesDialog user={lotsFor} onOpenChange={(o) => !o && setLotsFor(null)} /> : null}
    </div>
  );
}
