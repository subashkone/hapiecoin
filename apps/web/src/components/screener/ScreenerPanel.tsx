"use client";
// Options screener (roadmap item 11, ADR-076; HC-WS-110..112): every listed option of the workspace asset across all
// its expiries, folded once per tick burst into sortable rows (premium per day, yield per day, IV against the
// expiry's ATM, |Δ|, break-even against spot, OI) with side / |Δ| / expiry / OI filters, and a per-expiry view (ATM
// IV, 25Δ skew, expected move, OI, PCR, term shape). Buy / Sell hand a pick to the Builder at the chain lots, exactly
// as the chain row does; Chain opens that expiry in the chain. Design: docs/design/options-screener.md.
import type { ChainRow } from "@hapiecoin/schema";
import { EmptyState, cn, toast } from "@hapiecoin/ui";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useIvHistory } from "@/lib/api/market";
import { useExpiries } from "@/lib/chain/useExpiries";
import { DEFAULT_FILTERS, DELTA_BANDS, SHOWN_ROWS, type SideFilter, type StrikeFilters, type StrikeRow, type ExpiryRow, filterStrikes, screen } from "@/lib/chain/screener";
import { fmtExpiry, fmtIv, fmtOi, fmtPrice, fmtStrike } from "@/lib/format";
import { useChains } from "@/lib/gateway/useChains";
import { useConnectionStatus, useSpot } from "@/lib/gateway/hooks";
import { useUiStore } from "@/lib/store";
import { type LegSide, MAX_ACTIVE_LEGS } from "@/lib/strategy/legs";
import { useVenueId } from "@/lib/useVenue";
import { venueCalendar } from "@/lib/venue";
import { type Column, DataTable } from "@/components/analytics/DataTable";

const SIDES: { id: SideFilter; label: string }[] = [
  { id: "both", label: "Both" },
  { id: "call", label: "Calls" },
  { id: "put", label: "Puts" },
];

const signed = (v: number | null, dp: number, unit = ""): string => (v === null ? "—" : `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(dp)}${unit}`);
const daysLabel = (d: number): string => (d < 1 ? "< 1 d" : `${Math.round(d)}d`);

/** Spot quantised to a step two orders below its magnitude (BTC 79,521 → 50 USD, XAUT 3,425 → 5 USD): the fold
 * reruns when spot moves about 0.06 %, not on every spot frame; the basis line shows the live figure. */
export function foldSpot(spot: number | null): number | null {
  if (spot === null || !(spot > 0)) return null;
  const step = 10 ** Math.floor(Math.log10(spot)) / 200;
  return Math.round(spot / step) * step;
}

function chip(on: boolean, disabled = false): string {
  return cn("rounded border px-2 py-0.5 text-2xs", on ? "border-foreground text-foreground" : "border-border text-muted-foreground hover:text-foreground", disabled && "opacity-50");
}

export function ScreenerPanel() {
  const asset = useUiStore((s) => s.asset);
  const venue = useVenueId();
  const chainLots = useUiStore((s) => s.chainLots);
  const addLeg = useUiStore((s) => s.addLeg);
  const setExpiry = useUiStore((s) => s.setExpiry);
  const setWorkspaceTab = useUiStore((s) => s.setWorkspaceTab);
  const expiries = useExpiries(asset);
  const chains = useChains(asset, expiries);
  const spot = useSpot(asset);
  const feed = useConnectionStatus();
  const { data: ivHistory } = useIvHistory(asset, true);
  const [view, setView] = useState<"strikes" | "expiries">("strikes");
  const [filters, setFilters] = useState<StrikeFilters>(DEFAULT_FILTERS);
  const spotRaw = spot?.price !== undefined ? Number(spot.price) : Number.NaN;
  const spotNum = Number.isFinite(spotRaw) ? spotRaw : null;
  const spotFold = foldSpot(spotNum);

  // one fold per chain burst: `chains` is a new Map per batched render (useChains) and spot enters quantised, so a
  // spot frame alone does not refold the board
  const board = useMemo(() => {
    const rowsBy = new Map<string, readonly ChainRow[]>();
    for (const e of expiries) {
      const c = chains.get(e);
      if (c && c.rows.length) rowsBy.set(e, c.rows);
    }
    return screen({ asset, chains: rowsBy, spot: spotFold, nowMs: Date.now(), calendar: venueCalendar(asset, venue) });
  }, [asset, chains, expiries, spotFold, venue]);
  const filtered = useMemo(() => filterStrikes(board.strikes, filters), [board.strikes, filters]);
  // the filters belong to one asset and venue; a chosen expiry that is no longer listed (settled, or another board) is dropped
  useEffect(() => setFilters(DEFAULT_FILTERS), [asset, venue]);
  useEffect(() => {
    setFilters((f) => {
      const kept = new Set([...f.expiries].filter((e) => expiries.includes(e)));
      return kept.size === f.expiries.size ? f : { ...f, expiries: kept };
    });
  }, [expiries]);

  const state = expiries.length === 0 ? "no-expiries" : board.priced.length === 0 ? "pending" : "ready";
  const rank = ivHistory?.rank ?? null;
  const basis = [
    `${board.strikes.length} options on ${board.priced.length} of ${expiries.length} expiries`,
    "basis mark",
    rank ? `IV rank ${Math.round(rank.rank)} · front expiry · ${rank.days} d` : null,
    spotNum ? `spot ${fmtPrice(spotNum)}` : "no spot yet",
    board.termShape ? `term ${board.termShape}` : null,
    feed === "open" ? "updated live" : "feed disconnected · figures from the last tick",
  ]
    .filter((x): x is string => x !== null)
    .join(" · ");

  const add = useCallback(
    (row: StrikeRow, side: LegSide) => {
      const r = addLeg({ asset, kind: row.side, side, strike: row.strike, expiry: row.expiry, lots: chainLots, price: String(row.mark), iv: row.iv ?? undefined });
      if (r.ok) toast("Leg added", { description: `${side.toUpperCase()} ${r.leg.lots} × ${r.leg.symbol} @ ${fmtPrice(r.leg.price)}` });
      else if (r.reason === "limit") toast.error("Limit reached", { description: `Maximum ${MAX_ACTIVE_LEGS} active legs per strategy` });
      else toast.error("Lots must be a whole number above zero");
    },
    [addLeg, asset, chainLots],
  );
  const showInChain = useCallback(
    (expiry: string) => {
      setExpiry(asset, expiry);
      setWorkspaceTab("chain");
    },
    [asset, setExpiry, setWorkspaceTab],
  );

  // the column arrays are stable across ticks, so the table re-sorts only when the rows change
  const strikeCols = useMemo<Column<StrikeRow>[]>(() => [
    { key: "expiry", label: "Expiry", align: "l", render: (r) => <span title={r.expiry}>{fmtExpiry(r.expiry)}</span>, sortVal: (r) => r.expiry },
    { key: "strike", label: "Strike", align: "r", render: (r) => <span className="num">{fmtStrike(r.strike)}</span>, sortVal: (r) => Number(r.strike) },
    { key: "side", label: "Side", align: "c", render: (r) => <span className={r.side === "call" ? "text-buy" : "text-sell"}>{r.side === "call" ? "C" : "P"}</span>, sortVal: (r) => r.side },
    { key: "mark", label: "Mark", align: "r", render: (r) => <span className="num" title="Mark price, USD per unit">{fmtPrice(r.mark)}</span>, sortVal: (r) => r.mark },
    { key: "iv", label: "IV", align: "r", render: (r) => <span className="num" title="Mark IV">{fmtIv(r.iv ?? undefined)}</span>, sortVal: (r) => r.iv },
    { key: "ivVsAtm", label: "IV−ATM", align: "r", render: (r) => <span className="num" title="Vol points against this expiry's ATM IV (+ richer than ATM)">{signed(r.ivVsAtm, 1)}</span>, sortVal: (r) => r.ivVsAtm },
    { key: "delta", label: "|Δ|", align: "r", render: (r) => <span className="num">{r.delta === null ? "—" : r.delta.toFixed(2)}</span>, sortVal: (r) => r.delta },
    { key: "premiumPerDay", label: "Prem/day", align: "r", render: (r) => <span className="num" title="Mark ÷ days to settlement, USD per unit per day; earned only by a seller whose option expires worthless">{fmtPrice(r.premiumPerDay, 2)}</span>, sortVal: (r) => r.premiumPerDay },
    { key: "yieldPerDay", label: "Yield/day", align: "r", render: (r) => <span className="num" title="Premium per day as a percent of spot">{r.yieldPerDay === null ? "—" : `${r.yieldPerDay.toFixed(3)} %`}</span>, sortVal: (r) => r.yieldPerDay },
    { key: "breakEvenPct", label: "BE %", align: "r", render: (r) => <span className="num" title="Break-even vs spot at expiry: strike + mark for a call, strike − mark for a put">{signed(r.breakEvenPct, 2, " %")}</span>, sortVal: (r) => r.breakEvenPct },
    { key: "days", label: "Days", align: "r", render: (r) => <span className="num">{daysLabel(r.days)}</span>, sortVal: (r) => r.days, hidden: true },
    { key: "oi", label: "OI", align: "r", render: (r) => <span className="num">{fmtOi(r.oi === null ? undefined : String(r.oi))}</span>, sortVal: (r) => r.oi },
    {
      key: "act",
      label: "Act.",
      align: "c",
      sort: false,
      csv: () => "",
      render: (r) => (
        <span className="inline-flex gap-1">
          <button type="button" onClick={() => add(r, "buy")} className="rounded bg-buy px-1.5 text-3xs font-semibold text-white" title={`Buy ${chainLots} lots into the Builder`} data-testid="screener-buy">
            B
          </button>
          <button type="button" onClick={() => add(r, "sell")} className="rounded bg-sell px-1.5 text-3xs font-semibold text-white" title={`Sell ${chainLots} lots into the Builder`} data-testid="screener-sell">
            S
          </button>
          <button type="button" onClick={() => showInChain(r.expiry)} className="rounded border border-border px-1.5 text-3xs text-muted-foreground hover:text-foreground" title={`Open ${fmtExpiry(r.expiry)} in the chain`} data-testid="screener-chain">
            ⌕
          </button>
        </span>
      ),
    },
  ], [add, chainLots, showInChain]);
  const expiryCols = useMemo<Column<ExpiryRow>[]>(() => [
    { key: "expiry", label: "Expiry", align: "l", render: (r) => <span title={r.expiry}>{fmtExpiry(r.expiry)}</span>, sortVal: (r) => r.expiry },
    { key: "days", label: "Days", align: "r", render: (r) => <span className="num">{daysLabel(r.days)}</span>, sortVal: (r) => r.days },
    { key: "atmIv", label: "ATM IV", align: "r", render: (r) => <span className="num">{fmtIv(r.atmIv ?? undefined)}</span>, sortVal: (r) => r.atmIv },
    { key: "skewPts", label: "25Δ skew", align: "r", render: (r) => <span className="num" title="Put IV minus call IV at 25 delta, vol points (+ puts richer)">{r.skewPts === null ? "—" : `${signed(r.skewPts, 1)} pts`}</span>, sortVal: (r) => r.skewPts },
    { key: "expectedMove", label: "Expected move", align: "r", render: (r) => <span className="num" title="± one standard deviation the ATM IV implies over the days left">{r.expectedMove === null || r.expectedMovePct === null ? "—" : `±${fmtPrice(r.expectedMove, 0)} (${r.expectedMovePct.toFixed(1)} %)`}</span>, sortVal: (r) => r.expectedMove },
    { key: "callOi", label: "Call OI", align: "r", render: (r) => <span className="num">{fmtOi(String(r.callOi))}</span>, sortVal: (r) => r.callOi },
    { key: "putOi", label: "Put OI", align: "r", render: (r) => <span className="num">{fmtOi(String(r.putOi))}</span>, sortVal: (r) => r.putOi },
    { key: "pcr", label: "PCR", align: "r", render: (r) => <span className="num" title="Put OI ÷ call OI">{r.pcr === null ? "—" : r.pcr.toFixed(2)}</span>, sortVal: (r) => r.pcr },
    { key: "strikes", label: "Strikes", align: "r", sortVal: (r) => r.strikes },
    {
      key: "act",
      label: "Act.",
      align: "c",
      sort: false,
      csv: () => "",
      render: (r) => (
        <button type="button" onClick={() => showInChain(r.expiry)} className="rounded border border-border px-1.5 text-3xs text-muted-foreground hover:text-foreground" title={`Open ${fmtExpiry(r.expiry)} in the chain`} data-testid="screener-chain">
          ⌕
        </button>
      ),
    },
  ], [showInChain]);

  const toggleExpiry = (e: string) =>
    setFilters((f) => {
      const next = new Set(f.expiries);
      if (next.has(e)) next.delete(e);
      else next.add(e);
      return { ...f, expiries: next };
    });

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="screener-panel" data-state={state} data-rows={filtered.length} data-total={board.strikes.length} data-view={view}>
      <div className="border-b border-border p-3 text-2xs">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <span className="inline-flex items-center gap-1">
            <span className="micro mr-1">View</span>
            {(["strikes", "expiries"] as const).map((v) => (
              <button key={v} type="button" aria-pressed={view === v} onClick={() => setView(v)} className={chip(view === v)} data-testid={`screener-view-${v}`}>
                {v === "strikes" ? "Strikes" : "Expiries"}
              </button>
            ))}
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="micro mr-1">Side</span>
            {SIDES.map((s) => (
              <button key={s.id} type="button" aria-pressed={filters.side === s.id} disabled={view !== "strikes"} onClick={() => setFilters((f) => ({ ...f, side: s.id }))} className={chip(filters.side === s.id, view !== "strikes")} data-testid={`screener-side-${s.id}`}>
                {s.label}
              </button>
            ))}
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="micro mr-1">|Δ|</span>
            {DELTA_BANDS.map((b) => (
              <button key={b} type="button" aria-pressed={filters.delta === b} disabled={view !== "strikes"} onClick={() => setFilters((f) => ({ ...f, delta: b }))} className={chip(filters.delta === b, view !== "strikes")} data-testid={`screener-delta-${b === "any" ? "any" : b.replace(/[^0-9.]/g, "") || b}`}>
                {b === "any" ? "Any" : b}
              </button>
            ))}
          </span>
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <span className="inline-flex flex-wrap items-center gap-1">
            <span className="micro mr-1">Expiries</span>
            {expiries.map((e) => {
              const all = filters.expiries.size === 0;
              const on = all || filters.expiries.has(e);
              const verb = all ? `Only ${fmtExpiry(e)}` : on ? `Remove ${fmtExpiry(e)}` : `Add ${fmtExpiry(e)}`;
              return (
                <button key={e} type="button" aria-pressed={on} disabled={view !== "strikes"} onClick={() => toggleExpiry(e)} title={`${verb}${board.priced.includes(e) ? "" : " · chain not in yet"}`} className={chip(on, view !== "strikes")} data-testid={`screener-expiry-${e}`}>
                  {fmtExpiry(e)}
                </button>
              );
            })}
            {filters.expiries.size > 0 ? (
              <button type="button" onClick={() => setFilters((f) => ({ ...f, expiries: new Set() }))} className="micro ml-1 underline" data-testid="screener-expiries-all">
                all
              </button>
            ) : null}
          </span>
          <label className="inline-flex items-center gap-1.5 text-muted-foreground">
            Min OI
            <input type="number" inputMode="numeric" min={0} step={1} value={filters.minOi} disabled={view !== "strikes"} onChange={(e) => setFilters((f) => ({ ...f, minOi: Math.max(0, Math.floor(Number(e.target.value) || 0)) }))} className="num h-6 w-20 rounded border border-input bg-background px-1.5 text-right font-mono text-2xs text-foreground" aria-label="Minimum open interest" data-testid="screener-min-oi" />
          </label>
        </div>
        <p className="micro mt-2" data-testid="screener-basis">
          {basis}
        </p>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-3">
        {state === "no-expiries" ? (
          <EmptyState title="Waiting for the listed expiries" description={`The screener reads every listed ${asset} expiry from the venue; none has arrived yet.`} className="py-10" />
        ) : state === "pending" ? (
          <EmptyState title="Waiting for the chains" description={`${expiries.length} listed ${expiries.length === 1 ? "expiry" : "expiries"} · the first chain is on its way.`} className="py-10" />
        ) : view === "strikes" ? (
          <DataTable
            id="screener-strikes"
            rows={filtered}
            cols={strikeCols}
            rowKey={(r) => r.id}
            sortKey="premiumPerDay"
            sortDir="desc"
            search={false}
            columns
            csv="screener-strikes"
            limit={SHOWN_ROWS}
            compact
            empty="No option fits these filters"
            foot={
              <span className="micro" data-testid="screener-count">
                {filtered.length > SHOWN_ROWS ? `Top ${SHOWN_ROWS} of ${filtered.length} by the sorted column · tighten a filter for the rest` : `${filtered.length} of ${board.strikes.length} options`}
              </span>
            }
          />
        ) : (
          <DataTable id="screener-expiries" rows={board.expiries} cols={expiryCols} rowKey={(r) => r.expiry} sortKey="days" sortDir="asc" search={false} columns csv="screener-expiries" compact empty="No expiry priced yet" />
        )}
      </div>
    </div>
  );
}
