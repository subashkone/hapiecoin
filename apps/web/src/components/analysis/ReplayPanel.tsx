"use client";
// Replay tab (ADR-079; HC-WS-114): an expiry's chain as the venue published it, scrubbed through the recorded instants:
// daily from the end-of-day history, every five minutes over the last week. The ladder, the spot and, when the Builder
// holds legs on that expiry, what those legs were marked at then and the position's mark-to-market versus entry. Only
// recorded marks: a leg without one at that instant says so, nothing is modelled, nothing here is a fill.
import type { ReplayChain, ReplayRow } from "@hapiecoin/schema";
import { Button, EmptyState, cn } from "@hapiecoin/ui";
import { useEffect, useMemo, useState } from "react";
import { ApiError } from "@/lib/api/client";
import { useReplayChain, useReplayExpiries, useReplaySteps } from "@/lib/api/replay";
import { useSettings } from "@/lib/api/queries";
import { fmtDate, fmtExpiry, fmtIv, fmtPrice, fmtStrike } from "@/lib/format";
import { type MoneyFormat, USD, fmtMoney } from "@/lib/money";
import { atmIndex } from "@/lib/gateway/reducer";
import { useUiStore } from "@/lib/store";
import type { StrategyLeg } from "@/lib/strategy/legs";
import { useVenueId } from "@/lib/useVenue";
import { lotSizeFor } from "@/lib/venue";

type Resolution = "daily" | "fine";
const PLAY_MS = 400;

const clock = (iso: string) => `${fmtDate(iso)} ${new Date(iso).toISOString().slice(11, 16)} UTC`;

/** The Builder's open legs on the replayed expiry, each with its mark at the instant (null when the ladder has none). */
export function legsThen(legs: readonly StrategyLeg[], expiry: string, rows: readonly ReplayRow[]): { leg: StrategyLeg; mark: number | null }[] {
  return legs
    .filter((l) => l.status === "open" && l.enabled !== false && l.kind !== "future" && l.expiry === expiry)
    .map((leg) => {
      const row = rows.find((r) => Number(r.strike) === Number(leg.strike));
      const q = leg.kind === "call" ? row?.call : row?.put;
      return { leg, mark: q ? q.mark : null };
    });
}

/** Position mark-to-market versus entry over the option legs with a recorded mark, in quote currency; null when any leg lacks one or the lot size is unknown. */
export function markToMarket(then: readonly { leg: StrategyLeg; mark: number | null }[], lotSize: number): number | null {
  if (then.length === 0 || !(lotSize > 0) || then.some((x) => x.mark === null)) return null;
  return then.reduce((s, x) => s + (x.leg.side === "buy" ? 1 : -1) * x.leg.lots * lotSize * ((x.mark ?? 0) - Number(x.leg.price)), 0);
}

export function ReplayPanel() {
  const asset = useUiStore((s) => s.asset);
  const legs = useUiStore((s) => s.legs[s.asset]);
  const venue = useVenueId();
  const { data: settings } = useSettings();
  const money: MoneyFormat = settings ? { currency: settings.currency, rate: settings.conversionRate } : USD;
  const lotSize = Number(lotSizeFor(venue, asset, settings) ?? 0);
  const expiries = useReplayExpiries(asset);
  const [expiry, setExpiry] = useState<string | null>(null);
  const [wanted, setResolution] = useState<Resolution>("daily");
  // the position is kept per (expiry, resolution): a new pair opens at its end, a refetch never moves the slider
  const [pos, setPos] = useState<{ key: string; index: number } | null>(null);
  const [playing, setPlaying] = useState(false);
  const listedFirst = expiries.data?.expiries.find((e) => e.listed)?.expiry ?? expiries.data?.expiries[0]?.expiry ?? null;
  const chosen = expiry && expiries.data?.expiries.some((e) => e.expiry === expiry) ? expiry : listedFirst;
  const steps = useReplaySteps(asset, chosen);
  // the wanted resolution, unless it has no instants for this expiry and the other has
  const resolution: Resolution = wanted === "daily" ? (steps.data && steps.data.daily.length === 0 && steps.data.fine.length > 0 ? "fine" : "daily") : steps.data && steps.data.fine.length === 0 && steps.data.daily.length > 0 ? "daily" : "fine";
  const list = useMemo(() => (resolution === "daily" ? (steps.data?.daily ?? []) : (steps.data?.fine ?? [])), [steps.data, resolution]);
  const last = Math.max(0, list.length - 1);
  const key = `${chosen ?? ""}:${resolution}`;
  const index = pos && pos.key === key ? Math.min(pos.index, last) : last;
  const setIndex = (next: number | ((i: number) => number)) => setPos({ key, index: typeof next === "function" ? next(index) : next });
  const at = list[index]?.ts ?? null;
  const chain = useReplayChain(asset, chosen, at);
  useEffect(() => {
    if (!playing) return;
    if (index >= last) {
      setPlaying(false);
      return;
    }
    const id = setTimeout(() => setIndex((i) => Math.min(i + 1, last)), PLAY_MS);
    return () => clearTimeout(id);
  }, [playing, index, last]);
  const c: ReplayChain | undefined = chain.data;
  // the previous ladder stays on screen while the next loads; the readout and the legs follow only the live one
  const live = c && c.expiry === chosen && c.at === at ? c : undefined;
  const then = useMemo(() => (live && chosen ? legsThen(legs, chosen, live.rows) : []), [live, chosen, legs]);
  const mtm = useMemo(() => markToMarket(then, lotSize), [then, lotSize]);
  const perps = legs.filter((l) => l.status === "open" && l.enabled !== false && l.kind === "future").length;
  const atmIdx = c ? atmIndex(c.rows, String(c.spot)) : -1;
  const notYet = expiries.isError && expiries.error instanceof ApiError && expiries.error.status === 503;
  const state = notYet ? "empty" : expiries.isError || steps.isError || chain.isError ? "error" : !c ? "loading" : live ? "ready" : "stale";
  const today = new Date().toISOString().slice(0, 10);
  const errorText = [expiries, steps, chain].map((q) => (q.isError ? (q.error instanceof Error ? q.error.message : String(q.error)) : null)).find((m) => m !== null) ?? null;
  const legMarks = new Map(then.map((x) => [`${x.leg.kind}:${Number(x.leg.strike)}`, x]));
  return (
    <div className="flex h-full min-h-0 flex-col gap-2 overflow-auto p-2" data-testid="replay-panel" data-state={state} data-at={at ?? ""} data-source={live?.source ?? ""} data-steps={list.length} data-resolution={resolution}>
      <div className="flex flex-wrap items-end gap-2 text-xs">
        <label className="flex flex-col gap-0.5">
          <span className="micro">Expiry</span>
          <select value={chosen ?? ""} onChange={(e) => setExpiry(e.target.value)} className="h-7 rounded border border-input bg-background px-1 text-xs" data-testid="replay-expiry" disabled={!expiries.data}>
            {(expiries.data?.expiries ?? []).map((e) => (
              <option key={e.expiry} value={e.expiry}>
                {fmtExpiry(e.expiry, true)} · {e.days} {e.days === 1 ? "day" : "days"}
                {e.listed ? "" : e.expiry < today ? " · settled" : " · delisted"}
              </option>
            ))}
          </select>
        </label>
        <div className="flex gap-1" role="group" aria-label="Resolution">
          {(
            [
              ["daily", "Daily", steps.data?.daily.length ?? 0],
              ["fine", "5-min", steps.data?.fine.length ?? 0],
            ] as const
          ).map(([id, label, n]) => (
            <Button key={id} size="sm" variant={resolution === id ? "secondary" : "ghost"} onClick={() => setResolution(id)} aria-pressed={resolution === id} disabled={n === 0} title={id === "fine" ? "Every recorded pass over the last week" : "One instant per recorded end of day"} data-testid={`replay-res-${id}`}>
              {label} · {n}
            </Button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-1">
          <Button size="sm" variant="outline" onClick={() => setIndex((i) => Math.max(0, i - 1))} disabled={index <= 0} aria-label="Previous instant" data-testid="replay-prev">
            ‹
          </Button>
          <Button
            size="sm"
            variant={playing ? "secondary" : "outline"}
            onClick={() => {
              if (!playing && index >= last) setIndex(0); // at the end, play again from the start
              setPlaying((p) => !p);
            }}
            disabled={list.length < 2}
            aria-pressed={playing}
            title="Step through the recorded instants"
            data-testid="replay-play"
          >
            {playing ? "Pause" : "Play"}
          </Button>
          <Button size="sm" variant="outline" onClick={() => setIndex((i) => Math.min(last, i + 1))} disabled={index >= last} aria-label="Next instant" data-testid="replay-next">
            ›
          </Button>
        </div>
      </div>
      <input type="range" min={0} max={last} value={Math.min(index, last)} onChange={(e) => setIndex(Number(e.target.value))} disabled={list.length === 0} aria-label="Recorded instant" className="w-full" data-testid="replay-slider" />
      {state === "empty" ? (
        <EmptyState title="Nothing recorded yet" description={`A replay needs a recorded chain for ${asset}; the first end-of-day chain lands at the settlement hour once the venue's chain is being recorded.`} data-testid="replay-empty" />
      ) : state === "error" ? (
        <p className="text-xs text-loss" data-testid="replay-error">
          {errorText}
        </p>
      ) : !c ? (
        <p className="text-xs text-muted-foreground">Loading…</p>
      ) : (
        <>
          <div className={cn("flex flex-wrap gap-x-4 gap-y-1 text-xs", !live && "opacity-60")} data-testid="replay-readout" data-live={live !== undefined}>
            {live ? (
              <>
                <span>
                  <span className="micro">At </span>
                  <b className="num" data-testid="replay-at">{clock(live.at)}</b>
                </span>
                <span>
                  <span className="micro">Spot </span>
                  <b className="num" data-testid="replay-spot">{fmtPrice(live.spot)}</b>
                </span>
                <span className="text-muted-foreground" data-testid="replay-source">
                  {live.source === "eod" ? "recorded end of day" : "recorded 5-minute pass"} · {list.length ? `${index + 1} of ${list.length}` : ""}
                </span>
                {then.length ? (
                  <span data-testid="replay-mtm">
                    <span className="micro">
                      Your {then.length} option {then.length === 1 ? "leg" : "legs"} then{perps ? ` (${perps} perpetual ${perps === 1 ? "leg" : "legs"} not included)` : ""}{" "}
                    </span>
                    {mtm === null ? <b className="text-warning">{lotSize > 0 ? "a leg has no recorded mark at this instant" : "lot size unknown"}</b> : <b className={cn("num", mtm > 0 ? "text-profit" : mtm < 0 ? "text-loss" : "")}>{fmtMoney(mtm, money, { signed: true })} vs entry</b>}
                  </span>
                ) : null}
              </>
            ) : (
              <span className="text-muted-foreground">Loading the instant…</span>
            )}
          </div>
          <div className="overflow-x-auto">
          <table className="w-full min-w-[360px] text-2xs" data-testid="replay-ladder" data-rows={c.rows.length}>
            <thead className="text-muted-foreground">
              <tr>
                <th className="py-1 text-right font-normal">Call mark</th>
                <th className="py-1 text-right font-normal">IV</th>
                <th className="py-1 text-center font-normal">Strike</th>
                <th className="py-1 text-right font-normal">IV</th>
                <th className="py-1 text-right font-normal">Put mark</th>
              </tr>
            </thead>
            <tbody>
              {c.rows.map((r, i) => {
                const callLeg = legMarks.get(`call:${Number(r.strike)}`);
                const putLeg = legMarks.get(`put:${Number(r.strike)}`);
                return (
                  <tr key={r.strike} className={cn("border-t border-border", i === atmIdx && "bg-accent/10")} data-testid="replay-row" data-atm={i === atmIdx} data-strike={r.strike}>
                    <td className={cn("num py-0.5 pr-2 text-right", callLeg && (callLeg.leg.side === "buy" ? "text-buy" : "text-sell"))}>
                      {r.call ? fmtPrice(r.call.mark) : "—"}
                      {callLeg ? <span className="ml-1 text-2xs" data-testid="replay-leg" data-side={callLeg.leg.side}>{callLeg.leg.side === "buy" ? "B" : "S"}</span> : null}
                    </td>
                    <td className="num py-0.5 pr-2 text-right text-muted-foreground">{r.call?.iv === null || r.call?.iv === undefined ? "—" : fmtIv(r.call.iv)}</td>
                    <td className="num py-0.5 text-center font-medium">{fmtStrike(r.strike)}</td>
                    <td className="num py-0.5 pl-2 text-right text-muted-foreground">{r.put?.iv === null || r.put?.iv === undefined ? "—" : fmtIv(r.put.iv)}</td>
                    <td className={cn("num py-0.5 pl-2 text-right", putLeg && (putLeg.leg.side === "buy" ? "text-buy" : "text-sell"))}>
                      {r.put ? fmtPrice(r.put.mark) : "—"}
                      {putLeg ? <span className="ml-1 text-2xs" data-testid="replay-leg" data-side={putLeg.leg.side}>{putLeg.leg.side === "buy" ? "B" : "S"}</span> : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          </div>
          <p className="text-2xs text-muted-foreground">Marks as the venue published them at that instant; no fills, no orders, nothing modelled.</p>
        </>
      )}
    </div>
  );
}
