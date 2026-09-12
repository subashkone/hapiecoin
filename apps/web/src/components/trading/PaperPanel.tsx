"use client";
// Paper Trades tab (HC-TR-058..067; HC-TR-156, 157 lifecycle): search, sort (incl. expiry), lifecycle chips Open ·
// Expiring ≤ 1d · Closed, refresh, the P&L strip, strategy cards with start / expiry, live P&L and a sparkline,
// Details / Go live / Stop / Delete, pagination and the empty state.
import { type Strategy, type StrategyLeg, CLOSE_REASON_LABELS, MAX_STRATEGY_NAME, nearestSettlement, settlementMsOf, toDecimal } from "@hapiecoin/schema";
import { Button, EmptyState, cn, toast } from "@hapiecoin/ui";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo, useState, useEffect } from "react";
import { strategyKeys, useCreateStrategy, useDeleteStrategy, useStrategies } from "@/lib/api/strategies";
import { useAccountPositions, useLiveRetry, useLiveSync } from "@/lib/api/live";
import { type AccountRef, accountKey, accountLabel, accountRefOf } from "@/lib/accounts";
import { useBrokers, useCredential, useSettings } from "@/lib/api/queries";
import { type MindfulPauseInfo, mindfulFor } from "@/lib/strategy/mindful";
import { BatchLiveDialog } from "./BatchLiveDialog";
import { RetryDialog } from "./RetryDialog";
import { NetPositionsPanel } from "./NetPositionsPanel";
import { ReconcileDialog, driftTitle } from "./ReconcileDialog";
import { type DriftRow, driftFor, isSettling } from "@/lib/strategy/drift";
import { fmtMoney } from "@/lib/money";
import { useUiStore } from "@/lib/store";
import { dataOnly } from "@/lib/venue";
import { fmtDate, fmtExpiry } from "@/lib/format";
import { settlementHourUtc } from "@/lib/pricing/legs";
import { type Lifecycle, dayPnl, daysLeft, daysOf, expiryOf, fmtLeg, lifecycleOf, openLegs, pnlSeries } from "@/lib/strategy/paper";
import type { PaperBook } from "@/lib/strategy/usePaper";
import { usePortfolio } from "@/lib/strategy/usePortfolio";
import { AdjustedBadge, ModePill } from "./StrategyDetailsDialog";
import { FIRED_LABELS, firedRule, rulesLine } from "./RuleDialog";
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

/**
 * The position a closed strategy held at the moment it closed (HC-TR-172): the legs booked in that closing batch (a
 * partial exit or a rolled-out leg closed earlier and is not part of it), same-symbol rows merged.
 */
export function heldAtClose(s: Strategy): { kind: StrategyLeg["kind"]; side: StrategyLeg["side"]; strike: string; expiry: string; symbol: string; lots: number; price: string; iv: number | null }[] {
  const out: ReturnType<typeof heldAtClose> = [];
  for (const l of s.legs) {
    if (l.entryPrice === null || l.closedAt === null || l.closedAt !== s.closedAt) continue;
    const same = out.find((o) => o.symbol === l.symbol && o.side === l.side);
    if (same) same.lots += l.lots;
    else out.push({ kind: l.kind, side: l.side, strike: l.strike, expiry: l.expiry, symbol: l.symbol, lots: l.lots, price: l.exitPrice ?? l.price, iv: l.iv });
  }
  return out;
}
/** True when a dated leg of the closed position has already settled: the same contracts cannot be traded again. */
export function reenterExpired(s: Strategy, now = Date.now()): boolean {
  const n = nearestSettlement(heldAtClose(s), s.asset);
  return n !== null && n.ms <= now;
}

export function PaperPanel({ book, feedLive, kind = "paper" }: { book: PaperBook; feedLive: boolean; kind?: "paper" | "live" }) {
  const { data, isLoading, isError, refetch } = useStrategies();
  const qc = useQueryClient();
  const openDetails = useUiStore((s) => s.openDetails);
  const del = useDeleteStrategy();
  const create = useCreateStrategy();
  const retry = useLiveRetry();
  const sync = useLiveSync();
  const { data: brokers } = useBrokers();
  const { data: credential } = useCredential();
  const { data: settings } = useSettings();
  // HC-TR-182: the Mindful pause for Trade All → Live is decided when the dialog opens and holds while it is open
  const [batchMindful, setBatchMindful] = useState<MindfulPauseInfo | null>(null);
  // HC-TR-186: a retry sends real orders again, so it asks for the word in its own dialog
  const [retryForId, setRetryForId] = useState<string | null>(null);
  const retryFor = retryForId ? (data ?? []).find((x) => x.id === retryForId) ?? null : null; // the live row, not a snapshot
  useEffect(() => {
    // the list polls: once nothing is failed any more (a retry landed, or the reconciler filled it) the dialog has nothing to send
    if (retryForId && retryFor && !retryFor.orders.some((o) => o.state === "failed")) setRetryForId(null);
  }, [retryForId, retryFor]);
  const connected = (credential?.items.length ?? 0) > 0;
  const openTrade = useUiStore((s) => s.openTrade);
  const paneSource = useUiStore((s) => s.paneSource);
  const followStrategy = useUiStore((s) => s.followStrategy);
  const openAdjust = useUiStore((s) => s.openAdjust);
  const openAlerts = useUiStore((s) => s.openAlerts);
  const openRules = useUiStore((s) => s.openRules);
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
  const [reenterId, setReenterId] = useState<string | null>(null);
  // Re-enter (HC-TR-172): the legs this strategy held, as a fresh draft at today's marks, handed to the trade dialog
  // of this tab; the entry prices and the capital check happen there, nothing is placed here
  const reenter = (s: Strategy) => {
    const legs = heldAtClose(s).map((l) => {
      const mark = book.priceOf(s, { ...l, id: "", entryPrice: null, exitPrice: null, status: "open", isAdjustment: false, position: 0, openedAt: null, closedAt: null, orderId: null });
      return { kind: l.kind, side: l.side, strike: l.strike, expiry: l.expiry, symbol: l.symbol, lots: l.lots, price: mark !== null ? toDecimal(mark, 2) : l.price, ...(l.iv !== null ? { iv: l.iv } : {}) };
    });
    setReenterId(s.id);
    create.mutate(
      { name: `${s.name} re-entry`.slice(0, MAX_STRATEGY_NAME), asset: s.asset, venue: s.venue, templateName: s.templateName, legs },
      {
        onSuccess: (d) => {
          setReenterId(null);
          // the trade dialog reads the draft from the list: it goes into the cache now, before the refetch lands
          qc.setQueryData<Strategy[]>(strategyKeys.list(), (old) => (old && !old.some((x) => x.id === d.id) ? [d, ...old] : old));
          openTrade({ strategyId: d.id, mode: kind });
        },
        onError: (e) => {
          setReenterId(null);
          toast.error("Could not re-enter", { description: e.message });
        },
      },
    );
  };
  const q = search.trim().toLowerCase();
  const [life, setLife] = useState<Lifecycle>("open");
  const all = useMemo(() => (data ?? []).filter((s) => s.status === kind), [data, kind]);
  // closed = archived strategies that were traded in this mode; they stay on this tab under the Closed chip (ADR-059)
  const closed = useMemo(() => (data ?? []).filter((s) => s.status === "archived" && s.tradingMode === kind), [data, kind]);
  // ADR-068: with several keys on an exchange the tab can be read per account (every strategy stays tagged with its key)
  const accounts = useMemo(() => credential?.items ?? [], [credential]);
  const [accountFilter, setAccountFilter] = useState<string | null>(null);
  const accountOf = (s: Strategy) => accountRefOf(s, accounts)?.accountId ?? null;
  const expiring = all.filter((s) => lifecycleOf(s) === "expiring"); // per render: the clock moves, the list does not
  const lifeRows = life === "closed" ? closed : life === "expiring" ? expiring : all;
  const accountRows = accountFilter === null ? lifeRows : lifeRows.filter((s) => accountOf(s) === accountFilter);
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
  const rows = useMemo(() => sortStrategies(accountRows.filter((s) => !q || `${s.name} ${s.asset} ${s.templateName}`.toLowerCase().includes(q)), sort, (s) => book.pnlOf(s).total), [accountRows, q, sort, book]);
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
  // HC-TR-175 (ADR-068): every live strategy is compared with the positions of the account it trades through, one
  // read per distinct account; a strategy from before accounts on an exchange with several keys names none and is
  // left out of the check (its card says so)
  // stable inputs for the batch dialog: its selection effect keys on these arrays, so a fresh filter per render would reset what the trader unticked (ADR-069 fix)
  const batchStrategies = useMemo(() => all.filter((s) => !dataOnly(s.venue)), [all]);
  const batchBrokers = useMemo(() => (brokers ?? []).filter((b) => !dataOnly(b.venue)), [brokers]);
  const refs = useMemo(() => {
    const m = new Map<string, AccountRef>();
    if (kind === "live") for (const s of all) {
      const ref = accountRefOf(s, accounts);
      if (ref && ref.accountId !== null) m.set(accountKey(ref.brokerId, ref.accountId), ref);
    }
    return [...m.values()];
  }, [all, accounts, kind]);
  const wallet = useAccountPositions(refs, kind === "live" && connected);
  // the wallet behind the tab: the settling-asset balance of every account the tab's strategies trade through (ADR-068)
  const walletRows = [...wallet.byKey.values()].map((d) => ["USD", "USDT", "INR"].map((a) => d.balances.find((b) => b.asset === a)).find((b) => b !== undefined) ?? d.balances[0]).filter((r) => r !== undefined);
  const walletAccounts = wallet.byKey.size;
  // HC-TR-160: the exchange's net position per contract against the open live legs; a stop, a manual close or a
  // liquidation on the exchange leaves a strategy out of sync until it is reconciled (HC-TR-161)
  // only a fresh, successful read counts: a venue that did not answer is 503 (never an empty list), and a stale
  // snapshot kept after an error must not be compared with fresh legs
  const driftReady = kind === "live" && refs.length > 0 && wallet.ready && wallet.error === null;
  const drift = useMemo(() => {
    const out = new Map<string, DriftRow[]>();
    if (!driftReady) return out;
    for (const ref of refs) {
      const read = wallet.byKey.get(accountKey(ref.brokerId, ref.accountId));
      if (!read) continue;
      const mine = all.filter((s) => { const r = accountRefOf(s, accounts); return r !== null && r.accountId === ref.accountId && r.brokerId === ref.brokerId; });
      for (const [id, rows] of driftFor(read.positions, mine, (a) => book.lotSizeOf(a), Date.now())) out.set(id, rows);
    }
    return out;
  }, [driftReady, refs, wallet.byKey, wallet.updatedAt, all, accounts, book]); // updatedAt: an unchanged read still moves the clock past the settling window
  const [reconcileId, setReconcileId] = useState<string | null>(null);
  const reconciling = reconcileId ? (all.find((s) => s.id === reconcileId) ?? null) : null;
  // the price a gone leg is booked at: the exchange's mark while it still quotes the contract, else the pane's mark
  // (the position is usually gone, so the venue has none), else the dialog falls back to the entry
  const venueMarkOf = useCallback((l: StrategyLeg) => wallet.positions.find((p) => p.symbol === l.symbol)?.mark ?? (reconciling ? (book.priceOf(reconciling, l)?.toString() ?? null) : null), [wallet.positions, reconciling, book]);
  const marginTotal = walletRows.length ? walletRows.reduce((sum, r) => sum + Number(r.balance), 0) : null;
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
        {accounts.length > 1 ? (
          <div className="flex items-center gap-1" role="group" aria-label="Account" data-testid={`${kind}-accounts`}>
            {[null, ...accounts.map((a) => a.id)].map((id) => {
              const n = id === null ? lifeRows.length : lifeRows.filter((s) => accountOf(s) === id).length;
              return (
                <button key={id ?? "all"} type="button" aria-pressed={accountFilter === id} onClick={() => { setAccountFilter(id); setPage(1); }} className={cn("rounded-full border px-2.5 py-0.5 text-xs", accountFilter === id ? "border-foreground text-foreground" : "border-border text-muted-foreground hover:text-foreground")} title={id === null ? "Every account" : "Strategies trading through this key (ADR-068)"} data-testid={`${kind}-account-${id ?? "all"}`} data-count={n}>
                  {id === null ? "All accounts" : accountLabel(accounts, id)} <span className="text-muted-foreground">{n}</span>
                </button>
              );
            })}
          </div>
        ) : null}
        <Button size="sm" variant="outline" onClick={() => void refetch().then(() => toast("Refreshed", { description: "Strategy data has been updated" }))} data-testid={`${kind}-refresh`}>
          Refresh
        </Button>
        {kind === "paper" ? (
          <Button size="sm" variant="outline" className="ml-auto" disabled={all.length === 0} title={all.length ? "Place every open paper strategy as live orders (batch selector)" : "No paper strategies"} onClick={() => { setBatchMindful(mindfulFor(settings?.mindful, data, book)); setBatch(true); }} data-testid="trade-all-live">
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
        <div className="rounded border border-border px-2 py-1.5" title="Σ worst expiry loss of the defined-risk strategies (the exchange margin replaces it for live positions)"><div className="micro">Margin used</div><div className="num text-[15px] font-medium" data-testid={`${kind}-margin-used`}>{portfolio.open ? fmtMoney(portfolio.marginUsed, money) : "—"}</div>{marginTotal !== null && marginTotal > 0 ? <div className="micro"><span className="mr-1">of {fmtMoney(marginTotal, money)}{walletAccounts > 1 ? ` · ${walletAccounts} accounts` : ""} · {Math.min(999, (portfolio.marginUsed / marginTotal) * 100).toFixed(0)}%</span><span className="inline-block h-1 w-12 overflow-hidden rounded bg-muted align-middle"><i className="block h-full bg-[hsl(var(--curve))]" style={{ width: `${Math.min(100, (portfolio.marginUsed / marginTotal) * 100).toFixed(0)}%` }} /></span></div> : <div className="micro">{portfolio.undefinedRisk ? `${portfolio.undefinedRisk} undefined-risk ${portfolio.undefinedRisk === 1 ? "strategy" : "strategies"} excluded` : portfolio.pending && !portfolio.open ? "pricing the book…" : kind === "live" ? "wallet balance once connected" : "worst expiry loss · defined risk"}</div>}</div>
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
            {kind === "live" && connected && wallet.error !== null ? (
              <div className="flex flex-wrap items-center gap-2 rounded border border-warning/50 bg-warning/5 px-2 py-1.5 text-2xs" data-testid="live-drift-paused">
                <b className="text-warning">Exchange positions could not be read</b>
                <span className="text-muted-foreground">the out-of-sync check is paused until the next successful read · {wallet.error.message}</span>
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
              const left = ex ? daysLeft(ex.nearest, Date.now(), settlementHourUtc(s.asset, s.venue)) : null;
              const settleMs = ex ? settlementMsOf(ex.nearest, s.asset) : null;
              const expired = lc !== "closed" && settleMs !== null && settleMs <= Date.now();
              const settling = expired && isSettling(ex!.nearest, s.asset, Date.now());
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
                      openAdjust(s.id, false, s.venue); // HC-TR-152: A opens the workbench on the focused card
                    }
                  }}
                  data-testid={`${kind}-card`}
                  data-id={s.id}
                  data-life={lc}
                  data-followed={paneSource?.kind === "strategy" && paneSource.id === s.id ? "true" : undefined}
                >
                  <div className="flex flex-wrap items-start gap-2">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2 text-[13px] font-medium"><span className="truncate">{s.name}</span><ModePill status={s.status} />{kind === "live" && accounts.length > 1 ? <span className={cn("micro rounded border px-1", accountRefOf(s, accounts)?.accountId ? "border-border" : "border-warning text-warning")} title={accountRefOf(s, accounts)?.accountId ? "The exchange key this strategy trades through (ADR-068)" : "Placed before accounts: name it by going live again, or its exits and the out-of-sync check cannot find its key"} data-testid="card-account" data-account-id={accountRefOf(s, accounts)?.accountId ?? ""}>{accountLabel(accounts, accountRefOf(s, accounts)?.accountId) ?? "no account named"}</span> : null}<AdjustedBadge s={s} />{drift.get(s.id) ? <span className="micro rounded border border-loss bg-loss/10 px-1 text-loss" title={driftTitle(drift.get(s.id)!)} data-testid="card-drift" data-state="out-of-sync">out of sync</span> : null}{kind === "live" && s.orderBatchId ? <span className="micro rounded border border-border px-1 font-mono" title={`Order batch ${s.orderBatchId}`} data-testid="card-batch">batch {s.orderBatchId.slice(-6)}</span> : null}</div>
                      <div className="micro flex flex-wrap gap-2"><span className="rounded border border-border px-1">{s.asset}</span><span><b>{open.length}</b>/{s.legs.length} legs</span>{s.templateName ? <span>{s.templateName}</span> : null}</div>
                      <div className="micro mt-0.5 flex flex-wrap gap-x-2 normal-case tracking-normal" data-testid="card-expiry" data-days={left ?? undefined}>
                        <span>started <b className="num">{s.startedAt ? fmtDate(s.startedAt) : "—"}</b> · {daysOf(s)}d</span>
                        {lc === "closed" ? (
                          <span>closed <b className="num">{s.closedAt ? fmtDate(s.closedAt) : "—"}</b>{s.closeReason ? <span className="ml-1 rounded border border-border px-1" title="Why it closed (ADR-059)" data-testid="card-close-reason" data-reason={s.closeReason}>{CLOSE_REASON_LABELS[s.closeReason]}</span> : null}</span>
                        ) : ex ? (
                          <span>expires <b className={cn("num", left !== null && left <= 1 && "text-warning")}>{ex.nearest === ex.latest ? fmtExpiry(ex.nearest) : `${fmtExpiry(ex.nearest)} → ${fmtExpiry(ex.latest)}`}</b>{expired ? <span className="text-warning" data-testid="card-settling" data-state={settling ? "settling" : "unsettled"}> · {settling ? "expired, settling" : "expired, not settled yet"}</span> : left !== null ? <span className={cn(left <= 1 && "text-warning")}> ({left}d)</span> : null}</span>
                        ) : (
                          <span>no open option legs</span>
                        )}
                        {lc !== "closed" && rulesLine(s.rules, money, s.legs) ? <span className="text-accent" title="Exit rules run by the server (ADR-059 §2.3)" data-testid="card-rules">{rulesLine(s.rules, money, s.legs)}</span> : lc !== "closed" && open.length ? <span className="text-muted-foreground" data-testid="card-rules" data-state="none">no stop</span> : null}
                        {firedRule(s.rules) ? <span className={cn("rounded border px-1", firedRule(s.rules)!.outcome === "partial" ? "border-loss text-loss" : "border-border text-muted-foreground")} title={firedRule(s.rules)!.note ?? undefined} data-testid="card-rule-fired" data-kind={firedRule(s.rules)!.kind} data-outcome={firedRule(s.rules)!.outcome ?? undefined}>{FIRED_LABELS[firedRule(s.rules)!.kind]}{firedRule(s.rules)!.outcome === "partial" ? " · a leg still open" : ""}</span> : null}
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
                      <Button size="sm" variant="destructive" className="ml-auto" loading={retry.isPending} onClick={() => setRetryForId(s.id)} data-testid="card-retry">Retry Failed Orders</Button>
                    </div>
                  ) : null}
                  <div className="mt-2 flex flex-wrap gap-1">
                    <Button size="sm" variant="outline" onClick={() => openDetails(s.id)} data-testid="card-details">Details</Button>
                    {lc === "closed" ? <Button size="sm" variant="outline" onClick={() => setWorkspaceTab("journal")} title="This trade in the Journal" data-testid="card-journal">Journal</Button> : null}
                    {lc === "closed" && heldAtClose(s).length ? (
                      <Button size="sm" variant="outline" disabled={reenterExpired(s) || (create.isPending && reenterId !== s.id)} loading={reenterId === s.id} title={reenterExpired(s) ? "Its expiry has passed · build it afresh in the Builder" : `Re-enter: the legs it held when it closed, as a new draft at today's marks, then the ${kind} trade dialog · nothing is placed until you confirm`} onClick={() => reenter(s)} data-testid="card-reenter" data-expired={reenterExpired(s)}>
                        Re-enter
                      </Button>
                    ) : null}
                    {lc !== "closed" ? <Button size="sm" variant="outline" disabled={open.length === 0} title={open.length ? "Adjust: trim, close or add legs with the combined payoff (A)" : "No open legs"} onClick={() => openAdjust(s.id, false, s.venue)} data-testid="card-adjust">Adjust</Button> : null}
                    {lc !== "closed" && open.length ? <Button size="sm" variant="outline" title="Exit rules run by the server: stop / target, leg stop, spot level, time exit (ADR-059 §2.3)" onClick={() => openRules(s.id)} data-testid="card-protect">{rulesLine(s.rules, money, s.legs) ? "Protect…" : "Protect"}</Button> : null}
                    {lc !== "closed" ? <Button size="sm" variant="outline" title="Alert me when this strategy's P&L crosses a level" onClick={() => openAlerts({ kind: "pnl", strategyId: s.id, asset: s.asset })} data-testid="card-alert">Set alert</Button> : null}
                    {lc === "closed" ? null : kind === "paper" ? (
                      <>
                        <Button size="sm" variant="outline" disabled={!connected || open.length === 0} title={connected ? "Place these legs as live orders" : "Connect your exchange first"} onClick={() => openTrade({ strategyId: s.id, mode: "live" })} data-testid="card-golive">Go live</Button>
                        <Button size="sm" variant="outline" className="text-warning" onClick={() => setStopId(s.id)} data-testid="card-stop" data-tour="paper-stop">Stop</Button>
                      </>
                    ) : (
                      <>
                        {s.orders.some((o) => o.state === "pending") ? <Button size="sm" variant="outline" loading={sync.isPending} onClick={() => sync.mutate(s.id, { onSuccess: () => toast("Synced", { description: "Order states refreshed from the exchange" }) })} data-testid="card-sync">Sync</Button> : null}
                        {drift.get(s.id) ? <Button size="sm" variant="destructive" loading={reconcilePending === s.id} onClick={() => { setReconcilePending(s.id); void wallet.refetch().then((ok) => { setReconcilePending(null); if (ok) setReconcileId(s.id); }); }} title="Re-reads the exchange first, then books the lots it no longer holds as closed · no orders are sent" data-testid="card-reconcile">Reconcile</Button> : null}
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
      <RetryDialog strategy={retryFor} open={retryFor !== null} onOpenChange={(o) => !o && setRetryForId(null)} busy={retry.isPending} brokerName={book.brokerName(retryFor?.brokerId ?? null)} onRetry={(id, confirm) => retry.mutate({ id, confirm }, { onSuccess: (r) => { const left = r ? r.orders.filter((o) => o.state === "failed").length : 0; if (left) toast.error("Still failing", { description: `${left} ${left === 1 ? "order" : "orders"} refused again` }); else toast.success("Orders placed", { description: "All legs are filled" }); }, onError: (e) => toast.error("Retry refused", { description: e.message }), onSettled: () => setRetryForId(null) })} />
      {kind === "paper" ? <BatchLiveDialog open={batch} onOpenChange={(o) => { setBatch(o); if (!o) setBatchMindful(null); }} strategies={batchStrategies} brokers={batchBrokers} accounts={accounts} connected={connected} money={money} totalOf={(s) => book.pnlOf(s).total} mindful={batchMindful} /> : null}
      <ReconcileDialog strategy={reconciling} rows={reconciling ? (drift.get(reconciling.id) ?? []) : []} markOf={venueMarkOf} onOpenChange={(o) => { if (!o) { setReconcileId(null); void refetch(); void wallet.refetch(); } }} />
      {stopping ? <StopPaperDialog open={true} onOpenChange={(o) => !o && setStopId(null)} strategy={stopping} priceOf={(l) => book.priceOf(stopping, l)} total={book.pnlOf(stopping).total} money={money} live={feedLive} onDone={() => void qc.invalidateQueries({ queryKey: strategyKeys.all })} /> : null}
    </section>
  );
}
