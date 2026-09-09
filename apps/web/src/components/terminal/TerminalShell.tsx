"use client";
// Terminal shell (HC-MT-001, 011..031, 154, 155): the 232 px sticky sidebar with grouped links, the amber left rule on
// the active item, the "Markets Hub ↗" external marker, and the drawer under the lg breakpoint whose toggle names the
// current section and closes on route change. The header, section switcher and footer come from the analytics shell.
import { cn } from "@hapiecoin/ui";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { type ReactNode, useEffect, useState } from "react";
import { TERMINAL_NAV, navActive, navTestId, terminalSection } from "@/lib/terminal/nav";

export function TerminalShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [pathname]);
  const section = terminalSection(pathname);
  return (
    <div className="grid gap-4 lg:grid-cols-[232px_minmax(0,1fr)]" data-testid="terminal-shell" data-section={section}>
      <aside className="min-w-0 lg:sticky lg:top-3 lg:self-start" data-testid="terminal-sidebar">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="flex w-full items-center justify-between rounded border border-border bg-card px-3 py-1.5 text-xs lg:hidden"
          data-testid="terminal-nav-toggle"
        >
          <span>Navigation</span>
          <span className="font-medium text-foreground" data-testid="terminal-nav-current">{section}</span>
        </button>
        <nav className={cn("mt-2 space-y-3 lg:mt-0", open ? "block" : "hidden lg:block")} aria-label="Terminal navigation" data-testid="terminal-nav" data-open={open}>
          {TERMINAL_NAV.map((g) => (
            <div key={g.label}>
              <div className="micro px-2 pb-1">{g.label}</div>
              {g.items.map((it) => {
                const active = navActive(it, pathname);
                return (
                  <Link
                    key={it.href}
                    href={it.href}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "flex h-[30px] items-center gap-2 rounded-r border-l-2 px-2 text-xs",
                      it.sub && "pl-6",
                      active ? "border-primary bg-muted text-foreground" : "border-transparent text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                    )}
                    data-testid={navTestId(it.href)}
                    data-active={active ? "true" : undefined}
                  >
                    <span className="truncate">{it.label}</span>
                    {it.ext ? <span className="micro ml-auto" title="Leaves the terminal">↗</span> : null}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>
      </aside>
      <div className="min-w-0" data-testid="terminal-content">{children}</div>
    </div>
  );
}

/** Page title row: title, sub line and right-hand tools (chips, switchers, the mock clock's "Updated"). */
export function PageTitle({ title, sub, tools, testId }: { title: ReactNode; sub?: ReactNode; tools?: ReactNode; testId?: string }) {
  return (
    <div className="flex flex-wrap items-end gap-x-4 gap-y-2" data-testid={testId ?? "page-title"}>
      <div className="min-w-0">
        <h2 className="text-lg font-semibold leading-tight">{title}</h2>
        {sub ? <div className="text-2xs text-muted-foreground">{sub}</div> : null}
      </div>
      {tools ? <div className="ml-auto flex flex-wrap items-center gap-2">{tools}</div> : null}
    </div>
  );
}
