"use client";
// In-place instrument editor for a Builder leg (HC-TR-147, ADR-028): CE / PE toggle, strike select from that
// expiry's venue ladder (ADR-006), expiry select from the listed expiries. Each change re-quotes the leg from the
// chain when the quote is there; otherwise the stored price stands until the feed answers.
import { cn } from "@hapiecoin/ui";
import { daysToExpiry, fmtExpiry, fmtStrike } from "@/lib/format";
import { useChain } from "@/lib/gateway/hooks";
import { useExpiries } from "@/lib/chain/useExpiries";
import type { StrategyLeg } from "@/lib/strategy/legs";

export interface InstrumentPatch {
  kind?: "call" | "put";
  strike?: string;
  expiry?: string;
}
export type InstrumentQuote = { price: string; iv?: number | undefined } | undefined;

export function LegInstrument({ leg, moneyness, hasQuote, onChange }: { leg: StrategyLeg; moneyness: string | null; hasQuote: boolean; onChange: (patch: InstrumentPatch, quote: InstrumentQuote) => void }) {
  const expiries = useExpiries(leg.asset);
  const chain = useChain(leg.asset, leg.kind === "future" ? null : leg.expiry);
  const rows = chain?.rows ?? [];
  const strikes = rows.map((r) => r.strike);
  const listed = strikes.includes(leg.strike) ? strikes : [leg.strike, ...strikes];
  const expiryList = expiries.includes(leg.expiry) ? expiries : [leg.expiry, ...expiries];
  const quoteFor = (kind: "call" | "put", strike: string): InstrumentQuote => {
    const row = rows.find((r) => r.strike === strike);
    const side = kind === "call" ? row?.call : row?.put;
    return side ? { price: side.mark, iv: side.markIv } : undefined;
  };
  if (leg.kind === "future") {
    return (
      <>
        <div className="num font-medium">{leg.symbol}</div>
        <div className="micro">perp future</div>
      </>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-1" data-testid="leg-instrument">
      <button
        type="button"
        className={cn("rounded-[2px] border px-1 py-0.5 font-mono text-3xs font-bold", leg.kind === "call" ? "border-profit/60 text-profit" : "border-loss/60 text-loss")}
        title="Click to switch Call / Put"
        onClick={() => {
          const kind = leg.kind === "call" ? "put" : "call";
          onChange({ kind }, quoteFor(kind, leg.strike));
        }}
        data-testid="leg-kind"
      >
        {leg.kind === "call" ? "CE" : "PE"}
      </button>
      <select
        className="num h-6 rounded border border-input bg-background px-1 text-xs"
        value={leg.strike}
        onChange={(e) => onChange({ strike: e.target.value }, quoteFor(leg.kind as "call" | "put", e.target.value))}
        aria-label="Strike"
        title={rows.length ? "Strike from the listed ladder" : "Chain not loaded yet: strikes appear once it is"}
        data-testid="leg-strike"
      >
        {listed.map((s) => (
          <option key={s} value={s}>
            {fmtStrike(s)}
          </option>
        ))}
      </select>
      <select
        className="h-6 rounded border border-input bg-background px-1 font-mono text-2xs"
        value={leg.expiry}
        onChange={(e) => onChange({ expiry: e.target.value }, undefined)}
        aria-label="Expiry"
        data-testid="leg-expiry"
      >
        {expiryList.map((e) => (
          <option key={e} value={e}>
            {fmtExpiry(e)} · {daysToExpiry(e)}d
          </option>
        ))}
      </select>
      <span className="micro">
        {moneyness ?? ""}
        {!hasQuote ? " · no quote" : ""}
      </span>
    </div>
  );
}
