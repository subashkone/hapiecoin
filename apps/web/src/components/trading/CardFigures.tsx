"use client";
// Combined max loss / max profit / POP on a paper or live card (ADR-044 decision 4): the open legs at their
// entry premiums, priced once per mount and whenever the legs change, so an adjusted position shows what it
// now risks without opening Details.
import type { Strategy } from "@hapiecoin/schema";
import { cn } from "@hapiecoin/ui";
import { useEffect, useMemo, useState } from "react";
import { fmtMoney } from "@/lib/money";
import { useAnalysis } from "@/lib/pricing/client";
import { settlementHourUtc, toPricingLegs } from "@/lib/pricing/legs";
import { openLegs, serverLegToLocal } from "@/lib/strategy/paper";
import type { PaperBook } from "@/lib/strategy/usePaper";

export function CardFigures({ s, book }: { s: Strategy; book: PaperBook }) {
  const open = useMemo(() => openLegs(s), [s]);
  const live = book.spotOf(s.asset);
  // the first spot seen is kept, so the card prices once per mount (and per leg change) rather than per tick
  const [spot, setSpot] = useState(live);
  useEffect(() => {
    if (spot === null && live !== null) setSpot(live);
  }, [spot, live]);
  const nowMs = useMemo(() => Date.now(), []);
  const legs = useMemo(() => toPricingLegs(open.map((l) => serverLegToLocal(l, s.asset)), book.lotSizeOf(s.asset), { spot: spot === null ? undefined : String(spot) }), [open, s.asset, book, spot]);
  const options = useMemo(() => (spot === null || legs.length === 0 ? null : { spot, nowMs, settlementHourUtc: settlementHourUtc(s.asset), defaultIv: 0.5, points: 41 }), [spot, legs.length, nowMs, s.asset]);
  const { result } = useAnalysis(legs, options);
  if (open.length === 0) return null;
  const money = book.money;
  const pop = result && Number.isFinite(result.pop) ? `${(result.pop * 100).toFixed(0)}%` : "—";
  return (
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
  );
}
