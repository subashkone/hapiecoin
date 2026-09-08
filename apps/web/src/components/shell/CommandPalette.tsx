"use client";
// Minimal command palette (HC-PB-059): Ctrl K / ⌘ K opens a filterable list of navigation commands.
// Navigation, chain actions (Phase 2 items 1–3), Builder / analysis actions (Phase 2 item 4), theme toggle.
import {
  Dialog,
  DialogContent,
  DialogTitle,
  Kbd,
  Search,
  cn,
  toast,
  useTheme,
} from "@hapiecoin/ui";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, type KeyboardEvent } from "react";
import { greeksShown, setGreeks } from "@/lib/chain/layout";
import { useUiStore } from "@/lib/store";

export interface PaletteCommand {
  id: string;
  label: string;
  group: "Navigate" | "Actions";
  hint?: string;
  keywords?: string[];
  run: () => void;
}

export function buildCommands(opts: {
  loggedIn: boolean;
  navigate: (path: string) => void;
  toggleTheme: () => void;
  /** The signed-in user's referral code; enables "Referrals: copy link" (HC-AC-073). */
  referralCode?: string | null;
}): PaletteCommand[] {
  const nav = (id: string, path: string, label: string, keywords: string[] = []): PaletteCommand => ({
    id,
    label,
    group: "Navigate",
    hint: path,
    keywords,
    run: () => opts.navigate(path),
  });
  const list: PaletteCommand[] = [nav("nav:home", "/", "Home", ["landing", "public", "website"])];
  if (opts.loggedIn) {
    list.push(
      nav("nav:analyse", "/analyse", "Analyse workspace", ["options chain", "builder", "payoff"]),
      nav("nav:subscription", "/subscription", "Subscription: change plan", ["plan", "upgrade", "billing", "renew"]),
      nav("nav:referrals", "/referrals", "Referrals: share link and earnings", ["refer", "commission", "invite", "share"]),
      ...(opts.referralCode
        ? [
            {
              id: "act:referral-copy",
              label: "Referrals: copy link",
              group: "Actions" as const,
              keywords: ["refer", "invite", "share", "commission", "code"],
              run: () => {
                const link = `${window.location.origin}/auth?tab=signup&ref=${opts.referralCode}`;
                void navigator.clipboard.writeText(link).then(() => toast.success("Copied!", { description: "Referral link" })).catch(() => toast.error("Could not copy", { description: link }));
              },
            },
          ]
        : []),
      {
        id: "act:chain-atm",
        label: "Chain: recentre on ATM",
        group: "Actions",
        hint: "A",
        keywords: ["chain", "strike", "spot", "centre", "center"],
        run: () => useUiStore.getState().recentreChain(),
      },
      {
        id: "act:chain-all",
        label: "Chain: show all strikes",
        group: "Actions",
        keywords: ["chain", "range", "strikes", "expand"],
        run: () => useUiStore.getState().setChainRange(0),
      },
      {
        id: "act:chain-columns",
        label: "Chain: column settings",
        group: "Actions",
        keywords: ["chain", "columns", "show", "hide", "reorder", "greeks"],
        run: () => useUiStore.getState().openDialog("columns"),
      },
      {
        id: "act:builder-open",
        label: "Builder: open the strategy builder",
        group: "Actions",
        keywords: ["builder", "legs", "strategy", "tab"],
        run: () => {
          const s = useUiStore.getState();
          s.setWorkspaceTab("builder");
          s.setBuilderTab("builder");
        },
      },
      {
        id: "act:builder-templates",
        label: "Builder: load a template",
        group: "Actions",
        keywords: ["templates", "straddle", "strangle", "spread", "condor", "butterfly"],
        run: () => {
          const s = useUiStore.getState();
          s.setWorkspaceTab("builder");
          s.setBuilderTab("templates");
        },
      },
      {
        id: "act:builder-new",
        label: "Builder: new strategy (clear legs)",
        group: "Actions",
        keywords: ["new", "clear", "reset", "legs", "strategy"],
        run: () => {
          const s = useUiStore.getState();
          s.setLegs(s.asset, []);
          s.setStrategyMeta(s.asset, { name: "", draftId: null, priceMode: "live" });
          s.setWorkspaceTab("builder");
        },
      },
      {
        id: "act:analysis-payoff",
        label: "Analysis: payoff chart",
        group: "Actions",
        keywords: ["payoff", "chart", "breakeven", "pop", "target"],
        run: () => useUiStore.getState().setAnalysisTab("payoff"),
      },
      {
        id: "act:analysis-greeks",
        label: "Analysis: Greeks",
        group: "Actions",
        keywords: ["greeks", "delta", "gamma", "theta", "vega"],
        run: () => useUiStore.getState().setAnalysisTab("greeks"),
      },
      {
        id: "act:analysis-ladder",
        label: "Analysis: P&L ladder",
        group: "Actions",
        keywords: ["ladder", "pnl", "price", "table"],
        run: () => useUiStore.getState().setAnalysisTab("ladder"),
      },
      {
        id: "act:chain-greeks",
        label: "Chain: toggle Greeks columns (Γ Θ ν)",
        group: "Actions",
        keywords: ["chain", "greeks", "gamma", "theta", "vega", "columns"],
        run: () => {
          const s = useUiStore.getState();
          s.setChainColumns(setGreeks(s.chainColumns, !greeksShown(s.chainColumns)));
        },
      },
    );
  } else {
    list.push(nav("nav:auth", "/auth", "Sign in", ["login", "signup", "register", "otp", "password"]));
  }
  list.push(
    nav("nav:privacy", "/privacy", "Privacy Policy", ["legal"]),
    nav("nav:terms", "/terms", "Terms of Service", ["legal"]),
    nav("nav:disclaimer", "/disclaimer", "Disclaimer", ["legal", "risk"]),
    { id: "act:theme", label: "Toggle theme", group: "Actions", keywords: ["dark", "light", "mode"], run: opts.toggleTheme },
  );
  return list;
}

/** Case-insensitive subsequence match on label + keywords; returns a score (higher is better) or -1. */
export function scoreCommand(cmd: PaletteCommand, query: string): number {
  const q = query.trim().toLowerCase();
  if (!q) return 0;
  const hay = [cmd.label, ...(cmd.keywords ?? []), cmd.hint ?? ""].map((s) => s.toLowerCase());
  let best = -1;
  for (const h of hay) {
    if (h.includes(q)) best = Math.max(best, 100 - h.indexOf(q));
    else {
      let i = 0;
      for (const ch of h) if (ch === q[i]) i++;
      if (i === q.length) best = Math.max(best, 10);
    }
  }
  return best;
}

export function filterCommands(cmds: PaletteCommand[], query: string): PaletteCommand[] {
  if (!query.trim()) return cmds;
  return cmds
    .map((c) => ({ c, s: scoreCommand(c, query) }))
    .filter((x) => x.s >= 0)
    .sort((a, b) => b.s - a.s)
    .map((x) => x.c);
}

export function CommandPalette({ loggedIn, referralCode = null }: { loggedIn: boolean; referralCode?: string | null }) {
  const open = useUiStore((s) => s.paletteOpen);
  const setOpen = useUiStore((s) => s.setPaletteOpen);
  const router = useRouter();
  const { toggleTheme } = useTheme();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);

  const commands = useMemo(
    () => buildCommands({ loggedIn, navigate: (p) => router.push(p), toggleTheme, referralCode }),
    [loggedIn, referralCode, router, toggleTheme],
  );
  const items = useMemo(() => filterCommands(commands, query), [commands, query]);

  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen(!useUiStore.getState().paletteOpen);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setOpen]);

  useEffect(() => {
    if (!open) {
      setQuery("");
      setActive(0);
    }
  }, [open]);

  const run = (cmd: PaletteCommand | undefined) => {
    if (!cmd) return;
    setOpen(false);
    cmd.run();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(items.length - 1, a + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      run(items[active]);
    }
  };

  let lastGroup = "";
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent size="md" hideClose className="top-[18%] translate-y-0 p-0" aria-label="Command palette">
        <DialogTitle className="sr-only">Command palette</DialogTitle>
        <div className="flex items-center gap-2 border-b border-border px-3">
          <Search className="size-4 text-muted-foreground" aria-hidden="true" />
          <input
            autoFocus
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onKeyDown={onKeyDown}
            placeholder="Type a command or search…"
            aria-label="Command"
            role="combobox"
            aria-expanded="true"
            aria-controls="hc-palette-list"
            aria-activedescendant={items[active] ? `hc-cmd-${items[active].id}` : undefined}
            className="h-11 w-full bg-transparent text-[13.5px] outline-none placeholder:text-muted-foreground"
          />
          <Kbd>Esc</Kbd>
        </div>
        <ul id="hc-palette-list" role="listbox" className="max-h-[320px] overflow-auto p-1.5">
          {items.length === 0 ? (
            <li className="px-3 py-6 text-center text-muted-foreground">No matching command</li>
          ) : null}
          {items.map((cmd, i) => {
            const showGroup = cmd.group !== lastGroup;
            lastGroup = cmd.group;
            return (
              <li key={cmd.id} role="presentation">
                {showGroup ? <div className="micro px-2 pt-2 pb-1">{cmd.group}</div> : null}
                <button
                  type="button"
                  id={`hc-cmd-${cmd.id}`}
                  role="option"
                  aria-selected={i === active}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => run(cmd)}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-[12.5px]",
                    i === active ? "bg-muted text-foreground" : "text-foreground/90",
                  )}
                >
                  <span className="flex-1">{cmd.label}</span>
                  {cmd.hint ? <span className="font-mono text-2xs text-muted-foreground">{cmd.hint}</span> : null}
                </button>
              </li>
            );
          })}
        </ul>
      </DialogContent>
    </Dialog>
  );
}

/** Header button that opens the palette (shows the Ctrl K hint). */
export function PaletteButton({ className }: { className?: string }) {
  const setOpen = useUiStore((s) => s.setPaletteOpen);
  return (
    <button
      type="button"
      onClick={() => setOpen(true)}
      title="Command palette (Ctrl K)"
      aria-label="Command palette"
      data-testid="palette-button"
      className={cn(
        "inline-flex h-7 items-center gap-1 rounded border border-border bg-transparent px-1.5 text-muted-foreground hover:bg-muted hover:text-foreground",
        className,
      )}
    >
      <Kbd>Ctrl</Kbd>
      <Kbd>K</Kbd>
    </button>
  );
}
