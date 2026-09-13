"use client";
// Trade flow orchestrator (HC-TR-022, 050..057, 046): Select Trading Mode → Trade Preview → start. Trades
// either the Builder legs (saving them as a draft first) or an existing draft ("Activate"). Also imports the
// browser-local drafts saved before Phase 3 once (ADR-024).
import { emitTour } from "@/lib/tour";
import { type Strategy, toDecimal } from "@hapiecoin/schema";
import { toast } from "@hapiecoin/ui";
import { useEffect, useMemo, useRef, useState } from "react";
import { useBrokers, useCredential, useSettings } from "@/lib/api/queries";
import { type MindfulPauseInfo, mindfulFor, refusedMindful, serverMindful } from "@/lib/strategy/mindful";
import { useConnectionStatus } from "@/lib/gateway/hooks";
import { useLivePositions } from "@/lib/api/live";
import { useCreateStrategy, usePatchStrategy, useStartStrategy, useStrategies } from "@/lib/api/strategies";
import { newIdempotencyKey, useLivePlace, useLivePreview } from "@/lib/api/live";
import { handleUpgradeRequired } from "@/lib/api/upgrade";
import type { LivePreview } from "@hapiecoin/schema";
import { useUiStore } from "@/lib/store";
import { type FeeEstimate, localLegToInput, openLegs } from "@/lib/strategy/paper";
import { guessTemplateName } from "@/lib/strategy/templates";
import type { PaperBook } from "@/lib/strategy/usePaper";
import { useStrategyAnalysis } from "@/lib/strategy/useStrategyAnalysis";
import { SaveDraftDialog } from "@/components/dialogs/SaveDraftDialog";
import { suggestStrategyName } from "@/lib/strategy/naming";
import { isTemplateName } from "@/lib/strategy/templates";
import { type TradeLegView, TradeModeDialog, netPremium } from "./TradeModeDialog";
import { TradePreviewDialog, legLabel } from "./TradePreviewDialog";
import { overlapsFor } from "@/lib/strategy/overlap";
import { DEFAULT_VENUE, getVenueCore } from "@hapiecoin/venues/core";
import { dataOnly, dataOnlyNote } from "@/lib/venue";
import { useVenueId } from "@/lib/useVenue";

/** One-time import of the Phase 2 browser drafts into the API (ADR-024). */
export function useImportLegacyDrafts() {
  const drafts = useUiStore((s) => s.drafts);
  const imported = useUiStore((s) => s.draftsImported);
  const mark = useUiStore((s) => s.markDraftsImported);
  const create = useCreateStrategy();
  const ran = useRef(false);
  useEffect(() => {
    if (imported || ran.current) return;
    ran.current = true;
    if (drafts.length === 0) {
      mark();
      return;
    }
    void (async () => {
      let n = 0;
      for (const d of drafts) {
        if (d.legs.length === 0) continue;
        try {
          await create.mutateAsync({ name: d.name, asset: d.asset, venue: DEFAULT_VENUE, templateName: d.templateName, legs: d.legs.slice(0, 8).map(localLegToInput) }); // Phase 2 browser drafts predate the venue choice: Delta India
          n += 1;
        } catch {
          /* keep going: a failed row is not worth losing the rest */
        }
      }
      mark();
      if (n) toast("Drafts imported", { description: `${n} saved ${n === 1 ? "strategy" : "strategies"} moved to your account` });
    })();
  }, [drafts, imported, mark, create]);
}

export function TradeFlow({ book }: { book: PaperBook }) {
  useImportLegacyDrafts();
  const flow = useUiStore((s) => s.tradeFlow);
  const closeTrade = useUiStore((s) => s.closeTrade);
  const followStrategy = useUiStore((s) => s.followStrategy);
  const openRules = useUiStore((s) => s.openRules);
  const setLegs = useUiStore((s) => s.setLegs);
  const setMeta = useUiStore((s) => s.setStrategyMeta);
  const setWorkspaceTab = useUiStore((s) => s.setWorkspaceTab);
  const builder = useStrategyAnalysis("builder");
  const meta = useUiStore((s) => s.strategy[s.asset]);
  const { data: strategies } = useStrategies();
  const { data: brokers } = useBrokers();
  const { data: credential } = useCredential();
  const { data: settings } = useSettings();
  const feedLive = useConnectionStatus() === "open";
  const workspaceVenue = useVenueId();
  const create = useCreateStrategy();
  const patch = usePatchStrategy();
  const start = useStartStrategy();
  const livePreview = useLivePreview();
  const livePlace = useLivePlace();
  const [venue, setVenue] = useState<LivePreview | null>(null);
  const [idemKey, setIdemKey] = useState("");
  const [step, setStep] = useState<"mode" | "preview" | "name">("mode");
  const [mode, setMode] = useState<"paper" | "live">("paper");
  const [brokerId, setBrokerId] = useState("");
  const [accountId, setAccountId] = useState<string | null>(null);
  const [fees, setFees] = useState<FeeEstimate>({ fee: 0, gst: 0, total: 0, per: [] });
  const [busy, setBusy] = useState(false);
  // HC-TR-182: the Mindful pause is decided once, when the live preview opens, and holds for this flow
  const [mindful, setMindful] = useState<MindfulPauseInfo | null>(null);
  const [pauseRun, setPauseRun] = useState(0); // bumped by a refusal so the countdown restarts even at the same seconds
  useEffect(() => {
    if (flow) {
      setStep("mode");
      setMode(flow.mode ?? "paper");
      setVenue(null);
      setMindful(null);
      setIdemKey(newIdempotencyKey());
    }
  }, [flow]);

  const target: Strategy | null = flow?.strategyId ? strategies?.find((s) => s.id === flow.strategyId) ?? null : null;
  const fromBuilder = flow !== null && flow.strategyId === null;
  const asset = target ? target.asset : builder.asset;
  // the trade runs on the strategy's venue, else the workspace venue the Builder legs were built on (ADR-069)
  const tradeVenue = target ? target.venue : workspaceVenue;
  const venueBrokers = useMemo(() => (brokers ?? []).filter((b) => b.venue === tradeVenue), [brokers, tradeVenue]);
  const legs: TradeLegView[] = useMemo(() => {
    if (target) return openLegs(target).map((l) => ({ id: l.id, kind: l.kind, side: l.side, strike: l.strike, expiry: l.expiry, symbol: l.symbol, lots: l.lots, price: book.priceOf(target, l)?.toString() ?? l.price }));
    return builder.legs.map((l) => ({ id: l.id, kind: l.kind, side: l.side, strike: l.strike, expiry: l.expiry, symbol: l.symbol, lots: l.lots, price: builder.priceFor(l) }));
  }, [target, builder, book]);
  // HC-TR-159: contracts other open strategies of this mode already hold; the exchange nets them into one position
  const overlaps = useMemo(() => overlapsFor(legs.map((l) => ({ symbol: l.symbol, side: l.side, lots: l.lots, label: legLabel(l) })), strategies ?? [], mode, target?.id ?? null), [legs, strategies, mode, target]);
  // ADR-059: the name box arrives filled from the legs and the clock, read when the dialog opens
  const suggest = () => suggestStrategyName({ asset: builder.asset, templateName: guessTemplateName(builder.legs), legs: builder.legs, taken: (strategies ?? []).map((x) => x.name) });
  // capital on the preview (HC-TR-158): the exchange wallet, read only while a trade flow is open on a connected exchange
  const wallet = useLivePositions(flow !== null && (credential?.items.length ?? 0) > 0 && brokerId ? brokerId : null, true, accountId);
  const available = useMemo(() => {
    const rows = wallet.data?.balances ?? [];
    const row = ["USD", "USDT", "INR"].map((a) => rows.find((b) => b.asset === a)).find((b) => b !== undefined) ?? rows[0];
    return row ? { amount: Number(row.availableBalance), asset: row.asset } : null;
  }, [wallet.data]);
  if (!flow) return null;
  if (legs.length === 0) {
    toast.error("No legs", { description: "Add at least one leg to trade" });
    closeTrade();
    return null;
  }
  const lotSize = target ? book.lotSizeOf(target.asset, target.venue) : builder.lotSize ?? book.lotSizeOf(asset, workspaceVenue);
  const spot = target ? book.spotOf(target.asset, target.venue) : builder.spot;
  const money = book.money;
  const broker = brokers?.find((b) => b.id === brokerId);
  const title = target ? `“${target.name}”` : "this strategy";
  const connected = (credential?.items.length ?? 0) > 0;
  const customPrices = fromBuilder && meta.priceMode === "custom";
  const maxLoss = fromBuilder && builder.result && Number.isFinite(builder.result.maxLoss) ? builder.result.maxLoss : null;

  const entries = () => Object.fromEntries(legs.map((l) => [l.id, l.price]));
  const finish = (s: Strategy) => {
    if (fromBuilder) {
      setLegs(builder.asset, []);
      setMeta(builder.asset, { name: "", draftId: null });
    }
    closeTrade();
    setWorkspaceTab(s.status === "live" ? "live" : "paper");
    if (!useUiStore.getState().adjust) followStrategy(s.id); // the pane follows the new position instead of an empty Builder (HC-TR-143); an open workbench keeps its strategy
    // the Protect step (HC-TR-167): a trade from the Builder is offered its stop and target right away; a live trade
    // with refused legs is not (Retry first)
    if (fromBuilder && useUiStore.getState().protectPrompt && (s.status === "paper" || (s.status === "live" && !s.orders.some((o) => o.state === "failed")))) openRules(s.id, { afterTrade: true });
    if (s.status === "live") {
      const failed = s.orders.filter((o) => o.state === "failed").length;
      if (failed) toast.error("Some orders were refused", { description: `${s.name} · ${failed} ${failed === 1 ? "order" : "orders"} failed · use Retry on the Live tab` });
      else toast.success("Live Orders Placed", { description: `${s.name} · ${s.orders.length} ${s.orders.length === 1 ? "order" : "orders"} on ${broker?.name ?? "Delta Exchange"}` });
      return;
    }
    toast.success(target ? "Paper Trading Started" : "Paper Trade Started", { description: target ? `Trading ${s.name} on ${broker?.name ?? "Delta Exchange"}` : s.name });
    emitTour("paper-started"); // the tour's "review and start" step advances (HC-SH-073)
  };
  /** Live: the draft must exist on the server before the venue preview; returns its id. */
  const ensureDraft = async (name?: string): Promise<string> => {
    if (target) return target.id;
    const finalName = (name ?? meta.name).trim();
    const body = { name: finalName, asset: builder.asset, venue: workspaceVenue, templateName: guessTemplateName(builder.legs), legs: builder.legs.map((l) => ({ ...localLegToInput(l), price: toDecimal(Number(builder.priceFor(l)), 4) })) };
    if (meta.draftId) {
      await patch.mutateAsync({ id: meta.draftId, body: { name: body.name, templateName: body.templateName, legs: body.legs } });
      return meta.draftId;
    }
    const created = await create.mutateAsync(body);
    setMeta(builder.asset, { draftId: created.id, name: created.name });
    return created.id;
  };
  /** `confirm` is the word typed in the preview (live); the API refuses a live placement without it (HC-TR-186). */
  const trade = async (name?: string, confirm = "") => {
    setBusy(true);
    try {
      let id: string;
      if (target) id = target.id;
      else {
        // Builder legs: saved with today's price (live mark or custom) so the start uses it as the entry premium
        const finalName = (name ?? meta.name).trim();
        const body = {
          name: finalName,
          asset: builder.asset,
          venue: workspaceVenue,
          templateName: guessTemplateName(builder.legs),
          legs: builder.legs.map((l) => ({ ...localLegToInput(l), price: toDecimal(Number(builder.priceFor(l)), 4) })),
        };
        if (meta.draftId) {
          await patch.mutateAsync({ id: meta.draftId, body: { name: body.name, templateName: body.templateName, legs: body.legs } });
          id = meta.draftId;
        } else id = (await create.mutateAsync(body)).id;
      }
      if (mode === "live") {
        const placed = await livePlace.mutateAsync({ id, body: { confirm, brokerId, ...(accountId ? { accountId } : {}), idempotencyKey: idemKey, expected: Object.fromEntries((venue?.legs ?? []).filter((l) => l.mark !== null).map((l) => [l.legId, l.mark!])) } });
        finish(placed);
        return;
      }
      const saved = await start.mutateAsync({ id, body: { mode, brokerId, ...(accountId ? { accountId } : {}), entries: target ? entries() : {} } });
      finish(saved);
    } catch (e) {
      const refused = refusedMindful(e);
      if (refused) {
        // ADR-084: the server decided a pause the preview did not show (the day moved after it): the block and the countdown, not an error toast
        setMindful(refused);
        setPauseRun((n) => n + 1);
      } else if (!handleUpgradeRequired(e)) toast.error("Could not start the trade", { description: e instanceof Error ? e.message : "request failed" });
    } finally {
      setBusy(false);
    }
  };
  // ADR-059: a trade from the Builder always confirms its name (the Builder's own name pre-filled, else the suggestion):
  // paper asks here, after the preview; live asked before the exchange preview (the draft must exist for it)
  const onTradeNow = (confirm: string) => {
    if (fromBuilder && mode === "paper") {
      setStep("name");
      return;
    }
    void trade(undefined, confirm);
  };
  /** Live: after the mode step, ask the server for the venue preview before showing Trade Preview. */
  const toPreview = async (m: "paper" | "live", b: string, a: string | null, name?: string) => {
    if (m !== "live") {
      setStep("preview");
      return;
    }
    setBusy(true);
    try {
      const id = await ensureDraft(name);
      // the same figure the preview's capital block shows: never less than the debit paid (HC-TR-158)
      const debit = Math.max(0, -netPremium(legs, lotSize));
      // a debit with no loss figure (a calendar) still sends the debit: the wallet must cover it (GAPS #81)
      const worstLoss = maxLoss === null ? (debit > 0 ? -debit : null) : Math.min(maxLoss, -debit);
      const v = await livePreview.mutateAsync({ id, body: { brokerId: b, ...(a ? { accountId: a } : {}), ...(worstLoss !== null ? { worstLoss } : {}) } });
      setVenue(v);
      // ADR-084: the server's figure decides when it is known; this tab's fold only while the server has none
      const fromServer = serverMindful(v.mindful);
      setMindful(fromServer === undefined ? mindfulFor(settings?.mindful, strategies, book) : fromServer);
      setStep("preview");
    } catch (e) {
      toast.error("Could not preview the live order", { description: e instanceof Error ? e.message : "request failed" });
      closeTrade();
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <TradeModeDialog
        open={step === "mode"}
        onOpenChange={(o) => !o && closeTrade()}
        title={title}
        asset={asset}
        legs={legs}
        spot={spot}
        lotSize={lotSize}
        money={money}
        brokers={venueBrokers}
        accounts={credential?.items ?? []}
        initialAccountId={target?.accountId ?? null}
        connected={connected}
        dataOnly={dataOnly(tradeVenue) ? dataOnlyNote(tradeVenue) : null}
        priceModeLabel={customPrices ? "Custom (entered prices)" : `Live (${getVenueCore(tradeVenue).label})`}
        lockLive={flow.mode === "live"}
        onContinue={(m, b, f, a) => {
          setMode(m);
          setBrokerId(b);
          setAccountId(a);
          setFees(f);
          if (m === "live" && fromBuilder) {
            setStep("name"); // live: the name first, then the exchange preview
            return;
          }
          void toPreview(m, b, a);
        }}
      />
      <TradePreviewDialog open={step === "preview"} onOpenChange={(o) => !o && closeTrade()} mode={mode} asset={asset} legs={legs} spot={spot} lotSize={lotSize} money={money} broker={broker} fees={fees} maxLoss={maxLoss} maxLossKnown={fromBuilder} customPrices={customPrices} busy={busy} venue={venue} available={available} overlaps={overlaps} mindful={mindful} mindfulKey={`${idemKey}:${pauseRun}`} feedLive={feedLive} onTrade={onTradeNow} />
      <SaveDraftDialog open={step === "name"} onOpenChange={(o) => !o && setStep("preview")} initialName={isTemplateName(meta.name) ? "" : meta.name} suggest={fromBuilder ? suggest : undefined} intent="trade" onSave={(n) => { setMeta(builder.asset, { name: n }); if (mode === "live") void toPreview("live", brokerId, accountId, n); else { setStep("preview"); void trade(n); } }} />
    </>
  );
}
