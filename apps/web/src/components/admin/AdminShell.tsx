"use client";
// Admin shell (HC-AD-001..003; docs/design/billing.md): admin-only guard, sticky left rail with live counts on wide
// screens and a horizontal tab bar below 1024 px, the acting admin's email in the footer.
import { Button, EmptyState, cn } from "@hapiecoin/ui";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { useAdminMenuItems, useAdminPlans, useAdminUsers } from "@/lib/api/billing";
import { useMe } from "@/lib/api/queries";

export const ADMIN_NAV = [
  { href: "/admin/users", label: "Users", count: "users" as const },
  { href: "/admin/plans", label: "Subscription Plans", count: "plans" as const },
  { href: "/admin/pricing", label: "Menu Pricing", count: "menu" as const },
  { href: "/admin/coupons", label: "Coupon Codes", count: null },
  { href: "/admin/subscriptions", label: "User Subscriptions", count: "users" as const },
  { href: "/admin/banners", label: "Banners", count: null },
  { href: "/admin/emails", label: "Promotional Emails", count: null },
];

function Rail({ email }: { email: string }) {
  const path = usePathname();
  const plans = useAdminPlans();
  const menu = useAdminMenuItems();
  const users = useAdminUsers("", "all", 1);
  const counts = { plans: plans.data?.length, menu: menu.data?.length, users: users.data?.total };
  return (
    <nav className="flex gap-1 overflow-x-auto border-b border-border px-2 py-1 lg:sticky lg:top-0 lg:h-[calc(100vh-var(--header-h,56px))] lg:w-[220px] lg:shrink-0 lg:flex-col lg:overflow-visible lg:border-b-0 lg:border-r lg:px-3 lg:py-4" aria-label="Admin" data-testid="admin-rail">
      <span className="micro hidden lg:block lg:pb-2">Admin</span>
      {ADMIN_NAV.map((n) => {
        const active = path === n.href || path.startsWith(`${n.href}/`);
        const count = n.count ? counts[n.count] : undefined;
        return (
          <Link key={n.href} href={n.href} className={cn("flex shrink-0 items-center gap-2 rounded px-2 py-1 text-xs", active ? "bg-muted text-foreground lg:shadow-[inset_2px_0_0_0_hsl(var(--accent))]" : "text-muted-foreground hover:text-foreground")} aria-current={active ? "page" : undefined} data-testid={`admin-nav-${n.href.split("/").pop()}`}>
            {n.label}
            {count !== undefined ? <span className="ml-auto font-mono text-3xs">{count}</span> : null}
          </Link>
        );
      })}
      <span className="micro hidden truncate lg:mt-auto lg:block" title={email} data-testid="admin-email">
        {email}
      </span>
    </nav>
  );
}

export function AdminShell({ children }: { children: ReactNode }) {
  const me = useMe();
  if (me.isLoading) {
    return (
      <main className="mx-auto max-w-[1200px] px-6 py-8" data-testid="admin-shell" data-state="loading">
        <div className="h-6 w-40 animate-pulse rounded bg-muted" />
      </main>
    );
  }
  if (!me.data || me.data.role !== "admin") {
    return (
      <main className="mx-auto max-w-[720px] px-6 py-16" data-testid="admin-shell" data-state="denied">
        <EmptyState title="Admin only" description="This area is for HapieCoin administrators." action={<Button asChild size="sm"><Link href="/analyse">Go to Analyse</Link></Button>} />
      </main>
    );
  }
  return (
    <div className="flex min-h-[calc(100vh-var(--header-h,56px))] flex-col lg:flex-row" data-testid="admin-shell" data-state="ready">
      <Rail email={me.data.email} />
      <main className="min-w-0 flex-1 px-4 py-4 lg:px-6">{children}</main>
    </div>
  );
}

/** Page header shared by the admin pages: title, subtitle and the one primary action. */
export function AdminHeader({ title, subtitle, action }: { title: string; subtitle: string; action?: ReactNode }) {
  return (
    <div className="mb-3 flex flex-wrap items-end gap-2">
      <div>
        <h1 className="text-lg font-medium">{title}</h1>
        <p className="text-xs text-muted-foreground">{subtitle}</p>
      </div>
      <span className="flex-1" />
      {action}
    </div>
  );
}

/** Bulk bar shown only while rows are ticked (HC-AD-111, 114, 117). */
export function BulkBar({ count, onActivate, onDeactivate, onClear, busy }: { count: number; onActivate: () => void; onDeactivate: () => void; onClear: () => void; busy: boolean }) {
  if (count === 0) return null;
  return (
    <div className="mb-2 flex items-center gap-2 rounded border border-border px-2 py-1 text-xs" data-testid="bulk-bar">
      <span className="font-medium">{count} selected</span>
      <Button size="sm" variant="outline" loading={busy} onClick={onActivate} data-testid="bulk-activate">Activate</Button>
      <Button size="sm" variant="outline" loading={busy} onClick={onDeactivate} data-testid="bulk-deactivate">Deactivate</Button>
      <button type="button" className="ml-auto text-muted-foreground hover:text-foreground" onClick={onClear} data-testid="bulk-clear">Clear</button>
    </div>
  );
}
