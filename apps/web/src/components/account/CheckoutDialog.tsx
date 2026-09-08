"use client";
// Subscribe dialog with coupons and Razorpay checkout (HC-AC-016..030; ADR-034; docs/design/billing.md "Checkout").
// The API owns every amount: the dialog quotes coupons through it, opens the order it creates, and only the API's
// signature check changes the plan. In "mock" mode (web mock server) an in-app mock checkout stands in for Razorpay.
import { type AvailableCoupon, type BillingInterval, COUPON_REASON_TEXT, type CheckoutOrder, type Plan, type PriceBreakdown, breakdownFor } from "@hapiecoin/schema";
import { Button, Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, cn, toast } from "@hapiecoin/ui";
import { useEffect, useState } from "react";
import { useActivatePlan } from "@/lib/api/billing";
import { openRazorpay, useAvailableCoupons, useCancelCheckout, useConfirmCheckout, useCouponQuote, useStartCheckout } from "@/lib/api/payments";
import { INTERVAL_LABELS, fmtInr } from "@/lib/billing/format";
import { fmtDate } from "@/lib/format";

const tag = (c: AvailableCoupon) => (c.discountType === "percent" ? `${Number(c.discountValue)}% OFF` : `${fmtInr(c.discountValue)} OFF`);

export function Breakdown({ b, testId = "price-breakdown" }: { b: PriceBreakdown; testId?: string }) {
  const rows: [string, string, boolean][] = [["List price", b.list, false], ["Plan discount", b.planDiscount, true], ["Coupon discount", b.couponDiscount, true], ["Subtotal", b.subtotal, false], ["Tax (18% GST)", b.tax, false]];
  return (
    <dl className="grid grid-cols-[1fr_auto] gap-y-1 text-xs" data-testid={testId}>
      {rows.map(([k, v, neg]) => (
        <div key={k} className="contents">
          <dt className="text-muted-foreground">{k}</dt>
          <dd className={cn("num text-right", neg && Number(v) > 0 && "text-profit")}>{neg && Number(v) > 0 ? `− ${fmtInr(v, { decimals: true })}` : fmtInr(v, { decimals: true })}</dd>
        </div>
      ))}
      <dt className="mt-1 border-t border-border pt-1 font-medium">Total</dt>
      <dd className="num mt-1 border-t border-border pt-1 text-right font-medium" data-testid="price-total">{fmtInr(b.total, { decimals: true })}</dd>
    </dl>
  );
}

/** The mock checkout the mock server's "mock" orders open (HC-AC-024, 027..029); never shown for real orders. */
export function MockCheckout({ order, onPaid, onCancel, onFail }: { order: CheckoutOrder; onPaid: (paymentId: string) => void; onCancel: () => void; onFail: (reason: string) => void }) {
  const [method, setMethod] = useState<"upi" | "card" | "netbanking" | "wallet">("upi");
  const [busy, setBusy] = useState<string | null>(null);
  const run = (what: string, then: () => void) => {
    setBusy(what);
    setTimeout(() => {
      setBusy(null);
      then();
    }, 300);
  };
  return (
    <Dialog open onOpenChange={(o) => { if (!o && !busy) onCancel(); }}>
      <DialogContent className="sm:max-w-[400px]" data-testid="mock-checkout">
        <DialogHeader>
          <DialogTitle>Mock checkout · no money moves</DialogTitle>
          <DialogDescription>{order.description} · {fmtInr((order.amountPaise / 100).toFixed(2), { decimals: true })}</DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-3 text-xs">
          <div className="flex gap-1 border-b border-border" role="tablist">
            {(["upi", "card", "netbanking", "wallet"] as const).map((m) => (
              <button key={m} type="button" role="tab" aria-selected={method === m} onClick={() => setMethod(m)} className={cn("px-2 py-1 capitalize", method === m ? "border-b-2 border-accent text-foreground" : "text-muted-foreground")} data-testid={`mock-method-${m}`}>{m}</button>
            ))}
          </div>
          <p className="micro">Paying as {order.prefill.name} · {order.prefill.email}</p>
          {busy ? <p className="micro" data-testid="mock-busy">{busy}…</p> : null}
          <div className="flex flex-wrap gap-2 text-2xs text-muted-foreground">
            <button type="button" className="underline-offset-2 hover:underline" onClick={() => run("Processing", () => onFail("Payment failed. Please try again."))} data-testid="mock-fail">Simulate failure</button>
            <button type="button" className="underline-offset-2 hover:underline" onClick={() => run("Processing", () => onPaid(`pay_mock_bad_${method}`))} data-testid="mock-confirm-fail">Simulate confirmation failure</button>
          </div>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={busy !== null} data-testid="mock-cancel">Cancel</Button>
          <Button loading={busy !== null} onClick={() => run("Processing", () => onPaid(`pay_mock_${method}_${Date.now().toString(36)}`))} data-testid="mock-pay">Pay {fmtInr((order.amountPaise / 100).toFixed(2), { decimals: true })}</Button>
        </DialogFooter>
        <p className="micro px-5 pb-3">SECURED BY RAZORPAY · MOCK</p>
      </DialogContent>
    </Dialog>
  );
}

export function CheckoutDialog({ plan, interval, open, onOpenChange, onActivated }: { plan: Plan | null; interval: BillingInterval; open: boolean; onOpenChange: (o: boolean) => void; onActivated: () => void }) {
  const [code, setCode] = useState("");
  const [applied, setApplied] = useState<AvailableCoupon | null>(null);
  const [breakdown, setBreakdown] = useState<PriceBreakdown | null>(null);
  const [couponError, setCouponError] = useState<string | null>(null);
  const [mockOrder, setMockOrder] = useState<CheckoutOrder | null>(null);
  const [busy, setBusy] = useState(false);
  const available = useAvailableCoupons(open && plan ? plan.id : null, interval);
  const quote = useCouponQuote();
  const start = useStartCheckout();
  const confirm = useConfirmCheckout();
  const cancel = useCancelCheckout();
  const activate = useActivatePlan();
  useEffect(() => {
    // a new plan or interval resets the coupon
    setApplied(null);
    setCode("");
    setCouponError(null);
    setBreakdown(null);
  }, [plan?.id, interval, open]);
  if (!plan) return null;
  const base = breakdownFor(plan.intervals[interval]);
  const b = breakdown ?? base;
  const total = Number(b.total);
  const label = `${plan.name} · ${INTERVAL_LABELS[interval]}`;

  const apply = (raw: string) => {
    const c = raw.trim().toUpperCase();
    if (!c) return;
    quote.mutate(
      { code: c, planId: plan.id, interval },
      {
        onSuccess: (q) => {
          if (q.coupon.reason) {
            const why = COUPON_REASON_TEXT[q.coupon.reason];
            setCouponError(why);
            toast.error("Invalid coupon", { description: why });
            return;
          }
          setApplied(q.coupon);
          setBreakdown(q.breakdown);
          setCouponError(null);
          setCode("");
          toast.success("Coupon applied", { description: `${q.coupon.code} · − ${fmtInr(q.breakdown.couponDiscount, { decimals: true })}` });
        },
        onError: (e) => { setCouponError(e.message); toast.error("Invalid coupon", { description: e.message }); },
      },
    );
  };
  const remove = () => { setApplied(null); setBreakdown(null); setCouponError(null); };
  const finish = (what: string) => {
    onOpenChange(false);
    onActivated();
    toast.success("Subscription activated!", { description: what });
  };
  const confirmPayment = (order: CheckoutOrder, r: { razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature: string }) => {
    setBusy(true);
    confirm.mutate(r, {
      onSuccess: (res) => { setBusy(false); setMockOrder(null); finish(`${label} · ${fmtInr(res.payment.amountInr, { decimals: true })}${res.payment.invoiceNo ? ` · ${res.payment.invoiceNo}` : ""}`); },
      onError: (e) => { setBusy(false); setMockOrder(null); toast.error("Confirmation failed", { description: `${e.message} · Please contact support.` }); void cancel.mutateAsync({ orderId: order.orderId, reason: "Confirmation failed" }).catch(() => undefined); },
    });
  };
  const pay = () => {
    setBusy(true);
    start.mutate(
      { planId: plan.id, interval, ...(applied ? { couponCode: applied.code } : {}) },
      {
        onSuccess: (order) => {
          if (order.mode === "mock") { setBusy(false); setMockOrder(order); return; }
          openRazorpay(order)
            .then((r) => confirmPayment(order, r))
            .catch((e: unknown) => {
              setBusy(false);
              const msg = e instanceof Error ? e.message : "Something went wrong";
              if (msg === "dismissed") { toast("Payment cancelled", { description: "You can try again anytime." }); void cancel.mutateAsync({ orderId: order.orderId }).catch(() => undefined); return; }
              if (/Razorpay SDK/.test(msg)) { toast.error("Error", { description: "Failed to load Razorpay SDK" }); void cancel.mutateAsync({ orderId: order.orderId, reason: "SDK failed to load" }).catch(() => undefined); return; }
              toast.error("Payment failed", { description: `${msg} Please try again.` });
              void cancel.mutateAsync({ orderId: order.orderId, reason: msg }).catch(() => undefined);
            });
        },
        onError: (e) => { setBusy(false); toast.error("Error", { description: e.message || "Something went wrong" }); },
      },
    );
  };
  const activateFree = () => activate.mutate({ planId: plan.id, interval, ...(applied ? { couponCode: applied.code } : {}) }, { onSuccess: () => finish(label), onError: (e) => toast.error("Activation failed", { description: e.message }) });

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!busy) onOpenChange(o); }}>
      <DialogContent className="sm:max-w-[640px]" data-testid="subscribe-dialog">
        <DialogHeader>
          <DialogTitle>Subscribe to {label}</DialogTitle>
          <DialogDescription>{total === 0 ? "No payment needed for this order." : "Pay securely with Razorpay: UPI, cards, netbanking or wallets."}</DialogDescription>
        </DialogHeader>
        <DialogBody>
          <div className="grid gap-4 sm:grid-cols-2">
            <section data-testid="coupon-column">
              <div className="micro mb-1">Coupon</div>
              {applied ? (
                <div className="flex items-center gap-2 rounded border border-profit/60 px-2 py-1 text-xs text-profit" data-testid="coupon-chip">
                  <span className="font-mono">{applied.code}</span>
                  <span className="num">(− {fmtInr(b.couponDiscount, { decimals: true })})</span>
                  <button type="button" className="ml-auto text-muted-foreground hover:text-foreground" onClick={remove} aria-label="Remove coupon" data-testid="coupon-remove">✕</button>
                </div>
              ) : (
                <div className="flex gap-2">
                  <input value={code} onChange={(e) => { setCode(e.target.value.toUpperCase()); setCouponError(null); }} onKeyDown={(e) => { if (e.key === "Enter") apply(code); }} placeholder="Enter coupon code" className="num h-8 min-w-0 flex-1 rounded border border-input bg-background px-2 text-xs uppercase" aria-label="Coupon code" data-testid="coupon-input" />
                  <Button size="sm" variant="outline" loading={quote.isPending} disabled={!code.trim()} onClick={() => apply(code)} data-testid="coupon-apply">Apply</Button>
                </div>
              )}
              {couponError ? <p className="mt-1 text-xs text-loss" role="alert" data-testid="coupon-error">{couponError}</p> : null}
              <div className="micro mt-3 mb-1">Available coupons</div>
              {available.isLoading ? <div className="h-10 animate-pulse rounded bg-muted" /> : (available.data?.items.length ?? 0) === 0 ? <p className="micro" data-testid="coupon-none">No coupons right now</p> : (
                <ul className="space-y-1" data-testid="coupon-list">
                  {available.data?.items.map((c) => {
                    const isApplied = applied?.code === c.code;
                    return (
                      <li key={c.code}>
                        <button type="button" disabled={c.reason !== null || busy} onClick={() => apply(c.code)} className={cn("w-full rounded border px-2 py-1 text-left text-xs", isApplied ? "border-profit/60" : "border-border hover:border-foreground/40", c.reason !== null && "opacity-50")} data-testid="coupon-option" data-code={c.code} data-applicable={c.reason === null}>
                          <div className="flex items-center gap-2"><span className="font-mono">{c.code}</span><span className="rounded border border-border px-1 font-mono text-3xs">{tag(c)}</span>{c.scope === "community" ? <span className="micro">members</span> : null}{isApplied ? <span className="micro ml-auto text-profit">applied</span> : null}</div>
                          <div className="micro truncate">{c.description}{c.endsAt ? ` · until ${fmtDate(c.endsAt)}` : ""}{Number(c.minOrderInr) > 0 ? ` · min ${fmtInr(c.minOrderInr)}` : ""}</div>
                          {c.reason ? <div className="micro text-loss">{COUPON_REASON_TEXT[c.reason]}</div> : null}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
            <section>
              <div className="micro mb-1">Price breakdown</div>
              <Breakdown b={b} />
            </section>
          </div>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
          {total === 0 ? (
            <Button loading={activate.isPending} onClick={activateFree} data-testid="subscribe-activate">Activate</Button>
          ) : (
            <Button loading={busy || start.isPending} onClick={pay} data-testid="subscribe-pay">Pay with Razorpay</Button>
          )}
        </DialogFooter>
      </DialogContent>
      {mockOrder ? (
        <MockCheckout
          order={mockOrder}
          onPaid={(paymentId) => confirmPayment(mockOrder, { razorpay_order_id: mockOrder.orderId, razorpay_payment_id: paymentId, razorpay_signature: paymentId.includes("bad") ? "bad-sig" : "mock-sig" })}
          onCancel={() => { setMockOrder(null); toast("Payment cancelled", { description: "You can try again anytime." }); void cancel.mutateAsync({ orderId: mockOrder.orderId }).catch(() => undefined); }}
          onFail={(reason) => { setMockOrder(null); toast.error("Payment failed", { description: `${reason}` }); void cancel.mutateAsync({ orderId: mockOrder.orderId, reason }).catch(() => undefined); }}
        />
      ) : null}
    </Dialog>
  );
}
