"use client";
// Paper Trades tab (HC-TR-058..067; HC-TR-156, 157 lifecycle): search, sort (incl. expiry), lifecycle chips Open ·
// Expiring ≤ 1d · Closed, refresh, the P&L strip, strategy cards with start / expiry, live P&L and a sparkline,
// Details / Go live / Stop / Delete, pagination and the empty state.
import type { Strategy, StrategyLeg } from "@hapiecoin/schema";
import { Button, EmptyState, cn, toast } from "@hapiecoin/ui";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo, useState, useEffect } from "react";
import { strategyKeys, useDeleteStrategy, useStrategies } from "@/lib/api/strategies";
import { useLiveRetry, useLiveSync, useLivePositions } from "@/lib/api/live";
import { useBrokers, useCredential } from "@/lib/api/queries";
import { BatchLiveDialog } from "./BatchLiveDialog";
import { NetPositionsPanel } from "./NetPositionsPanel";
import { ReconcileDialog, driftTitle } from "./ReconcileDialog";
import { type DriftRow, driftFor } from "@/lib/strategy/drift";
import { fmtMoney } from "@/lib/money";
import { useUiStore } from "@/lib/store";
import { fmtDate, fmtExpiry } from "@/lib/format";
import { settlementHourUtc } from "@/lib/pricing/legs";
import { type Lifecycle, dayPnl, daysLeft, daysOf, expiryOf, fmtLeg, lifecycleOf, openLegs, pnlSeries } from "@/lib/strategy/paper";
import type { PaperBook } from "@/lib/strategy/usePaper";
import { usePortfolio } from "@/lib/strategy/usePortfolio";
import { AdjustedBadge, ModePill } from "./StrategyDetailsDialog";
import { CardFigures } from "./CardFigures";
import { StopPaperDialog } from "./StopPaperDialog";

export const PAGE = 10;
type SortKey = "pnl" | "date" | "name" | "expiry";
const LIFE: readonly { key: Lifecycle; label: string }[] = [
  { key: "open", label: "Open" },
  { key: "expiring", label: "Expiring ≤ 1d" },
  { key: "closed", label: "Closed" },
];

export function Sparkline({ series, className }: { series: number[]; className?: string }) {
  const W = 150;
  const H = 28;
  const pad = 2;
  const min = Math.min(0, ...series);
  const max = Math.max(0, ...series);
  const rng = max - min || 1;
  const x = (i: number) => (pad + ((W - 2 * pad) * i) / Math.max(1, series.length - 1)).toFixed(1);
  const y = (v: number) => (pad + (H - 2 * pad) * (1 - (v - min) / rng)).toFixed(1);
  const last = series.at(-1) ?? 0;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className={cn("h-7 w-[150px]", className)} aria-label="P&L sparkline" role="img" data-testid="sparkline">
      <polyline points={series.map((v, i) => `${x(i)},${y(v)}`).join(" ")} fill="none" stroke={last >= 0 ? "hsl(var(--profit))" : "hsl(var(--loss))"} strokeWidth="1.5" />
    </svg>
  );
}

export function sortStrategies(rows: Strategy[], key: SortKey, totalOf: (s: Strategy) => number): Strategy[] {
  const r = rows.slice();
  if (key === "date") r.sort((a, b) => new Date(b.startedAt ?? b.createdAt).getTime() - new Date(a.startedAt ?? a.createdAt).getTime());
  else if (key === "name") r.sort((a, b) => a.name.localeCompare(b.name));
  else if (key === "expiry") r.sort((a, b) => (expiryOf(a)?.nearest ?? "9999").localeCompare(expiryOf(b)?.nearest ?? "9999") || a.name.localeCompare(b.name));
  else r.sort((a, b) => totalOf(b) - totalOf(a));
  return r;
}

export function PaperPanel({ book, feedLive, kind = "paper" }: { book: PaperBook; feedLive: boolean; kind?: "paper" | "live" }) {
  const { data, isLoading, isError, refetch } = useStrategies();
  const qc = useQueryClient();
  const openDetails = useUiStore((s) => s.openDetails);
  const del = useDeleteStrategy();
  const retry = useLiveRetry();
  const sync = useLiveSync();
  const { data: brokers } = useBrokers();
  const { data: credential } = useCredential();
  const connected = (credential?.items.length ?? 0) > 0;
  const openTrade = useUiStore((s) => s.openTrade);
  const paneSource = useUiStore((s) => s.paneSource);
  const followStrategy = useUiStore((s) => s.followStrategy);
  const openAdjust = useUiStore((s) => s.openAdjust);
  const openAlerts = useUiStore((s) => s.openAlerts);
  const workspaceTab = useUiStore((s) => s.workspaceTab);
  const setWorkspaceTab = useUiStore((s) => s.setWorkspaceTab);
  const [batch, setBatch] = useState(false);
  // the Reconcile click re-reads the exchange first; only that click shows a spinner, never the background poll
  const [reconcilePending, setReconcilePending] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortKey>("pnl");
  const [page, setPage] = useState(1);
  const [stopId, setStopId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const q = search.trim().toLowerCase();
  const [life, setLife] = useState<Lifecycle>("open");
  const all = useMemo(() => (data ?? []).filter((s) => s.status === kind), [data, kind]);
  // closed = archived strategies that were traded in this mode; they stay on this tab under the Closed chip (ADR-059)
  const closed = useMemo(() => (data ?? []).filter((s) => s.status === "archived" && s.tradingMode === kind), [data, kind]);
  const expiring = all.filter((s) => lifecycleOf(s) === "expiring"); // per render: the clock moves, the list does not
  const lifeRows = life === "closed" ? closed : life === "expiring" ? expiring : all;
  // ADR-029: the API reconciles pending orders in the background; while any are pending, poll the list so chips update
  const anyPending = kind === "live" && all.some((s) => s.orders.some((o) => o.state === "pending"));
  useEffect(() => {
    if (!anyPending) return;
    const id = setInterval(() => void refetch(), 10_000);
    return () => clearInterval(id);
  }, [anyPending, refetch]);
  // nothing followed yet on this tab: the pane follows the first card (HC-TR-143)
  useEffect(() => {
    if (workspaceTab !== kind || paneSource !== null) return;
    const first = all[0];
    if (first) followStrategy(first.id);
  }, [workspaceTab, kind, paneSource, all, followStrategy]);
  const rows = useMemo(() => sortStrategies(lifeRows.filter((s) => !q || `${s.name} ${s.asset} ${s.templateName}`.toLowerCase().includes(q)), sort, (s) => book.pnlOf(s).total), [lifeRows, q, sort, book]);
  const pages = Math.max(1, Math.ceil(rows.length / PAGE));
  const current = Math.min(page, pages);
  const slice = rows.slice((current - 1) * PAGE, current * PAGE);
  const money = book.money;
  const totals = all.reduce(
    (acc, s) => {
      const p = book.pnlOf(s);
      acc.total += p.total;
      acc.day += dayPnl(s, p.total);
      acc.open += p.openLegs;
      return acc;
    },
    { total: 0, day: 0, open: 0 },
  );
  const stopping = stopId ? all.find((s) => s.id === stopId) ?? null : null;
  // HC-TR-113 / 116 / 138: net greeks and the margin estimate across this tab's strategies, priced in the worker
  const portfolio = usePortfolio(data, book, kind);
  const liveBrokerId = kind === "live" ? (credential?.items[0]?.brokerId ?? null) : null;
  const wallet = useLivePositions(liveBrokerId, kind === "live" && connected);
  const balances = wallet.data?.balances ?? [];
  // HC-TR-160: the exchange's net position per contract against the open live legs; a stop, a manual close or a
  // liquidation on the exchange leaves a strategy out of sync until it is reconciled (HC-TR-161)
  // only a fresh, successful read counts: a venue that did not answer is 503 (never an empty list), and a stale
  // snapshot kept after an error must not be compared with fresh legs
  const driftReady = kind === "live" && wallet.isSuccess && !wallet.isError && wallet.data !== undefined;
  const drift = useMemo(() => (driftReady && wallet.data ? driftFor(wallet.data.positions, all, (a) => book.lotSizeOf(a)) : new Map<string, DriftRow[]>()), [driftReady, wallet.data, all, book]);
  const [reconcileId, setReconcileId] = useState<string | null>(null);
  const reconciling = reconcileId ? (all.find((s) => s.id === reconcileId) ?? null) : null;
  // the price a gone leg is booked at: the exchange's mark while it still quotes the contract, else the pane's mark
  // (the position is usually gone, so the venue has none), else the dialog falls back to the entry
  const venueMarkOf = useCallback((l: StrategyLeg) => wallet.data?.positions.find((p) => p.symbol === l.symbol)?.mark ?? (reconciling ? (book.priceOf(reconciling, l)?.toString() ?? null) : null), [wallet.data, reconciling, book]);
  const walletRow = ["USD", "USDT", "INR"].map((a) => balances.find((b) => b.asset === a)).find((b) => b !== undefined) ?? balances[0];
  const marginTotal = walletRow ? Number(walletRow.balance) : null;
  return (
    <section className="flex h-full min-h-0 flex-col" data-testid={`${kind}-panel`} data-count={all.length}>
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
        <input value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} placeholder={`Search ${kind} trades...`} className="h-7 w-[200px] rounded border border-input bg-background px-2 text-xs" aria-label={`Search ${kind} trades`} data-testid={`${kind}-search`} />
        <select value={sort} onChange={(e) => { setSort(e.target.value as SortKey); setPage(1); }} className="h-7 rounded border border-input bg-background px-2 text-xs" aria-label="Sort" data-testid={`${kind}-sort`}>
          <option value="pnl">Sort · P&L</option>
          <option value="date">Sort · Date</option>
          <option value="name">Sort · Name</option>
          <option value="expiry">Sort · Expiry</option>
        </select>
        <div className="flex items-center gap-1" role="group" aria-label="Lifecycle" data-testid={`${kind}-life`}>
          {LIFE.map((l) => {
            const n = l.key === "closed" ? closed.length : l.key === "expiring" ? expiring.length : all.length;
            return (
              <button key={l.key} type="button" aria-pressed={life === l.key} onClick={() => { setLife(l.key); setPage(1); }} className={cn("rounded-full border px-2.5 py-0.5 text-xs", life === l.key ? "border-foreground text-foreground" : "border-border text-muted-foreground hover:text-foreground", l.key === "expiring" && n > 0 && life !== l.key && "text-warning")} data-testid={`${kind}-life-${l.key}`} data-count={n}>
                {l.label} <span className="text-muted-foreground">{n}</span>
              </button>
            );
          })}
        </div>
        <Button size="sm" variant="outline" onClick={() => void refetch().then(() => toast("Refreshed", { description: "Strategy data has been updated" }))} data-testid={`${kind}-refresh`}>
          Refresh
        </Button>
        {kind === "paper" ? (
          <Button size="sm" variant="outline" className="ml-auto" disabled={all.length === 0} title={all.length ? "Place every open paper strategy as live orders (batch selector)" : "No paper strategies"} onClick={() => setBatch(true)} data-testid="trade-all-live">
            Trade All → Live
          </Button>
        ) : (
          <span className={cn("micro ml-auto rounded border px-1.5 py-0.5", connected ? "border-profit text-profit" : "border-border text-muted-foreground")} data-testid="live-exchange-chip">
            {connected ? "exchange connected" : "exchange not connected"}
          </span>
        )}
      </div>
      {kind === "live" ? <NetPositionsPanel money={money} /> : null}
      <div className="grid grid-cols-2 gap-2 px-3 py-2 sm:grid-cols-5" data-testid={`${kind}-strip`} data-portfolio={portfolio.pending ? "pending" : portfolio.open ? "ready" : "empty"}>
        <div className="rounded border border-border px-2 py-1.5"><div className="micro">Total P&amp;L</div><div className={cn("num text-[15px] font-medium", totals.total >= 0 ? "text-profit" : "text-loss")} data-testid={`${kind}-total`}>{fmtMoney(totals.total, money, { signed: true })}</div><div className="micro">{all.length} {all.length === 1 ? "trade" : "trades"} · {totals.open} open {totals.open === 1 ? "leg" : "legs"}</div></div>
        <div className="rounded border border-border px-2 py-1.5"><div className="micro">Day P&amp;L</div><div className={cn("num text-[15px] font-medium", totals.day >= 0 ? "text-profit" : "text-loss")}>{fmtMoney(totals.day, money, { signed: true })}</div><div className="micro">vs previous close</div></div>
        <div className="rounded border border-border px-2 py-1.5" title="Net position delta across the open strategies, in units of the underlying (Black-76 at the live marks)"><div className="micro">Net Δ</div><div className={cn("num text-[15px] font-medium", portfolio.open ? (portfolio.netDelta >= 0 ? "text-profit" : "text-loss") : "text-muted-foreground")} data-testid={`${kind}-net-delta`}>{portfolio.open ? `${portfolio.netDelta >= 0 ? "+" : ""}${portfolio.netDelta.toFixed(4)}` : "—"}</div><div className="micro">{portfolio.open ? `Θ/day ${fmtMoney(portfolio.netTheta, money, { signed: true })} · ν ${fmtMoney(portfolio.netVega, money, { signed: true })}` : portfolio.pending ? "pricing the book…" : "no open strategy"}</div></div>
        <div className="rounded border border-border px-2 py-1.5" title="Σ worst expiry loss of the defined-risk strategies (the exchange margin replaces it for live positions)"><div className="micro">Margin used</div><div className="num text-[15px] font-medium" data-testid={`${kind}-margin-used`}>{portfolio.open ? fmtMoney(portfolio.marginUsed, money) : "—"}</div>{marginTotal !== null && marginTotal > 0 ? <div className="micro"><span className="mr-1">of {fmtMoney(marginTotal, money)} · {Math.min(999, (portfolio.marginUsed / marginTotal) * 100).toFixed(0)}%</span><span className="inline-block h-1 w-12 overflow-hidden rounded bg-muted align-middle"><i className="block h-full bg-[hsl(var(--curve))]" style={{ width: `${Math.min(100, (portfolio.marginUsed / marginTotal) * 100).toFixed(0)}%` }} /></span></div> : <div className="micro">{portfolio.undefinedRisk ? `${portfolio.undefinedRisk} undefined-risk ${portfolio.undefinedRisk === 1 ? "strategy" : "strategies"} excluded` : portfolio.pending && !portfolio.open ? "pricing the book…" : kind === "live" ? "wallet balance once connected" : "worst expiry loss · defined risk"}</div>}</div>
        <div className="rounded border border-border px-2 py-1.5"><div className="micro">Prices</div><div className="num text-[15px] font-medium">{feedLive ? "Live" : "Waiting"}</div><div className="micro">{feedLive ? "mark basis · gateway" : "connecting to the feed"}</div></div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-3 pb-3">
        {isLoading ? (
          <p className="py-6 text-center text-xs text-muted-foreground">Loading strategies…</p>
        ) : isError ? (
          <EmptyState title="Could not load strategies" description="Check your connection and try again." action={<Button size="sm" variant="outline" onClick={() => void refetch()}>Retry</Button>} />
        ) : rows.length === 0 ? (
          <EmptyState title={q ? `No matching ${kind} trades` : life === "closed" ? `No closed ${kind} trades yet` : life === "expiring" ? "Nothing expires within a day" : kind === "paper" ? "No paper trades yet" : "No live trades"} description={q ? "Try a different search" : life !== "open" ? "The Open chip shows what is running" : kind === "paper" ? "Click Paper trade in the Builder to begin" : "Go live from a paper card, or pick Live in the Builder's trade dialog."} className="py-12" data-testid={`${kind}-empty`} />
        ) : (
          <div className="flex flex-col gap-2">
            {kind === "live" && connected && wallet.isError ? (
              <div className="flex flex-wrap items-center gap-2 rounded border border-warning/50 bg-warning/5 px-2 py-1.5 text-2xs" data-testid="live-drift-paused">
                <b className="text-warning">Exchange positions could not be read</b>
                <span className="text-muted-foreground">the out-of-sync check is paused until the next successful read · {wallet.error instanceof Error ? wallet.error.message : "try again in a moment"}</span>
              </div>
            ) : null}
            {drift.size > 0 ? (
              <div className="flex flex-wrap items-center gap-2 rounded border border-loss/50 bg-loss/5 px-2 py-1.5 text-2xs" data-testid="live-drift-banner" data-count={drift.size}>
                <b className="text-loss">{drift.size} {drift.size === 1 ? "strategy is" : "strategies are"} out of sync with the exchange</b>
                <span className="text-muted-foreground">a stop, a manual close or a liquidation changed a position outside HapieCoin · open the card and Reconcile</span>
              </div>
            ) : null}
            {slice.map((s) => {
              const p = book.pnlOf(s);
              const open = openLegs(s);
              const lc = lifecycleOf(s);
              const ex = expiryOf(s);
              const left = ex ? daysLeft(ex.nearest, Date.now(), settlementHourUtc(s.asset)) : null;
              return (
                <div
                  key={s.id}
                  role="button"
                  tabIndex={0}
                  className={cn("rounded border p-2 outline-none focus-visible:ring-1 focus-visible:ring-ring", paneSource?.kind === "strategy" && paneSource.id === s.id ? "border-accent" : "border-border hover:border-foreground/30")}
                  title="Click to analyse this strategy in the pane"
                  onClick={(e) => {
                    if ((e.target as HTMLElement).closest("button, a, input, select")) return;
                    followStrategy(s.id);
                  }}
                  onKeyDown={(e) => {
                    if (e.target !== e.currentTarget) return;
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      followStrategy(s.id);
                    } else if ((e.key === "a" || e.key === "A") && open.length > 0) {
                      e.preventDefault();
                      openAdjust(s.id); // HC-TR-152: A opens the workbench on the focused card
                    }
                  }}
                  data-testid={`${kind}-card`}
                  data-id={s.id}
                  data-life={lc}
                  data-followed={paneSource?.kind === "strategy" && paneSource.id === s.id ? "true" : undefined}
                >
                  <div className="flex flex-wrap items-start gap-2">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2 text-[13px] font-medium"><span className="truncate">{s.name}</span><ModePill status={s.status} /><AdjustedBadge s={s} />{drift.get(s.id) ? <span className="micro rounded border border-loss bg-loss/10 px-1 text-loss" title={driftTitle(drift.get(s.id)!)} data-testid="card-drift" data-state="out-of-sync">out of sync</span> : null}{kind === "live" && s.orderBatchId ? <span className="micro rounded border border-border px-1 font-mono" title={`Order batch ${s.orderBatchId}`} data-testid="card-batch">batch {s.orderBatchId.slice(-6)}</span> : null}</div>
                      <div className="micro flex flex-wrap gap-2"><span className="rounded border border-border px-1">{s.asset}</span><span><b>{open.length}</b>/{s.legs.length} legs</span>{s.templateName ? <span>{s.templateName}</span> : null}</div>
                      <div className="micro mt-0.5 flex flex-wrap gap-x-2 normal-case tracking-normal" data-testid="card-expiry" data-days={left ?? undefined}>
                        <span>started <b className="num">{s.startedAt ? fmtDate(s.startedAt) : "—"}</b> · {daysOf(s)}d</span>
                        {lc === "closed" ? (
                          <span>closed <b className="num">{s.closedAt ? fmtDate(s.closedAt) : "—"}</b></span>
                        ) : ex ? (
                          <span>expires <b className={cn("num", left !== null && left <= 1 && "text-warning")}>{ex.nearest === ex.latest ? fmtExpiry(ex.nearest) : `${fmtExpiry(ex.nearest)} → ${fmtExpiry(ex.latest)}`}</b>{left !== null ? <span className={cn(left <= 1 && "text-warning")}> ({left}d)</span> : null}</span>
                        ) : (
                          <span>no open option legs</span>
                        )}
                      </div>
                    </div>
                    <div className="ml-auto text-right">
                      <div className={cn("num text-[15px] font-medium", p.total >= 0 ? "text-profit" : "text-loss")} data-testid="card-pnl" data-tour="paper-pnl">{fmtMoney(p.total, money, { signed: true })}</div>
                      <div className="micro">unreal {fmtMoney(p.unrealized, money, { signed: true })} · real {fmtMoney(p.realized, money, { signed: true })}</div>
                    </div>
                  </div>
                  <CardFigures s={s} book={book} />
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    <Sparkline series={pnlSeries(s, p.total)} />
                    <div className="flex flex-wrap gap-1">
                      {s.legs.map((l) => {
                        const order = kind === "live" ? s.orders.filter((o) => o.legId === l.id && o.purpose !== "exit").at(-1) : undefined;
                        const state = l.status === "squared_off" ? "closed" : order?.state ?? (kind === "live" ? "pending" : "open");
                        return (
                          <span key={l.id} className={cn("micro rounded border px-1", state === "closed" ? "border-border/50 text-muted-foreground line-through" : state === "failed" ? "border-loss text-loss" : state === "pending" ? "border-warning text-warning" : "border-border")} title={order?.error ?? (order?.venueOrderId ? `Order ${order.venueOrderId}` : fmtLeg(l))} data-testid="order-chip" data-state={state}>
                            {l.side[0]!.toUpperCase()} {l.kind === "future" ? "FUT" : `${l.kind[0]!.toUpperCase()} ${Number(l.strike).toLocaleString("en-US")}`} · {kind === "live" ? state : l.lots}
                          </span>
                        );
                      })}
                    </div>
                  </div>
                  {kind === "live" && s.orders.some((o) => o.state === "failed") ? (
                    <div className="mt-2 flex flex-wrap items-center gap-2 rounded border border-loss/40 p-2 text-2xs" data-testid="failed-banner">
                      <b className="text-loss">Order placement failed</b>
                      <span className="text-muted-foreground">{s.orders.filter((o) => o.state === "failed").length} {s.orders.filter((o) => o.state === "failed").length === 1 ? "leg" : "legs"} · retried {Math.max(...s.orders.filter((o) => o.state === "failed").map((o) => o.attempts)) - 1} {Math.max(...s.orders.filter((o) => o.state === "failed").map((o) => o.attempts)) - 1 === 1 ? "time" : "times"}</span>
                      <Button size="sm" variant="destructive" className="ml-auto" loading={retry.isPending} onClick={() => retry.mutate(s.id, { onSuccess: (r) => { const left = r ? r.orders.filter((o) => o.state === "failed").length : 0; if (left) toast.error("Still failing", { description: `${left} ${left === 1 ? "order" : "orders"} refused again` }); else toast.success("Orders placed", { description: "All legs are filled" }); }, onError: (e) => toast.error("Retry refused", { description: e.message }) })} data-testid="card-retry">Retry Failed Orders</Button>
                    </div>
                  ) : null}
                  <div className="mt-2 flex flex-wrap gap-1">
                    <Button size="sm" variant="outline" onClick={() => openDetails(s.id)} data-testid="card-details">Details</Button>
                    {lc === "closed" ? <Button size="sm" variant="outline" onClick={() => setWorkspaceTab("journal")} title="This trade in the Journal" data-testid="card-journal">Journal</Button> : null}
                    {lc !== "closed" ? <Button size="sm" variant="outline" disabled={open.length === 0} title={open.length ? "Adjust: trim, close or add legs with the combined payoff (A)" : "No open legs"} onClick={() => openAdjust(s.id)} data-testid="card-adjust">Adjust</Button> : null}
                    {lc !== "closed" ? <Button size="sm" variant="outline" title="Alert me when this strategy's P&L crosses a level" onClick={() => openAlerts({ kind: "pnl", strategyId: s.id, asset: s.asset })} data-testid="card-alert">Set alert</Button> : null}
                    {lc === "closed" ? null : kind === "paper" ? (
                      <>
                        <Button size="sm" variant="outline" disabled={!connected || open.length === 0} title={connected ? "Place these legs as live orders" : "Connect your exchange first"} onClick={() => openTrade({ strategyId: s.id, mode: "live" })} data-testid="card-golive">Go live</Button>
                        <Button size="sm" variant="outline" className="text-warning" onClick={() => setStopId(s.id)} data-testid="card-stop" data-tour="paper-stop">Stop</Button>
                      </>
                    ) : (
                      <>
                        {s.orders.some((o) => o.state === "pending") ? <Button size="sm" variant="outline" loading={sync.isPending} onClick={() => sync.mutate(s.id, { onSuccess: () => toast("Synced", { description: "Order states refreshed from the exchange" }) })} data-testid="card-sync">Sync</Button> : null}
                        {drift.get(s.id) ? <Button size="sm" variant="destructive" loading={reconcilePending === s.id} onClick={() => { setReconcilePending(s.id); void wallet.refetch().then((r) => { setReconcilePending(null); if (r.isSuccess) setReconcileId(s.id); }); }} title="Re-reads the exchange first, then books the lots it no longer holds as closed · no orders are sent" data-testid="card-reconcile">Reconcile</Button> : null}
                        <Button size="sm" variant="outline" className="text-loss" disabled={open.length === 0} onClick={() => openDetails(s.id)} title="Square off from Details" data-testid="card-sqall">Square off all</Button>
                      </>
                    )}
                    <span className="ml-auto flex gap-1">
                      {lc === "closed" ? null : deleteId === s.id ? (
                        <>
                          <Button size="sm" variant="destructive" loading={del.isPending} onClick={() => del.mutate(s.id, { onSuccess: () => { setDeleteId(null); toast("Deleted", { description: s.name }); }, onError: (e) => toast.error("Could not delete", { description: e.message }) })} data-testid="card-delete-confirm">Confirm delete</Button>
                          <Button size="sm" variant="ghost" onClick={() => setDeleteId(null)}>Cancel</Button>
                        </>
                      ) : (
                        <Button size="sm" variant="ghost" className="text-loss" onClick={() => setDeleteId(s.id)} title={`Delete ${s.name}? This action cannot be undone.`} data-testid="card-delete">Delete</Button>
                      )}
                    </span>
                  </div>
                </div>
              );
            })}
            {pages > 1 ? (
              <div className="flex items-center justify-center gap-3 py-2 text-xs" data-testid={`${kind}-pager`}>
                <Button size="sm" variant="outline" disabled={current <= 1} onClick={() => setPage(current - 1)}>‹ Previous</Button>
                <span className="micro">Page {current} of {pages}</span>
                <Button size="sm" variant="outline" disabled={current >= pages} onClick={() => setPage(current + 1)}>Next ›</Button>
              </div>
            ) : null}
          </div>
        )}
      </div>
      {kind === "paper" ? <BatchLiveDialog open={batch} onOpenChange={setBatch} strategies={all} brokers={brokers ?? []} connected={connected} money={money} totalOf={(s) => book.pnlOf(s).total} /> : null}
      <ReconcileDialog strategy={reconciling} rows={reconciling ? (drift.get(reconciling.id) ?? []) : []} markOf={venueMarkOf} onOpenChange={(o) => { if (!o) { setReconcileId(null); void refetch(); void wallet.refetch(); } }} />
      {stopping ? <StopPaperDialog open={true} onOpenChange={(o) => !o && setStopId(null)} strategy={stopping} priceOf={(l) => book.priceOf(stopping, l)} total={book.pnlOf(stopping).total} money={money} live={feedLive} onDone={() => void qc.invalidateQueries({ queryKey: strategyKeys.all })} /> : null}
    </section>
  );
}
