"use client";
// Admin · User Management (HC-AD-086..101, 108, 109; HC-AD-092..097; ADR-032; docs/design/admin.md §4a): search,
// plan / status filters, sortable columns, Columns menu, Copy CSV, 10 per page, row → drawer, bulk bar with
// Activate / Deactivate / Set plan / Export CSV, and Invite user as the one primary action.
import type { AdminUserRow } from "@hapiecoin/schema";
import { Button, EmptyState, cn } from "@hapiecoin/ui";
import { useState } from "react";
import { AdminHeader } from "./AdminShell";
import { UserDrawer } from "./UserDrawer";
import { InviteUserDialog, SetPlanDialog } from "./UserDialogs";
import { type ColumnDef, ColumnsMenu, FloatingBar, SortHeader, type SortState, copyCsv, useAdminColumns } from "./table-tools";
import { DEFAULT_USERS_QUERY, type UsersListQuery, useAdminUsersList, userStatus } from "@/lib/api/admin";
import { useAdminPlans, useBulkAdminUsers } from "@/lib/api/billing";
import { fmtInr } from "@/lib/billing/format";
import { fmtDate } from "@/lib/format";
import { toast } from "@hapiecoin/ui";

const day = (iso: string | null) => (iso ? fmtDate(iso) : "—");
const endsText = (u: AdminUserRow, now = Date.now()) => {
  if (!u.planName) return { text: "—", tone: "text-muted-foreground" };
  if (!u.expiresAt) return { text: "No end date", tone: "" };
  const d = Math.ceil((new Date(u.expiresAt).getTime() - now) / 86_400_000);
  if (d <= 0) return { text: `${fmtDate(u.expiresAt)} · expired ${-d} d ago`, tone: "text-loss" };
  return { text: `${fmtDate(u.expiresAt)} · ${d} d left`, tone: d < 7 ? "text-warning" : "" };
};

export const USER_COLUMNS: ColumnDef<AdminUserRow>[] = [
  { key: "name", label: "Name", sort: "name", csv: (u) => u.name },
  { key: "email", label: "Email", sort: "email", csv: (u) => u.email },
  { key: "plan", label: "Plan", sort: "planName", csv: (u) => u.planName ?? "Free" },
  { key: "status", label: "Status", csv: (u) => userStatus(u).label },
  { key: "startsAt", label: "Subscribed", sort: "startsAt", csv: (u) => u.startsAt?.slice(0, 10) ?? "" },
  { key: "expiresAt", label: "Ends", sort: "expiresAt", csv: (u) => u.expiresAt?.slice(0, 10) ?? "" },
  { key: "createdAt", label: "Joined", sort: "createdAt", csv: (u) => u.createdAt.slice(0, 10) },
  { key: "referralCode", label: "Referral code", csv: (u) => u.referralCode },
  { key: "commissionPct", label: "Commission", align: "right", csv: (u) => `${u.commissionPct}%` },
  { key: "twoFactor", label: "2FA", csv: (u) => (u.twoFactorEnabled ? "on" : "off") }, // ADR-086 (HC-AD-129)
  { key: "paidInr", label: "Paid", sort: "paidInr", align: "right", hidden: true, csv: (u) => u.paidInr },
  { key: "mobile", label: "Mobile", hidden: true, csv: (u) => u.mobile ?? "" },
  { key: "lastLoginAt", label: "Last login", sort: "lastLoginAt", hidden: true, csv: (u) => u.lastLoginAt ?? "" },
];
const NUMERIC_SORTS = new Set(["startsAt", "expiresAt", "createdAt", "paidInr", "lastLoginAt"]);

function Cell({ col, u }: { col: ColumnDef<AdminUserRow>; u: AdminUserRow }) {
  switch (col.key) {
    case "name":
      return <><div className="truncate font-medium" title={u.name}>{u.name}</div>{u.role === "admin" ? <div className="micro">admin</div> : null}</>;
    case "email":
      return <span className="num">{u.email}</span>;
    case "plan":
      return <span className={cn("rounded border px-1.5 py-0.5 font-mono text-3xs", u.planName ? "border-accent/60 text-accent" : "border-border text-muted-foreground")} data-testid="user-plan">{u.planName ?? "Free plan"}</span>;
    case "status": {
      const s = userStatus(u);
      return <span className={cn("rounded border px-1.5 py-0.5 font-mono text-3xs", s.key === "active" ? "border-profit/60 text-profit" : s.key === "deactivated" || s.key === "expired" ? "border-loss/60 text-loss" : "border-border text-muted-foreground")} data-testid="user-status" data-status={s.key}>{s.label}</span>;
    }
    case "startsAt":
      return <span className="num">{day(u.startsAt)}</span>;
    case "expiresAt": {
      const e = endsText(u);
      return <span className={cn("num", e.tone)}>{e.text}</span>;
    }
    case "createdAt":
      return <span className="num">{day(u.createdAt)}</span>;
    case "referralCode":
      return <span className="font-mono text-2xs">{u.referralCode}</span>;
    case "commissionPct":
      return <span className="num">{u.commissionPct}%</span>;
    case "twoFactor":
      return <span className={cn("rounded border px-1.5 py-0.5 font-mono text-3xs", u.twoFactorEnabled ? "border-profit/60 text-profit" : "border-border text-muted-foreground")} data-testid="user-2fa" data-on={u.twoFactorEnabled ? "true" : "false"}>{u.twoFactorEnabled ? "on" : "off"}</span>;
    case "paidInr":
      return <span className="num">{fmtInr(u.paidInr, { decimals: true })}</span>;
    case "mobile":
      return <span className="num">{u.mobile ?? "—"}</span>;
    case "lastLoginAt":
      return <span className="num">{u.lastLoginAt ? fmtDate(u.lastLoginAt) : "never"}</span>;
    default:
      return null;
  }
}

export function UsersAdmin() {
  const [query, setQuery] = useState<UsersListQuery>(DEFAULT_USERS_QUERY);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [drawer, setDrawer] = useState<string | null>(null);
  const [invite, setInvite] = useState(false);
  const [bulkPlan, setBulkPlan] = useState(false);
  const users = useAdminUsersList(query);
  const plans = useAdminPlans();
  const bulk = useBulkAdminUsers();
  const columns = useAdminColumns("users", USER_COLUMNS);
  const rows = users.data?.items ?? [];
  const total = users.data?.total ?? 0;
  const pages = users.data ? Math.max(1, Math.ceil(users.data.total / users.data.pageSize)) : 1;
  const filtered = query.q !== "" || query.status !== "all" || query.plan !== "all";
  const patchQuery = (p: Partial<UsersListQuery>) => setQuery((q) => ({ ...q, ...p, page: p.page ?? 1 }));
  const clear = () => { setQuery({ ...DEFAULT_USERS_QUERY }); setSel(new Set()); };
  const sortState: SortState = { sort: query.sort, dir: query.dir };
  const onSort = (s: SortState) => patchQuery({ sort: s.sort as UsersListQuery["sort"], dir: s.dir });
  const selectedRows = rows.filter((u) => sel.has(u.id));
  const doBulk = (active: boolean) => bulk.mutate({ ids: [...sel], active }, { onSuccess: (r) => { setSel(new Set()); toast.success("Updated", { description: `${r.updated} ${r.updated === 1 ? "account" : "accounts"} ${active ? "activated" : "deactivated"}` }); }, onError: (e) => toast.error("Failed", { description: e.message }) });
  return (
    <div data-testid="admin-users" data-count={total} data-state={users.isLoading ? "loading" : users.isError ? "error" : "ready"}>
      <AdminHeader title="User Management" subtitle={`${total} ${total === 1 ? "user" : "users"} · search, plan and status, then open a row for everything else`} action={<Button size="sm" onClick={() => setInvite(true)} data-testid="users-invite">Invite user</Button>} />
      <div className="sticky top-0 z-10 -mx-1 mb-2 flex flex-wrap items-center gap-2 bg-background px-1 py-2" data-testid="users-filters">
        <input value={query.q} onChange={(e) => patchQuery({ q: e.target.value })} placeholder="Search by name or email" className="h-7 w-[220px] rounded border border-input bg-background px-2 text-xs" aria-label="Search users" data-testid="um-search" />
        <select value={query.plan} onChange={(e) => patchQuery({ plan: e.target.value })} className="h-7 rounded border border-input bg-background px-2 text-xs" aria-label="Plan" data-testid="um-plan">
          <option value="all">All plans</option>
          <option value="free">Free (no plan)</option>
          {(plans.data ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <select value={query.status} onChange={(e) => patchQuery({ status: e.target.value as UsersListQuery["status"] })} className="h-7 rounded border border-input bg-background px-2 text-xs" aria-label="Status" data-testid="um-status">
          <option value="all">All status</option>
          <option value="active">Active plan</option>
          <option value="expired">Expired</option>
          <option value="free">Free</option>
          <option value="deactivated">Deactivated</option>
        </select>
        {filtered ? <Button size="sm" variant="ghost" onClick={clear} data-testid="um-clear">Clear</Button> : null}
        <span className="flex-1" />
        <span className="micro" data-testid="um-count">{rows.length} of {total} rows</span>
        <ColumnsMenu defs={USER_COLUMNS} columns={columns} testId="um-columns" />
        <Button size="sm" variant="outline" disabled={rows.length === 0} onClick={() => void copyCsv(rows, columns.visible, `page ${query.page} of ${pages}`)} data-testid="um-csv">Copy CSV</Button>
      </div>
      {users.isLoading ? (
        <div className="h-32 animate-pulse rounded bg-muted" />
      ) : users.isError ? (
        <EmptyState title="Failed to load users" description={users.error.message} className="py-10" action={<Button size="sm" onClick={() => void users.refetch()}>Retry</Button>} data-testid="um-error" />
      ) : rows.length === 0 ? (
        filtered ? (
          <EmptyState title="No users match" description="Try another search, plan or status" className="py-10" action={<Button size="sm" variant="outline" onClick={clear}>Clear filters</Button>} data-testid="um-empty-filtered" />
        ) : (
          <EmptyState title="No users yet" description="Invite the first trader" className="py-10" action={<Button size="sm" onClick={() => setInvite(true)}>Invite user</Button>} data-testid="um-empty" />
        )
      ) : (
        <div className="overflow-x-auto rounded border border-border">
          <table className="w-full text-xs" data-testid="um-table">
            <thead>
              <tr className="micro text-left">
                <th className="w-6 px-2 py-1"><input type="checkbox" aria-label="Select all rows" checked={rows.every((u) => sel.has(u.id))} onChange={(e) => setSel(e.target.checked ? new Set(rows.map((u) => u.id)) : new Set())} data-testid="um-select-all" /></th>
                {columns.visible.map((c) => (
                  <th key={c.key} className={cn("py-1 pr-2", c.align === "right" && "text-right", c.key === "name" && "sticky left-0 bg-background")}>
                    <SortHeader label={c.label} sortKey={c.sort} state={sortState} onSort={onSort} numeric={NUMERIC_SORTS.has(c.sort ?? "")} align={c.align ?? "left"} testId={`um-sort-${c.key}`} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((u) => (
                <tr
                  key={u.id}
                  tabIndex={0}
                  onClick={() => setDrawer(u.id)}
                  onKeyDown={(e) => { if (e.key === "Enter") setDrawer(u.id); }}
                  className={cn("h-row cursor-pointer border-t border-border outline-none hover:bg-muted/60 focus-visible:bg-muted/60", sel.has(u.id) && "bg-accent/10", !u.active && "opacity-60")}
                  data-testid="um-row"
                  data-email={u.email}
                  data-status={userStatus(u).key}
                >
                  <td className="px-2 py-1" onClick={(e) => e.stopPropagation()}>
                    <input type="checkbox" checked={sel.has(u.id)} onChange={(e) => setSel((s) => { const n = new Set(s); if (e.target.checked) n.add(u.id); else n.delete(u.id); return n; })} aria-label={`Select ${u.email}`} data-testid="um-select" />
                  </td>
                  {columns.visible.map((c) => (
                    <td key={c.key} className={cn("max-w-[220px] py-1 pr-2", c.align === "right" && "text-right", c.key === "name" && "sticky left-0 bg-background")}><Cell col={c} u={u} /></td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground" data-testid="um-pager">
        <span>Page {query.page} of {pages} · {total} {total === 1 ? "user" : "users"}</span>
        <span className="flex-1" />
        <Button size="sm" variant="outline" disabled={query.page <= 1} onClick={() => patchQuery({ page: query.page - 1 })}>← Previous</Button>
        <Button size="sm" variant="outline" disabled={query.page >= pages} onClick={() => patchQuery({ page: query.page + 1 })}>Next →</Button>
      </div>
      <FloatingBar count={sel.size} onClear={() => setSel(new Set())} testId="um-bulk">
        <Button size="sm" variant="outline" loading={bulk.isPending} onClick={() => doBulk(true)} data-testid="um-bulk-activate">Activate</Button>
        <Button size="sm" variant="outline" loading={bulk.isPending} onClick={() => doBulk(false)} data-testid="um-bulk-deactivate">Deactivate</Button>
        <Button size="sm" variant="outline" onClick={() => setBulkPlan(true)} data-testid="um-bulk-plan">Set plan</Button>
        <Button size="sm" variant="outline" onClick={() => void copyCsv(selectedRows, columns.visible, `${selectedRows.length} selected`)} data-testid="um-bulk-csv">Export {sel.size} selected</Button>
      </FloatingBar>
      {drawer ? <UserDrawer id={drawer} onOpenChange={(o) => { if (!o) setDrawer(null); }} /> : null}
      {invite ? <InviteUserDialog onOpenChange={(o) => { if (!o) setInvite(false); }} onInvited={(id) => setDrawer(id)} /> : null}
      {bulkPlan ? <SetPlanDialog ids={[...sel]} who={`${sel.size} ${sel.size === 1 ? "user" : "users"}`} onOpenChange={(o) => { if (!o) { setBulkPlan(false); setSel(new Set()); } }} /> : null}
    </div>
  );
}
