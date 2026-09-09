"use client";
// Market Analytics shell (HC-MA-003..008, 089..091): title row with the mark, "← Analyse", coin search with a
// dropdown, the section switcher shared by /analytics and /terminal, and the footer note. Sections not yet built
// still route (to a "next release" page) so navigation never dead-ends (HC-SH-016).
import { Kbd, cn, toast } from "@hapiecoin/ui";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { useMarkets } from "@/lib/api/analytics";
import { useUiStore } from "@/lib/store";
import { LogoMark } from "@/components/shell/Logo";

export const SECTIONS = [
  { href: "/analytics/hub", label: "Hub" },
  { href: "/analytics/overview", label: "Futures" },
  { href: "/analytics/markets", label: "Markets" },
  { href: "/analytics/derivatives", label: "Derivatives" },
  { href: "/analytics/options", label: "Options" },
  { href: "/analytics/etf", label: "ETF" },
  { href: "/analytics/liquidations", label: "Liquidations" },
  { href: "/analytics/whales", label: "Whales" },
  { href: "/analytics/sentiment", label: "Sentiment" },
] as const;
export const TERMINAL = [
  { href: "/terminal", label: "Dashboard" },
  { href: "/terminal/spot", label: "Spot Markets" },
  { href: "/terminal/exchanges", label: "Exchanges" },
  { href: "/terminal/derivatives/open-interest", label: "Open Interest" },
  { href: "/terminal/derivatives/funding", label: "Funding Rates" },
  { href: "/terminal/derivatives/long-short", label: "Long / Short" },
  { href: "/terminal/derivatives/liquidations", label: "Liquidations" },
  { href: "/terminal/etf", label: "ETF Flows" },
  { href: "/terminal/indicators/fear-greed", label: "Fear & Greed" },
  { href: "/terminal/indicators/cycle", label: "BTC Cycle" },
] as const;

/** `base` is the coin route the search opens: the analytics coin page, or the terminal's inside /terminal (HC-MT-003..006). */
export function CoinSearch({ className, base = "/analytics/coin" }: { className?: string; base?: "/analytics/coin" | "/terminal/coin" }) {
  const router = useRouter();
  const { data } = useMarkets();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const rows = (data?.data.rows ?? []).filter((r) => {
    const n = q.trim().toLowerCase();
    return n.length > 0 && (r.symbol.toLowerCase().startsWith(n) || r.name.toLowerCase().includes(n));
  }).slice(0, 8);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);
  const go = (symbol: string) => {
    setOpen(false);
    setQ("");
    router.push(`${base}/${symbol}`);
  };
  const inTerminal = base === "/terminal/coin";
  return (
    <div ref={box} className={cn("relative", className)}>
      <input
        value={q}
        onChange={(e) => { setQ(e.target.value); setOpen(true); setActive(0); }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(rows.length - 1, a + 1)); }
          else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
          else if (e.key === "Enter" && rows[active]) go(rows[active].symbol);
          else if (e.key === "Enter" && q.trim()) toast.error(`No coin matches “${q.trim()}”`);
          else if (e.key === "Escape") setOpen(false);
        }}
        placeholder="Search coin…"
        aria-label="Search coin"
        className="h-7 w-[180px] rounded border border-input bg-background px-2 text-xs"
        data-testid="coin-search"
      />
      {open && q.trim() ? (
        <div className="absolute left-0 top-full z-30 mt-1 w-[260px] rounded-md border border-border bg-popover p-1 text-xs shadow-md" role="listbox" data-testid="coin-search-list" data-base={base}>
          {inTerminal && rows.length > 0 ? <div className="micro px-2 pb-1" data-testid="coin-search-hint">Enter · open in the terminal</div> : null}
          {rows.length === 0 ? (
            <div className="px-2 py-1.5 text-muted-foreground" data-testid="coin-search-empty">{data ? `No coin matches “${q.trim()}”` : "Coin list not loaded yet"}</div>
          ) : (
            rows.map((r, i) => (
              <button key={r.symbol} type="button" role="option" aria-selected={i === active} onMouseEnter={() => setActive(i)} onClick={() => go(r.symbol)} className={cn("flex w-full items-center gap-2 rounded px-2 py-1 text-left", i === active && "bg-muted")} data-testid="coin-search-item">
                <b>{r.symbol}</b>
                <span className="truncate text-muted-foreground">{r.name}</span>
                <span className="num ml-auto text-muted-foreground">#{r.rank}</span>
              </button>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}

export function AnalyticsShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const setPaletteOpen = useUiStore((s) => s.setPaletteOpen);
  const [termOpen, setTermOpen] = useState(false);
  const inTerminal = pathname.startsWith("/terminal");
  return (
    <div className="flex min-h-[calc(100vh-56px)] flex-col" data-testid="analytics-shell">
      <div className="border-b border-border bg-surface-1">
        <div className="mx-auto flex max-w-[1600px] flex-wrap items-center gap-3 px-4 py-2">
          <span className="inline-flex items-center gap-2">
            <LogoMark className="size-4" />
            <h1 className="text-[15px] font-semibold">Market Analytics</h1>
          </span>
          <Link href="/analyse" className="text-2xs text-muted-foreground hover:text-foreground" data-testid="analytics-back">← Analyse</Link>
          <CoinSearch className="ml-auto" base={inTerminal ? "/terminal/coin" : "/analytics/coin"} />
          <button type="button" onClick={() => setPaletteOpen(true)} className="inline-flex items-center gap-1 rounded border border-border px-1.5 py-0.5 text-2xs text-muted-foreground hover:text-foreground" title="Command palette (Ctrl K)" aria-label="Command palette" data-testid="analytics-palette">
            <Kbd>Ctrl</Kbd>
            <Kbd>K</Kbd>
          </button>
        </div>
        <nav className="mx-auto flex max-w-[1600px] flex-wrap items-center gap-1 px-4 pb-2" aria-label="Analytics sections" data-testid="analytics-nav">
          {SECTIONS.map((s) => (
            <Link key={s.href} href={s.href} className={cn("rounded px-2 py-1 text-xs", pathname === s.href || (s.href === "/analytics/hub" && pathname === "/analytics") ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground")} aria-current={pathname === s.href ? "page" : undefined} data-testid={`section-${s.label.toLowerCase()}`}>
              {s.label}
            </Link>
          ))}
          <div className="relative">
            <button type="button" onClick={() => setTermOpen((o) => !o)} aria-expanded={termOpen} className={cn("rounded px-2 py-1 text-xs", inTerminal ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground")} data-testid="section-terminal">
              Terminal ▾
            </button>
            {termOpen ? (
              <div className="absolute left-0 top-full z-30 mt-1 w-[200px] rounded-md border border-border bg-popover p-1 text-xs shadow-md" role="menu" data-testid="terminal-menu" onMouseLeave={() => setTermOpen(false)}>
                {TERMINAL.map((t) => (
                  <Link key={t.href} href={t.href} role="menuitem" onClick={() => setTermOpen(false)} className="block rounded px-2 py-1 hover:bg-muted">{t.label}</Link>
                ))}
              </div>
            ) : null}
          </div>
        </nav>
      </div>
      <main className="mx-auto w-full max-w-[1600px] flex-1 px-4 py-4">{children}</main>
      <footer className="micro mx-auto w-full max-w-[1600px] px-4 pb-6 text-center" data-testid="analytics-footer">Market data · auto-refreshing · intervals vary per dataset</footer>
    </div>
  );
}

/** Section pages that arrive in a later PR still render inside the shell (HC-SH-016). */
export function SectionSoon({ title, release, blurb }: { title: string; release: string; blurb: string }) {
  return (
    <div className="mx-auto max-w-[640px] py-12 text-center" data-testid="section-soon" data-release={release}>
      <p className="micro">Arrives in {release}</p>
      <h2 className="mt-2 text-xl">{title}</h2>
      <p className="mt-2 text-sm text-muted-foreground">{blurb}</p>
      <Link href="/analytics/hub" className="mt-4 inline-block text-xs text-accent underline-offset-2 hover:underline">← Markets Hub</Link>
    </div>
  );
}
