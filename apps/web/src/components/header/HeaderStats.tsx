"use client";
// Header market stats (HC-SH-077, 078, 083; HC-WS-068): the ATM IV of the chain's shown expiry with the IV rank
// slot, and the expected 1σ move to that expiry. Read from the same chain topic the workspace subscribes to.
import { expectedMove } from "@hapiecoin/pricing";
import { cn } from "@hapiecoin/ui";
import { useMemo } from "react";
import { nearestExpiry } from "@/lib/chain/expiries";
import { atmIvOf } from "@/lib/chain/structure";
import { useExpiries } from "@/lib/chain/useExpiries";
import { daysToExpiry, fmtExpiry, fmtIv, fmtPrice } from "@/lib/format";
import { useChain, useSpot } from "@/lib/gateway/hooks";
import { useIvHistory } from "@/lib/api/market";
import { useUiStore } from "@/lib/store";

export interface HeaderStatValues {
  expiry: string | null;
  atmIv: number | null;
  move: number | null;
  dte: number;
}

/** The figures behind the header stats, shared with tests and the palette. */
export function useHeaderStats(): HeaderStatValues {
  const asset = useUiStore((s) => s.asset);
  const selected = useUiStore((s) => s.expiry[s.asset] ?? null);
  const expiries = useExpiries(asset);
  const expiry = selected && expiries.includes(selected) ? selected : nearestExpiry(expiries);
  const chain = useChain(asset, expiry);
  const spot = useSpot(asset);
  const spotN = spot ? Number(spot.price) : null;
  return useMemo(() => {
    const atmIv = atmIvOf(chain?.rows ?? [], spotN);
    const dte = expiry ? Math.max(0, daysToExpiry(expiry)) : 0;
    const move = spotN !== null && atmIv !== null && expiry ? expectedMove(spotN, atmIv, dte) : null;
    return { expiry, atmIv, move, dte };
  }, [chain, spotN, expiry]);
}

export function HeaderStats() {
  const { expiry, atmIv, move } = useHeaderStats();
  const asset = useUiStore((s) => s.asset);
  const { data: history } = useIvHistory(asset);
  const rank = history?.rank ? Math.round(history.rank.rank) : null;
  return (
    <>
      <div className="hidden flex-col leading-tight min-[1180px]:flex" data-testid="header-atm-iv" data-state={atmIv === null ? "pending" : "ready"} title={rank === null ? "ATM implied volatility of the shown expiry · IV rank appears once two days of history exist (ADR-056)" : `ATM implied volatility of the shown expiry · IV rank ${rank} of 100 over the last ${history?.rank?.days ?? 0} days`}>
        <span className="micro text-[9.5px] max-[1000px]:hidden">ATM IV</span>
        <span className="flex items-baseline gap-1.5">
          <span className="num text-[15px] font-medium">{atmIv === null ? "—" : fmtIv(atmIv)}</span>
          <span className="font-mono text-3xs text-muted-foreground" data-testid="header-iv-rank">IV rank {rank === null ? "—" : rank}</span>
        </span>
      </div>
      <div className={cn("hidden flex-col leading-tight min-[1330px]:flex")} data-testid="header-exp-move" data-state={move === null ? "pending" : "ready"} title="Expected 1σ move of the futures price to the shown expiry (ATM IV × √time)">
        <span className="micro text-[9.5px]">Exp. move{expiry ? ` · ${fmtExpiry(expiry)}` : ""}</span>
        <span className="flex items-baseline gap-1">
          <span className="num text-[15px] font-medium">{move === null ? "—" : `± ${fmtPrice(move, 0)}`}</span>
          <span className="text-3xs text-muted-foreground">1σ</span>
        </span>
      </div>
    </>
  );
}
