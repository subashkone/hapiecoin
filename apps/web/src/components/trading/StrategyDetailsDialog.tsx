"use client";
// Strategy Details (HC-TR-068..078): header with the mode pill, P&L tiles, actions, payoff figures, the
// Active / Squared off leg groups with per-leg square off, the P&L history chart and statistics.
import type { Strategy, StrategyLeg as ServerLeg } from "@hapiecoin/schema";
import { Button, Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, cn, toast } from "@hapiecoin/ui";
import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { strategyKeys, useAddLegs, useArchiveStrategy, useCloseAll, useDeleteStrategy, useStrategies } from "@/lib/api/strategies";
import { daysToExpiry, fmtExpiry, fmtPrice, fmtStrike } from "@/lib/format";
import { fmtMoney } from "@/lib/money";
import { useAnalysis } from "@/lib/pricing/client";
import { settlementHourUtc, toPricingLegs } from "@/lib/pricing/legs";
import { useUiStore } from "@/lib/store";
import { MAX_OPEN_LEGS_UI, daysOf, openLegs, pickToInput, pnlSeries, priceMap, serverLegToLocal } from "@/lib/strategy/paper";
import { type PaperBook } from "@/lib/strategy/usePaper";
import { ChainPickerDialog } from "@/components/builder/ChainPickerDialog";
import { PartialExitDialog } from "./PartialExitDialog";
import { SquareOffDialog } from "./SquareOffDialog";
import { StopPaperDialog } from "./StopPaperDialog";

export function ModePill({ status }: { status: Strategy["status"] }) {
  const cls = status === "live" ? "border-loss bg-loss text-white" : status === "paper" ? "border-border" : status === "archived" ? "border-border text-muted-foreground" : "border-border text-muted-foreground";
  const label = status === "live" ? "Live" : status === "paper" ? "Paper" : status === "archived" ? "Archived" : "Draft";
  return (
    <span className={cn("micro inline-flex items-center gap-1 rounded border px-1.5", cls)} title={status === "live" ? "Live · real orders on the exchange" : status === "paper" ? "Paper · simulated at live prices" : undefined} data-testid="mode-pill" data-status={status}>
      {status === "live" ? <i className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-white" /> : status === "paper" ? <i className="inline-block h-1.5 w-1.5 rounded-full border border-current" /> : null}
      {label}
    </span>
  );
}

/** SVG polyline of the P&L history (HC-TR-076). */
export function PnlChart({ series, className }: { series: number[]; className?: string }) {
  const W = 600;
  const H = 110;
  const pad = 8;
  const mL = 40;
  const min = Math.min(0, ...series);
  const max = Math.max(0, ...series);
  const rng = max - min || 1;
  const x = (i: number) => mL + ((W - mL - pad) * i) / Math.max(1, series.length - 1);
  const y = (v: number) => pad + (H - 2 * pad - 10) * (1 - (v - min) / rng);
  const last = series.at(-1) ?? 0;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className={cn("w-full", className)} role="img" aria-label="P&L history" data-testid="pnl-chart" data-points={series.length}>
      <line x1={mL} x2={W - pad} y1={y(0)} y2={y(0)} stroke="hsl(var(--border))" strokeDasharray="3 3" />
      <text x={mL - 4} y={y(0) + 3} fontSize="9" textAnchor="end" fill="hsl(var(--muted-foreground))">0</text>
      <polyline points={series.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ")} fill="none" stroke={last >= 0 ? "hsl(var(--profit))" : "hsl(var(--loss))"} strokeWidth="1.5" />
    </svg>
  );
}

export function legInstrument(l: ServerLeg): string {
  return l.kind === "future" ? `${l.symbol} · perp` : `${fmtStrike(l.strike)} ${l.kind === "call" ? "C" : "P"} · ${fmtExpiry(l.expiry)} · ${daysToExpiry(l.expiry)}d`;
}

export function StrategyDetailsDialog({ book, feedLive }: { book: PaperBook; feedLive: boolean }) {
  const id = useUiStore((s) => s.detailsId);
  const openDetails = useUiStore((s) => s.openDetails);
  const openTrade = useUiStore((s) => s.openTrade);
  const setLegs = useUiStore((s) => s.setLegs);
  const setMeta = useUiStore((s) => s.setStrategyMeta);
  const setAsset = useUiStore((s) => s.setAsset);
  const setWorkspaceTab = useUiStore((s) => s.setWorkspaceTab);
  const { data: strategies } = useStrategies();
  const qc = useQueryClient();
  const s = strategies?.find((x) => x.id === id) ?? null;
  const [tab, setTab] = useState<"active" | "closed">("active");
  const [sqLeg, setSqLeg] = useState<ServerLeg | null>(null);
  const [partial, setPartial] = useState(false);
  const [stop, setStop] = useState(false);
  const [adjust, setAdjust] = useState(false);
  const [confirmAll, setConfirmAll] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const closeAll = useCloseAll();
  const addLegs = useAddLegs();
  const del = useDeleteStrategy();
  const archive = useArchiveStrategy();
  const pnl = s ? book.pnlOf(s) : null;
  const active = s ? s.status === "paper" || s.status === "live" : false;
  const open = s ? openLegs(s) : [];
  const payLegs = s ? (open.length ? open : s.legs) : [];
  const pricingLegs = useMemo(() => (s ? toPricingLegs(payLegs.map((l) => serverLegToLocal(l, s.asset)), book.lotSizeOf(s.asset), { spot: undefined }) : []), [s, payLegs, book]);
  const spot = s ? book.spotOf(s.asset) : null;
  const analysis = useAnalysis(pricingLegs, s && spot !== null && pricingLegs.length ? { spot, nowMs: Date.now(), settlementHourUtc: settlementHourUtc(s.asset), defaultIv: 0.5 } : null);
  if (!s) return null;
  const closed = s.legs.filter((l) => l.status === "squared_off");
  const shown = tab === "active" ? open : closed;
  const adj = shown.filter((l) => l.isAdjustment);
  const orig = shown.filter((l) => !l.isAdjustment);
  const money = book.money;
  const close = () => openDetails(null);
  const loadInBuilder = () => {
    setAsset(s.asset);
    setLegs(s.asset, s.legs.filter((l) => l.status === "open").map((l) => serverLegToLocal(l, s.asset)));
    setMeta(s.asset, { name: s.name, draftId: s.status === "draft" ? s.id : null });
    setWorkspaceTab("builder");
    close();
    toast("Loaded", { description: `${s.name} loaded into the Builder` });
  };
  const squareOffAll = () =>
    closeAll.mutate(
      { id: s.id, body: { exits: priceMap(open, (l) => book.priceOf(s, l)) } },
      {
        onSuccess: () => {
          setConfirmAll(false);
          toast.success("All positions squared off", { description: `${open.length} ${open.length === 1 ? "leg" : "legs"} closed at market prices` });
        },
        onError: (e) => toast.error("Could not square off", { description: e.message }),
      },
    );
  const legRow = (l: ServerLeg) => {
    const p = pnl?.byLeg.get(l.id);
    return (
      <div key={l.id} className={cn("flex flex-wrap items-center gap-2 rounded border border-border px-2 py-1 text-xs", l.status === "squared_off" && "opacity-70")} data-testid="details-leg" data-leg-status={l.status}>
        <span className={cn("font-mono text-3xs font-bold uppercase", l.side === "buy" ? "text-buy" : "text-sell")}>{l.side}</span>
        <span className="num">{legInstrument(l)}</span>
        {l.isAdjustment ? <span className="micro rounded border border-border px-1">adj</span> : null}
        <span className="num text-muted-foreground">{l.lots} lots</span>
        <span className="num">entry <b>{fmtPrice(p?.entry, 1)}</b> → {l.status === "squared_off" ? "exit" : "now"} <b>{fmtPrice(p?.current, 1)}</b></span>
        <span className={cn("num ml-auto rounded px-1", (p?.pnl ?? 0) >= 0 ? "text-profit" : "text-loss")} data-testid="details-leg-pnl">{p ? fmtMoney(p.pnl, money, { signed: true }) : "—"}</span>
        {active && l.status === "open" ? (
          <Button size="sm" variant="outline" onClick={() => setSqLeg(l)} data-testid="details-sqoff">
            Square off
          </Button>
        ) : null}
      </div>
    );
  };
  return (
    <>
      <Dialog open={true} onOpenChange={(o) => !o && close()}>
        <DialogContent className="sm:max-w-[780px]" data-testid="strategy-details" data-status={s.status}>
          <DialogHeader>
            <DialogTitle>{s.name}</DialogTitle>
            <DialogDescription>
              <span className="inline-flex flex-wrap items-center gap-2">
                <ModePill status={s.status} />
                <span className="micro rounded border border-border px-1">{s.asset}</span>
                {s.templateName ? <span>{s.templateName}</span> : null}
                <span className="micro">{s.id}</span>
                {s.brokerId ? <span className="micro">· {book.brokerName(s.brokerId)}</span> : null}
              </span>
            </DialogDescription>
          </DialogHeader>
          <DialogBody>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" data-testid="details-tiles">
              <div className="rounded border border-border p-2"><div className="micro">Total P&amp;L</div><div className={cn("num text-[15px] font-medium", (pnl?.total ?? 0) >= 0 ? "text-profit" : "text-loss")} data-testid="details-total">{pnl ? fmtMoney(pnl.total, money, { signed: true }) : "—"}</div><div className="micro">{active ? "live · mark basis" : "final"}</div></div>
              <div className="rounded border border-border p-2"><div className="micro">Unrealised</div><div className={cn("num text-[15px] font-medium", (pnl?.unrealized ?? 0) >= 0 ? "text-profit" : "text-loss")}>{pnl ? fmtMoney(pnl.unrealized, money, { signed: true }) : "—"}</div></div>
              <div className="rounded border border-border p-2"><div className="micro">Realised</div><div className={cn("num text-[15px] font-medium", (pnl?.realized ?? 0) >= 0 ? "text-profit" : "text-loss")} data-testid="details-realized">{pnl ? fmtMoney(pnl.realized, money, { signed: true }) : "—"}</div></div>
              <div className="rounded border border-border p-2"><div className="micro">Days</div><div className="num text-[15px] font-medium">{daysOf(s)}</div><div className="micro">{s.legs.length} legs · {open.length} open</div></div>
            </div>
            <div className="mt-3 flex flex-wrap gap-2" data-testid="details-actions">
              {active ? (
                <>
                  <Button size="sm" variant="outline" onClick={() => void qc.invalidateQueries({ queryKey: strategyKeys.all }).then(() => toast("Refreshed", { description: "Strategy data has been updated" }))}>Refresh</Button>
                  <Button size="sm" variant="outline" disabled={open.length >= MAX_OPEN_LEGS_UI} title={open.length >= MAX_OPEN_LEGS_UI ? "Maximum 10 active legs reached" : "Add adjustment legs from the options chain"} onClick={() => setAdjust(true)} data-testid="details-adjust">+ Add adjustment</Button>
                  <Button size="sm" variant="outline" disabled={open.length === 0} onClick={() => setPartial(true)} data-testid="details-partial">Partial exit</Button>
                  {confirmAll ? (
                    <>
                      <Button size="sm" variant="destructive" loading={closeAll.isPending} onClick={squareOffAll} data-testid="details-sqall-confirm">Square off {open.length} {open.length === 1 ? "leg" : "legs"} at market</Button>
                      <Button size="sm" variant="ghost" onClick={() => setConfirmAll(false)}>Cancel</Button>
                    </>
                  ) : (
                    <Button size="sm" variant="outline" className="text-loss" disabled={open.length === 0} onClick={() => setConfirmAll(true)} data-testid="details-sqall">Square off all</Button>
                  )}
                  {s.status === "paper" ? <Button size="sm" variant="outline" className="text-warning" onClick={() => setStop(true)} data-testid="details-stop">Stop</Button> : null}
                </>
              ) : (
                <>
                  <span className="micro self-center rounded border border-border px-1">{s.status}{s.tradingMode ? ` · was ${s.tradingMode}` : ""}</span>
                  <Button size="sm" variant="outline" onClick={loadInBuilder} data-testid="details-load">Load in builder</Button>
                  {s.status === "draft" ? <Button size="sm" onClick={() => { close(); openTrade({ strategyId: s.id }); }} data-testid="details-activate">Activate</Button> : null}
                  {s.status === "archived" ? <Button size="sm" variant="outline" onClick={() => archive.mutate({ id: s.id, archived: false }, { onSuccess: () => toast("Restored", { description: `${s.name} is a draft again` }) })} data-testid="details-restore">Restore</Button> : null}
                </>
              )}
              <span className="ml-auto flex gap-1">
                {confirmDelete ? (
                  <>
                    <Button size="sm" variant="destructive" loading={del.isPending} onClick={() => del.mutate(s.id, { onSuccess: () => { close(); toast("Deleted", { description: s.name }); } })} data-testid="details-delete-confirm">Confirm delete</Button>
                    <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(false)}>Cancel</Button>
                  </>
                ) : (
                  <Button size="sm" variant="ghost" className="text-loss" onClick={() => setConfirmDelete(true)} data-testid="details-delete">Delete</Button>
                )}
              </span>
            </div>
            {analysis.result ? (
              <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-2xs" data-testid="details-payoff">
                <span className="micro">Payoff · at expiry</span>
                <span>Max profit <b className="num text-profit">{fmtMoney(analysis.result.maxProfit, money, { signed: true, unlimited: "∞" })}</b></span>
                <span>Max loss <b className="num text-loss">{fmtMoney(analysis.result.maxLoss, money, { signed: true, unlimited: "−∞" })}</b></span>
                <span>BE <b className="num">{analysis.result.breakevens.length ? analysis.result.breakevens.map((b) => fmtStrike(String(Math.round(b)))).join(" / ") : "—"}</b></span>
                <span>Net Δ <b className="num">{analysis.result.greeks.delta.toFixed(4)}</b></span>
                <span>Θ/day <b className={cn("num", analysis.result.greeks.theta >= 0 ? "text-profit" : "text-loss")}>{fmtMoney(analysis.result.greeks.theta, money, { signed: true })}</b></span>
              </div>
            ) : null}
            <div className="mt-3 flex items-center gap-2 border-b border-border text-xs">
              {(["active", "closed"] as const).map((t) => (
                <button key={t} type="button" aria-pressed={tab === t} onClick={() => setTab(t)} className={cn("px-2 py-1", tab === t ? "border-b-2 border-foreground text-foreground" : "text-muted-foreground")} data-testid={`details-tab-${t}`}>
                  {t === "active" ? "Active" : "Squared off"} <span className="font-mono text-3xs">{t === "active" ? open.length : closed.length}</span>
                </button>
              ))}
              <span className="micro ml-auto">{s.status === "live" ? `orders on ${book.brokerName(s.brokerId)}` : s.status === "paper" ? "simulated at live prices" : ""}</span>
            </div>
            {shown.length === 0 ? <p className="py-4 text-center text-xs text-muted-foreground">{tab === "active" ? "No active legs · All legs have been squared off" : "No squared off legs · Closed legs will appear here"}</p> : null}
            {adj.length ? <><div className="micro mt-2">Adjustments</div><div className="flex flex-col gap-1">{adj.map(legRow)}</div></> : null}
            {orig.length ? <><div className="micro mt-2">{adj.length ? "Original legs" : "Legs"}</div><div className="flex flex-col gap-1">{orig.map(legRow)}</div></> : null}
            <div className="micro mt-3">P&amp;L history · {s.pnlHistory.length + 1} {s.pnlHistory.length + 1 === 1 ? "point" : "points"}</div>
            <PnlChart series={pnlSeries(s, pnl?.total ?? 0)} className="rounded border border-border" />
            <div className="micro mt-3">Trading statistics</div>
            <div className="grid grid-cols-3 gap-2 text-xs sm:grid-cols-6" data-testid="details-stats">
              <div><span className="micro block">Open</span><b className="num">{open.length}</b></div>
              <div><span className="micro block">Closed</span><b className="num">{closed.length}</b></div>
              <div><span className="micro block">Total legs</span><b className="num">{s.legs.length}</b></div>
              <div><span className="micro block">Days</span><b className="num">{daysOf(s)}</b></div>
              <div><span className="micro block">Realised</span><b className={cn("num", (pnl?.realized ?? 0) >= 0 ? "text-profit" : "text-loss")}>{pnl ? fmtMoney(pnl.realized, money, { signed: true }) : "—"}</b></div>
              <div><span className="micro block">Started</span><b className="num">{s.startedAt ? new Date(s.startedAt).toLocaleDateString("en-GB", { day: "2-digit", month: "short" }) : "—"}</b></div>
            </div>
            {s.status === "archived" && (s.tags.length || s.notes) ? (
              <div className="mt-3 rounded border border-border p-2 text-xs">
                <div className="micro">Journal</div>
                <div className="flex flex-wrap gap-1">{s.tags.map((t) => <span key={t} className="micro rounded border border-border px-1">{t}</span>)}</div>
                {s.notes ? <p className="mt-1">{s.notes}</p> : null}
              </div>
            ) : null}
          </DialogBody>
          <DialogFooter>
            <Button variant="outline" onClick={close}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {sqLeg ? <SquareOffDialog open={sqLeg !== null} onOpenChange={(o) => !o && setSqLeg(null)} strategy={s} leg={sqLeg} current={book.priceOf(s, sqLeg)} lotSize={book.lotSizeOf(s.asset)} money={money} /> : null}
      <PartialExitDialog open={partial} onOpenChange={setPartial} strategy={s} priceOf={(l) => book.priceOf(s, l)} />
      <StopPaperDialog open={stop} onOpenChange={setStop} strategy={s} priceOf={(l) => book.priceOf(s, l)} total={pnl?.total ?? 0} money={money} live={feedLive} onDone={(next) => { if (next.status !== "paper" && next.status !== "live") close(); }} />
      <ChainPickerDialog
        open={adjust}
        onOpenChange={setAdjust}
        remaining={Math.max(0, MAX_OPEN_LEGS_UI - open.length)}
        asset={s.asset}
        expiry={s.legs.find((l) => l.kind !== "future")?.expiry ?? null}
        title="Add adjustment legs"
        onAdd={(legs) =>
          addLegs.mutate(
            { id: s.id, body: { legs: legs.map(pickToInput) } },
            {
              onSuccess: () => toast.success("Adjustment added", { description: `${legs.length} adjustment ${legs.length === 1 ? "leg" : "legs"} added successfully` }),
              onError: (e) => toast.error("Could not add adjustment", { description: e.message }),
            },
          )
        }
      />
    </>
  );
}
