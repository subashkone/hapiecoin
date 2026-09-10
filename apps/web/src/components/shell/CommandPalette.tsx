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
import { useExpiries } from "@/lib/chain/useExpiries";
import { fmtExpiry } from "@/lib/format";
import { useUiStore } from "@/lib/store";
import { TEMPLATES } from "@/lib/strategy/templates";

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
  /** Admin role: adds the seven "Admin: …" navigation commands (HC-AD-091). */
  admin?: boolean;
  /** Listed expiries of the workspace asset → "Switch expiry → <date>" per expiry (HC-WS-069). */
  expiries?: readonly string[];
  /** Template names → "Load template → <name>" per template (HC-WS-069, HC-TR-140). */
  templates?: readonly string[];
}): PaletteCommand[] {
  const nav = (id: string, path: string, label: string, keywords: string[] = []): PaletteCommand => ({
    id,
    label,
    group: "Navigate",
    hint: path,
    keywords,
    run: () => opts.navigate(path),
  });
  const list: PaletteCommand[] = [nav("nav:home", "/", "Home", ["landing", "public", "website"]), nav("nav:payoff-preview", "/payoff-preview", "Payoff chart preview", ["chart", "preview", "demo", "payoff"])];
  if (opts.loggedIn) {
    list.push(
      nav("nav:analyse", "/analyse", "Analyse workspace", ["options chain", "builder", "payoff"]),
      nav("nav:analytics-hub", "/analytics/hub", "Analytics: Markets Hub", ["analytics", "markets", "open interest", "hub"]),
      nav("nav:analytics-overview", "/analytics/overview", "Analytics: Futures overview", ["analytics", "futures", "long short", "fear greed"]),
      nav("nav:analytics-markets", "/analytics/markets", "Analytics: Markets screener", ["analytics", "screener", "compare", "watchlist"]),
      nav("nav:analytics-derivatives", "/analytics/derivatives", "Analytics: Derivatives", ["analytics", "funding", "open interest", "arbitrage"]),
      nav("nav:analytics-liquidations", "/analytics/liquidations", "Analytics: Liquidations", ["analytics", "liquidations", "feed", "long short"]),
      nav("nav:analytics-options", "/analytics/options", "Analytics: Options", ["analytics", "options", "max pain", "deribit", "delta"]),
      nav("nav:analytics-sentiment", "/analytics/sentiment", "Analytics: Sentiment", ["analytics", "sentiment", "fear greed", "rsi", "cycle"]),
      nav("nav:analytics-whales", "/analytics/whales", "Analytics: Whales", ["analytics", "whales", "hyperliquid", "large orders"]),
      nav("nav:terminal-dashboard", "/terminal", "Terminal: Dashboard", ["terminal", "analytics", "dashboard", "open interest"]),
      nav("nav:terminal-spot", "/terminal/spot", "Terminal: Spot Markets", ["terminal", "spot", "markets", "screener", "sectors"]),
      nav("nav:terminal-exchanges", "/terminal/exchanges", "Terminal: Exchanges", ["terminal", "exchange", "binance", "bybit", "okx"]),
      nav("nav:terminal-open-interest", "/terminal/derivatives/open-interest", "Terminal: Open Interest", ["terminal", "open interest", "oi"]),
      nav("nav:terminal-funding", "/terminal/derivatives/funding", "Terminal: Funding Rates", ["terminal", "funding", "rates"]),
      nav("nav:terminal-long-short", "/terminal/derivatives/long-short", "Terminal: Long / Short", ["terminal", "long short", "ratio"]),
      nav("nav:terminal-liquidations", "/terminal/derivatives/liquidations", "Terminal: Liquidations", ["terminal", "liquidations"]),
      nav("nav:terminal-fear-greed", "/terminal/indicators/fear-greed", "Terminal: Fear & Greed", ["terminal", "fear greed", "sentiment"]),
      nav("nav:terminal-cycle", "/terminal/indicators/cycle", "Terminal: BTC Cycle", ["terminal", "cycle", "pi cycle", "rainbow"]),
      nav("nav:subscription", "/subscription", "Subscription: change plan", ["plan", "upgrade", "billing", "renew"]),
      nav("nav:referrals", "/referrals", "Referrals: share link and earnings", ["refer", "commission", "invite", "share"]),
      ...(opts.admin
        ? [
            nav("nav:admin-users", "/admin/users", "Admin: Users", ["admin", "user management", "invite"]),
            nav("nav:admin-plans", "/admin/plans", "Admin: Subscription Plans", ["admin", "plans", "pricing"]),
            nav("nav:admin-pricing", "/admin/pricing", "Admin: Menu Pricing", ["admin", "menu items"]),
            nav("nav:admin-coupons", "/admin/coupons", "Admin: Coupon Codes", ["admin", "coupons", "discount"]),
            nav("nav:admin-subscriptions", "/admin/subscriptions", "Admin: User Subscriptions", ["admin", "commissions", "subscriptions"]),
            nav("nav:admin-banners", "/admin/banners", "Admin: Banners", ["admin", "flyer", "popup"]),
            nav("nav:admin-emails", "/admin/emails", "Admin: Promotional Emails", ["admin", "campaign", "email"]),
          ]
        : []),
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
        id: "act:tour",
        label: "Take a tour",
        group: "Actions",
        keywords: ["tour", "help", "walkthrough", "guide", "onboarding"],
        run: () => {
          opts.navigate("/analyse");
          useUiStore.getState().requestTour();
        },
      },
      {
        id: "act:assistant",
        label: "Ask the HapieCoin Assistant",
        group: "Actions",
        keywords: ["assistant", "chat", "help", "question", "support"],
        run: () => useUiStore.getState().openAssistant(),
      },
      {
        id: "act:flyers",
        label: "Show announcements",
        group: "Actions",
        keywords: ["flyers", "banners", "popup", "offers", "announcements"],
        run: () => {
          opts.navigate("/analyse");
          useUiStore.getState().requestFlyers();
        },
      },
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
        id: "act:builder-save",
        label: "Builder: save draft",
        group: "Actions",
        keywords: ["save", "draft", "strategy", "name"],
        run: () => {
          const s = useUiStore.getState();
          opts.navigate("/analyse");
          s.setWorkspaceTab("builder");
          s.setBuilderTab("builder");
          s.requestSaveDraft(true);
        },
      },
      {
        id: "act:builder-paper",
        label: "Paper trade the current strategy",
        group: "Actions",
        hint: "P",
        keywords: ["paper", "trade", "simulate", "start"],
        run: () => {
          const s = useUiStore.getState();
          if (s.legs[s.asset].filter((l) => l.status === "open" && l.enabled !== false).length === 0) {
            toast("No legs", { description: "Add legs in the Builder before paper trading" });
            return;
          }
          opts.navigate("/analyse");
          s.setWorkspaceTab("builder");
          s.openTrade({ strategyId: null });
        },
      },
      {
        id: "act:open-paper",
        label: "Open Paper trades",
        group: "Actions",
        keywords: ["paper", "trades", "positions", "tab"],
        run: () => {
          opts.navigate("/analyse");
          useUiStore.getState().setWorkspaceTab("paper");
        },
      },
      {
        id: "act:open-live",
        label: "Open Live trades",
        group: "Actions",
        keywords: ["live", "trades", "orders", "tab"],
        run: () => {
          opts.navigate("/analyse");
          useUiStore.getState().setWorkspaceTab("live");
        },
      },
      {
        id: "act:open-journal",
        label: "Open Journal",
        group: "Actions",
        keywords: ["journal", "closed", "trades", "notes", "tags"],
        run: () => {
          opts.navigate("/analyse");
          useUiStore.getState().setWorkspaceTab("journal");
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
      ...(opts.expiries ?? []).map(
        (e): PaletteCommand => ({
          id: `act:expiry-${e}`,
          label: `Switch expiry → ${fmtExpiry(e)}`,
          group: "Actions",
          hint: e,
          keywords: ["expiry", "chain", "switch", e],
          run: () => {
            const s = useUiStore.getState();
            opts.navigate("/analyse");
            s.setExpiry(s.asset, e);
            s.setWorkspaceTab("chain");
          },
        }),
      ),
      ...(opts.templates ?? []).map(
        (name): PaletteCommand => ({
          id: `act:template-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
          label: `Load template → ${name}`,
          group: "Actions",
          keywords: ["template", "load", "strategy", name],
          run: () => {
            const s = useUiStore.getState();
            opts.navigate("/analyse");
            s.setWorkspaceTab("builder");
            s.setBuilderTab("templates");
            s.requestTemplate(name);
          },
        }),
      ),
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

export function CommandPalette({ loggedIn, referralCode = null, admin = false }: { loggedIn: boolean; referralCode?: string | null; admin?: boolean }) {
  const open = useUiStore((s) => s.paletteOpen);
  const setOpen = useUiStore((s) => s.setPaletteOpen);
  const router = useRouter();
  const { toggleTheme } = useTheme();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);

  const asset = useUiStore((s) => s.asset);
  const expiries = useExpiries(asset);
  const templates = useMemo(() => TEMPLATES.map((t) => t.name), []);
  const commands = useMemo(
    () => buildCommands({ loggedIn, navigate: (p) => router.push(p), toggleTheme, referralCode, admin, expiries: loggedIn ? expiries : [], templates: loggedIn ? templates : [] }),
    [admin, loggedIn, referralCode, router, toggleTheme, expiries, templates],
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
      data-tour="command-palette"
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
