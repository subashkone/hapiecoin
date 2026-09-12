"use client";
// Net positions on the exchange for the Live tab (HC-TR-144, HC-TR-145, ADR-026): the venue's own view of what is
// open, ticked rows feed the analysis pane, Exit / Exit all square off through the executor with a confirm step.
import type { LivePosition } from "@hapiecoin/schema";
import { Button, Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, cn, toast } from "@hapiecoin/ui";
import { useEffect, useMemo, useState } from "react";
import { newIdempotencyKey, useLiveExitPositions, useLivePositions } from "@/lib/api/live";
import { useBrokers, useCredential } from "@/lib/api/queries";
import { DEFAULT_VENUE } from "@hapiecoin/venues/core";
import { fmtExpiry, fmtPrice, fmtStrike } from "@/lib/format";
import { fmtMoney, type MoneyFormat } from "@/lib/money";
import { useUiStore } from "@/lib/store";
import { parseVenueSymbol, positionPnl } from "@/lib/strategy/positions";

const ASSET_FILTERS = ["All", "BTC", "ETH", "XAUT"] as const;

/** "SHORT 78,000 CE · 25 Sep 26" from a position, or the raw symbol when it cannot be parsed. */
/** Exchange positions come from the connected exchange, so their symbols parse with that venue's codec (Delta India, the only venue with live trading, by default). */
export function positionLabel(p: LivePosition, venue: string = DEFAULT_VENUE): { title: string; sub: string } {
  const parsed = p.symbol ? parseVenueSymbol(p.symbol, venue) : null;
  const side = p.size > 0 ? "LONG" : "SHORT";
  if (!parsed) return { title: `${side} ${p.symbol ?? p.productId}`, sub: "" };
  if (parsed.kind === "future") return { title: `${side} ${parsed.asset} perpetual`, sub: p.symbol ?? "" };
  return { title: `${side} ${fmtStrike(parsed.strike)} ${parsed.kind === "call" ? "CE" : "PE"}`, sub: `Exp ${fmtExpiry(parsed.expiry)} · ${parsed.asset}` };
}

export function NetPositionsPanel({ money }: { money: MoneyFormat }) {
  const { data: credential } = useCredential();
  const { data: brokers } = useBrokers();
  const brokerId = credential?.items[0]?.brokerId ?? null;
  const venue = brokers?.find((b) => b.id === brokerId)?.venue ?? DEFAULT_VENUE;
  const positions = useLivePositions(brokerId);
  const exit = useLiveExitPositions();
  const paneSource = useUiStore((s) => s.paneSource);
  const analysePositions = useUiStore((s) => s.analysePositions);
  const [asset, setAsset] = useState<(typeof ASSET_FILTERS)[number]>("All");
  const [confirm, setConfirm] = useState<number[] | null>(null);
  const [key, setKey] = useState("");

  const rows = useMemo(() => (positions.data?.positions ?? []).filter((p) => p.size !== 0).filter((p) => asset === "All" || (p.symbol ? parseVenueSymbol(p.symbol, venue)?.asset === asset : false)), [positions.data, asset, venue]);
  const ticked = paneSource?.kind === "positions" ? paneSource.productIds : [];
  const total = rows.reduce((s, p) => s + (positionPnl(p) ?? 0), 0);
  useEffect(() => {
    if (confirm) setKey(newIdempotencyKey());
  }, [confirm]);
  // the header wallet chip shares this query and may hold a snapshot from before the last order: refresh on mount
  const refetch = positions.refetch;
  useEffect(() => {
    if (brokerId) void refetch();
  }, [brokerId, refetch]);
  // ticked ids that disappeared (closed elsewhere) drop out of the pane source
  useEffect(() => {
    if (!positions.data || paneSource?.kind !== "positions") return;
    const alive = paneSource.productIds.filter((id) => positions.data.positions.some((p) => p.productId === id && p.size !== 0));
    if (alive.length !== paneSource.productIds.length) analysePositions(alive);
  }, [positions.data, paneSource, analysePositions]);

  const toggle = (id: number) => analysePositions(ticked.includes(id) ? ticked.filter((x) => x !== id) : [...ticked, id]);
  const go = () => {
    if (!confirm || !brokerId) return;
    exit.mutate(
      { brokerId, productIds: confirm, idempotencyKey: key },
      {
        onSuccess: (r) => {
          setConfirm(null);
          if (r.failed.length) toast.error(`${r.failed.length} ${r.failed.length === 1 ? "exit" : "exits"} refused`, { description: r.failed.map((f) => `#${f.productId}: ${f.error}`).join(" · ") });
          if (r.closed.length) toast.success("Positions squared off", { description: `${r.closed.length} ${r.closed.length === 1 ? "position" : "positions"} closed at market` });
        },
        onError: (e) => toast.error("Exit refused", { description: e.message }),
      },
    );
  };

  if (!brokerId) {
    return (
      <div className="border-b border-border px-3 py-2 text-2xs text-muted-foreground" data-testid="net-positions" data-state="disconnected">
        Net positions appear here once your exchange is connected in Settings → API Settings.
      </div>
    );
  }
  return (
    <div className="border-b border-border" data-testid="net-positions" data-state={positions.isError ? "error" : positions.data ? "ready" : "loading"} data-count={rows.length}>
      <div className="flex flex-wrap items-center gap-2 px-3 py-2">
        <span className="micro">Net positions</span>
        <span className="micro inline-flex items-center gap-1 text-profit"><i className="inline-block h-1.5 w-1.5 rounded-full bg-profit" />exchange</span>
        <div className="ml-auto flex gap-1">
          {ASSET_FILTERS.map((a) => (
            <button key={a} type="button" aria-pressed={asset === a} onClick={() => setAsset(a)} className={cn("rounded px-1.5 py-0.5 text-2xs", asset === a ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground")} data-testid={`positions-asset-${a.toLowerCase()}`}>
              {a}
            </button>
          ))}
        </div>
        <Button size="sm" variant="outline" className="text-loss" disabled={rows.length === 0} onClick={() => setConfirm(rows.map((p) => p.productId))} data-testid="positions-exit-all">
          Exit all
        </Button>
        <Button size="sm" variant="outline" loading={positions.isFetching} onClick={() => void positions.refetch()} data-testid="positions-refresh">
          ↻
        </Button>
      </div>
      {positions.isError ? (
        <div className="px-3 pb-2 text-2xs text-loss" data-testid="positions-error">{positions.error.message}</div>
      ) : rows.length === 0 ? (
        <div className="px-3 pb-2 text-2xs text-muted-foreground" data-testid="positions-empty">{positions.data ? "No open positions on the exchange." : "Loading positions…"}</div>
      ) : (
        <table className="w-full text-xs" data-testid="positions-table">
          <thead>
            <tr className="micro text-left">
              <th className="w-6 px-3 py-1">
                <input type="checkbox" aria-label="Tick every position" checked={rows.every((p) => ticked.includes(p.productId))} onChange={(e) => analysePositions(e.target.checked ? rows.map((p) => p.productId) : [])} data-testid="positions-tick-all" />
              </th>
              <th className="py-1 pr-2">Position</th>
              <th className="py-1 pr-2 text-right">Size</th>
              <th className="py-1 pr-2 text-right">Entry</th>
              <th className="py-1 pr-2 text-right">Mark</th>
              <th className="py-1 pr-2 text-right">P&L</th>
              <th className="py-1 pr-3 text-right">Exit</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => {
              const l = positionLabel(p, venue);
              const pnl = positionPnl(p);
              const on = ticked.includes(p.productId);
              return (
                <tr key={p.productId} className={cn("border-t border-border", on && "bg-muted/40")} data-testid="position-row" data-product={p.productId} data-ticked={on ? "true" : undefined}>
                  <td className="px-3 py-1">
                    <input type="checkbox" aria-label={`Analyse ${l.title}`} checked={on} onChange={() => toggle(p.productId)} data-testid="position-tick" />
                  </td>
                  <td className="py-1 pr-2">
                    <div className={cn("font-medium", p.size > 0 ? "text-buy" : "text-sell")}>{l.title}</div>
                    <div className="micro">{l.sub}</div>
                  </td>
                  <td className={cn("num py-1 pr-2 text-right", p.size > 0 ? "text-buy" : "text-sell")}>{p.size > 0 ? `+${p.size}` : p.size}</td>
                  <td className="num py-1 pr-2 text-right">{p.entryPrice ? fmtPrice(p.entryPrice, 2) : "—"}</td>
                  <td className="num py-1 pr-2 text-right">{p.mark ? fmtPrice(p.mark, 2) : "—"}</td>
                  <td className={cn("num py-1 pr-2 text-right", pnl === null ? "text-muted-foreground" : pnl >= 0 ? "text-profit" : "text-loss")} data-testid="position-pnl">{pnl === null ? "—" : fmtMoney(pnl, money, { signed: true })}</td>
                  <td className="py-1 pr-3 text-right">
                    <button type="button" className="rounded px-1 text-loss hover:bg-loss/10" title="Square off this position at market" onClick={() => setConfirm([p.productId])} data-testid="position-exit">✕</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="border-t border-border text-2xs">
              <td colSpan={5} className="px-3 py-1">Total P&L <b className={cn("num", total >= 0 ? "text-profit" : "text-loss")} data-testid="positions-total">{fmtMoney(total, money, { signed: true })}</b></td>
              <td colSpan={2} className="micro py-1 pr-3 text-right">{ticked.length ? `${ticked.length} ticked · analysed in the pane →` : "Tick positions to analyse →"}</td>
            </tr>
          </tfoot>
        </table>
      )}
      <Dialog open={confirm !== null} onOpenChange={(o) => !o && setConfirm(null)}>
        <DialogContent className="sm:max-w-[520px]" data-testid="exit-positions">
          <DialogHeader>
            <DialogTitle>Square off {confirm?.length === 1 ? "position" : `${confirm?.length ?? 0} positions`}</DialogTitle>
            <DialogDescription>Reduce-only market orders on the exchange. Real funds.</DialogDescription>
          </DialogHeader>
          <DialogBody>
            <ul className="text-xs">
              {(confirm ?? []).map((id) => {
                const p = rows.find((r) => r.productId === id);
                if (!p) return null;
                const l = positionLabel(p, venue);
                return (
                  <li key={id} className="flex justify-between border-t border-border py-1" data-testid="exit-row">
                    <span>{l.title} <span className="micro">{l.sub}</span></span>
                    <span className="num">{p.size > 0 ? `+${p.size}` : p.size} contracts</span>
                  </li>
                );
              })}
            </ul>
            <div className="mt-3 rounded border border-loss/40 p-2 text-2xs">Orders are placed at market. Prices may differ from the marks shown. HapieCoin legs matching these positions are squared off with the fills.</div>
          </DialogBody>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirm(null)}>Cancel</Button>
            <Button variant="destructive" loading={exit.isPending} onClick={go} data-testid="exit-confirm">Square off →</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
