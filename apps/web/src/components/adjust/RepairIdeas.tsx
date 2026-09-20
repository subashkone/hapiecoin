"use client";
// Repair ideas (ADR-094; HC-TR-194, HC-TR-195): a diagnosis of the open position, then the catalogue of standard
// repairs, each priced with the engine before → after and ordered by the goal the trader picks. A click loads the idea
// into the working change, where it is reviewed like any other; nothing here sends an order. An adjustment swaps one
// risk for another, so every idea says what it gives up and the tags are facts ("defines your risk"), never "best".
import { Button, cn } from "@hapiecoin/ui";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useChain } from "@/lib/gateway/hooks";
import { fmtExpiry, fmtStrike } from "@/lib/format";
import { fmtMoney, type MoneyFormat } from "@/lib/money";
import { effects, matchingPlan } from "@/lib/adjust/model";
import { REPAIR_GOALS, type RepairContext, type RepairFigures, type RepairGoal, type RepairIdea, type RepairRow, defaultGoal, diagnose, diagnosisLine, draftSignature, orderIdeas, repairIdeas, tagIdeas } from "@/lib/adjust/repairs";
import type { AdjustWorkbench } from "@/lib/adjust/useAdjustWorkbench";
import { type DraftMarket, type PlanFigures, useDraftFigures } from "./PlansBar";

/** The ideas re-build and re-price from the market at most this often: they are a menu, not a ticker, and each one is an engine run. */
export const IDEAS_REFRESH_MS = 2_000;
/** The list re-orders once the figures have been quiet for this long, so cards do not jump while results arrive one by one. */
export const RANK_SETTLE_MS = 400;

const figureKey = (f: PlanFigures | null): string => (f ? [f.maxLoss, f.maxProfit, f.breakevens.join("/"), f.pop, f.delta, f.cash].map(String).join("|") : "");

/** A value that follows `live` at once when `structure` changes and otherwise at most every `ms`. */
export function useSettled<T>(live: T, structure: string, ms: number): T {
  const [value, setValue] = useState(live);
  const latest = useRef(live);
  latest.current = live;
  const shown = useRef(structure);
  useEffect(() => {
    if (shown.current !== structure) {
      shown.current = structure;
      setValue(latest.current);
    }
  }, [structure]);
  useEffect(() => {
    const t = setInterval(() => setValue((v) => (v === latest.current ? v : latest.current)), ms);
    return () => clearInterval(t);
  }, [ms]);
  return value;
}

const money$ = (v: number | undefined, money: MoneyFormat): string => (v === undefined ? "—" : fmtMoney(v, money, { unlimited: "Unlimited" }));
const be = (xs: readonly number[]): string => (xs.length ? xs.map((x) => fmtStrike(String(Math.round(x)))).join(" / ") : "none");
const pct = (p: number): string => (Number.isFinite(p) ? `${(p * 100).toFixed(0)}%` : "—");
const dlt = (d: number): string => (Number.isFinite(d) ? `${d >= 0 ? "+" : "−"}${Math.abs(d).toFixed(3)}` : "—");
/** Green when the figure improved, red when it got worse, no colour when it is equal or either side is unknown. */
const better = (a: number, b: number): "profit" | "loss" | undefined => (Number.isNaN(a) || Number.isNaN(b) || a === b ? undefined : b > a ? "profit" : "loss");
const floor = (v: number): number => (Number.isFinite(v) ? v : -Number.MAX_VALUE);
const ceiling = (v: number): number => (Number.isFinite(v) ? v : Number.MAX_VALUE);

function Metric({ label, hint, before, after, tone }: { label: string; hint?: string | undefined; before: string; after: string; tone?: "profit" | "loss" | undefined }) {
  const same = before === after;
  return (
    <span className="whitespace-nowrap" title={hint}>
      <span className="text-muted-foreground">{label}</span>{" "}
      {same ? <b className="num font-normal text-muted-foreground">{after}</b> : <><span className="num text-muted-foreground">{before}</span> → <b className={cn("num", tone === "profit" && "text-profit", tone === "loss" && "text-loss")}>{after}</b></>}
    </span>
  );
}

function IdeaCard({ w, idea, market, before, tags, replaces, working, onFigures }: { w: AdjustWorkbench; idea: RepairIdea; market: DraftMarket; before: PlanFigures | null; tags: readonly string[]; replaces: boolean; /** the working change's signature: an edit disarms the button */ working: string; onFigures: (kind: RepairIdea["kind"], f: PlanFigures | null) => void }) {
  const f = useDraftFigures(w, idea.draft, market);
  const key = figureKey(f);
  const report = useRef(onFigures);
  report.current = onFigures;
  const held = useRef(f);
  held.current = f;
  // the figures go up for the ordering; keyed on their values so a re-render with equal numbers reports nothing
  useEffect(() => report.current(idea.kind, held.current), [idea.kind, key]);
  // Load asks once before it replaces a change the trader has built by hand (one that is no idea and no kept plan)
  const [armed, setArmed] = useState(false);
  useEffect(() => setArmed(false), [replaces, working]);
  const money = w.a.money;
  const asset = w.strategy.asset;
  const orders = useMemo(() => (idea.draft ? effects(idea.draft, w.open).length : 0), [idea.draft, w.open]);
  const state = idea.draft ? (f ? "ready" : "pending") : "unavailable";
  const load = () => {
    if (!idea.draft) return;
    if (replaces && !armed) return setArmed(true);
    setArmed(false);
    w.applyDraft(idea.draft);
  };
  return (
    <li className={cn("rounded border px-2 py-1.5", idea.draft ? "border-border" : "border-border/50 text-muted-foreground")} data-testid="repair-idea" data-kind={idea.kind} data-state={state} data-cash={f ? f.cash : undefined} data-max-loss={f ? f.maxLoss : undefined}>
      <div className="flex flex-wrap items-center gap-1.5">
        <b className="text-xs">{idea.label}</b>
        {tags.map((t) => (
          <span key={t} className="micro rounded border border-profit/50 px-1 text-profit" data-testid="repair-tag">
            {t}
          </span>
        ))}
        <Button size="sm" variant="outline" className={cn("ml-auto", armed && "border-warning text-warning")} disabled={!idea.draft} onClick={load} aria-label={armed ? `Replace the change you are building with: ${idea.label}` : `Load: ${idea.label}`} title={idea.draft ? (armed ? "This replaces the change you are building. Click again to replace it, or keep it as a plan first." : "Load this idea into the change below; nothing is sent until you review it") : idea.note} data-testid="repair-load" data-armed={armed}>
          {armed ? "Replace my change?" : "Load"}
        </Button>
      </div>
      {idea.draft ? (
        <>
          <p className="mt-0.5 text-2xs" data-testid="repair-what">{idea.what}</p>
          <p className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-2xs" data-testid="repair-figures">
            {f && before ? (
              <>
                <Metric label="Max loss" before={money$(before.maxLoss, money)} after={money$(f.maxLoss, money)} tone={better(floor(before.maxLoss), floor(f.maxLoss))} />
                <Metric label="Max profit" before={money$(before.maxProfit, money)} after={money$(f.maxProfit, money)} tone={better(ceiling(before.maxProfit), ceiling(f.maxProfit))} />
                <Metric label="Break-evens" hint={`${asset} price in USD where the whole trade makes nothing at the valuation date`} before={be(before.breakevens)} after={be(f.breakevens)} />
                <Metric label="POP" hint="Probability of profit at the valuation date" before={pct(before.pop)} after={pct(f.pop)} tone={better(before.pop, f.pop)} />
                <Metric label={`Δ ${asset}`} hint={`Net delta of the whole position, in ${asset}`} before={dlt(before.delta)} after={dlt(f.delta)} />
                <span className="whitespace-nowrap" title="Premium this idea receives (+) or pays (−) now, at the mark, before fees">
                  <span className="text-muted-foreground">Cash now</span> <b className={cn("num", f.cash >= 0 ? "text-profit" : "text-loss")} data-testid="repair-cash">{fmtMoney(f.cash, money, { signed: true })}</b>
                </span>
                <span className="whitespace-nowrap text-muted-foreground">{orders} {orders === 1 ? "order" : "orders"}</span>
              </>
            ) : (
              <span className="text-muted-foreground">pricing…</span>
            )}
          </p>
          <p className="mt-0.5 text-2xs text-muted-foreground" data-testid="repair-gives-up">
            You give up: {idea.givesUp}
            {idea.note ? <span className="text-warning" data-testid="repair-caveat"> · {idea.note}</span> : null}
          </p>
        </>
      ) : (
        <p className="mt-0.5 text-2xs" data-testid="repair-note">Not available: {idea.note}</p>
      )}
    </li>
  );
}

type FiguresByKind = Partial<Record<RepairIdea["kind"], PlanFigures | null>>;

export function RepairIdeas({ w, expiry, rows, expiries }: { w: AdjustWorkbench; expiry: string | null; rows: readonly RepairRow[]; expiries: readonly string[] }) {
  const [open, setOpen] = useState(true);
  const [picked, setPicked] = useState<RepairGoal | null>(null);
  const [figures, setFigures] = useState<FiguresByKind>({});
  const bodyId = useId();
  // the ideas are for the POSITION, not for whatever the chain below happens to show: the shown expiry when option legs
  // are held on it, else the nearest expiry that holds some (the chain can be on another expiry while the trader looks
  // around); that expiry's ladder is then read here, on the strategy's own venue
  const venue = w.strategy.venue;
  const heldExpiries = useMemo(() => [...new Set(w.open.filter((l) => l.kind !== "future").map((l) => l.expiry))].sort(), [w.open]);
  const shownExpiry = expiry;
  const ideasExpiry = shownExpiry !== null && heldExpiries.includes(shownExpiry) ? shownExpiry : (heldExpiries[0] ?? shownExpiry);
  const own = useChain(w.strategy.asset, ideasExpiry !== null && ideasExpiry !== shownExpiry ? ideasExpiry : null, venue);
  const ladder: readonly RepairRow[] = ideasExpiry === shownExpiry ? rows : (own?.rows ?? []);
  const nextExpiry = useMemo(() => (ideasExpiry ? (expiries[expiries.indexOf(ideasExpiry) + 1] ?? null) : null), [ideasExpiry, expiries]);
  const next = useChain(w.strategy.asset, open ? nextExpiry : null, venue);
  const em = w.a.before?.expectedMove ?? w.a.result?.expectedMove;
  const liveCtx = useMemo<RepairContext>(() => ({ open: w.open, asset: w.strategy.asset, expiry: ideasExpiry, rows: ladder, nextExpiry, nextRows: next?.rows ?? [], spot: w.a.spot, expectedMove: em !== undefined && Number.isFinite(em) && em > 0 ? em : null }), [w.open, w.strategy.asset, ideasExpiry, ladder, nextExpiry, next?.rows, w.a.spot, em]);
  // what changes the menu itself (the expiry, the legs, a chain arriving) applies at once; the market settles on a timer,
  // and the ideas are both built and priced on that settled copy, so a spot tick re-runs nothing
  const structure = `${ideasExpiry}|${nextExpiry}|${ladder.length > 0}|${(next?.rows.length ?? 0) > 0}|${liveCtx.spot === null}|${liveCtx.expectedMove === null}|${w.open.map((l) => `${l.id}:${l.lots}`).join(",")}`;
  const liveMarket: DraftMarket = { spot: w.a.spot, spotText: w.a.spotText, nowMs: w.a.nowMs, markOf: w.a.markOf, quoteFor: w.a.quoteFor };
  const { ctx, market } = useSettled({ ctx: liveCtx, market: liveMarket }, structure, IDEAS_REFRESH_MS);
  const dx = useMemo(() => diagnose(ctx), [ctx]);
  // the ideas start from the position as it stands, never from the change on the ticket
  // (keyed on what an idea keeps from the draft: the strategy, the valuation date and the saved plans; the working edits are dropped by design)
  const ideas = useMemo(() => repairIdeas(w.draft, ctx), [w.draft.strategyId, w.draft.valuation, w.draft.plans, ctx]);
  const blankDraft = useMemo(() => ({ ...w.draft, lotsAfter: {}, picks: [] }), [w.draft.strategyId, w.draft.valuation, w.draft.plans]);
  const before = useDraftFigures(w, blankDraft, market);
  const onFigures = (kind: RepairIdea["kind"], f: PlanFigures | null) => setFigures((prev) => (figureKey(prev[kind] ?? null) === figureKey(f) && (kind in prev) ? prev : { ...prev, [kind]: f }));
  // the order and the tags follow a copy of the figures taken once they have been quiet for a moment: results arrive
  // one by one, and a card must not move under the pointer each time; a goal click re-orders that copy at once
  const beforeKey = figureKey(before);
  const latestBefore = useRef(before);
  latestBefore.current = before;
  const [ranked, setRanked] = useState<{ figures: FiguresByKind; before: PlanFigures | null }>({ figures: {}, before: null });
  useEffect(() => {
    const t = setTimeout(() => setRanked({ figures, before: latestBefore.current }), RANK_SETTLE_MS);
    return () => clearTimeout(t);
  }, [figures, beforeKey]);
  const list: (RepairFigures | null)[] = ideas.map((i) => (i.draft ? (ranked.figures[i.kind] ?? null) : null));
  const goal = picked ?? defaultGoal(dx, before);
  const order = orderIdeas(list, goal);
  const tags = tagIdeas(list, ranked.before);
  const ready = ideas.filter((i) => i.draft).length;
  // a working change that is one of the ideas, or a copy of a kept plan, can be replaced without a question: nothing is lost
  const mine = draftSignature(w.draft);
  const replaces = !w.empty && !matchingPlan(w.draft, w.open) && !ideas.some((i) => i.draft && draftSignature(i.draft) === mine);
  return (
    <section className="mb-2 rounded border border-border p-2" data-testid="repair-ideas" data-goal={goal} data-open={open} data-count={ready} data-expiry={ideasExpiry ?? ""} data-before-max-loss={before ? before.maxLoss : undefined}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="micro">Repair ideas</span>
        {ideasExpiry ? <span className="text-2xs text-muted-foreground" data-testid="repair-expiry">for your {fmtExpiry(ideasExpiry)} legs{shownExpiry && shownExpiry !== ideasExpiry ? ` (the chain below shows ${fmtExpiry(shownExpiry)})` : ""}</span> : null}
        {open && ideas.length && ladder.length ? <span className="text-2xs text-muted-foreground">{ready} of {ideas.length} can be built from the listed strikes</span> : null}
        <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-controls={bodyId} className="ml-auto rounded border border-border px-1.5 py-0.5 text-2xs text-muted-foreground hover:text-foreground focus-visible:outline focus-visible:outline-1 focus-visible:outline-ring" data-testid="repair-toggle">
          {open ? "Hide" : "Show"}
        </button>
      </div>
      <p className="mt-1 text-2xs" data-testid="repair-diagnosis" data-pressure={dx.underPressure}>
        {diagnosisLine(dx)}
        {before && !Number.isFinite(before.maxLoss) ? <b className="text-loss"> · the loss has no limit</b> : null}
      </p>
      <div id={bodyId} hidden={!open}>
        {open && ideas.length && ladder.length === 0 ? <p className="mt-1.5 text-2xs text-muted-foreground" data-testid="repair-loading">Loading the {ideasExpiry ? fmtExpiry(ideasExpiry) : ""} strikes…</p> : null}
        {open && ideas.length && ladder.length ? (
          <>
            <div className="mt-1.5 flex flex-wrap items-center gap-1" role="group" aria-label="Order the ideas by">
              <span className="micro mr-1">Order by</span>
              {REPAIR_GOALS.map((g) => (
                <button key={g.id} type="button" aria-pressed={goal === g.id} onClick={() => setPicked(g.id)} className={cn("rounded border px-1.5 py-0.5 text-2xs focus-visible:outline focus-visible:outline-1 focus-visible:outline-ring", goal === g.id ? "border-foreground/50 bg-muted text-foreground" : "border-border text-muted-foreground hover:text-foreground")} data-testid={`repair-goal-${g.id}`}>
                  {g.label}
                </button>
              ))}
            </div>
            <ol className="mt-1.5 flex flex-col gap-1.5" data-testid="repair-list">
              {order.map((i) => {
                const idea = ideas[i];
                return idea ? <IdeaCard key={idea.kind} w={w} idea={idea} market={market} before={before} tags={tags[i] ?? []} replaces={replaces} working={mine} onFigures={onFigures} /> : null;
              })}
            </ol>
            <p className="mt-1 text-2xs text-muted-foreground" data-testid="repair-basis">Before → after compares the whole trade from entry: an idea that closes a leg carries the profit or loss that exit locks in, at the mark. Fees and slippage are not included. An adjustment swaps one risk for another: compare what each idea gives up. Loading an idea only fills the change below; nothing is sent until you review it.</p>
          </>
        ) : null}
      </div>
    </section>
  );
}
