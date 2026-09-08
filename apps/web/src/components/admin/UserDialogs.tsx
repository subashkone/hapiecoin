"use client";
// Admin · User Management dialogs (ADR-032): Set plan (comped at ₹0, one user or many; HC-AD-100, 104) and
// Invite user (HC-AD-108). Both say plainly what happens to money: nothing is charged.
import { BILLING_INTERVALS, type BillingInterval } from "@hapiecoin/schema";
import { Button, Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, toast } from "@hapiecoin/ui";
import { useState } from "react";
import { useBulkPlan, useInviteUser, useSetPlan } from "@/lib/api/admin";
import { useAdminPlans } from "@/lib/api/billing";
import { INTERVAL_LABELS, fmtInr } from "@/lib/billing/format";

const selectClass = "h-8 w-full rounded border border-input bg-background px-2 text-xs";
const inputClass = "h-8 w-full rounded border border-input bg-background px-2 text-xs";

export function SetPlanDialog({ ids, who, onOpenChange }: { ids: string[]; who: string; onOpenChange: (o: boolean) => void }) {
  const plans = useAdminPlans();
  const active = (plans.data ?? []).filter((p) => p.active);
  const [planId, setPlanId] = useState("");
  const [interval, setInterval] = useState<BillingInterval>("yearly");
  const [error, setError] = useState<string | null>(null);
  const one = useSetPlan();
  const many = useBulkPlan();
  const plan = active.find((p) => p.id === planId);
  const busy = one.isPending || many.isPending;
  const submit = () => {
    if (!plan) return setError("Pick a plan");
    setError(null);
    const done = (label: string) => {
      toast.success("Plan set", { description: label });
      onOpenChange(false);
    };
    const fail = (e: Error) => setError(e.message);
    if (ids.length === 1) one.mutate({ id: ids[0]!, body: { planId: plan.id, interval } }, { onSuccess: (r) => done(`${r.name} · ${plan.name} ${INTERVAL_LABELS[interval].toLowerCase()} · ₹0`), onError: fail });
    else many.mutate({ ids, planId: plan.id, interval }, { onSuccess: (r) => done(`${r.updated} ${r.updated === 1 ? "user" : "users"} · ${r.planName} ${INTERVAL_LABELS[interval].toLowerCase()} · ₹0`), onError: fail });
  };
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[420px]" data-testid="set-plan-dialog">
        <DialogHeader>
          <DialogTitle>Set plan · {who}</DialogTitle>
          <DialogDescription>Comped by admin · ₹0 · the user pays nothing. The current subscription is cancelled and the new one starts now.</DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-3 text-xs">
          <label className="block">
            <span className="micro">Plan</span>
            <select value={planId} onChange={(e) => setPlanId(e.target.value)} className={selectClass} aria-label="Plan" data-testid="set-plan-plan">
              <option value="">Choose a plan…</option>
              {active.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="micro">Interval</span>
            <select value={interval} onChange={(e) => setInterval(e.target.value as BillingInterval)} className={selectClass} aria-label="Interval" data-testid="set-plan-interval">
              {BILLING_INTERVALS.map((i) => <option key={i} value={i}>{INTERVAL_LABELS[i]}</option>)}
            </select>
          </label>
          {plan ? <p className="micro" data-testid="set-plan-summary">List price {fmtInr(plan.intervals[interval].priceInr)} · charged ₹0 · {Number(plan.intervals[interval].priceInr) === 0 ? "never expires" : `expires after ${INTERVAL_LABELS[interval].toLowerCase() === "monthly" ? "30" : interval === "quarterly" ? "90" : "360"} days`}</p> : null}
          {error ? <p className="text-loss" role="alert" data-testid="set-plan-error">{error}</p> : null}
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button loading={busy} onClick={submit} data-testid="set-plan-save">Set plan</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function InviteUserDialog({ onOpenChange, onInvited }: { onOpenChange: (o: boolean) => void; onInvited?: (id: string) => void }) {
  const plans = useAdminPlans();
  const active = (plans.data ?? []).filter((p) => p.active);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [mobile, setMobile] = useState("");
  const [planId, setPlanId] = useState("");
  const [interval, setInterval] = useState<BillingInterval>("yearly");
  const [error, setError] = useState<string | null>(null);
  const invite = useInviteUser();
  const submit = () => {
    if (!name.trim()) return setError("Name is required");
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) return setError("A valid email is required");
    if (mobile && !/^[0-9]{10}$/.test(mobile)) return setError("Mobile must be 10 digits");
    setError(null);
    invite.mutate(
      { name: name.trim(), email: email.trim().toLowerCase(), ...(mobile ? { mobile } : {}), ...(planId ? { planId, interval } : {}) },
      {
        onSuccess: (row) => {
          toast.success("Invitation sent", { description: `${row.email}${row.planName ? ` · ${row.planName}` : ""}` });
          onInvited?.(row.id);
          onOpenChange(false);
        },
        onError: (e) => setError(e.message),
      },
    );
  };
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[440px]" data-testid="invite-dialog">
        <DialogHeader>
          <DialogTitle>Invite user</DialogTitle>
          <DialogDescription>Creates the account and emails a sign-in link. They sign in with a one-time code; no password is set by you.</DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-3 text-xs">
          <label className="block"><span className="micro">Name *</span><input value={name} onChange={(e) => setName(e.target.value)} className={inputClass} placeholder="Priya Sharma" data-testid="invite-name" /></label>
          <label className="block"><span className="micro">Email *</span><input value={email} onChange={(e) => setEmail(e.target.value)} className={`num ${inputClass}`} placeholder="priya@example.com" type="email" data-testid="invite-email" /></label>
          <label className="block"><span className="micro">Mobile (optional, 10 digits)</span><input value={mobile} onChange={(e) => setMobile(e.target.value)} className={`num ${inputClass}`} placeholder="9000000000" inputMode="numeric" data-testid="invite-mobile" /></label>
          <div className="grid grid-cols-2 gap-2">
            <label className="block"><span className="micro">Plan (optional, comped ₹0)</span>
              <select value={planId} onChange={(e) => setPlanId(e.target.value)} className={selectClass} aria-label="Plan" data-testid="invite-plan">
                <option value="">No plan (Free)</option>
                {active.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </label>
            <label className="block"><span className="micro">Interval</span>
              <select value={interval} onChange={(e) => setInterval(e.target.value as BillingInterval)} className={selectClass} aria-label="Interval" disabled={!planId} data-testid="invite-interval">
                {BILLING_INTERVALS.map((i) => <option key={i} value={i}>{INTERVAL_LABELS[i]}</option>)}
              </select>
            </label>
          </div>
          {error ? <p className="text-loss" role="alert" data-testid="invite-error">{error}</p> : null}
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button loading={invite.isPending} onClick={submit} data-testid="invite-send">Send invitation</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
