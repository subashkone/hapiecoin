"use client";
// Templates (HC-TR-037..049): 28 cards by category with a payoff sketch, placed on the venue ladder around
// ATM at the chosen expiry; and My templates (drafts | archived) with search, Load, Archive and Delete.
import { Button, cn, toast } from "@hapiecoin/ui";
import { payoffAtExpiry } from "@hapiecoin/pricing";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState, useEffect } from "react";
import { discoverExpiries, nearestExpiry } from "@/lib/chain/expiries";
import { publicEnv } from "@/lib/env";
import { daysToExpiry, fmtDate, fmtExpiry } from "@/lib/format";
import { useChain, useSpot } from "@/lib/gateway/hooks";
import { atmIndex } from "@/lib/gateway/reducer";
import { useUiStore } from "@/lib/store";
import { useArchiveStrategy, useDeleteStrategy, useStrategies } from "@/lib/api/strategies";
import { serverLegToLocal } from "@/lib/strategy/paper";
import type { Strategy } from "@hapiecoin/schema";
import { MAX_ACTIVE_LEGS, addLeg as addLegPure, type StrategyLeg } from "@/lib/strategy/legs";
import { type StrategyTemplate, TEMPLATES, TEMPLATE_CATEGORIES, materialiseTemplate } from "@/lib/strategy/templates";

/** Small SVG sketch of the expiry payoff of a template placed around a nominal spot of 100 (shape only). */
export function templateSketch(tpl: StrategyTemplate): string {
  const legs = tpl.legs.map((l) => ({
    kind: l.kind,
    side: l.side,
    strike: 100 + l.k * 2.5,
    expiry: "2030-01-01",
    quantity: l.lots ?? 1,
    price: l.kind === "call" ? Math.max(0.5, 4 - l.k * 1.2) : Math.max(0.5, 4 + l.k * 1.2),
  }));
  const xs = Array.from({ length: 41 }, (_, i) => 85 + (30 * i) / 40);
  const ys = xs.map((x) => payoffAtExpiry(legs, x));
  const min = Math.min(0, ...ys);
  const max = Math.max(0, ...ys);
  const W = 100;
  const H = 40;
  const y = (v: number) => H - 3 - ((v - min) / (max - min || 1)) * (H - 6);
  const x = (i: number) => 3 + (i / 40) * (W - 6);
  return xs.map((_, i) => `${x(i).toFixed(1)},${y(ys[i]!).toFixed(1)}`).join(" ");
}

/**
 * Template loading shared by the Templates tab and the strip under the Builder legs (HC-TR-040, ADR-027): the
 * expiry choice (workspace expiry by default), the venue chain around ATM, and `load` that materialises a template.
 */
export function useTemplateLoader() {
  const asset = useUiStore((s) => s.asset);
  const workspaceExpiry = useUiStore((s) => s.expiry[s.asset] ?? null);
  const chainLots = useUiStore((s) => s.chainLots);
  const setLegs = useUiStore((s) => s.setLegs);
  const setMeta = useUiStore((s) => s.setStrategyMeta);
  const setBuilderTab = useUiStore((s) => s.setBuilderTab);
  const env = publicEnv();
  const expiries = useQuery({
    queryKey: ["expiries", asset],
    queryFn: () => discoverExpiries(asset, { gatewayWsUrl: env.NEXT_PUBLIC_GATEWAY_URL, defaultsCsv: env.NEXT_PUBLIC_DEFAULT_EXPIRIES }),
    staleTime: 5 * 60_000,
  });
  const list = expiries.data?.expiries ?? [];
  const [chosen, setChosen] = useState<string | null>(null);
  const expiry = chosen && list.includes(chosen) ? chosen : (workspaceExpiry && list.includes(workspaceExpiry) ? workspaceExpiry : nearestExpiry(list));
  const chain = useChain(asset, expiry);
  const spot = useSpot(asset);
  const rows = chain?.rows ?? [];
  const atm = useMemo(() => atmIndex(rows, spot?.price), [rows, spot?.price]);

  const load = (tpl: StrategyTemplate) => {
    if (!expiry) return;
    const r = materialiseTemplate(tpl, { asset, expiry, expiries: list, rows, atm, lots: chainLots });
    if (!r.ok) {
      toast.error(r.reason === "no-chain" ? "Chain not loaded yet" : r.reason === "out-of-range" ? "Not enough listed strikes around ATM for this template" : "A leg has no quote yet");
      return;
    }
    let legs: StrategyLeg[] = [];
    for (const input of r.legs) {
      const a = addLegPure(legs, input);
      if (!a.ok) {
        toast.error("Limit reached", { description: `Maximum ${MAX_ACTIVE_LEGS} active legs per strategy` });
        return;
      }
      legs = a.legs;
    }
    setLegs(asset, legs);
    setMeta(asset, { name: tpl.name, draftId: null });
    setBuilderTab("builder");
    toast(`${tpl.name} loaded`, { description: `${legs.length} ${legs.length === 1 ? "leg" : "legs"} on ${fmtExpiry(expiry)} · ${chainLots} lots each` });
  };
  // HC-WS-069: the palette's "Load template → <name>" waits here until the chain rows exist
  const request = useUiStore((s) => s.templateRequest);
  const requestTemplate = useUiStore((s) => s.requestTemplate);
  const chainReady = rows.length > 0;
  useEffect(() => {
    if (!request || !chainReady || !expiry) return;
    const tpl = TEMPLATES.find((t) => t.name === request);
    requestTemplate(null);
    if (tpl) load(tpl);
    else toast.error("Unknown template", { description: request });
    // `load` reads the latest chain each call; re-running on its identity would double-load
  }, [request, chainReady, expiry, requestTemplate]);
  return { asset, expiry, list, setChosen, load, chainReady };
}

export function TemplatesPanel() {
  const { expiry, list, setChosen, load } = useTemplateLoader();
  const setLegs = useUiStore((s) => s.setLegs);
  const setMeta = useUiStore((s) => s.setStrategyMeta);
  const setBuilderTab = useUiStore((s) => s.setBuilderTab);
  const setAsset = useUiStore((s) => s.setAsset);
  const setWorkspaceTab = useUiStore((s) => s.setWorkspaceTab);
  const openTrade = useUiStore((s) => s.openTrade);
  const openDetails = useUiStore((s) => s.openDetails);
  const { data: strategies, isLoading: mineLoading } = useStrategies();
  const archiveStrategy = useArchiveStrategy();
  const deleteStrategy = useDeleteStrategy();
  const [category, setCategory] = useState<(typeof TEMPLATE_CATEGORIES)[number]>("All");
  const [mine, setMine] = useState<"draft" | "archived">("draft");
  const [search, setSearch] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const cards = TEMPLATES.filter((t) => category === "All" || t.category === category);
  const myList = (strategies ?? []).filter((d) => d.status === mine && (search.trim() === "" || `${d.name} ${d.asset} ${d.templateName}`.toLowerCase().includes(search.trim().toLowerCase())));
  const loadDraft = (d: Strategy) => {
    setAsset(d.asset);
    setLegs(d.asset, d.legs.filter((l) => l.status === "open").map((l) => serverLegToLocal(l, d.asset)));
    setMeta(d.asset, { name: d.name, draftId: d.status === "draft" ? d.id : null });
    setWorkspaceTab("builder");
    setBuilderTab("builder");
  };

  return (
    <div className="p-3" data-testid="templates-panel">
      <div className="flex flex-wrap items-center gap-1">
        {TEMPLATE_CATEGORIES.map((c) => (
          <button key={c} type="button" aria-pressed={category === c} onClick={() => setCategory(c)} className={cn("rounded px-2 py-1 text-xs", category === c ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground")} data-testid={`template-cat-${c.toLowerCase()}`}>
            {c}
          </button>
        ))}
        <label className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground">
          Expiry
          <select className="h-7 rounded border border-input bg-background px-2 font-mono text-xs text-foreground" value={expiry ?? ""} onChange={(e) => setChosen(e.target.value)} aria-label="Template expiry" data-testid="template-expiry">
            {list.map((e) => (
              <option key={e} value={e}>
                {fmtExpiry(e)} · {daysToExpiry(e)}d
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3" data-testid="template-cards">
        {cards.map((t) => (
          <button key={t.name} type="button" onClick={() => load(t)} className="flex gap-3 rounded border border-border p-2 text-left hover:border-foreground/40" data-testid="template-card" data-name={t.name}>
            <svg viewBox="0 0 100 40" width="88" height="36" className="shrink-0 rounded bg-surface-2" aria-hidden>
              <line x1="0" x2="100" y1="20" y2="20" stroke="hsl(var(--border))" strokeWidth="1" />
              <polyline points={templateSketch(t)} fill="none" stroke="hsl(var(--foreground))" strokeWidth="1.4" />
            </svg>
            <span className="min-w-0">
              <span className="block text-[12.5px] font-medium">{t.name}</span>
              <span className="micro block">{t.category} · {t.legs.length} {t.legs.length === 1 ? "leg" : "legs"}</span>
              <span className="mt-0.5 block text-2xs leading-snug text-muted-foreground">{t.description}</span>
            </span>
          </button>
        ))}
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-border pt-3">
        <span className="micro">My templates</span>
        {(["draft", "archived"] as const).map((k) => (
          <button key={k} type="button" aria-pressed={mine === k} onClick={() => setMine(k)} className={cn("rounded px-2 py-1 text-xs capitalize", mine === k ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground")} data-testid={`mine-${k}`}>
            {k === "draft" ? "Draft strategies" : "Archived strategies"}
          </button>
        ))}
        <span className="relative ml-auto">
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={mine === "draft" ? "Search draft strategies..." : "Search archived strategies..."} className="h-7 w-[220px] rounded border border-input bg-background px-2 pr-6 text-xs" aria-label="Search strategies" data-testid="mine-search" />
          {search ? (
            <button type="button" onClick={() => setSearch("")} className="absolute right-1 top-1/2 -translate-y-1/2 text-muted-foreground" aria-label="Clear search">
              ✕
            </button>
          ) : null}
        </span>
      </div>
      {mineLoading ? (
        <p className="py-6 text-center text-xs text-muted-foreground">Loading your strategies…</p>
      ) : myList.length === 0 ? (
        <p className="py-6 text-center text-xs text-muted-foreground" data-testid="mine-empty">
          {mine === "draft" ? "No draft strategies · Create a strategy to see it here" : "No archived strategies · Archived strategies appear here"}
        </p>
      ) : (
        <div className="mt-2 flex flex-col gap-2" data-testid="mine-list">
          {myList.map((d) => (
            <div key={d.id} className="flex flex-wrap items-center gap-2 rounded border border-border p-2 text-xs" data-testid="mine-card" data-id={d.id}>
              <span className="text-[12.5px] font-medium">{d.name}</span>
              <span className={cn("micro rounded border px-1", d.status === "draft" ? "border-border" : "border-muted-foreground/40")}>{d.status === "draft" ? "Draft" : "Archived"}</span>
              <span className="micro">{d.asset}</span>
              <span className="micro">{d.legs.length} {d.legs.length === 1 ? "leg" : "legs"}</span>
              <span className="micro">{d.templateName}</span>
              <span className="micro">{d.status === "archived" && d.closedAt ? `closed ${fmtDate(d.closedAt)}` : `created ${fmtDate(d.createdAt)}`}{d.tradingMode ? ` · was ${d.tradingMode}` : ""}</span>
              <span className="ml-auto flex gap-1">
                <Button size="sm" variant="outline" onClick={() => { loadDraft(d); toast("Loaded", { description: `${d.name} loaded into the Builder` }); }} data-testid="mine-load">
                  Load
                </Button>
                {d.status === "draft" ? (
                  <Button size="sm" onClick={() => openTrade({ strategyId: d.id })} title="Start paper trading this draft" data-testid="mine-activate">
                    Activate
                  </Button>
                ) : null}
                <Button size="sm" variant="ghost" onClick={() => openDetails(d.id)} data-testid="mine-details">
                  Details
                </Button>
                <Button size="sm" variant="ghost" onClick={() => archiveStrategy.mutate({ id: d.id, archived: d.status === "draft" }, { onSuccess: () => toast(d.status === "draft" ? "Archived" : "Restored", { description: d.name }), onError: (e) => toast.error("Could not update", { description: e.message }) })} data-testid="mine-archive">
                  {d.status === "draft" ? "Archive" : "Restore"}
                </Button>
                {confirmDelete === d.id ? (
                  <>
                    <Button size="sm" variant="ghost" className="text-loss" loading={deleteStrategy.isPending} onClick={() => deleteStrategy.mutate(d.id, { onSuccess: () => { setConfirmDelete(null); toast("Deleted", { description: d.name }); }, onError: (e) => toast.error("Could not delete", { description: e.message }) })} data-testid="mine-delete-confirm">
                      Confirm delete
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(null)}>
                      Cancel
                    </Button>
                  </>
                ) : (
                  <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(d.id)} title={`Delete ${d.name}? This action cannot be undone.`} data-testid="mine-delete">
                    Delete
                  </Button>
                )}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
