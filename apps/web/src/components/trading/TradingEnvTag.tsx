"use client";
// HC-SH-138 (ADR-092): the venue every live order goes to, named on screen whenever it is not the real exchange. Rendered
// beside the Exchange chip, the live cards, the net positions header, the mode and preview dialogs and the batch dialog;
// nothing renders on the real exchange, so the label is a warning, never decoration.
import { cn } from "@hapiecoin/ui";
import { useTradingEnv } from "@/lib/api/queries";

export function TradingEnvTag({ className }: { className?: string | undefined }) {
  const env = useTradingEnv();
  if (env === null || env.env !== "testnet") return null;
  return (
    <span
      className={cn("micro inline-flex items-center rounded border border-warning bg-warning/10 px-1 font-bold text-warning", className)}
      title={`Live orders go to the Delta testnet at ${env.host}: play money, and its prices can differ widely from the real market (ADR-092)`}
      data-testid="trading-env"
      data-env="testnet"
      data-host={env.host}
    >
      TESTNET
    </span>
  );
}
