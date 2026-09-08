"use client";
// Admin · User Subscriptions → Commissions tab (HC-AD-052..058, 118, 119; ADR-031): what is owed to referrers,
// per referrer with View and Mark Payment (Paid / Not Paid with a reason and proof), bulk pay, and paid vs pending
// by month. Money is INR with two decimals; amber is the one primary action (Bulk pay).
import { type AdminCommissionRow, type MarkPaymentBody } from "@hapiecoin/schema";
import { Button, Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, EmptyState, cn, toast } from "@hapiecoin/ui";
import { useState } from "react";
import { useAdminCommissions, useBulkPay, useCommissionDetail, useMarkPayment } from "@/lib/api/referrals";
import { INTERVAL_LABELS, fmtInr } from "@/lib/billing/format";
import { fmtDate } from "@/lib/format";
import { EarningsChart, StatusBadge } from "../account/ReferralBits";

function ViewDialog({ row, onOpenChange }: { row: AdminCommissionRow; onOpenChange: (o: boolean) => void }) {
  const detail = useCommissionDetail(row.referrerId);
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[640px]" data-testid="cms-view-dialog">
        <DialogHeader>
          <DialogTitle>Referrals of {row.name}</DialogTitle>
          <DialogDescription>{row.email} · {row.commissionPct}% commission · pending {fmtInr(row.pendingInr, { decimals: true })}</DialogDescription>
        </DialogHeader>
        <DialogBody>
          {detail.isLoading ? (
            <div className="h-20 animate-pulse rounded bg-muted" />
          ) : detail.isError ? (
            <EmptyState title="Failed to load" description={detail.error.message} className="py-6" />
          ) : (detail.data?.rows.length ?? 0) === 0 ? (
            <EmptyState title="No referrals yet" description="Nobody has signed up with this code" className="py-6" />
          ) : (
            <div className="overflow-x-auto rounded border border-border">
              <table className="w-full text-xs" data-testid="cms-view-table">
                <thead><tr className="micro text-left"><th className="py-1 pl-2 pr-2">User</th><th className="py-1 pr-2">Joined</th><th className="py-1 pr-2">Plan</th><th className="py-1 pr-2 text-right">Amount</th><th className="py-1 pr-2 text-right">Commission</th><th className="py-1 pr-2">Status</th></tr></thead>
                <tbody>
                  {detail.data?.rows.map((r) => (
                    <tr key={r.userId} className="border-t border-border" data-testid="cms-view-row" data-status={r.status}>
                      <td className="py-1 pl-2 pr-2"><div className="font-medium">{r.name}</div><div className="micro">{r.email}</div></td>
                      <td className="num py-1 pr-2">{fmtDate(r.joinedAt)}</td>
                      <td className="py-1 pr-2">{r.planName ? <>{r.planName}{r.interval ? <span className="micro ml-1">{INTERVAL_LABELS[r.interval].toLowerCase()}</span> : null}</> : <span className="micro">no plan yet</span>}</td>
                      <td className="num py-1 pr-2 text-right">{fmtInr(r.amountInr, { decimals: true })}</td>
                      <td className={cn("num py-1 pr-2 text-right", Number(r.commissionInr) > 0 && "text-profit")}>{fmtInr(r.commissionInr, { decimals: true })}</td>
                      <td className="py-1 pr-2"><StatusBadge status={r.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} data-testid="cms-view-close">Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function MarkDialog({ row, onOpenChange }: { row: AdminCommissionRow; onOpenChange: (o: boolean) => void }) {
  const [status, setStatus] = useState<MarkPaymentBody["status"]>("paid");
  const [note, setNote] = useState("");
  const [proofUrl, setProofUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const mark = useMarkPayment();
  const submit = () => {
    if (status === "not_paid" && !note.trim()) return setError("A reason is required when marking Not Paid");
    if (proofUrl && !/^https?:\/\//.test(proofUrl)) return setError("Proof must be a full URL (https://…)");
    setError(null);
    const body: MarkPaymentBody = { status, ...(note.trim() ? { note: note.trim() } : {}), ...(proofUrl ? { proofUrl } : {}) };
    mark.mutate(
      { id: row.referrerId, body },
      {
        onSuccess: (r) => {
          toast.success(status === "paid" ? "Marked paid" : "Marked not paid", { description: `${row.name} · ${r.rows} ${r.rows === 1 ? "row" : "rows"} · ${fmtInr(r.amountInr, { decimals: true })}` });
          onOpenChange(false);
        },
        onError: (e) => setError(e.message),
      },
    );
  };
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[440px]" data-testid="cms-mark-dialog">
        <DialogHeader>
          <DialogTitle>Mark payment · {row.name}</DialogTitle>
          <DialogDescription>Pending {fmtInr(row.pendingInr, { decimals: true })} across {row.referrals} {row.referrals === 1 ? "referral" : "referrals"}. Every pending row of this referrer is settled together.</DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-3 text-xs">
          <div className="flex gap-2" role="radiogroup" aria-label="Payment status">
            {(["paid", "not_paid"] as const).map((s) => (
              <button key={s} type="button" role="radio" aria-checked={status === s} onClick={() => setStatus(s)} className={cn("flex-1 rounded border px-2 py-1.5 font-medium", status === s ? (s === "paid" ? "border-profit text-profit" : "border-loss text-loss") : "border-border text-muted-foreground hover:text-foreground")} data-testid={`cms-mark-${s}`}>
                {s === "paid" ? "Paid" : "Not Paid"}
              </button>
            ))}
          </div>
          <label className="block">
            <span className="micro">{status === "not_paid" ? "Reason (required)" : "Note (optional)"}</span>
            <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} className="mt-1 w-full rounded border border-input bg-background px-2 py-1 text-xs" placeholder={status === "not_paid" ? "e.g. bank details missing" : "e.g. NEFT ref 4471"} data-testid="cms-mark-note" />
          </label>
          <label className="block">
            <span className="micro">Proof URL (optional)</span>
            <input value={proofUrl} onChange={(e) => setProofUrl(e.target.value)} className="num mt-1 h-7 w-full rounded border border-input bg-background px-2 text-xs" placeholder="https://…" data-testid="cms-mark-proof" />
          </label>
          {error ? <p className="text-loss" role="alert" data-testid="cms-mark-error">{error}</p> : null}
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button loading={mark.isPending} onClick={submit} data-testid="cms-mark-save">{status === "paid" ? "Mark paid" : "Mark not paid"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function CommissionsAdmin() {
  const [q, setQ] = useState("");
  const [month, setMonth] = useState("");
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [viewFor, setViewFor] = useState<AdminCommissionRow | null>(null);
  const [markFor, setMarkFor] = useState<AdminCommissionRow | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  const view = useAdminCommissions(q, month);
  const bulk = useBulkPay();
  const rows = view.data?.rows ?? [];
  const pendingRows = rows.filter((r) => Number(r.pendingInr) > 0);
  const selectedPending = pendingRows.filter((r) => sel.has(r.referrerId));
  const bulkTarget = selectedPending.length > 0 ? selectedPending : pendingRows;
  const bulkAmount = bulkTarget.reduce((t, r) => t + Number(r.pendingInr), 0);
  const runBulk = () =>
    bulk.mutate(selectedPending.length > 0 ? { referrerIds: selectedPending.map((r) => r.referrerId) } : {}, {
      onSuccess: (r) => {
        setBulkOpen(false);
        setSel(new Set());
        toast.success("Paid", { description: `${r.settledRows} ${r.settledRows === 1 ? "row" : "rows"} · ${r.referrers} ${r.referrers === 1 ? "referrer" : "referrers"} · ${fmtInr(r.amountInr, { decimals: true })}` });
      },
      onError: (e) => toast.error("Bulk pay failed", { description: e.message }),
    });
  const clear = () => {
    setQ("");
    setMonth("");
    setSel(new Set());
  };
  return (
    <div data-testid="admin-commissions" data-count={rows.length} data-state={view.isLoading ? "loading" : view.isError ? "error" : "ready"}>
      <div className="mb-3 grid grid-cols-3 gap-3" data-testid="cms-tiles">
        {[
          ["Total commission", view.data?.tiles.totalInr, "paid + pending", ""],
          ["Paid", view.data?.tiles.paidInr, "settled", "text-profit"],
          ["Pending", view.data?.tiles.pendingInr, "owed to referrers", "text-warning"],
        ].map(([label, value, sub, tone]) => (
          <div key={label} className="rounded border border-border p-3" data-testid="cms-tile">
            <div className="micro">{label}</div>
            <div className={cn("num text-[15px] font-medium", tone)}>{value === undefined ? "—" : fmtInr(value, { decimals: true })}</div>
            <div className="micro">{sub}</div>
          </div>
        ))}
      </div>
      <div className="mb-2 flex flex-wrap items-center gap-2" data-testid="cms-filters">
        <span className="text-xs font-medium">Referrers ({rows.length})</span>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search referrer by name or email..." className="h-7 w-[220px] rounded border border-input bg-background px-2 text-xs" aria-label="Search referrers" data-testid="cms-search" />
        <select value={month} onChange={(e) => setMonth(e.target.value)} className="h-7 rounded border border-input bg-background px-2 text-xs" aria-label="Month" data-testid="cms-month">
          <option value="">All months</option>
          {(view.data?.months ?? []).map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
        <Button size="sm" variant="ghost" onClick={clear} data-testid="cms-clear">Clear</Button>
        <span className="flex-1" />
        {sel.size > 0 ? <span className="micro" data-testid="cms-selected">{sel.size} selected{selectedPending.length < sel.size ? ` · ${selectedPending.length} with pending` : ""}</span> : null}
        <Button size="sm" disabled={bulkTarget.length === 0} onClick={() => setBulkOpen(true)} data-testid="cms-bulk-pay">
          {selectedPending.length > 0 ? `Mark paid (${selectedPending.length})` : "Bulk pay"}
        </Button>
      </div>
      {view.isLoading ? (
        <div className="h-24 animate-pulse rounded bg-muted" />
      ) : view.isError ? (
        <EmptyState title="Failed to load commissions" description={view.error.message} className="py-10" action={<Button size="sm" onClick={() => void view.refetch()}>Retry</Button>} data-testid="cms-error" />
      ) : rows.length === 0 ? (
        <EmptyState title="No commissions yet" description={q || month ? "Try another search or month" : "Commissions appear when a referred user buys a plan"} className="py-10" data-testid="cms-empty" />
      ) : (
        <div className="overflow-x-auto rounded border border-border">
          <table className="w-full text-xs" data-testid="cms-table">
            <thead>
              <tr className="micro text-left">
                <th className="w-6 px-2 py-1"><input type="checkbox" aria-label="Select all referrers" checked={pendingRows.length > 0 && pendingRows.every((r) => sel.has(r.referrerId))} disabled={pendingRows.length === 0} onChange={(e) => setSel(e.target.checked ? new Set(pendingRows.map((r) => r.referrerId)) : new Set())} data-testid="cms-select-all" /></th>
                <th className="py-1 pr-2">Referrer</th>
                <th className="py-1 pr-2 text-right">Referrals</th>
                <th className="py-1 pr-2 text-right">Commission</th>
                <th className="py-1 pr-2 text-right">Total</th>
                <th className="py-1 pr-2 text-right">Paid</th>
                <th className="py-1 pr-2 text-right">Pending</th>
                <th className="py-1 pr-2">Status</th>
                <th className="py-1 pr-2 text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const pending = Number(r.pendingInr) > 0;
                return (
                  <tr key={r.referrerId} className="border-t border-border" data-testid="cms-row" data-email={r.email} data-status={r.status}>
                    <td className="px-2 py-1"><input type="checkbox" checked={sel.has(r.referrerId)} disabled={!pending} onChange={(e) => setSel((s) => { const n = new Set(s); if (e.target.checked) n.add(r.referrerId); else n.delete(r.referrerId); return n; })} aria-label={`Select ${r.email}`} data-testid="cms-select" /></td>
                    <td className="py-1 pr-2"><div className="font-medium">{r.name}</div><div className="micro">{r.email}{r.lastNote ? ` · ${r.lastNote}` : ""}</div></td>
                    <td className="num py-1 pr-2 text-right">{r.referrals}</td>
                    <td className="num py-1 pr-2 text-right">{r.commissionPct}%</td>
                    <td className="num py-1 pr-2 text-right">{fmtInr(r.totalInr, { decimals: true })}</td>
                    <td className="num py-1 pr-2 text-right text-profit">{fmtInr(r.paidInr, { decimals: true })}</td>
                    <td className={cn("num py-1 pr-2 text-right", pending && "text-warning")} data-testid="cms-pending">{fmtInr(r.pendingInr, { decimals: true })}</td>
                    <td className="py-1 pr-2"><StatusBadge status={r.status} /></td>
                    <td className="py-1 pr-2 text-right">
                      <Button size="sm" variant="ghost" onClick={() => setViewFor(r)} data-testid="cms-view">View</Button>
                      {pending ? <Button size="sm" variant="outline" onClick={() => setMarkFor(r)} data-testid="cms-mark">Mark Paid</Button> : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {view.data && view.data.byMonth.length > 0 ? (
        <div className="mt-3">
          <EarningsChart bars={view.data.byMonth} title="Paid vs pending by month" />
        </div>
      ) : null}
      {viewFor ? <ViewDialog row={viewFor} onOpenChange={(o) => { if (!o) setViewFor(null); }} /> : null}
      {markFor ? <MarkDialog row={markFor} onOpenChange={(o) => { if (!o) setMarkFor(null); }} /> : null}
      <Dialog open={bulkOpen} onOpenChange={setBulkOpen}>
        <DialogContent className="sm:max-w-[420px]" data-testid="cms-bulk-dialog">
          <DialogHeader>
            <DialogTitle>{selectedPending.length > 0 ? `Mark ${selectedPending.length} ${selectedPending.length === 1 ? "referrer" : "referrers"} paid?` : "Pay every pending commission?"}</DialogTitle>
            <DialogDescription>
              {fmtInr(bulkAmount.toFixed(2), { decimals: true })} across {bulkTarget.length} {bulkTarget.length === 1 ? "referrer" : "referrers"}{month ? ` (all months, not only ${month})` : ""}. Rows are marked paid with the note "bulk pay"; this cannot be undone here.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBulkOpen(false)}>Cancel</Button>
            <Button loading={bulk.isPending} onClick={runBulk} data-testid="cms-bulk-confirm">Confirm</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
