"use client";
// Combined max loss / max profit / POP on a paper or live card (ADR-044 decision 4): the open legs at their
// entry premiums, priced once per mount and whenever the legs change, so an adjusted position shows what it
// now risks without opening Details.
// HC-TR-253, HC-TR-255 (ADR-127): a second line with the money of the trade: the capital it ties up, the exchange
// fees so far, and what is left after them. A closed trade has this line alone, on the legs it entered.
import type { Strategy } from "@hapiecoin/schema";
import { cn } from "@hapiecoin/ui";
import { useEffect, useMemo, useState } from "react";
import { fmtMoney } from "@/lib/money";
import { useAnalysis } from "@/lib/pricing/client";
import { toPricingLegs } from "@/lib/pricing/legs";
import { expiryExtremes } from "@hapiecoin/pricing";
import { coverOf, openLegs, serverLegToLocal } from "@/lib/strategy/paper";
import type { PaperBook } from "@/lib/strategy/usePaper";
import { venueCalendar } from "@/lib/venue";

/** Profit after fees as a share of the capital, one decimal; null without a positive capital figure. */
export function returnOnCapital(net: number, capital: number | null): string | null {
  if (capital === null || !(capital > 0) || !Number.isFinite(net)) return null;
  const pct = (net / capital) * 100;
  return `${pct >= 0 ? "+" : "−"}${Math.abs(pct).toFixed(1)} %`;
}

export function CardFigures({ s, book, pnl, fees }: { s: Strategy; book: PaperBook; /** The card's P&L before fees. */ pnl: number; /** Estimated fees so far; null when the venue publishes no fee rule. */ fees: number | null }) {
  const closed = s.status === "archived";
  const open = useMemo(() => openLegs(s), [s]);
  // a closed trade is read on every leg it entered, at its entry premium (as the pane and Details draw it)
  const held = useMemo(() => (closed ? s.legs.filter((l) => l.entryPrice !== null) : open), [closed, s, open]);
  const live = book.spotOf(s.asset, s.venue);
  // the first spot seen is kept, so the card prices once per mount (and per leg change) rather than per tick
  const [spot, setSpot] = useState(live);
  useEffect(() => {
    if (spot === null && live !== null) setSpot(live);
  }, [spot, live]);
  const nowMs = useMemo(() => Date.now(), []);
  const legs = useMemo(() => toPricingLegs(held.map((l) => serverLegToLocal(l, s.asset)), book.lotSizeOf(s.asset, s.venue), { spot: spot === null ? undefined : String(spot) }), [held, s.asset, s.venue, book, spot]);
  // a closed trade has no figures row, so it asks the worker for nothing (and needs no live spot)
  const options = useMemo(() => (closed || spot === null || legs.length === 0 ? null : { spot, nowMs, calendar: venueCalendar(s.asset, s.venue), defaultIv: 0.5, points: 41 }), [closed, spot, legs.length, nowMs, s.asset, s.venue]);
  const { result } = useAnalysis(legs, options);
  // capital: the worst loss at expiry, exact from the legs at their entry premiums, and only for a position whose
  // sold options are all covered. A sold option without cover (a sold put included: its loss to a price of zero is
  // not what it ties up) and a future are margined by the exchange: their capital is the margin estimated at entry
  // (below), and a trade entered before that was recorded says so instead of a figure.
  const cover = useMemo(() => coverOf(held), [held]);
  // HC-TR-257 (ADR-128): for those the margin estimated when the trade was entered is its capital, when one was recorded
  const recorded = cover !== "covered" && s.marginEstimate ? Number(s.marginEstimate) : null;
  const margin = recorded !== null && Number.isFinite(recorded) && recorded > 0 ? recorded : null;
  const worstLoss = useMemo(() => {
    if (cover !== "covered") return null;
    const entry = toPricingLegs(held.map((l) => serverLegToLocal(l, s.asset)), book.lotSizeOf(s.asset, s.venue));
    if (entry.length === 0) return null;
    const worst = expiryExtremes(entry).maxLoss;
    return Number.isFinite(worst) ? Math.max(0, -worst) : null;
  }, [cover, held, s.asset, s.venue, book]);
  const capital = margin ?? worstLoss;
  if (held.length === 0) return null;
  const money = book.money;
  const pop = result && Number.isFinite(result.pop) ? `${(result.pop * 100).toFixed(0)}%` : "—";
  const net = pnl - (fees ?? 0);
  // the capital of an open card is what is still held, while its P&L carries the legs already closed: no ratio of the two
  const partlyClosed = !closed && s.legs.some((l) => l.status === "squared_off");
  const onCapital = partlyClosed ? null : returnOnCapital(net, capital);
  return (
    <>
      {closed ? null : (
        <div className="micro mt-1 flex flex-wrap gap-x-3 gap-y-0.5" data-testid="card-figures" data-state={result ? "ready" : "pending"} title="Combined open position at its entry premiums · at expiry">
          <span>
            max loss <b className={cn("num", result && "text-loss")}>{result ? fmtMoney(result.maxLoss, money, { unlimited: "Unlimited" }) : "—"}</b>
          </span>
          <span>
            max profit <b className={cn("num", result && "text-profit")}>{result ? fmtMoney(result.maxProfit, money, { unlimited: "Unlimited" }) : "—"}</b>
          </span>
          <span>
            POP <b className="num">{pop}</b>
          </span>
        </div>
      )}
      <div className="micro mt-1 flex flex-wrap gap-x-3 gap-y-0.5 normal-case tracking-normal" data-testid="card-money" data-capital={margin !== null ? "margin" : cover === "covered" ? (capital !== null ? "worst-loss" : undefined) : cover}>
        <span
          title={
            margin !== null
              ? "The least margin the exchange lists for the whole trade as it was entered: each sold option under its contract's margin percent of that day, plus any premium paid. An estimate, not the exchange's own figure: it may hold more, and it is not updated when a leg is closed"
              : cover === "uncovered"
                ? "Options sold without a bought one to cover them: what they tie up is the margin the exchange blocks, which was not recorded when this trade was entered"
                : cover === "futures"
                  ? "A futures leg is held on margin, which was not recorded when this trade was entered"
                  : `The most ${closed ? "this position could lose" : "the open position can lose"} at expiry, at its entry premiums; the exchange may block more than this`
          }
          data-testid="card-capital"
        >
          capital <b className="num">{capital !== null ? fmtMoney(capital, money) : "—"}</b>
          {margin !== null ? " min. margin est." : cover === "uncovered" ? " sold without cover" : cover === "futures" ? " futures margin" : capital !== null ? " worst loss" : ""}
        </span>
        <span title={fees === null ? "This exchange's fee schedule is not in HapieCoin, so no fee is taken off" : closed ? "Estimated exchange fees and GST on every entry and exit of this trade; an option that expired worthless paid no exit fee" : "Estimated exchange fees and GST paid so far; the exit fee is still to come"} data-testid="card-fees">
          fees <b className="num">{fees !== null ? fmtMoney(fees, money) : "—"}</b>
          {fees !== null ? " est." : " no fee schedule"}
        </span>
        {fees !== null ? (
          <span title={closed ? "The result of this trade less its estimated fees" : "The running profit less the fees paid so far"} data-testid="card-net">
            after fees <b className={cn("num", net >= 0 ? "text-profit" : "text-loss")}>{fmtMoney(net, money, { signed: true })}</b>
          </span>
        ) : null}
        {onCapital !== null && fees !== null ? (
          <span title={margin !== null ? "Profit after fees as a share of the estimated minimum margin; lower if the exchange holds more" : "Profit after fees as a share of the capital"} data-testid="card-return">
            <b className={cn("num", net >= 0 ? "text-profit" : "text-loss")}>{onCapital}</b> {margin !== null ? "on est. margin" : "on capital"}
          </span>
        ) : null}
      </div>
    </>
  );
}
