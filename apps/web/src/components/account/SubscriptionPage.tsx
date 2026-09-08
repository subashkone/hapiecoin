"use client";
// My Subscription (HC-AC-001..015, 056..059, 064..066; ADR-030; docs/design/billing.md): what plan you are on, when
// it ends, what you can still do this month, and the plan comparison with a pinned "what changes if I upgrade"
// panel. ₹0 plans activate here; paid plans open the breakdown and wait for Razorpay (item 2).
import { type BillingInterval, LIMIT_KEYS, LIMIT_LABELS, type Plan, type SubscriptionView, priceBreakdown } from "@hapiecoin/schema";
import { Button, Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, EmptyState, cn, toast } from "@hapiecoin/ui";
import { useEffect, useMemo, useState } from "react";
import { useActivatePlan, useSubscription } from "@/lib/api/billing";
import { BILLING_INTERVALS, INTERVAL_LABELS, effectivePrice, fmtInr, limitText, nextPlan, perMonth } from "@/lib/billing/format";
import { fmtDate } from "@/lib/format";

function StatusBadge({ state, daysLeft }: { state: SubscriptionView["plan"]["state"]; daysLeft: number | undefined }) {
  const tone = state === "active" ? "border-profit text-profit" : state === "expiring_soon" ? "border-warning text-warning" : state === "expired" ? "border-loss text-loss" : "border-border text-muted-foreground";
  const label = state === "active" ? "ACTIVE" : state === "expiring_soon" ? "EXPIRING SOON" : state === "expired" ? "EXPIRED" : "FREE";
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={cn("rounded border px-1.5 py-0.5 font-mono text-3xs font-bold tracking-wide", tone)} data-testid="sub-status" data-state={state}>
        {label}
      </span>
      {daysLeft !== undefined && state !== "expired" ? <span className="micro rounded border border-border px-1.5 py-0.5" data-testid="sub-days-left">{daysLeft}d left</span> : null}
    </span>
  );
}

function Stat({ label, value, sub, testId }: { label: string; value: string; sub?: string | undefined; testId?: string | undefined }) {
  return (
    <div className="min-w-0" data-testid={testId}>
      <div className="micro">{label}</div>
      <div className="num truncate text-[15px] font-medium">{value}</div>
      {sub ? <div className="micro">{sub}</div> : null}
    </div>
  );
}

export function LimitsList({ view }: { view: SubscriptionView }) {
  return (
    <div className="rounded border border-border p-3" data-testid="sub-limits">
      <div className="micro mb-2">Feature limits · this month</div>
      <ul className="space-y-2">
        {view.entitlements.map((e) => {
          const pct = e.included && e.limit !== null && e.limit > 0 ? Math.min(100, Math.round((e.used / e.limit) * 100)) : 0;
          return (
            <li key={e.key} className="text-xs" data-testid="limit-row" data-key={e.key} data-included={e.included}>
              <div className="flex items-center gap-2">
                <span className="font-mono text-2xs text-muted-foreground">{e.key}</span>
                <span className="text-muted-foreground">{LIMIT_LABELS[e.key]}</span>
                <span className="num ml-auto">{limitText(e.limit, e.included)}</span>
                {e.overridden ? <span className="micro rounded border border-accent/60 px-1 text-accent" title="Set for your account by an admin">override</span> : null}
              </div>
              {e.included ? (
                <>
                  <div className="mt-1 h-1 w-full rounded bg-muted">
                    <div className={cn("h-1 rounded", pct >= 100 ? "bg-loss" : pct >= 80 ? "bg-warning" : "bg-profit")} style={{ width: `${e.limit === null ? 4 : pct}%` }} />
                  </div>
                  <div className="micro">{e.limit === null ? `${e.used} used` : `${e.used} of ${e.limit} used · ${pct}%`}</div>
                </>
              ) : (
                <div className="micro text-warning">Not included · Upgrade to unlock</div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function PlanCard({ plan, interval, current, pinned, onPin, onChoose }: { plan: Plan; interval: BillingInterval; current: boolean; pinned: boolean; onPin: () => void; onChoose: () => void }) {
  const p = plan.intervals[interval];
  const { pay, list, offPct } = effectivePrice(p);
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onPin}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onPin();
        }
      }}
      className={cn("flex w-[240px] shrink-0 flex-col rounded border p-3 text-left outline-none focus-visible:ring-1 focus-visible:ring-ring", current ? "border-t-2 border-t-accent bg-accent/5" : pinned ? "border-foreground/40" : "border-border hover:border-foreground/30")}
      data-testid="plan-card"
      data-plan={plan.name}
      data-current={current}
      data-pinned={pinned}
    >
      <div className="micro flex items-center gap-2">
        {current ? <span className="rounded border border-accent/60 px-1 text-accent">Current plan</span> : null}
        {offPct ? <span className="rounded border border-profit/60 px-1 text-profit">-{offPct}%</span> : null}
      </div>
      <div className="mt-1 text-[15px] font-medium">{plan.name}</div>
      <div className="text-2xs text-muted-foreground">{plan.description}</div>
      <div className="num mt-2 text-xl font-medium" data-testid="plan-price">
        {fmtInr(pay)}
        {offPct ? <span className="num ml-2 text-xs text-muted-foreground line-through">{fmtInr(list)}</span> : null}
      </div>
      <div className="micro">{pay === 0 ? "free forever" : `${INTERVAL_LABELS[interval].toLowerCase()} · ${perMonth(p, interval)}`}</div>
      <div className="mt-2 flex flex-wrap gap-1">
        {LIMIT_KEYS.map((k) => {
          const l = p.limits[k];
          return (
            <span key={k} className={cn("micro rounded border px-1", l === undefined ? "border-border/50 text-muted-foreground line-through" : "border-border")} title={LIMIT_LABELS[k]}>
              {k.replace("_", " ")} {l === undefined ? "" : l === 0 ? "∞" : l}
            </span>
          );
        })}
      </div>
      <ul className="mt-2 flex-1 space-y-0.5 text-2xs">
        {plan.features.map((f) => (
          <li key={f}>· {f}</li>
        ))}
      </ul>
      <Button
        size="sm"
        variant={current ? "outline" : "primary"}
        className="mt-3"
        onClick={(e) => {
          e.stopPropagation();
          onChoose();
        }}
        data-testid="plan-action"
      >
        {current ? "Manage" : pay === 0 ? "Activate" : "Subscribe"}
      </Button>
    </div>
  );
}

export function DiffPanel({ from, to, interval }: { from: Plan | null; to: Plan; interval: BillingInterval }) {
  const rows = LIMIT_KEYS.map((k) => ({ key: k, a: from?.intervals[interval].limits[k], b: to.intervals[interval].limits[k] })).filter((r) => r.a !== r.b);
  const priceFrom = from ? effectivePrice(from.intervals[interval]).pay : 0;
  const priceTo = effectivePrice(to.intervals[interval]).pay;
  const text = (v: number | undefined) => (v === undefined ? "not included" : v === 0 ? "unlimited" : `${v} / month`);
  return (
    <div className="rounded border border-border p-3 text-xs" data-testid="plan-diff">
      <div className="micro mb-1">What changes if you {from && priceTo < priceFrom ? "switch" : "upgrade"} to {to.name}</div>
      {rows.length === 0 ? (
        <div className="text-muted-foreground" data-testid="plan-diff-empty">Same limits as your current plan at this interval.</div>
      ) : (
        <ul className="space-y-0.5">
          {rows.map((r) => (
            <li key={r.key} className="flex gap-2" data-testid="plan-diff-row">
              <span className="w-[160px] text-muted-foreground">{LIMIT_LABELS[r.key]}</span>
              <span className="num">{text(r.a)}</span>
              <span className="text-muted-foreground">→</span>
              <span className="num font-medium">{text(r.b)}</span>
            </li>
          ))}
        </ul>
      )}
      <div className="num mt-2" data-testid="plan-diff-price">
        {fmtInr(priceFrom)} → {fmtInr(priceTo)} {INTERVAL_LABELS[interval].toLowerCase()}
      </div>
    </div>
  );
}

export function LimitsMatrix({ plans, interval, currentId }: { plans: Plan[]; interval: BillingInterval; currentId: string | null }) {
  return (
    <div className="overflow-x-auto rounded border border-border" data-testid="plan-matrix">
      <table className="w-full text-xs">
        <thead>
          <tr className="micro text-left">
            <th className="sticky left-0 bg-background py-1 pl-3 pr-2">Limit</th>
            {plans.map((p) => (
              <th key={p.id} className={cn("py-1 pr-3 text-right", p.id === currentId && "border-t-2 border-t-accent bg-accent/5")}>
                <div>{p.name}</div>
                <div className="num font-normal text-muted-foreground">{fmtInr(effectivePrice(p.intervals[interval]).pay)}</div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {LIMIT_KEYS.map((k) => (
            <tr key={k} className="border-t border-border">
              <td className="sticky left-0 bg-background py-1 pl-3 pr-2 text-muted-foreground">{LIMIT_LABELS[k]}</td>
              {plans.map((p) => {
                const l = p.intervals[interval].limits[k];
                return (
                  <td key={p.id} className={cn("num py-1 pr-3 text-right", p.id === currentId && "bg-accent/5", l === undefined && "text-muted-foreground")}>
                    {l === undefined ? "✕" : l === 0 ? "∞" : l}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SubscribeDialog({ plan, interval, open, onOpenChange, onActivated }: { plan: Plan | null; interval: BillingInterval; open: boolean; onOpenChange: (o: boolean) => void; onActivated: () => void }) {
  const activate = useActivatePlan();
  if (!plan) return null;
  const b = priceBreakdown(plan.intervals[interval]);
  const rows: [string, number][] = [["List price", b.list], ["Plan discount", -b.planDiscount], ["Coupon discount", -b.couponDiscount], ["Subtotal", b.subtotal], ["Tax (18% GST)", b.tax]];
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[440px]" data-testid="subscribe-dialog">
        <DialogHeader>
          <DialogTitle>
            Subscribe to {plan.name} · {INTERVAL_LABELS[interval]}
          </DialogTitle>
          <DialogDescription>{b.total === 0 ? "No payment needed for this plan." : "Coupons and Razorpay checkout arrive with the next release."}</DialogDescription>
        </DialogHeader>
        <DialogBody>
          <dl className="grid grid-cols-[1fr_auto] gap-y-1 text-xs" data-testid="price-breakdown">
            {rows.map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="text-muted-foreground">{k}</dt>
                <dd className="num text-right">{v < 0 ? `− ${fmtInr(-v, { decimals: true })}` : fmtInr(v, { decimals: true })}</dd>
              </div>
            ))}
            <dt className="mt-1 border-t border-border pt-1 font-medium">Total</dt>
            <dd className="num mt-1 border-t border-border pt-1 text-right font-medium" data-testid="price-total">{fmtInr(b.total, { decimals: true })}</dd>
          </dl>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          {b.total === 0 ? (
            <Button loading={activate.isPending} onClick={() => activate.mutate({ planId: plan.id, interval }, { onSuccess: () => { onOpenChange(false); onActivated(); toast.success("Plan activated", { description: `${plan.name} · ${INTERVAL_LABELS[interval]}` }); }, onError: (e) => toast.error("Could not activate", { description: e.message }) })} data-testid="subscribe-activate">
              Activate
            </Button>
          ) : (
            <Button disabled title="Razorpay checkout arrives with the next release" data-testid="subscribe-pay">
              Pay with Razorpay
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function SubscriptionPage() {
  const { data: view, isLoading, isError, error, refetch } = useSubscription();
  const [interval, setInterval] = useState<BillingInterval>("monthly");
  const [pinnedId, setPinnedId] = useState<string | null>(null);
  const [choose, setChoose] = useState<Plan | null>(null);
  const currentId = view?.current?.planId ?? view?.effectivePlan?.id ?? null;
  const upgrade = useMemo(() => (view ? nextPlan(view.plans, currentId) : undefined), [view, currentId]);
  useEffect(() => {
    if (view?.current?.interval) setInterval(view.current.interval);
  }, [view?.current?.interval]);
  const pinned = view?.plans.find((p) => p.id === pinnedId) ?? upgrade ?? null;

  if (isLoading) {
    return (
      <main className="mx-auto max-w-[1100px] px-6 py-8" data-testid="subscription-page" data-state="loading">
        <div className="h-6 w-48 animate-pulse rounded bg-muted" />
        <div className="mt-4 h-28 animate-pulse rounded bg-muted" />
      </main>
    );
  }
  if (isError || !view) {
    return (
      <main className="mx-auto max-w-[1100px] px-6 py-8" data-testid="subscription-page" data-state="error">
        <EmptyState title="Could not load your subscription" description={error?.message ?? "request failed"} action={<Button size="sm" onClick={() => void refetch()}>Retry</Button>} />
      </main>
    );
  }
  const cur = view.current;
  const plan = view.effectivePlan;
  const pricing = cur?.interval && plan ? plan.intervals[cur.interval] : null;
  const price = pricing ? effectivePrice(pricing) : null;
  return (
    <main className="mx-auto max-w-[1100px] px-6 py-8" data-testid="subscription-page" data-state="ready">
      <p className="micro">My Subscription</p>
      <h1 className="mt-1">Choose a plan to unlock features</h1>
      {!view.accountActive ? <div className="mt-3 rounded border border-loss/40 p-2 text-xs text-loss" data-testid="sub-deactivated">Your account has been deactivated. Trading and plan changes are paused; contact support.</div> : null}

      <div className="mt-6 grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <section className="rounded border border-border p-4" data-testid="sub-current">
          {cur ? (
            <>
              <div className="flex flex-wrap items-center gap-3">
                <span className="text-lg font-medium" data-testid="sub-plan-name">{cur.planName}</span>
                <StatusBadge state={view.plan.state} daysLeft={view.plan.daysLeft} />
                <span className="flex-1" />
                {cur.interval ? <Button size="sm" variant="outline" onClick={() => plan && setChoose(plan)} data-testid="sub-renew">Renew</Button> : null}
                {upgrade ? <Button size="sm" onClick={() => setChoose(upgrade)} data-testid="sub-upgrade">Upgrade</Button> : null}
              </div>
              <div className="mt-4 grid grid-cols-2 gap-3 border-t border-border pt-3 sm:grid-cols-5" data-testid="sub-summary">
                <Stat label="Billing" value={cur.interval ? INTERVAL_LABELS[cur.interval] : "—"} />
                <Stat label="Price" value={price ? fmtInr(price.list) : "—"} sub={price && price.offPct ? `-${price.offPct}% plan discount` : undefined} />
                <Stat label="You pay" value={cur.paidInr === null ? "—" : fmtInr(cur.paidInr)} sub={cur.paidInr === "0" && price && price.pay > 0 ? "granted" : undefined} />
                <Stat label="Currency" value={cur.currency} />
                <Stat label="Valid until" value={cur.expiresAt ? fmtDate(cur.expiresAt) : "No end date"} sub={view.plan.daysLeft !== undefined ? `${view.plan.daysLeft} days left` : undefined} testId="sub-valid-until" />
              </div>
            </>
          ) : (
            <EmptyState title="No Active Subscription" description={plan ? `You are on the ${plan.name} plan. Pick a plan below to unlock more.` : "No plans are configured yet."} className="py-6" data-testid="sub-none" action={upgrade ? <Button size="sm" onClick={() => setChoose(upgrade)} data-testid="sub-upgrade">See plans</Button> : undefined} />
          )}
          {plan ? (
            <div className="mt-4 border-t border-border pt-3 text-xs" data-testid="sub-features">
              <div className="micro mb-1">Plan features · {plan.name}</div>
              <ul className="grid gap-x-4 gap-y-0.5 sm:grid-cols-2">
                {plan.features.map((f) => (
                  <li key={f}>✓ {f}</li>
                ))}
                {view.menuItems.map((m) => (
                  <li key={m}>✓ {m}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </section>
        <LimitsList view={view} />
      </div>

      <section className="mt-8" data-testid="sub-plans">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-base font-medium">Available plans</h2>
          <div className="ml-auto flex rounded border border-border p-0.5" role="tablist" aria-label="Billing interval">
            {BILLING_INTERVALS.map((i) => (
              <button key={i} type="button" role="tab" aria-selected={interval === i} onClick={() => setInterval(i)} className={cn("rounded px-2 py-0.5 text-xs", interval === i ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground")} data-testid={`interval-${i}`}>
                {INTERVAL_LABELS[i]}
              </button>
            ))}
          </div>
        </div>
        <div className="mt-3 flex gap-3 overflow-x-auto pb-1" data-testid="plan-grid">
          {view.plans.map((p) => (
            <PlanCard key={p.id} plan={p} interval={interval} current={p.id === currentId} pinned={pinned?.id === p.id && p.id !== currentId} onPin={() => setPinnedId(p.id)} onChoose={() => setChoose(p)} />
          ))}
        </div>
        {pinned && pinned.id !== currentId ? <div className="mt-3"><DiffPanel from={plan} to={pinned} interval={interval} /></div> : null}
        <div className="mt-4">
          <LimitsMatrix plans={view.plans} interval={interval} currentId={currentId} />
        </div>
      </section>

      <SubscribeDialog plan={choose} interval={interval} open={choose !== null} onOpenChange={(o) => !o && setChoose(null)} onActivated={() => setPinnedId(null)} />
    </main>
  );
}
