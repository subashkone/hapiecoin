"use client";
// Payment history and the invoice dialog (HC-AC-031..035, 060..065; ADR-034): what was paid, when, with what, and
// the tax invoice for every paid row. Five rows per page from the API, status chips with counts, Copy CSV.
import { type Invoice, PAYMENT_STATUS_LABELS, type Payment, type PaymentStatus } from "@hapiecoin/schema";
import { Button, Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, EmptyState, cn, toast } from "@hapiecoin/ui";
import { useState } from "react";
import { useInvoice, usePayments } from "@/lib/api/payments";
import { INTERVAL_LABELS, fmtInr } from "@/lib/billing/format";
import { fmtDate } from "@/lib/format";

const fmtDateTime = (iso: string) => new Date(iso).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" });
const methodText = (m: string | null) => (m === null ? "—" : m === "free" ? "Free plan" : m === "coupon" ? "Coupon" : `Razorpay · ${m.charAt(0).toUpperCase()}${m.slice(1)}`);

export function StatusBadge({ status }: { status: PaymentStatus }) {
  return <span className={cn("rounded border px-1.5 py-0.5 font-mono text-3xs", status === "paid" ? "border-profit/60 text-profit" : status === "pending" ? "border-warning/60 text-warning" : "border-loss/60 text-loss")} data-testid="payment-status" data-status={status}>{PAYMENT_STATUS_LABELS[status]}</span>;
}

export function paymentsCsv(rows: readonly Payment[]): string {
  const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
  const head = ["Date", "Plan", "Interval", "Amount", "Coupon", "Discount", "Tax", "Method", "Status", "Invoice"];
  return [head.map(esc).join(","), ...rows.map((p) => [p.at, p.planName, p.interval, p.amountInr, p.couponCode ?? "", p.couponDiscountInr, p.taxInr, p.method ?? "", p.status, p.invoiceNo ?? ""].map(esc).join(","))].join("\n");
}

/** Plain-text rendering used by Download and Copy as text (HC-AC-063). */
export function invoiceText(inv: Invoice): string {
  const L = inv.lines;
  return [
    `${inv.seller.name} · TAX INVOICE ${inv.no}`,
    `${inv.seller.address} · GSTIN ${inv.seller.gstin} · ${inv.seller.email}`,
    `Issued ${fmtDate(inv.issuedAt)} · Paid`,
    "",
    `Billed to: ${inv.billedTo.name} <${inv.billedTo.email}>${inv.billedTo.mobile ? ` · ${inv.billedTo.mobile}` : ""}`,
    `Service period: ${fmtDate(inv.period.from)} → ${inv.period.to ? fmtDate(inv.period.to) : "no end date"}`,
    "",
    `${L.description}: ₹${L.listInr}`,
    `Plan discount: −₹${L.planDiscountInr}`,
    `Coupon${L.couponCode ? ` (${L.couponCode})` : ""}: −₹${L.couponDiscountInr}`,
    `Taxable value: ₹${L.taxableInr}`,
    `CGST 9%: ₹${L.cgstInr}`,
    `SGST 9%: ₹${L.sgstInr}`,
    `TOTAL: ₹${L.totalInr}`,
    "",
    `Payment: ${methodText(inv.payment.method)}${inv.payment.razorpayPaymentId ? ` · ${inv.payment.razorpayPaymentId}` : ""} · ${fmtDate(inv.payment.paidAt)}`,
  ].join("\n");
}

async function copy(text: string, what: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    toast.success("Copied!", { description: what });
  } catch {
    toast.error("Could not copy", { description: "Your browser blocked the clipboard" });
  }
}

export function InvoiceDialog({ paymentId, onOpenChange }: { paymentId: string; onOpenChange: (o: boolean) => void }) {
  const inv = useInvoice(paymentId);
  const d = inv.data;
  const download = () => {
    if (!d) return;
    try {
      const blob = new Blob([invoiceText(d)], { type: "text/plain" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${d.no}.txt`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success(`Invoice ${d.no} downloaded`);
    } catch {
      void copy(invoiceText(d), `Invoice ${d.no} (download blocked, copied instead)`);
    }
  };
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[560px]" data-testid="invoice-dialog" data-state-load={inv.isLoading ? "loading" : inv.isError ? "error" : "ready"}>
        <DialogHeader>
          <DialogTitle>{d ? `Invoice ${d.no}` : "Invoice"}</DialogTitle>
          <DialogDescription>{d ? `${d.seller.name} · GSTIN ${d.seller.gstin}` : "Tax invoice"}</DialogDescription>
        </DialogHeader>
        <DialogBody>
          {inv.isLoading ? <div className="h-32 animate-pulse rounded bg-muted" /> : inv.isError || !d ? <EmptyState title="Invoice unavailable" description={inv.error?.message ?? "Only paid payments have an invoice"} className="py-6" /> : (
            <div className="space-y-3 text-xs" data-testid="invoice">
              <div className="flex items-start justify-between gap-3">
                <div><div className="text-[15px] font-medium">{d.seller.name}</div><div className="micro">{d.seller.address}</div><div className="micro">GSTIN {d.seller.gstin} · {d.seller.email}</div></div>
                <div className="text-right"><div className="font-mono">{d.no}</div><span className="rounded border border-profit/60 px-1.5 py-0.5 font-mono text-3xs text-profit">Paid</span></div>
              </div>
              <dl className="grid grid-cols-3 gap-2">
                <div><dt className="micro">Billed to</dt><dd>{d.billedTo.name}<div className="micro">{d.billedTo.email}{d.billedTo.mobile ? ` · ${d.billedTo.mobile}` : ""}</div></dd></div>
                <div><dt className="micro">Invoice date</dt><dd className="num">{fmtDate(d.issuedAt)}</dd></div>
                <div><dt className="micro">Service period</dt><dd className="num">{fmtDate(d.period.from)} → {d.period.to ? fmtDate(d.period.to) : "no end date"}</dd></div>
              </dl>
              <table className="w-full" data-testid="invoice-lines">
                <tbody>
                  {([["Item", d.lines.description, ""], ["List price", fmtInr(d.lines.listInr, { decimals: true }), ""], ["Plan discount", `− ${fmtInr(d.lines.planDiscountInr, { decimals: true })}`, ""], [`Coupon${d.lines.couponCode ? ` · ${d.lines.couponCode}` : ""}`, `− ${fmtInr(d.lines.couponDiscountInr, { decimals: true })}`, ""], ["Taxable value", fmtInr(d.lines.taxableInr, { decimals: true }), ""], ["CGST 9%", fmtInr(d.lines.cgstInr, { decimals: true }), ""], ["SGST 9%", fmtInr(d.lines.sgstInr, { decimals: true }), ""], ["Total", fmtInr(d.lines.totalInr, { decimals: true }), "font-medium border-t border-border"]] as [string, string, string][]).map(([k, v, cls]) => (
                    <tr key={k} className={cls}><td className="py-0.5 text-muted-foreground">{k}</td><td className={cn("num py-0.5 text-right", cls)}>{v}</td></tr>
                  ))}
                </tbody>
              </table>
              <p className="micro">Payment: {methodText(d.payment.method)}{d.payment.razorpayPaymentId ? ` · ${d.payment.razorpayPaymentId}` : ""} · {fmtDate(d.payment.paidAt)}</p>
            </div>
          )}
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={() => d && void copy(invoiceText(d), `Invoice ${d.no} as text`)} disabled={!d} data-testid="invoice-copy">Copy as text</Button>
          <Button onClick={download} disabled={!d} data-testid="invoice-download">Download</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function PaymentHistory({ onBrowsePlans }: { onBrowsePlans?: () => void }) {
  const [status, setStatus] = useState<PaymentStatus | "all">("all");
  const [page, setPage] = useState(1);
  const [invoiceFor, setInvoiceFor] = useState<string | null>(null);
  const q = usePayments(status, page);
  const rows = q.data?.items ?? [];
  const counts = q.data?.counts ?? { all: 0, paid: 0, pending: 0, failed: 0 };
  const pages = q.data ? Math.max(1, Math.ceil(q.data.total / q.data.pageSize)) : 1;
  return (
    <section className="mt-8" data-testid="payment-history" data-state={q.isLoading ? "loading" : q.isError ? "error" : "ready"} data-count={counts.all}>
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-[15px] font-medium">Payment History</h2>
        <div className="flex gap-1" role="tablist" data-testid="payment-chips">
          {(["all", "paid", "pending", "failed"] as const).map((s) => (
            <button key={s} type="button" role="tab" aria-selected={status === s} onClick={() => { setStatus(s); setPage(1); }} className={cn("rounded border px-2 py-0.5 font-mono text-3xs uppercase", status === s ? "border-foreground bg-foreground text-background" : "border-border text-muted-foreground hover:text-foreground")} data-testid={`payment-chip-${s}`}>
              {s} {counts[s]}
            </button>
          ))}
        </div>
        <span className="flex-1" />
        <Button size="sm" variant="outline" disabled={rows.length === 0} onClick={() => void copy(paymentsCsv(rows), `${rows.length} payments as CSV`)} data-testid="payments-csv">Copy CSV</Button>
      </div>
      {q.isLoading ? <div className="mt-2 h-20 animate-pulse rounded bg-muted" /> : q.isError ? (
        <EmptyState title="Couldn't load payments" description={q.error.message} className="py-8" action={<Button size="sm" onClick={() => void q.refetch()}>Retry</Button>} />
      ) : counts.all === 0 ? (
        <EmptyState title="No payments yet" description="Your invoices appear here after your first purchase" className="py-8" action={onBrowsePlans ? <Button size="sm" onClick={onBrowsePlans}>Browse plans</Button> : undefined} data-testid="payments-empty" />
      ) : rows.length === 0 ? (
        <EmptyState title={`No ${status} payments`} description="Try another status" className="py-8" action={<Button size="sm" variant="outline" onClick={() => { setStatus("all"); setPage(1); }}>Show all</Button>} data-testid="payments-empty-filtered" />
      ) : (
        <div className="mt-2 overflow-x-auto rounded border border-border">
          <table className="w-full text-xs" data-testid="payments-table">
            <thead><tr className="micro text-left"><th className="py-1 pl-3 pr-2">Date</th><th className="py-1 pr-2">Plan</th><th className="py-1 pr-2">Interval</th><th className="py-1 pr-2 text-right">Amount</th><th className="py-1 pr-2">Coupon</th><th className="py-1 pr-2">Method</th><th className="py-1 pr-2">Status</th><th className="py-1 pr-2">Invoice</th></tr></thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id} className="h-row border-t border-border" data-testid="payment-row" data-status={p.status}>
                  <td className="num py-1 pl-3 pr-2">{fmtDateTime(p.at)}</td>
                  <td className="py-1 pr-2">{p.planName}</td>
                  <td className="py-1 pr-2">{INTERVAL_LABELS[p.interval]}</td>
                  <td className="num py-1 pr-2 text-right">{fmtInr(p.amountInr, { decimals: true })}</td>
                  <td className="py-1 pr-2">{p.couponCode ? <><span className="font-mono">{p.couponCode}</span> <span className="num text-profit">− {fmtInr(p.couponDiscountInr, { decimals: true })}</span></> : "—"}</td>
                  <td className="py-1 pr-2">{methodText(p.method)}{p.status === "failed" && p.failureReason ? <div className="micro text-loss">{p.failureReason}</div> : null}</td>
                  <td className="py-1 pr-2"><StatusBadge status={p.status} /></td>
                  <td className="py-1 pr-2">{p.invoiceNo ? <button type="button" className="font-mono text-2xs underline-offset-2 hover:underline" onClick={() => setInvoiceFor(p.id)} data-testid="payment-invoice">{p.invoiceNo}</button> : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {counts.all > 0 ? (
        <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground" data-testid="payments-pager">
          <span>Page {page} of {pages}</span>
          <span className="flex-1" />
          <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>← Previous</Button>
          <Button size="sm" variant="outline" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>Next →</Button>
        </div>
      ) : null}
      {invoiceFor ? <InvoiceDialog paymentId={invoiceFor} onOpenChange={(o) => { if (!o) setInvoiceFor(null); }} /> : null}
    </section>
  );
}
