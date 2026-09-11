"use client";
// The overlap line (ADR-059 §2.2.1; HC-TR-159): shown in the trade previews and the workbench Review when a contract
// in the order is already held by another open strategy. It never blocks; the trader may intend it.
import { type OverlapRow, lotsWord } from "@/lib/strategy/overlap";

export function OverlapNotice({ rows, mode, testId = "overlap-notice" }: { rows: readonly OverlapRow[]; mode: "paper" | "live"; testId?: string | undefined }) {
  if (rows.length === 0) return null;
  return (
    <div className="mt-3 rounded border border-warning/60 bg-warning/5 p-2 text-2xs" data-testid={testId} data-count={rows.length}>
      <div className="micro mb-1 text-warning">Shared {rows.length === 1 ? "contract" : "contracts"}</div>
      <ul className="flex flex-col gap-1">
        {rows.map((r) => (
          <li key={r.symbol} data-testid="overlap-row" data-symbol={r.symbol} data-after={r.afterNet}>
            You already hold <b className="num">{lotsWord(r.heldNet)}</b> of <b className="num">{r.label}</b> in {r.held.map((h, i) => (
              <span key={`${h.id}-${i}`}>
                {i > 0 ? ", " : ""}
                <em>{h.name}</em> ({h.lots.toLocaleString("en-US")} {h.side === "buy" ? "bought" : "sold"})
              </span>
            ))}
            . After this order the exchange holds <b className="num">{lotsWord(r.afterNet)}</b> as one position.
          </li>
        ))}
      </ul>
      <p className="mt-1 text-muted-foreground">
        {mode === "live"
          ? "A stop or close you set on the exchange for that contract acts on all of it, across every strategy. Stops set in HapieCoin act per strategy."
          : "On the exchange these net into one position when they go live; a stop set there would act on all of it."}
      </p>
    </div>
  );
}
