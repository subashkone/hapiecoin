"use client";
// My Referrals (HC-AC-037..055, 067..074; ADR-031; docs/design/billing.md "Referrals"): link and code to share,
// what was earned and what is still pending, the referred users with filters / sort / paging, and an earnings chart.
import { type CommissionStatus, type ReferralRow, type ReferralsView } from "@hapiecoin/schema";
import { Button, Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, EmptyState, cn, toast } from "@hapiecoin/ui";
import { useMemo, useState } from "react";
import { referralsCsv, shareTemplates, useReferrals } from "@/lib/api/referrals";
import { INTERVAL_LABELS, fmtInr } from "@/lib/billing/format";
import { fmtDate } from "@/lib/format";
import { EarningsChart, StatusBadge } from "./ReferralBits";

export const REFERRALS_PAGE = 10;
type SortKey = "name" | "joinedAt" | "planName" | "amountInr" | "commissionInr" | "status";

async function copy(text: string, what: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    toast.success("Copied!", { description: what });
  } catch {
    toast.error("Could not copy", { description: "Select the text and copy it yourself" });
  }
}

function ShareDialog({ view, open, onOpenChange }: { view: ReferralsView; open: boolean; onOpenChange: (o: boolean) => void }) {
  const templates = shareTemplates(view.link, view.code, view.commissionPct);
  const canShare = typeof navigator !== "undefined" && typeof navigator.share === "function";
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[560px]" data-testid="share-dialog">
        <DialogHeader>
          <DialogTitle>Share your referral link</DialogTitle>
          <DialogDescription>Every message carries your link and code.</DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-3">
          <div className="flex gap-2">
            <input readOnly value={view.link} className="num h-8 flex-1 rounded border border-input bg-background px-2 text-xs" aria-label="Referral link" onFocus={(e) => e.currentTarget.select()} />
            <Button size="sm" variant="outline" onClick={() => void copy(view.link, "Referral link")} data-testid="share-copy-link">Copy link</Button>
            {canShare ? <Button size="sm" variant="outline" onClick={() => void navigator.share({ title: "HapieCoin", text: templates[0]!.text, url: view.link }).catch(() => undefined)} data-testid="share-native">Share…</Button> : null}
          </div>
          {templates.map((t) => (
            <div key={t.key} className="rounded border border-border p-2 text-xs" data-testid={`share-${t.key}`}>
              <div className="mb-1 flex items-center gap-2">
                <b>{t.label}</b>
                <a href={t.href} target="_blank" rel="noreferrer" className="text-muted-foreground hover:text-foreground">Open</a>
                <Button size="sm" variant="ghost" className="ml-auto" onClick={() => void copy(t.text, `${t.label} message`)} data-testid={`share-copy-${t.key}`}>Copy message</Button>
              </div>
              <pre className="whitespace-pre-wrap font-sans text-2xs text-muted-foreground">{t.text}</pre>
            </div>
          ))}
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ReferralsPage() {
  const { data: view, isLoading, isError, error, refetch } = useReferrals();
  const [share, setShare] = useState(false);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<"all" | CommissionStatus>("all");
  const [plan, setPlan] = useState("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "joinedAt", dir: -1 });
  const [page, setPage] = useState(1);
  const plans = useMemo(() => [...new Set((view?.rows ?? []).map((r) => r.planName ?? "Free"))].sort(), [view]);
  const rows = useMemo(() => {
    const all = view?.rows ?? [];
    const filtered = all.filter((r) => {
      if (q && !`${r.name} ${r.email}`.toLowerCase().includes(q.toLowerCase())) return false;
      if (status !== "all" && r.status !== status) return false;
      if (plan !== "all" && (r.planName ?? "Free") !== plan) return false;
      const day = r.joinedAt.slice(0, 10);
      if (from && day < from) return false;
      if (to && day > to) return false;
      return true;
    });
    const num = (k: SortKey) => k === "amountInr" || k === "commissionInr";
    return [...filtered].sort((a, b) => {
      const av = a[sort.key] ?? "";
      const bv = b[sort.key] ?? "";
      const c = num(sort.key) ? Number(av) - Number(bv) : String(av).localeCompare(String(bv));
      return c * sort.dir;
    });
  }, [view, q, status, plan, from, to, sort]);
  const pages = Math.max(1, Math.ceil(rows.length / REFERRALS_PAGE));
  const slice = rows.slice((page - 1) * REFERRALS_PAGE, page * REFERRALS_PAGE);
  const clear = () => {
    setQ("");
    setStatus("all");
    setPlan("all");
    setFrom("");
    setTo("");
    setPage(1);
    toast("Filters cleared");
  };
  const toggleSort = (key: SortKey) => setSort((s) => (s.key === key ? { key, dir: s.dir === 1 ? -1 : 1 } : { key, dir: key === "joinedAt" || key === "amountInr" || key === "commissionInr" ? -1 : 1 }));

  if (isLoading) {
    return (
      <main className="mx-auto max-w-[1100px] px-6 py-8" data-testid="referrals-page" data-state="loading">
        <div className="h-6 w-48 animate-pulse rounded bg-muted" />
        <div className="mt-4 h-28 animate-pulse rounded bg-muted" />
      </main>
    );
  }
  if (isError || !view) {
    return (
      <main className="mx-auto max-w-[1100px] px-6 py-8" data-testid="referrals-page" data-state="error">
        <EmptyState title="Failed to load referrals" description={error?.message ?? "request failed"} action={<Button size="sm" onClick={() => void refetch()}>Retry</Button>} />
      </main>
    );
  }
  const pct = Number(view.commissionPct);
  const filtered = rows.length !== view.rows.length;
  return (
    <main className="mx-auto max-w-[1100px] px-6 py-8" data-testid="referrals-page" data-state="ready" data-count={view.rows.length}>
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <p className="micro">My Referrals</p>
          <h1 className="mt-1">Share &amp; Earn</h1>
        </div>
        <span className="micro ml-2" data-testid="ref-meta">
          {pct > 0 ? `${view.commissionPct}% commission` : "commission rate not set"} · {view.stats.referrals} {view.stats.referrals === 1 ? "referral" : "referrals"}
        </span>
        <span className="flex-1" />
        <Button size="sm" onClick={() => setShare(true)} data-testid="ref-share">Share</Button>
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <section className="rounded border border-border p-4" data-testid="ref-link-card">
          <div className="flex items-center gap-2 text-[15px] font-medium">
            <span aria-hidden>🎁</span>
            {pct > 0 ? `Get ${view.commissionPct}% commission on every paid referral` : "Invite traders and earn commission on their plans"}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">Share your link. When a friend signs up and buys a plan, the commission is credited as pending and paid out by HapieCoin.</p>
          <div className="mt-3 flex gap-2">
            <input readOnly value={view.link} onClick={(e) => e.currentTarget.select()} className="num h-8 min-w-0 flex-1 rounded border border-input bg-background px-2 text-xs" aria-label="Referral link" data-testid="ref-link" />
            <Button size="sm" variant="outline" onClick={() => void copy(view.link, "Referral link")} data-testid="ref-copy">Copy</Button>
          </div>
          <button type="button" className="mt-2 rounded border border-dashed border-border px-2 py-0.5 font-mono text-2xs hover:border-foreground/40" title="Click to copy the code" onClick={() => void copy(view.code, "Referral code")} data-testid="ref-code">
            Code: {view.code}
          </button>
        </section>
        <section className="rounded border border-border p-4 text-xs" data-testid="ref-how">
          <div className="micro mb-2">How it works</div>
          <ol className="space-y-1">
            <li><b className="font-mono">1</b> Share your unique referral link</li>
            <li><b className="font-mono">2</b> Your friend signs up and purchases a plan</li>
            <li><b className="font-mono">3</b> Earn {pct > 0 ? `${view.commissionPct}%` : "a commission"} on what they pay</li>
          </ol>
          <p className="micro mt-2">Pending · not yet paid out → Paid when HapieCoin settles it.</p>
        </section>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4" data-testid="ref-tiles">
        {[
          ["Total referrals", String(view.stats.referrals), "sign-ups with your code", ""],
          ["Total earned", fmtInr(view.stats.earnedInr, { decimals: true }), "paid + pending", ""],
          ["Paid", fmtInr(view.stats.paidInr, { decimals: true }), "settled to you", "text-profit"],
          ["Pending", fmtInr(view.stats.pendingInr, { decimals: true }), "not yet paid out", "text-warning"],
        ].map(([label, value, sub, tone]) => (
          <div key={label} className="rounded border border-border p-3" data-testid="ref-tile">
            <div className="micro">{label}</div>
            <div className={cn("num text-[15px] font-medium", tone)}>{value}</div>
            <div className="micro">{sub}</div>
          </div>
        ))}
      </div>

      <div className="mt-4">
        <EarningsChart bars={view.byMonth} />
      </div>

      <section className="mt-6" data-testid="ref-table-section">
        <div className="flex flex-wrap items-center gap-2" data-testid="ref-filters">
          <input value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} placeholder="Search by name or email" className="h-7 w-[200px] rounded border border-input bg-background px-2 text-xs" aria-label="Search referrals" data-testid="ref-search" />
          <select value={status} onChange={(e) => { setStatus(e.target.value as typeof status); setPage(1); }} className="h-7 rounded border border-input bg-background px-2 text-xs" aria-label="Status" data-testid="ref-status-filter">
            <option value="all">All Status</option>
            <option value="paid">Paid</option>
            <option value="pending">Pending</option>
            <option value="not_paid">No Purchase</option>
          </select>
          <select value={plan} onChange={(e) => { setPlan(e.target.value); setPage(1); }} className="h-7 rounded border border-input bg-background px-2 text-xs" aria-label="Plan" data-testid="ref-plan-filter">
            <option value="all">All Plans</option>
            {plans.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
          <label className="flex items-center gap-1 text-2xs text-muted-foreground">Date <input type="date" value={from} onChange={(e) => { setFrom(e.target.value); setPage(1); }} className="h-7 rounded border border-input bg-background px-1 text-xs" aria-label="Joined from" data-testid="ref-from" /> – <input type="date" value={to} onChange={(e) => { setTo(e.target.value); setPage(1); }} className="h-7 rounded border border-input bg-background px-1 text-xs" aria-label="Joined to" data-testid="ref-to" /></label>
          <Button size="sm" variant="ghost" onClick={clear} data-testid="ref-clear">Clear</Button>
          <span className="flex-1" />
          <Button size="sm" variant="outline" disabled={rows.length === 0} onClick={() => void copy(referralsCsv(rows), `${rows.length} rows as CSV`)} data-testid="ref-csv">Copy CSV</Button>
        </div>
        {view.rows.length === 0 ? (
          <EmptyState title="No referrals yet" description="Share your link to start earning" className="py-10" action={<Button size="sm" onClick={() => setShare(true)}>Share link</Button>} data-testid="ref-empty" />
        ) : rows.length === 0 ? (
          <EmptyState title="No results found" description="Try adjusting your filters" className="py-10" action={<Button size="sm" variant="outline" onClick={clear}>Clear filters</Button>} data-testid="ref-no-results" />
        ) : (
          <div className="mt-2 overflow-x-auto rounded border border-border">
            <table className="w-full text-xs" data-testid="ref-table">
              <thead>
                <tr className="micro text-left">
                  {([["name", "User"], ["joinedAt", "Joined"], ["planName", "Plan"], ["amountInr", "Amount"], ["commissionInr", "Commission"], ["status", "Status"]] as [SortKey, string][]).map(([key, label]) => (
                    <th key={key} className={cn("py-1 pr-2", (key === "amountInr" || key === "commissionInr") && "text-right", key === "name" && "sticky left-0 bg-background pl-3")}>
                      <button type="button" className="hover:text-foreground" onClick={() => toggleSort(key)} data-testid={`ref-sort-${key}`}>
                        {label} {sort.key === key ? (sort.dir === 1 ? "▲" : "▼") : ""}
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {slice.map((r: ReferralRow) => (
                  <tr key={r.userId} className="border-t border-border" data-testid="ref-row" data-status={r.status}>
                    <td className="sticky left-0 bg-background py-1 pl-3 pr-2">
                      <div className="flex items-center gap-2">
                        <span className="grid h-6 w-6 place-items-center rounded-full bg-muted font-mono text-3xs">{r.name.split(" ").map((s) => s[0] ?? "").join("").slice(0, 2).toUpperCase()}</span>
                        <div className="min-w-0"><div className="truncate font-medium" title={r.name}>{r.name}</div><div className="micro truncate">{r.email}</div></div>
                      </div>
                    </td>
                    <td className="num py-1 pr-2">{fmtDate(r.joinedAt)}</td>
                    <td className="py-1 pr-2">{r.planName ? <><span className="rounded border border-border px-1 font-mono text-3xs">{r.planName}</span>{r.interval ? <span className="micro ml-1">{INTERVAL_LABELS[r.interval].toLowerCase()}</span> : null}</> : <span className="micro">no plan yet</span>}</td>
                    <td className="num py-1 pr-2 text-right">{fmtInr(r.amountInr, { decimals: true })}</td>
                    <td className={cn("num py-1 pr-2 text-right", Number(r.commissionInr) > 0 && "text-profit")}>{fmtInr(r.commissionInr, { decimals: true })}</td>
                    <td className="py-1 pr-2"><StatusBadge status={r.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {view.rows.length > 0 ? (
          <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground" data-testid="ref-pager">
            <span>{rows.length} {rows.length === 1 ? "referral" : "referrals"}{filtered ? ` (filtered from ${view.rows.length})` : ""} · Page {page} of {pages}</span>
            <span className="flex-1" />
            <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>← Previous</Button>
            <Button size="sm" variant="outline" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>Next →</Button>
          </div>
        ) : null}
      </section>
      <ShareDialog view={view} open={share} onOpenChange={setShare} />
    </main>
  );
}
