"use client";
// Admin · user detail drawer (HC-AD-090, 101, 103..107; ADR-032): slides in from the right with the user's pills,
// then tabs Profile / Subscription / Referrals / Limits / Lot sizes / History. Actions the API refuses for the acting
// admin (own account, own role) are not offered; every other refusal surfaces the API's reason.
import { type AdminUserDetail, LIMIT_KEYS, LIMIT_LABELS, type LimitKey, type PlanLimits } from "@hapiecoin/schema";
import { Button, Dialog, DialogContent, DialogDescription, DialogTitle, EmptyState, cn, toast } from "@hapiecoin/ui";
import Link from "next/link";
import { useState } from "react";
import { StatusBadge } from "../account/ReferralBits";
import { SetPlanDialog } from "./UserDialogs";
import { useAdminUserDetail, userStatus } from "@/lib/api/admin";
import { usePatchAdminUser } from "@/lib/api/billing";
import { useMe } from "@/lib/api/queries";
import { INTERVAL_LABELS, fmtInr } from "@/lib/billing/format";
import { fmtDate } from "@/lib/format";

type Tab = "profile" | "subscription" | "referrals" | "limits" | "lots" | "history";
const TABS: [Tab, string][] = [["profile", "Profile"], ["subscription", "Subscription"], ["referrals", "Referrals"], ["limits", "Limits"], ["lots", "Lot sizes"], ["history", "History"]];
const initials = (name: string) => name.split(" ").map((s) => s[0] ?? "").join("").slice(0, 2).toUpperCase();
const fmtDateTime = (iso: string | null) => (iso ? `${fmtDate(iso)} ${new Date(iso).toISOString().slice(11, 16)} UTC` : "—");

function Pill({ children, tone = "" , testId }: { children: React.ReactNode; tone?: string; testId?: string }) {
  return <span className={cn("rounded border px-1.5 py-0.5 font-mono text-3xs", tone || "border-border text-muted-foreground")} data-testid={testId}>{children}</span>;
}

function KV({ rows }: { rows: [string, React.ReactNode][] }) {
  return (
    <dl className="grid grid-cols-[120px_1fr] gap-x-3 gap-y-1.5 text-xs">
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="micro self-center">{k}</dt>
          <dd className="num min-w-0 truncate">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function Profile({ d, isSelf }: { d: AdminUserDetail; isSelf: boolean }) {
  const u = d.user;
  const patch = usePatchAdminUser();
  const run = (body: Parameters<typeof patch.mutate>[0]["body"], what: string) => patch.mutate({ id: u.id, body }, { onSuccess: () => toast.success("Updated", { description: `${what} · ${u.name}` }), onError: (e) => toast.error("Refused", { description: e.message }) });
  return (
    <div className="space-y-3">
      <KV rows={[
        ["Name", u.name],
        ["Email", u.email],
        ["Mobile", u.mobile ?? "—"],
        ["Role", u.role === "admin" ? "Admin" : "User"],
        ["Joined", fmtDate(u.createdAt)],
        ["Last login", fmtDateTime(u.lastLoginAt)],
        ["Referral code", <span key="c" className="font-mono">{u.referralCode}</span>],
        ["Amount paid", fmtInr(u.paidInr, { decimals: true })],
        ["Account", u.active ? "Active" : "Deactivated"],
        ["Id", <span key="i" className="font-mono text-2xs">{u.id}</span>],
      ]} />
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" onClick={() => void navigator.clipboard.writeText(u.email).then(() => toast.success("Copied!", { description: u.email })).catch(() => toast.error("Could not copy"))} data-testid="drawer-copy-email">Copy email</Button>
        {isSelf ? <span className="micro self-center" data-testid="drawer-self">This is you · account and role are managed by another admin</span> : (
          <>
            <Button size="sm" variant="outline" loading={patch.isPending} onClick={() => run({ active: !u.active }, u.active ? "Deactivated" : "Activated")} data-testid="drawer-toggle-active">{u.active ? "Deactivate account" : "Activate account"}</Button>
            <Button size="sm" variant="outline" loading={patch.isPending} onClick={() => run({ role: u.role === "admin" ? "user" : "admin" }, u.role === "admin" ? "Admin removed" : "Made admin")} data-testid="drawer-toggle-role">{u.role === "admin" ? "Remove admin" : "Make admin"}</Button>
          </>
        )}
      </div>
    </div>
  );
}

function Subscription({ d, onSetPlan }: { d: AdminUserDetail; onSetPlan: () => void }) {
  const s = d.subscription;
  return (
    <div className="space-y-3">
      {s ? (
        <KV rows={[
          ["Plan", s.planName],
          ["Interval", s.interval ? INTERVAL_LABELS[s.interval] : "—"],
          ["Status", s.status],
          ["Subscribed", fmtDate(s.startsAt)],
          ["Ends", s.expiresAt ? fmtDate(s.expiresAt) : "No end date"],
          ["Validity", s.validityDays === null ? "—" : `${s.validityDays} d`],
          ["Days left", s.daysLeft === null ? "—" : `${s.daysLeft} d`],
          ["Amount paid", fmtInr(s.paidInr ?? "0", { decimals: true })],
        ]} />
      ) : (
        <p className="text-xs text-muted-foreground" data-testid="drawer-no-plan">No active subscription · on the {d.planDefaults.planName} plan's limits.</p>
      )}
      <Button size="sm" onClick={onSetPlan} data-testid="drawer-set-plan">Set plan (₹0)</Button>
      {d.subscriptions.length > 1 ? (
        <div>
          <div className="micro mb-1">History</div>
          <ul className="space-y-1 text-xs" data-testid="drawer-sub-history">
            {d.subscriptions.map((h) => <li key={h.id} className="flex gap-2"><span className="num w-[90px] shrink-0">{fmtDate(h.startsAt)}</span><span>{h.planName}{h.interval ? ` · ${INTERVAL_LABELS[h.interval].toLowerCase()}` : ""}</span><span className="micro ml-auto">{h.status}</span></li>)}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function Referrals({ d }: { d: AdminUserDetail }) {
  const r = d.referrals;
  return (
    <div className="space-y-3">
      <KV rows={[["Code", <span key="c" className="font-mono">{r.code}</span>], ["Commission", `${r.commissionPct}%`], ["Referrals", String(r.count)], ["Earned", fmtInr(r.earnedInr, { decimals: true })], ["Paid / pending", `${fmtInr(r.paidInr, { decimals: true })} / ${fmtInr(r.pendingInr, { decimals: true })}`]]} />
      {r.rows.length === 0 ? (
        <EmptyState title="No referrals yet" description="Nobody has signed up with this code" className="py-6" />
      ) : (
        <table className="w-full text-xs" data-testid="drawer-referrals">
          <thead><tr className="micro text-left"><th className="py-1 pr-2">User</th><th className="py-1 pr-2">Plan</th><th className="py-1 pr-2 text-right">Commission</th><th className="py-1">Status</th></tr></thead>
          <tbody>{r.rows.map((x) => <tr key={x.userId} className="border-t border-border"><td className="py-1 pr-2"><div className="truncate">{x.name}</div><div className="micro truncate">{x.email}</div></td><td className="py-1 pr-2">{x.planName ?? <span className="micro">no plan</span>}</td><td className="num py-1 pr-2 text-right">{fmtInr(x.commissionInr, { decimals: true })}</td><td className="py-1"><StatusBadge status={x.status} /></td></tr>)}</tbody>
        </table>
      )}
      <Link href="/admin/subscriptions?tab=commissions" className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline" data-testid="drawer-commissions-link">Open Commissions →</Link>
    </div>
  );
}

function Limits({ d }: { d: AdminUserDetail }) {
  const [form, setForm] = useState<PlanLimits>({ ...d.user.limitOverrides });
  const patch = usePatchAdminUser();
  const set = (key: LimitKey, raw: string) => setForm((f) => { const n = { ...f }; if (raw === "") delete n[key]; else n[key] = Math.max(0, Math.floor(Number(raw))); return n; });
  const hint = (key: LimitKey) => { const v = d.planDefaults.limits[key]; return v === undefined ? "not included in the plan" : v === 0 ? "plan: unlimited" : `plan: ${v} / month`; };
  return (
    <div className="space-y-3 text-xs">
      <p className="micro">Overrides replace the {d.planDefaults.planName} plan's number for this user; 0 = unlimited, blank = plan default.</p>
      {LIMIT_KEYS.map((key) => (
        <label key={key} className="grid grid-cols-[1fr_120px] items-center gap-2">
          <span>{LIMIT_LABELS[key]}<span className="micro block">{hint(key)}</span></span>
          <input type="number" min={0} value={form[key] ?? ""} onChange={(e) => set(key, e.target.value)} className="num h-7 rounded border border-input bg-background px-2" aria-label={LIMIT_LABELS[key]} data-testid={`drawer-limit-${key}`} />
        </label>
      ))}
      <Button size="sm" loading={patch.isPending} onClick={() => patch.mutate({ id: d.user.id, body: { limitOverrides: form } }, { onSuccess: () => toast.success("Limits saved", { description: d.user.name }), onError: (e) => toast.error("Failed", { description: e.message }) })} data-testid="drawer-limits-save">Save limits</Button>
    </div>
  );
}

function Lots({ d }: { d: AdminUserDetail }) {
  const [form, setForm] = useState<Record<"BTC" | "ETH" | "XAUT", string>>({ BTC: d.user.lotSizes?.BTC ?? "0.001", ETH: d.user.lotSizes?.ETH ?? "0.01", XAUT: d.user.lotSizes?.XAUT ?? "0.001" });
  const [error, setError] = useState<string | null>(null);
  const patch = usePatchAdminUser();
  const save = () => {
    if (Object.values(form).some((v) => !(Number(v) > 0))) return setError("Every lot size must be greater than zero");
    setError(null);
    patch.mutate({ id: d.user.id, body: { lotSizes: form } }, { onSuccess: () => toast.success("Lot sizes saved", { description: d.user.name }), onError: (e) => setError(e.message) });
  };
  return (
    <div className="space-y-3 text-xs">
      {(["BTC", "ETH", "XAUT"] as const).map((a) => (
        <label key={a} className="grid grid-cols-[1fr_120px] items-center gap-2"><span>{a} <span className="micro">per lot</span></span><input value={form[a]} onChange={(e) => setForm((f) => ({ ...f, [a]: e.target.value }))} className="num h-7 rounded border border-input bg-background px-2" aria-label={`${a} lot size`} data-testid={`drawer-lot-${a}`} /></label>
      ))}
      {error ? <p className="text-loss" role="alert">{error}</p> : null}
      <Button size="sm" loading={patch.isPending} onClick={save} data-testid="drawer-lots-save">Save lot sizes</Button>
    </div>
  );
}

function History({ d }: { d: AdminUserDetail }) {
  if (d.history.length === 0) return <EmptyState title="No admin actions yet" description="Plan changes, role and account changes appear here" className="py-6" />;
  return (
    <ul className="space-y-1 text-xs" data-testid="drawer-history">
      {d.history.map((h) => (
        <li key={h.id} className="flex gap-2 border-t border-border py-1 first:border-t-0">
          <span className="num w-[150px] shrink-0 text-muted-foreground">{fmtDateTime(h.at)}</span>
          <span className="font-mono text-2xs">{h.action.replace("admin.user.", "")}</span>
          <span className="micro ml-auto truncate">{h.actorEmail ?? "system"}</span>
        </li>
      ))}
    </ul>
  );
}

export function UserDrawer({ id, onOpenChange }: { id: string; onOpenChange: (o: boolean) => void }) {
  const detail = useAdminUserDetail(id);
  const { data: me } = useMe();
  const [tab, setTab] = useState<Tab>("profile");
  const [setPlan, setSetPlan] = useState(false);
  const d = detail.data;
  const status = d ? userStatus(d.user) : null;
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="fixed inset-y-0 right-0 left-auto top-0 flex h-full max-h-none w-[560px] max-w-full translate-x-0 translate-y-0 flex-col rounded-none border-l border-border p-0 data-[state=open]:slide-in-from-right" size="lg" data-testid="user-drawer" data-state-load={detail.isLoading ? "loading" : detail.isError ? "error" : "ready"}>
        {detail.isLoading || !d ? (
          <div className="p-5">
            <DialogTitle className="sr-only">User</DialogTitle>
            <DialogDescription className="sr-only">Loading</DialogDescription>
            {detail.isError ? <EmptyState title="Failed to load user" description={detail.error?.message ?? "request failed"} action={<Button size="sm" onClick={() => void detail.refetch()}>Retry</Button>} /> : <div className="h-24 animate-pulse rounded bg-muted" />}
          </div>
        ) : (
          <>
            <div className="border-b border-border px-5 pt-4 pb-3 pr-12">
              <div className="flex items-center gap-3">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-muted font-mono text-xs">{initials(d.user.name)}</span>
                <div className="min-w-0">
                  <DialogTitle className="truncate text-[15px] font-medium" data-testid="drawer-name">{d.user.name}</DialogTitle>
                  <DialogDescription className="micro truncate">{d.user.email}{d.user.mobile ? ` · ${d.user.mobile}` : ""} · joined {fmtDate(d.user.createdAt)}</DialogDescription>
                </div>
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                <Pill tone={d.user.planName ? "border-accent/60 text-accent" : ""} testId="drawer-pill-plan">{d.user.planName ?? "Free plan"}</Pill>
                <Pill tone={status?.key === "active" ? "border-profit/60 text-profit" : status?.key === "expired" || status?.key === "deactivated" ? "border-loss/60 text-loss" : ""} testId="drawer-pill-status">{status?.label}</Pill>
                {d.user.role === "admin" ? <Pill testId="drawer-pill-admin">Admin</Pill> : null}
              </div>
            </div>
            <div className="flex gap-1 overflow-x-auto border-b border-border px-3" role="tablist">
              {TABS.map(([key, label]) => (
                <button key={key} type="button" role="tab" aria-selected={tab === key} onClick={() => setTab(key)} className={cn("shrink-0 px-2 py-1.5 text-xs", tab === key ? "border-b-2 border-accent text-foreground" : "text-muted-foreground hover:text-foreground")} data-testid={`drawer-tab-${key}`}>{label}</button>
              ))}
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-5" data-testid={`drawer-panel-${tab}`}>
              {tab === "profile" ? <Profile d={d} isSelf={me?.id === d.user.id} /> : null}
              {tab === "subscription" ? <Subscription d={d} onSetPlan={() => setSetPlan(true)} /> : null}
              {tab === "referrals" ? <Referrals d={d} /> : null}
              {tab === "limits" ? <Limits key={d.user.id} d={d} /> : null}
              {tab === "lots" ? <Lots key={d.user.id} d={d} /> : null}
              {tab === "history" ? <History d={d} /> : null}
            </div>
          </>
        )}
      </DialogContent>
      {setPlan && d ? <SetPlanDialog ids={[d.user.id]} who={d.user.name} onOpenChange={(o) => { if (!o) setSetPlan(false); }} /> : null}
    </Dialog>
  );
}
