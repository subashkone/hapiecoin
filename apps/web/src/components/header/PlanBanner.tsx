"use client";
// Plan banner under the analyse header (HC-SH-014). States from GET /v1/plan: free / active / expiring /
// expired. Copy from the v2 mock banner chrome. Active banners can be dismissed for the session.
import { Button, CircleAlert, CircleCheck, Crown, X, cn } from "@hapiecoin/ui";
import Link from "next/link";
import { useState } from "react";
import { usePlan } from "@/lib/api/queries";
import type { PlanState } from "@/lib/api/schemas";
import { fmtDate } from "@/lib/format";

export interface BannerView {
  kind: "free" | "active" | "expiring" | "expired";
  text: string;
  button?: string;
  dismissible: boolean;
}

export function bannerFor(plan: PlanState): BannerView {
  switch (plan.state) {
    case "expired":
      return { kind: "expired", text: "Your plan has expired.", button: "Renew Plan", dismissible: false };
    case "expiring_soon": {
      const d = plan.daysLeft ?? 0;
      return {
        kind: "expiring",
        text: `Your plan expires soon — ${d} day${d === 1 ? "" : "s"} left.`,
        button: "Renew Plan",
        dismissible: false,
      };
    }
    case "active":
      return {
        kind: "active",
        text: plan.expiresAt
          ? `Congratulations! Your plan is active until ${fmtDate(plan.expiresAt)}`
          : "Congratulations! Your plan is active.",
        dismissible: true,
      };
    case "free":
    default:
      return { kind: "free", text: "Your free plan is active.", button: "Upgrade", dismissible: true };
  }
}

export function PlanBannerView({ plan, onDismiss }: { plan: PlanState; onDismiss?: () => void }) {
  const v = bannerFor(plan);
  const label = (plan.planName ?? (v.kind === "free" ? "Free plan" : "Plan")).toUpperCase();
  const Icon = v.kind === "active" ? CircleCheck : v.kind === "free" ? Crown : CircleAlert;
  return (
    <div
      role="status"
      data-testid="plan-banner"
      data-kind={v.kind}
      className={cn(
        "flex h-9 items-center gap-3 border-b border-border px-4 text-[12.5px]",
        v.kind === "expired" ? "bg-sell-bg text-loss" : v.kind === "expiring" ? "bg-warning-bg text-warning" : "bg-surface-1",
      )}
    >
      <Icon className="size-3.5 shrink-0" aria-hidden="true" />
      <span className="micro">{label}</span>
      <span>{v.text}</span>
      {v.button ? (
        <Button asChild size="xs" variant={v.kind === "free" ? "outline" : "primary"} className="ml-2">
          <Link href="/subscription">{v.button}</Link>
        </Button>
      ) : null}
      {v.dismissible && onDismiss ? (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          className="ml-auto grid size-6 place-items-center rounded-sm text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <X className="size-3.5" aria-hidden="true" />
        </button>
      ) : null}
    </div>
  );
}

export function PlanBanner() {
  const { data } = usePlan();
  const [dismissed, setDismissed] = useState(false);
  if (!data || dismissed) return null;
  return <PlanBannerView plan={data} onDismiss={() => setDismissed(true)} />;
}
