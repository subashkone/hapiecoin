"use client";
// App header. `analyse` variant (HC-SH-001..008, 011, 013, 014) and `default` variant with text tabs
// (HC-SH-015..021). Settings menu HC-SH-022 / 026; account menu HC-SH-020.
import {
  Bell,
  Button,
  CreditCard,
  DollarSign,
  Gem,
  KeyRound,
  Layers,
  LogOut,
  Mail,
  MessageCircle,
  Moon,
  Percent,
  Plug,
  Rocket,
  Rows2,
  Rows3,
  Settings,
  Sun,
  User as UserIcon,
  Users,
  Zap,
  cn,
  useDensity,
  useTheme,
} from "@hapiecoin/ui";
import type { User } from "@hapiecoin/schema";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { useMe, useSettings } from "@/lib/api/queries";
import { ASSET_META, useUiStore } from "@/lib/store";
import { useMounted } from "@/lib/use-mounted";
import { CommandPalette, PaletteButton } from "@/components/shell/CommandPalette";
import { Logo } from "@/components/shell/Logo";
import { Menu, MenuItem, MenuLabel, MenuSeparator } from "@/components/shell/Menu";
import { ThemeToggle } from "@/components/shell/ThemeToggle";
import { SUPPORT_EMAIL, SUPPORT_WHATSAPP } from "@/content/landing";
import { AssetSwitch, CurrencyToggle, ExchangeChip, FeedStatus, FuturesPrice } from "./widgets";
import { PlanBanner } from "./PlanBanner";

export const AVATAR_ICON = { rocket: Rocket, diamond: Gem, lightning: Zap } as const;

export function Avatar({ avatar, className }: { avatar: User["avatar"]; className?: string }) {
  const Icon = AVATAR_ICON[avatar];
  return <Icon className={cn("size-4", className)} aria-hidden="true" />;
}

const TABS = [
  { href: "/analyse", label: "Analyse", active: (p: string) => p === "/analyse" },
  { href: "/analytics", label: "Market Analytics", active: (p: string) => p.startsWith("/analytics") || p.startsWith("/terminal") },
  { href: "/subscription", label: "Subscription", active: (p: string) => p.startsWith("/subscription") },
  { href: "/referrals", label: "Referrals", active: (p: string) => p.startsWith("/referrals") },
] as const;

function AdminChip() {
  return (
    <a
      href="/admin/users"
      title="Admin console"
      data-testid="admin-chip"
      className="rounded-sm border border-border px-1.5 py-px font-mono text-3xs uppercase tracking-[0.1em] text-muted-foreground hover:text-foreground"
    >
      Admin
    </a>
  );
}

function SettingsMenu({ user }: { user: User }) {
  const [open, setOpen] = useState(false);
  const openDialog = useUiStore((s) => s.openDialog);
  const { data: settings } = useSettings();
  const theme = useTheme();
  const mounted = useMounted();
  const resolvedTheme = mounted ? theme.resolvedTheme : "dark"; // stored theme is browser-only (hydration)
  const { toggleTheme } = theme;
  const densityCtx = useDensity();
  const density = mounted ? densityCtx.density : "comfortable";
  const { toggleDensity } = densityCtx;
  const pick = (kind: Parameters<typeof openDialog>[0]) => {
    setOpen(false);
    openDialog(kind);
  };
  return (
    <div className="relative">
      <Button
        variant="ghost"
        size="sm"
        iconOnly
        title="Settings"
        aria-label="Settings"
        aria-haspopup="menu"
        aria-expanded={open}
        data-tour="settings-menu"
        data-testid="settings-gear"
        onClick={() => setOpen((o) => !o)}
      >
        <Settings className="size-4" aria-hidden="true" />
      </Button>
      <Menu open={open} onClose={() => setOpen(false)} label="Settings" testId="settings-menu">
        <MenuLabel>Account</MenuLabel>
        <MenuItem onSelect={() => pick("profile")} testId="menu-profile">
          <UserIcon /> My Profile
        </MenuItem>
        <MenuItem href="/subscription" onSelect={() => setOpen(false)}>
          <CreditCard /> My Subscription
        </MenuItem>
        <MenuItem href="/referrals" onSelect={() => setOpen(false)}>
          <Users /> My Referrals
        </MenuItem>
        {user.role === "admin" ? (
          <>
            <MenuSeparator />
            <MenuLabel>Admin</MenuLabel>
            <MenuItem href="/admin/users" onSelect={() => setOpen(false)} testId="menu-admin-users"><Users /> User Management</MenuItem>
            <MenuItem href="/admin/plans" onSelect={() => setOpen(false)}><CreditCard /> Subscription Plans</MenuItem>
            <MenuItem href="/admin/pricing" onSelect={() => setOpen(false)}><DollarSign /> Menu Pricing</MenuItem>
            <MenuItem href="/admin/coupons" onSelect={() => setOpen(false)}><Percent /> Coupon Codes</MenuItem>
            <MenuItem href="/admin/subscriptions" onSelect={() => setOpen(false)}><Layers /> User Subscriptions</MenuItem>
            <MenuItem href="/admin/banners" onSelect={() => setOpen(false)}><Bell /> Banners</MenuItem>
            <MenuItem href="/admin/emails" onSelect={() => setOpen(false)}><Plug /> Promotional Emails</MenuItem>
          </>
        ) : null}
        <MenuSeparator />
        <MenuLabel>Preferences</MenuLabel>
        <MenuItem onSelect={() => pick("api")} testId="menu-api">
          <KeyRound /> API Settings
        </MenuItem>
        <MenuItem onSelect={() => pick("currency")} value={settings?.currency} testId="menu-currency">
          <DollarSign /> Currency Settings
        </MenuItem>
        <MenuItem onSelect={() => pick("lot")} testId="menu-lot">
          <Layers /> Lot Size Settings
        </MenuItem>
        <MenuItem onSelect={() => pick("pnl")} value={settings ? (settings.pnlBasis === "bid_ask" ? "bid/ask" : "mark") : undefined} testId="menu-pnl">
          <Percent /> P&amp;L Settings
        </MenuItem>
        <MenuItem onSelect={() => pick("exchanges")} testId="menu-exchanges">
          <Plug /> Exchange Setup
        </MenuItem>
        <MenuItem onSelect={() => { setOpen(false); toggleDensity(); }} value={density}>
          {density === "compact" ? <Rows3 /> : <Rows2 />} Density
        </MenuItem>
        <MenuItem onSelect={() => { setOpen(false); toggleTheme(); }}>
          {resolvedTheme === "dark" ? <Sun /> : <Moon />} {resolvedTheme === "dark" ? "Switch to Light Mode" : "Switch to Dark Mode"}
        </MenuItem>
        <MenuSeparator />
        <MenuLabel>Support</MenuLabel>
        <MenuItem href={`mailto:${SUPPORT_EMAIL}`} external>
          <Mail /> Email Us
        </MenuItem>
        <MenuItem href={SUPPORT_WHATSAPP.href} external>
          <MessageCircle /> WhatsApp Us
        </MenuItem>
        <MenuSeparator />
        <MenuItem onSelect={() => pick("logout")} danger testId="menu-logout">
          <LogOut /> Logout
        </MenuItem>
        <span className="sr-only">{user.email}</span>
      </Menu>
    </div>
  );
}

function AccountMenu({ user }: { user: User }) {
  const [open, setOpen] = useState(false);
  const openDialog = useUiStore((s) => s.openDialog);
  return (
    <div className="relative">
      <button
        type="button"
        title={user.name}
        aria-label="Account"
        aria-haspopup="menu"
        aria-expanded={open}
        data-testid="account-avatar"
        onClick={() => setOpen((o) => !o)}
        className="grid size-7 place-items-center rounded-full border border-border bg-muted text-foreground hover:bg-surface-3"
      >
        <Avatar avatar={user.avatar} />
      </button>
      <Menu open={open} onClose={() => setOpen(false)} label="Account" testId="account-menu">
        <div className="px-2 pt-2 pb-1">
          <b className="block text-[13px]">{user.name}</b>
          <span className="text-2xs text-muted-foreground">{user.email}</span>
        </div>
        <MenuLabel>Account</MenuLabel>
        <MenuItem onSelect={() => { setOpen(false); openDialog("profile"); }}>
          <UserIcon /> My Profile
        </MenuItem>
        <MenuItem href="/subscription" onSelect={() => setOpen(false)}>
          <CreditCard /> My Subscription
        </MenuItem>
        <MenuItem href="/referrals" onSelect={() => setOpen(false)}>
          <Users /> My Referrals
        </MenuItem>
        <MenuSeparator />
        <MenuItem onSelect={() => { setOpen(false); openDialog("logout"); }} danger testId="account-logout">
          <LogOut /> Logout
        </MenuItem>
      </Menu>
    </div>
  );
}

export interface AppHeaderProps {
  variant: "analyse" | "default";
  /** Session user from the server (protected routes); public routes pass null and rely on useMe. */
  initialUser?: User | null;
}

export function AppHeader({ variant, initialUser = null }: AppHeaderProps) {
  const pathname = usePathname() ?? "/";
  const { data: me } = useMe();
  const user = me ?? initialUser;
  const isAdmin = user?.role === "admin";
  const asset = useUiStore((s) => s.asset);

  if (variant === "analyse" && user) {
    return (
      <>
        <header
          data-testid="app-header"
          data-variant="analyse"
          className="flex h-[50px] items-center gap-4 border-b border-border bg-header-bg px-4 text-header-fg"
        >
          <div className="flex items-center gap-2">
            <Logo href="/analyse" sub="Analyse" />
            {isAdmin ? <AdminChip /> : null}
          </div>
          <AssetSwitch />
          <span className="hidden h-6 w-px bg-border md:block" aria-hidden="true" />
          <FuturesPrice />
          <span className="sr-only">{ASSET_META[asset].name}</span>
          <span className="flex-1" />
          <FeedStatus />
          <span className="hidden h-6 w-px bg-border md:block" aria-hidden="true" />
          <ExchangeChip />
          <CurrencyToggle />
          <Bell className="hidden size-4 text-muted-foreground lg:block" aria-hidden="true" />
          <ThemeToggle />
          <PaletteButton className="hidden lg:inline-flex" />
          <SettingsMenu user={user} />
          <AccountMenu user={user} />
        </header>
        <PlanBanner />
        <CommandPalette loggedIn referralCode={user.referralCode} admin={user.role === "admin"} />
      </>
    );
  }

  return (
    <>
      <header
        data-testid="app-header"
        data-variant="default"
        className="flex h-[50px] items-center gap-6 border-b border-border bg-header-bg px-4 text-header-fg"
      >
        <div className="flex items-center gap-2">
          <Logo href={user ? "/analyse" : "/"} />
          {isAdmin ? <AdminChip /> : null}
        </div>
        <nav aria-label="Primary" className="flex items-center gap-1 self-stretch">
          {(user ? TABS : [{ href: "/", label: "Home", active: (p: string) => p === "/" }, TABS[1]]).map((t) => {
            const on = t.active(pathname);
            return (
              <a
                key={t.href}
                href={t.href}
                aria-current={on ? "page" : undefined}
                className={cn(
                  "-mb-px flex h-full items-center border-b-2 px-2.5 text-[13px]",
                  on ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                {t.label}
              </a>
            );
          })}
          {user && isAdmin ? (
            <a
              href="/admin/users"
              aria-current={pathname.startsWith("/admin") ? "page" : undefined}
              className={cn(
                "-mb-px flex h-full items-center border-b-2 px-2.5 text-[13px]",
                pathname.startsWith("/admin") ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              Admin
            </a>
          ) : null}
        </nav>
        <span className="flex-1" />
        <ThemeToggle />
        <PaletteButton className="hidden lg:inline-flex" />
        {user ? (
          <>
            <SettingsMenu user={user} />
            <AccountMenu user={user} />
          </>
        ) : (
          <Button asChild size="sm">
            <a href="/auth" data-testid="header-sign-in">
              Sign In
            </a>
          </Button>
        )}
      </header>
      <CommandPalette loggedIn={!!user} referralCode={user?.referralCode ?? null} admin={user?.role === "admin"} />
    </>
  );
}
