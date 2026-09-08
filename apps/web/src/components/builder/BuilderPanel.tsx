"use client";
// Strategy Builder (HC-TR-001..021, 024..026, 090): the asset's legs as an editable table, the net premium
// ticket, and the actions. Legs live in the UI store (ADR-022); prices follow the feed in live mode.
import { Button, EmptyState, Input, Switch, Tabs, TabsContent, TabsList, TabsTrigger, cn, toast } from "@hapiecoin/ui";
import { black76Greeks, yearFraction } from "@hapiecoin/pricing";
import { useMemo, useState } from "react";
import { daysToExpiry, fmtExpiry, fmtIv, fmtPrice, fmtStrike } from "@/lib/format";
import { fmtMoney } from "@/lib/money";
import { settlementHourUtc } from "@/lib/pricing/legs";
import { useUiStore } from "@/lib/store";
import { marginEstimate, premiumPerUnit } from "@/lib/strategy/analysis";
import { MAX_ACTIVE_LEGS, type StrategyLeg, setLegLots, setLegPrice, stepLots, toggleLegSide } from "@/lib/strategy/legs";
import { guessTemplateName } from "@/lib/strategy/templates";
import { useStrategyAnalysis } from "@/lib/strategy/useStrategyAnalysis";
import { SaveDraftDialog } from "@/components/dialogs/SaveDraftDialog";
import { ChainPickerDialog } from "./ChainPickerDialog";
import { FutureDialog } from "./FutureDialog";
import { TemplatesPanel } from "./TemplatesPanel";

/** New strategies stop at 8 legs; editing an active one allows 10 (HC-TR-017). Phase 2 has no active strategies yet. */
export const NEW_STRATEGY_LEGS = 8;

function moneyness(leg: StrategyLeg, spot: number | null): "ATM" | "ITM" | "OTM" | "" {
  if (leg.kind === "future" || spot === null) return "";
  const k = Number(leg.strike);
  if (Math.abs(k - spot) / spot < 0.0025) return "ATM";
  const itm = leg.kind === "call" ? k < spot : k > spot;
  return itm ? "ITM" : "OTM";
}

export function BuilderPanel() {
  const a = useStrategyAnalysis();
  const meta = useUiStore((s) => s.strategy[s.asset]);
  const setMeta = useUiStore((s) => s.setStrategyMeta);
  const updateLegs = useUiStore((s) => s.updateLegs);
  const setLegs = useUiStore((s) => s.setLegs);
  const removeLeg = useUiStore((s) => s.removeLeg);
  const saveDraft = useUiStore((s) => s.saveDraft);
  const builderTab = useUiStore((s) => s.builderTab);
  const setBuilderTab = useUiStore((s) => s.setBuilderTab);
  const [saveIntent, setSaveIntent] = useState<"draft" | "trade" | null>(null);
  const [picker, setPicker] = useState(false);
  const [future, setFuture] = useState(false);
  const { asset, legs, result, spot, lotSize, money } = a;
  const remaining = Math.max(0, NEW_STRATEGY_LEGS - legs.length);
  const limitTitle = `Maximum ${NEW_STRATEGY_LEGS} legs for a new strategy`;

  const perLeg = useMemo(() => {
    const out = new Map<string, { delta: number; theta: number } | null>();
    for (const l of legs) {
      if (l.kind === "future") {
        out.set(l.id, { delta: (l.side === "buy" ? 1 : -1) * l.lots * Number(lotSize ?? 0), theta: 0 });
        continue;
      }
      const q = a.quoteFor(l);
      const iv = q?.markIv ?? l.iv;
      if (spot === null || iv === undefined || !lotSize) {
        out.set(l.id, null);
        continue;
      }
      const T = Math.max(0, yearFraction(a.nowMs, l.expiry, settlementHourUtc(asset)));
      const g = black76Greeks(spot, Number(l.strike), T, iv, l.kind === "call");
      const sign = (l.side === "buy" ? 1 : -1) * l.lots * Number(lotSize);
      out.set(l.id, Number.isFinite(g.delta) ? { delta: g.delta * sign, theta: g.theta * sign } : null);
    }
    return out;
  }, [legs, a, spot, lotSize, asset]);

  const clear = () => {
    if (legs.length === 0) {
      toast("No legs", { description: "Nothing to clear" });
      return;
    }
    setLegs(asset, []);
    toast("Cleared", { description: "All legs removed" });
  };
  const fresh = () => {
    setLegs(asset, []);
    setMeta(asset, { name: "", draftId: null, priceMode: "live" });
    toast("New strategy", { description: "Builder reset · add legs from the chain or a template" });
  };
  const onSave = (name: string, intent: "draft" | "trade") => {
    const d = saveDraft(asset, name, guessTemplateName(legs));
    toast(meta.draftId ? "Updated" : "Saved", { description: `${d.name} saved as draft` });
    if (intent === "trade") toast("Paper and live trading arrive in Phase 3", { description: "The draft is saved; choose a trading mode once trading lands." });
  };

  const net = result?.netPremium ?? null;
  const perUnit = net === null ? null : premiumPerUnit(net, legs.map((l) => l.lots), lotSize);
  const margin = result ? marginEstimate(result) : null;

  return (
    <section className="flex h-full min-h-0 flex-col" data-testid="builder-panel" data-legs={legs.length}>
      <Tabs value={builderTab} onValueChange={(v) => setBuilderTab(v === "templates" ? "templates" : "builder")} className="flex min-h-0 flex-1 flex-col gap-0">
        <TabsList className="px-2">
          <TabsTrigger value="builder" data-testid="builder-tab-builder">
            Builder
          </TabsTrigger>
          <TabsTrigger value="templates" data-testid="builder-tab-templates" data-tour="templates-tab">
            Templates
          </TabsTrigger>
          <span className="ml-auto self-center pr-2 font-mono text-3xs uppercase tracking-[0.1em] text-muted-foreground" data-testid="builder-subinfo">
            {legs.length} {legs.length === 1 ? "leg" : "legs"}
            {legs.length ? ` · ${[...new Set(legs.filter((l) => l.kind !== "future").map((l) => fmtExpiry(l.expiry)))].join(" · ")}` : ""}
          </span>
        </TabsList>
        <TabsContent value="builder" className="min-h-0 flex-1 overflow-auto p-3" data-tour="strategy-legs">
          <div className="flex flex-wrap items-center gap-2">
            <span className="micro">Builder</span>
            <Input
              value={meta.name}
              onChange={(e) => setMeta(asset, { name: e.target.value.slice(0, 80) })}
              onKeyDown={(e) => {
                if (e.key === "Enter" && legs.length) {
                  e.preventDefault();
                  if (meta.name.trim()) onSave(meta.name.trim(), "draft");
                  else setSaveIntent("draft");
                }
              }}
              placeholder="Untitled strategy"
              aria-label="Strategy name"
              className="h-8 w-[220px]"
              data-testid="strategy-name"
            />
            <span className="micro rounded border border-border px-1.5 py-0.5" data-testid="strategy-asset">
              {asset}
            </span>
            {meta.draftId ? <span className="micro rounded border border-border px-1.5 py-0.5">draft</span> : null}
            <span className="flex-1" />
            <button
              type="button"
              className={cn("micro rounded border px-1.5 py-0.5", meta.priceMode === "live" ? "border-profit text-profit" : "border-input")}
              onClick={() => setMeta(asset, { priceMode: meta.priceMode === "live" ? "custom" : "live" })}
              title={meta.priceMode === "live" ? "Live prices from Delta Exchange (click for custom prices)" : "Custom prices (click to follow the feed again)"}
              data-testid="price-mode"
            >
              {meta.priceMode === "live" ? "● Live prices" : "Custom prices"}
            </button>
            <label className="flex items-center gap-1.5 text-xs" title={meta.basket ? "Basket on: quantity and custom-price changes apply to every leg" : "Basket off: each leg keeps its own quantity and price"}>
              <Switch checked={meta.basket} onCheckedChange={(on) => setMeta(asset, { basket: on })} aria-label="Basket" data-testid="basket-switch" />
              Basket
            </label>
            <Button size="sm" variant="ghost" onClick={fresh} data-testid="builder-new">
              New
            </Button>
            <Button size="sm" variant="ghost" onClick={clear} data-testid="builder-clear">
              Clear
            </Button>
          </div>

          {legs.length === 0 ? (
            <EmptyState
              title="No legs added"
              description="Start building your strategy by adding option or futures legs"
              className="py-10"
              action={
                <div className="flex gap-2">
                  <Button size="sm" onClick={() => setPicker(true)} data-testid="builder-select-chain" data-tour="add-leg-button">
                    Select from chain
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setBuilderTab("templates")} data-testid="builder-goto-templates">
                    Browse templates
                  </Button>
                </div>
              }
            />
          ) : (
            <>
              <div className="mt-3 overflow-x-auto">
                <table className="w-full text-xs" data-testid="legs-table">
                  <thead>
                    <tr className="micro text-left">
                      <th className="py-1 pr-2">Side</th>
                      <th className="py-1 pr-2">Instrument</th>
                      <th className="py-1 pr-2 text-right">Lots</th>
                      <th className="py-1 pr-2 text-right">IV</th>
                      <th className="py-1 pr-2 text-right" title={`USD per ${asset} · ${meta.priceMode === "live" ? "live mark" : "custom"}`}>
                        Price
                      </th>
                      <th className="py-1 pr-2 text-right" title="Position delta (lots × lot size)">
                        Δ
                      </th>
                      <th className="py-1 pr-2 text-right" title="Position theta per day">
                        Θ/d
                      </th>
                      <th className="py-1" />
                    </tr>
                  </thead>
                  <tbody>
                    {legs.map((l) => {
                      const g = perLeg.get(l.id) ?? null;
                      const q = a.quoteFor(l);
                      const mny = moneyness(l, spot);
                      return (
                        <tr key={l.id} className="border-t border-border" data-testid="leg-row" data-leg-id={l.id} data-side={l.side}>
                          <td className="py-1.5 pr-2">
                            <button
                              type="button"
                              onClick={() => updateLegs(asset, (legs) => toggleLegSide(legs, l.id))}
                              className={cn("rounded-[2px] border px-1.5 py-0.5 font-mono text-3xs font-bold uppercase", l.side === "buy" ? "border-buy text-buy" : "border-sell text-sell")}
                              title="Click to toggle Buy / Sell"
                              data-testid="leg-side"
                            >
                              {l.side}
                            </button>
                          </td>
                          <td className="py-1.5 pr-2">
                            <div className="num font-medium">{l.kind === "future" ? l.symbol : `${fmtStrike(l.strike)} ${l.kind === "call" ? "C" : "P"}`}</div>
                            <div className="micro">
                              {l.kind === "future" ? "perp future" : `${fmtExpiry(l.expiry)} · ${daysToExpiry(l.expiry)}d`}
                              {mny ? ` · ${mny}` : ""}
                              {l.kind !== "future" && !q ? " · no quote" : ""}
                            </div>
                          </td>
                          <td className="py-1.5 pr-2 text-right">
                            <span className="inline-flex h-6 items-center rounded-[2px] border border-input font-mono text-xs">
                              <button type="button" className="px-1.5 text-muted-foreground hover:text-foreground" aria-label="Fewer lots" onClick={() => updateLegs(asset, (legs) => setLegLots(legs, l.id, stepLots(l.lots, -1), meta.basket))} data-testid="leg-lots-down">
                                −
                              </button>
                              <input
                                type="number"
                                min={1}
                                step={1}
                                value={l.lots}
                                onChange={(e) => updateLegs(asset, (legs) => setLegLots(legs, l.id, Number(e.target.value), meta.basket))}
                                className="w-12 bg-transparent text-center outline-none"
                                aria-label="Lots"
                                data-testid="leg-lots"
                              />
                              <button type="button" className="px-1.5 text-muted-foreground hover:text-foreground" aria-label="More lots" onClick={() => updateLegs(asset, (legs) => setLegLots(legs, l.id, stepLots(l.lots, 1), meta.basket))} data-testid="leg-lots-up">
                                +
                              </button>
                            </span>
                          </td>
                          <td className="num py-1.5 pr-2 text-right">{l.kind === "future" ? "—" : fmtIv(q?.markIv ?? l.iv)}</td>
                          <td className="num py-1.5 pr-2 text-right">
                            {meta.priceMode === "custom" && l.kind !== "future" ? (
                              <input
                                type="number"
                                step="0.1"
                                min={0}
                                value={l.price}
                                onChange={(e) => updateLegs(asset, (legs) => setLegPrice(legs, l.id, e.target.value, meta.basket))}
                                className="w-20 rounded border border-input bg-transparent px-1 text-right outline-none"
                                aria-label="Custom price"
                                data-testid="leg-price-input"
                              />
                            ) : (
                              <span title={meta.priceMode === "live" ? "Live price from Delta Exchange" : "Stored price"} data-testid="leg-price">
                                {fmtPrice(a.priceFor(l), 1)}
                              </span>
                            )}
                          </td>
                          <td className={cn("num py-1.5 pr-2 text-right", g ? (g.delta >= 0 ? "text-profit" : "text-loss") : "text-muted-foreground")}>{g ? g.delta.toFixed(4) : "—"}</td>
                          <td className={cn("num py-1.5 pr-2 text-right", g ? (g.theta >= 0 ? "text-profit" : "text-loss") : "text-muted-foreground")}>{g ? fmtMoney(g.theta, money, { signed: true }) : "—"}</td>
                          <td className="py-1.5 text-right">
                            <button type="button" className="text-muted-foreground hover:text-loss" title="Delete this leg" aria-label="Delete this leg" onClick={() => removeLeg(asset, l.id)} data-testid="leg-delete">
                              ✕
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={() => setPicker(true)} disabled={remaining === 0} title={remaining ? "Select option from live options chain" : limitTitle} data-testid="builder-select-chain" data-tour="add-leg-button">
                  Select from chain
                </Button>
                <Button size="sm" variant="outline" onClick={() => setFuture(true)} disabled={remaining === 0} title={remaining ? "Add a perpetual futures contract" : limitTitle} data-testid="builder-add-future">
                  + Future
                </Button>
                <span className="ml-auto self-center font-mono text-3xs text-muted-foreground" data-testid="builder-remaining">
                  {remaining} of {NEW_STRATEGY_LEGS} slots left · max {MAX_ACTIVE_LEGS} active
                </span>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-3 rounded border border-border p-3 sm:grid-cols-4" data-testid="builder-ticket">
                <div>
                  <div className="micro">Premium at mark</div>
                  <div className={cn("num text-[15px] font-medium", net !== null && net >= 0 ? "text-profit" : "")} data-testid="ticket-net">
                    {net === null ? "—" : fmtMoney(net, money, { signed: true })}
                  </div>
                  <div className="micro">{perUnit === null ? "" : `${Math.abs(perUnit).toFixed(1)} / ${asset} · ${net !== null && net >= 0 ? "credit" : "debit"}`}</div>
                </div>
                <div>
                  <div className="micro">Margin est.</div>
                  <div className="num text-[15px] font-medium" data-testid="ticket-margin">
                    {margin === null ? "—" : fmtMoney(margin, money)}
                  </div>
                  <div className="micro">{margin === null ? (result ? "undefined risk · exchange est. in Phase 3" : "") : "worst expiry loss"}</div>
                </div>
                <div>
                  <div className="micro">P&amp;L at target</div>
                  <div className={cn("num text-[15px] font-medium", result ? (result.target.pnlTarget >= 0 ? "text-profit" : "text-loss") : "")} data-testid="ticket-target">
                    {result ? fmtMoney(result.target.pnlTarget, money, { signed: true }) : "—"}
                  </div>
                  <div className="micro">{result ? `${fmtStrike(String(a.targetPrice))} · ${a.targetDays === 0 ? "today" : `+${a.targetDays}d`}` : ""}</div>
                </div>
                <div>
                  <div className="micro">POP · R:R</div>
                  <div className="num text-[15px] font-medium" data-testid="ticket-pop">
                    {result ? `${Number.isFinite(result.pop) ? `${(result.pop * 100).toFixed(0)}%` : "—"} · ${Number.isFinite(result.rewardRisk) ? result.rewardRisk.toFixed(2) : "∞"}` : "—"}
                  </div>
                  <div className="micro">Lot = {lotSize ?? "…"} {asset}</div>
                </div>
              </div>
            </>
          )}
          <div className="mt-3 flex gap-2">
            <Button size="sm" variant="outline" disabled={legs.length === 0} onClick={() => (meta.name.trim() && meta.draftId ? onSave(meta.name.trim(), "draft") : setSaveIntent("draft"))} data-testid="builder-save">
              {meta.draftId ? "Update" : "Save draft"}
            </Button>
            <Button size="sm" variant="ghost" disabled={legs.length === 0} onClick={() => setSaveIntent("trade")} title="Name it, then choose paper or live (Phase 3)" data-testid="builder-save-trade">
              Save &amp; trade
            </Button>
          </div>
        </TabsContent>
        <TabsContent value="templates" className="min-h-0 flex-1 overflow-auto">
          <TemplatesPanel />
        </TabsContent>
      </Tabs>
      <SaveDraftDialog open={saveIntent !== null} onOpenChange={(o) => !o && setSaveIntent(null)} initialName={meta.name} intent={saveIntent ?? "draft"} onSave={(n) => onSave(n, saveIntent ?? "draft")} />
      <ChainPickerDialog open={picker} onOpenChange={setPicker} remaining={remaining} />
      <FutureDialog open={future} onOpenChange={setFuture} />
    </section>
  );
}
