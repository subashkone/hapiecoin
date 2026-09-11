"use client";
// Trade flow orchestrator (HC-TR-022, 050..057, 046): Select Trading Mode → Trade Preview → start. Trades
// either the Builder legs (saving them as a draft first) or an existing draft ("Activate"). Also imports the
// browser-local drafts saved before Phase 3 once (ADR-024).
import { emitTour } from "@/lib/tour";
import { type Strategy, toDecimal } from "@hapiecoin/schema";
import { toast } from "@hapiecoin/ui";
import { useEffect, useMemo, useRef, useState } from "react";
import { useBrokers, useCredential } from "@/lib/api/queries";
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
          await create.mutateAsync({ name: d.name, asset: d.asset, templateName: d.templateName, legs: d.legs.slice(0, 8).map(localLegToInput) });
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
  const setLegs = useUiStore((s) => s.setLegs);
  const setMeta = useUiStore((s) => s.setStrategyMeta);
  const setWorkspaceTab = useUiStore((s) => s.setWorkspaceTab);
  const builder = useStrategyAnalysis("builder");
  const meta = useUiStore((s) => s.strategy[s.asset]);
  const { data: strategies } = useStrategies();
  const { data: brokers } = useBrokers();
  const { data: credential } = useCredential();
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
  const [fees, setFees] = useState<FeeEstimate>({ fee: 0, gst: 0, total: 0, per: [] });
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (flow) {
      setStep("mode");
      setMode(flow.mode ?? "paper");
      setVenue(null);
      setIdemKey(newIdempotencyKey());
    }
  }, [flow]);

  const target: Strategy | null = flow?.strategyId ? strategies?.find((s) => s.id === flow.strategyId) ?? null : null;
  const fromBuilder = flow !== null && flow.strategyId === null;
  const asset = target ? target.asset : builder.asset;
  const legs: TradeLegView[] = useMemo(() => {
    if (target) return openLegs(target).map((l) => ({ id: l.id, kind: l.kind, side: l.side, strike: l.strike, expiry: l.expiry, symbol: l.symbol, lots: l.lots, price: book.priceOf(target, l)?.toString() ?? l.price }));
    return builder.legs.map((l) => ({ id: l.id, kind: l.kind, side: l.side, strike: l.strike, expiry: l.expiry, symbol: l.symbol, lots: l.lots, price: builder.priceFor(l) }));
  }, [target, builder, book]);
  // HC-TR-159: contracts other open strategies of this mode already hold; the exchange nets them into one position
  const overlaps = useMemo(() => overlapsFor(legs.map((l) => ({ symbol: l.symbol, side: l.side, lots: l.lots, label: legLabel(l) })), strategies ?? [], mode, target?.id ?? null), [legs, strategies, mode, target]);
  // ADR-059: the name box arrives filled from the legs and the clock, read when the dialog opens
  const suggest = () => suggestStrategyName({ asset: builder.asset, templateName: guessTemplateName(builder.legs), legs: builder.legs, taken: (strategies ?? []).map((x) => x.name) });
  // capital on the preview (HC-TR-158): the exchange wallet, read only while a trade flow is open on a connected exchange
  const wallet = useLivePositions(flow !== null && (credential?.items.length ?? 0) > 0 && brokerId ? brokerId : null);
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
  const lotSize = target ? book.lotSizeOf(target.asset) : builder.lotSize ?? book.lotSizeOf(asset);
  const spot = target ? book.spotOf(target.asset) : builder.spot;
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
    const body = { name: finalName, asset: builder.asset, templateName: guessTemplateName(builder.legs), legs: builder.legs.map((l) => ({ ...localLegToInput(l), price: toDecimal(Number(builder.priceFor(l)), 4) })) };
    if (meta.draftId) {
      await patch.mutateAsync({ id: meta.draftId, body: { name: body.name, templateName: body.templateName, legs: body.legs } });
      return meta.draftId;
    }
    const created = await create.mutateAsync(body);
    setMeta(builder.asset, { draftId: created.id, name: created.name });
    return created.id;
  };
  const trade = async (name?: string) => {
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
          templateName: guessTemplateName(builder.legs),
          legs: builder.legs.map((l) => ({ ...localLegToInput(l), price: toDecimal(Number(builder.priceFor(l)), 4) })),
        };
        if (meta.draftId) {
          await patch.mutateAsync({ id: meta.draftId, body: { name: body.name, templateName: body.templateName, legs: body.legs } });
          id = meta.draftId;
        } else id = (await create.mutateAsync(body)).id;
      }
      if (mode === "live") {
        const placed = await livePlace.mutateAsync({ id, body: { brokerId, idempotencyKey: idemKey, expected: Object.fromEntries((venue?.legs ?? []).filter((l) => l.mark !== null).map((l) => [l.legId, l.mark!])) } });
        finish(placed);
        return;
      }
      const saved = await start.mutateAsync({ id, body: { mode, brokerId, entries: target ? entries() : {} } });
      finish(saved);
    } catch (e) {
      if (!handleUpgradeRequired(e)) toast.error("Could not start the trade", { description: e instanceof Error ? e.message : "request failed" });
    } finally {
      setBusy(false);
    }
  };
  // ADR-059: a trade from the Builder always confirms its name (the Builder's own name pre-filled, else the suggestion):
  // paper asks here, after the preview; live asked before the exchange preview (the draft must exist for it)
  const onTradeNow = () => {
    if (fromBuilder && mode === "paper") {
      setStep("name");
      return;
    }
    void trade();
  };
  /** Live: after the mode step, ask the server for the venue preview before showing Trade Preview. */
  const toPreview = async (m: "paper" | "live", b: string, name?: string) => {
    if (m !== "live") {
      setStep("preview");
      return;
    }
    setBusy(true);
    try {
      const id = await ensureDraft(name);
      // the same figure the preview's capital block shows: never less than the debit paid (HC-TR-158)
      const debit = Math.max(0, -netPremium(legs, lotSize));
      const worstLoss = maxLoss === null ? null : Math.min(maxLoss, -debit);
      const v = await livePreview.mutateAsync({ id, body: { brokerId: b, ...(worstLoss !== null ? { worstLoss } : {}) } });
      setVenue(v);
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
        brokers={brokers ?? []}
        connected={connected}
        priceModeLabel={customPrices ? "Custom (entered prices)" : "Live (Delta Exchange)"}
        lockLive={flow.mode === "live"}
        onContinue={(m, b, f) => {
          setMode(m);
          setBrokerId(b);
          setFees(f);
          if (m === "live" && fromBuilder) {
            setStep("name"); // live: the name first, then the exchange preview
            return;
          }
          void toPreview(m, b);
        }}
      />
      <TradePreviewDialog open={step === "preview"} onOpenChange={(o) => !o && closeTrade()} mode={mode} asset={asset} legs={legs} spot={spot} lotSize={lotSize} money={money} broker={broker} fees={fees} maxLoss={maxLoss} maxLossKnown={fromBuilder} customPrices={customPrices} busy={busy} venue={venue} available={available} overlaps={overlaps} onTrade={onTradeNow} />
      <SaveDraftDialog open={step === "name"} onOpenChange={(o) => !o && setStep("preview")} initialName={isTemplateName(meta.name) ? "" : meta.name} suggest={fromBuilder ? suggest : undefined} intent="trade" onSave={(n) => { setMeta(builder.asset, { name: n }); if (mode === "live") void toPreview("live", brokerId, n); else { setStep("preview"); void trade(n); } }} />
    </>
  );
}
