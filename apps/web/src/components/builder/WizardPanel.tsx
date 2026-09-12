"use client";
// Strategy Wizard (roadmap item 8, ADR-072; HC-TR-176..178): a view, a move and a listed expiry become the three
// defined-risk templates that profit most per unit of worst case if the thesis comes true, priced at the live chain
// on the venue ladder. "Use this" loads the legs the card shows into the Builder (the same store writes as the
// Templates tab) and opens the payoff on the thesis (target price and days). The wizard never trades; the Builder's
// ticket does.
import { Button, EmptyState, cn, toast } from "@hapiecoin/ui";
import { useMemo, useState } from "react";
import { useSettings } from "@/lib/api/queries";
import { daysToExpiry, fmtExpiry, fmtPrice, fmtStrike } from "@/lib/format";
import { useConnectionStatus } from "@/lib/gateway/hooks";
import { type MoneyFormat, USD, fmtMoney } from "@/lib/money";
import { useUiStore } from "@/lib/store";
import { rrText } from "@/lib/strategy/analysis";
import { TEMPLATES } from "@/lib/strategy/templates";
import { useWizardCandidates } from "@/lib/strategy/useWizardCandidates";
import { DEFAULT_MOVE_PCT, MAX_MOVE_PCT, type RankedCandidate, type WizardView, WIZARD_VIEWS, clampMove, eligibleTemplates, moveFromTarget, rankCandidates, tagBest, thesisPrices } from "@/lib/strategy/wizard";
import { useVenueCore } from "@/lib/useVenue";
import { lotSizeFor } from "@/lib/venue";
import { TemplateSketch, useTemplateLoader } from "./TemplatesPanel";

const ELIGIBLE = eligibleTemplates(TEMPLATES);
const SHOWN = 3;

const VIEW_HINT: Record<WizardView, string> = {
  Bullish: "Price rises by the move",
  Bearish: "Price falls by the move",
  Neutral: "Price stays within the move either side of spot",
  Volatile: "Price moves at least this much, either way",
};

/** "+3.0 %", "−3.0 %", "±2.0 %". */
export function fmtMove(view: WizardView, pct: number): string {
  const s = clampMove(pct).toFixed(1);
  return view === "Bullish" ? `+${s} %` : view === "Bearish" ? `−${s} %` : `±${s} %`;
}

/** The move field's text for a number: "3", "2.5", "1.86". */
function moveLabel(pct: number): string {
  return String(Number(pct.toFixed(2)));
}

function clock(ms: number): string {
  const d = new Date(ms);
  return [d.getHours(), d.getMinutes(), d.getSeconds()].map((n) => String(n).padStart(2, "0")).join(":");
}

export function WizardPanel() {
  const { asset, expiry, list, setChosen, rows, atm, spot, seq } = useTemplateLoader();
  const chainLots = useUiStore((s) => s.chainLots);
  const venue = useUiStore((s) => s.venue);
  const setLegs = useUiStore((s) => s.setLegs);
  const setMeta = useUiStore((s) => s.setStrategyMeta);
  const setBuilderTab = useUiStore((s) => s.setBuilderTab);
  const setTarget = useUiStore((s) => s.setTarget);
  const core = useVenueCore();
  const feed = useConnectionStatus();
  const { data: settings } = useSettings();
  const money: MoneyFormat = settings ? { currency: settings.currency === "INR" ? "INR" : "USD", rate: settings.conversionRate } : USD;
  const lotSize = lotSizeFor(venue, asset, settings);
  const [view, setView] = useState<WizardView>("Bullish");
  /** The move in percent at full precision (a typed target price lands here unrounded). */
  const [movePct, setMovePct] = useState<number>(DEFAULT_MOVE_PCT.Bullish);
  /** What the trader is typing in the move field; null while it shows the move. */
  const [moveText, setMoveText] = useState<string | null>(null);
  /** What the trader is typing in the price field; null while it follows the move. Committed on blur or Enter. */
  const [priceText, setPriceText] = useState<string | null>(null);
  const spotNum = spot === null ? null : Number(spot);
  const at = spotNum ? thesisPrices(spotNum, { view, movePct }) : null;

  const pricing = useWizardCandidates(ELIGIBLE, { venue, asset, expiry, expiries: list, rows, atm, lots: chainLots, spot: spotNum, lotSize, nowMs: Date.now(), version: seq });
  const shown = useMemo(() => (spotNum ? rankCandidates(pricing.candidates, spotNum, { view, movePct }).slice(0, SHOWN) : []), [pricing.candidates, spotNum, view, movePct]);
  const tags = useMemo(() => tagBest(shown), [shown]);
  const days = expiry ? daysToExpiry(expiry) : null;

  const pickView = (v: WizardView) => {
    setView(v);
    setMovePct(DEFAULT_MOVE_PCT[v]);
    setMoveText(null);
    setPriceText(null);
  };
  const onViewKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    e.preventDefault();
    const i = WIZARD_VIEWS.indexOf(view);
    const next = WIZARD_VIEWS[(i + (e.key === "ArrowRight" ? 1 : WIZARD_VIEWS.length - 1)) % WIZARD_VIEWS.length]!;
    pickView(next);
    document.querySelector<HTMLButtonElement>(`[data-testid="wizard-view-${next.toLowerCase()}"]`)?.focus();
  };
  const onMoveChange = (text: string) => {
    setMoveText(text);
    setPriceText(null);
    const n = Number(text);
    if (text.trim() !== "" && Number.isFinite(n)) setMovePct(clampMove(n));
  };
  /** A typed target price becomes the move; a price on the other side of spot switches the direction. */
  const commitPrice = () => {
    if (priceText === null) return;
    const price = Number(priceText);
    setPriceText(null);
    if (!spotNum || !(price > 0)) return;
    const signed = moveFromTarget(spotNum, price);
    if (signed < 0 && view === "Bullish") setView("Bearish");
    else if (signed > 0 && view === "Bearish") setView("Bullish");
    setMovePct(clampMove(signed));
    setMoveText(null);
  };
  const use = (c: RankedCandidate) => {
    if (!spotNum || !at || !expiry) return;
    // the legs the card shows, not a fresh placement (the chain may have moved since); the same writes as the Templates loader
    setLegs(asset, c.legs);
    setMeta(asset, { name: c.template.name, draftId: null });
    setBuilderTab("builder");
    // the payoff opens on the thesis: the target price (the upper edge of a band, spot for Neutral) and the days to the expiry (HC-TR-178)
    setTarget({ price: at.kind === "price" ? at.price : view === "Neutral" ? spotNum : at.hi, days: days ?? 0 });
    toast(`${c.template.name} loaded`, { description: `${c.legs.length} ${c.legs.length === 1 ? "leg" : "legs"} on ${fmtExpiry(expiry)} · ${chainLots} lots each · payoff at ${fmtMove(view, movePct)}` });
  };

  const state = spotNum === null ? "no-spot" : pricing.state === "waiting" ? "waiting" : pricing.state === "pricing" ? "pricing" : shown.length === 0 ? "no-fit" : "ready";
  const inputsOff = spotNum === null;
  const basis =
    state === "waiting" || state === "pricing"
      ? "Waiting for the chain…"
      : feed !== "open" && pricing.pricedAt !== null
        ? `Feed disconnected · figures from ${clock(pricing.pricedAt)} · ${chainLots} lots × ${lotSize ?? "—"} ${asset}`
        : `Priced at the live chain · ${chainLots} lots × ${lotSize ?? "—"} ${asset} · marks · ${expiry ? `${fmtExpiry(expiry)} (${days}d)` : "—"}${pricing.running ? " · repricing…" : ""}${state === "ready" && shown.length < SHOWN ? ` · ${shown.length} of ${SHOWN} fit this ladder` : ""}`;

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="wizard-panel" data-state={state} data-fits={shown.length} data-candidates={pricing.candidates.length} data-repricing={pricing.running || undefined}>
      <div className="border-b border-border p-3">
        <div className="flex flex-wrap items-center gap-1" role="group" aria-label="View" onKeyDown={onViewKey} data-testid="wizard-views">
          <span className="micro mr-1">View</span>
          {WIZARD_VIEWS.map((v) => (
            <button key={v} type="button" aria-pressed={view === v} disabled={inputsOff} onClick={() => pickView(v)} title={VIEW_HINT[v]} className={cn("rounded px-2 py-1 text-xs", view === v ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground", inputsOff && "opacity-50")} data-testid={`wizard-view-${v.toLowerCase()}`}>
              {v}
            </button>
          ))}
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs">
          <label className="flex items-center gap-1.5 text-muted-foreground">
            {view === "Bullish" ? "Rise" : view === "Bearish" ? "Fall" : view === "Neutral" ? "Within" : "Move"}
            <input type="number" inputMode="decimal" min={0} max={MAX_MOVE_PCT} step={0.5} value={moveText ?? moveLabel(movePct)} disabled={inputsOff} onChange={(e) => onMoveChange(e.target.value)} onBlur={() => setMoveText(null)} className="num h-7 w-16 rounded border border-input bg-background px-2 text-right font-mono text-xs text-foreground" aria-label="Move in percent" data-testid="wizard-move" />
            <span className="text-foreground">%</span>
          </label>
          {at?.kind === "price" ? (
            <label className="flex items-center gap-1.5 text-muted-foreground">
              = target
              <input
                type="number"
                inputMode="decimal"
                step="any"
                value={priceText ?? at.price.toFixed(1)}
                disabled={inputsOff}
                onChange={(e) => setPriceText(e.target.value)}
                onBlur={commitPrice}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    commitPrice();
                  }
                }}
                className="num h-7 w-[7.5rem] rounded border border-input bg-background px-2 text-right font-mono text-xs text-foreground"
                aria-label="Target price"
                title="Type a price and press Enter; a price on the other side of spot switches the view"
                data-testid="wizard-price"
              />
              <span className="text-foreground">USD</span>
            </label>
          ) : at ? (
            <span className="num text-muted-foreground" data-testid="wizard-band">
              = <span className="text-foreground">{fmtPrice(at.lo)} – {fmtPrice(at.hi)}</span> USD {view === "Neutral" ? "(stays inside)" : "(ends outside)"}
            </span>
          ) : null}
          <label className="flex items-center gap-1.5 text-muted-foreground">
            by
            <select className="h-7 rounded border border-input bg-background px-2 font-mono text-xs text-foreground" value={expiry ?? ""} disabled={inputsOff || list.length === 0} onChange={(e) => setChosen(e.target.value)} aria-label="Target expiry" data-testid="wizard-expiry">
              {list.map((e) => (
                <option key={e} value={e}>
                  {fmtExpiry(e)} · {daysToExpiry(e)}d
                </option>
              ))}
            </select>
          </label>
        </div>
        <p className="micro mt-2" data-testid="wizard-basis">{basis}</p>
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-3">
        {state === "no-spot" ? (
          <EmptyState title={`No spot yet for ${asset} on ${core.label}`} description="The wizard needs the live index to place strikes and read your move." className="py-8" />
        ) : state === "waiting" || state === "pricing" ? (
          <div className="flex flex-col gap-2" aria-busy data-testid="wizard-skeleton">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-[92px] animate-pulse rounded border border-border bg-surface-2/60" />
            ))}
          </div>
        ) : state === "no-fit" ? (
          <EmptyState
            title={`No defined-risk template fits a ${view} view at ${fmtMove(view, movePct)} by ${expiry ? fmtExpiry(expiry) : "—"}`}
            description={view === "Bullish" || view === "Bearish" ? "A fit profits at the target and more than at the opposite move. Widen the move or pick a later date, or browse every template." : "Widen the move or pick a later date, or browse every template."}
            className="py-8"
            action={
              <Button size="sm" variant="outline" onClick={() => setBuilderTab("templates")} data-testid="wizard-goto-templates">
                Browse templates
              </Button>
            }
          />
        ) : (
          <ol className="flex flex-col gap-2" data-testid="wizard-cards">
            {shown.map((c, i) => {
              const tag = tags.get(c.template.name);
              const legsLine = c.legs.map((l) => `${l.side === "buy" ? "Buy" : "Sell"} ${l.kind === "future" ? "Perp" : `${fmtStrike(l.strike)} ${l.kind === "call" ? "C" : "P"}`}${l.lots !== chainLots ? ` ×${Math.round(l.lots / chainLots)}` : ""}`).join(" · ");
              return (
                <li key={c.template.name} className="rounded border border-border p-2" data-testid="wizard-card" data-rank={i + 1} data-name={c.template.name}>
                  <div className="flex items-start gap-3">
                    <span className="num w-4 shrink-0 pt-1 text-right text-xs text-muted-foreground">{i + 1}</span>
                    <TemplateSketch tpl={c.template} />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-baseline gap-x-2">
                        <span className="truncate text-[12.5px] font-medium" title={c.template.name}>
                          {c.template.name}
                        </span>
                        {tag ? (
                          <span className="micro rounded border border-border px-1" data-testid="wizard-tag">
                            {tag}
                          </span>
                        ) : null}
                      </div>
                      <p className="micro mt-0.5" data-testid="wizard-legs">
                        {legsLine} · {expiry ? fmtExpiry(expiry) : ""}
                      </p>
                      <dl className="num mt-1.5 grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-4">
                        <div>
                          <dt className="micro">{view === "Neutral" || view === "Volatile" ? `If right on ${expiry ? fmtExpiry(expiry) : "expiry"} (least)` : `If right on ${expiry ? fmtExpiry(expiry) : "expiry"}`}</dt>
                          <dd className={cn("text-sm font-medium", c.pnlThesis > 0 ? "text-profit" : "text-loss")} data-testid="wizard-pnl">
                            {fmtMoney(c.pnlThesis, money, { signed: true })}
                          </dd>
                        </div>
                        <div>
                          <dt className="micro">POP</dt>
                          <dd data-testid="wizard-pop">{c.pop === null ? "—" : `${(c.pop * 100).toFixed(0)} %`}</dd>
                        </div>
                        <div>
                          <dt className="micro">Max loss (the most you can lose)</dt>
                          <dd className="text-loss" data-testid="wizard-maxloss">
                            {fmtMoney(c.result.maxLoss, money, { signed: true })}
                          </dd>
                        </div>
                        <div>
                          <dt className="micro">Max profit · R:R</dt>
                          <dd data-testid="wizard-maxprofit">
                            <span className="text-profit">{fmtMoney(c.result.maxProfit, money, { signed: true })}</span> · {rrText(c.result.rewardRisk, c.result.maxProfit, c.result.maxLoss)}
                          </dd>
                        </div>
                      </dl>
                    </div>
                    <Button size="sm" variant={i === 0 ? "primary" : "outline"} className="shrink-0 self-center" onClick={() => use(c)} title={`Load ${c.template.name} into the Builder and open the payoff on this thesis`} data-testid="wizard-use">
                      Use this
                    </Button>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </div>
  );
}
