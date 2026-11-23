/**
 * The margin a trade was estimated to tie up when it was entered (HC-TR-257, ADR-128).
 *
 * A sold option without cover and a futures leg have no worst loss to call their capital: what they tie up is the
 * margin the exchange blocks. The exchange lists an initial margin percent per contract, and that percent changes as
 * the contract nears its expiry (0.5, 1 and 5 on BTC options on 23 Nov 2026) and disappears with the contract when it
 * expires. So the figure cannot be worked out later: it is estimated once, at entry, and stored with the strategy.
 *
 * The arithmetic is the live preview's (ADR-091, ADR-095): every sold option under `shortOptionMarginUsd`, every
 * futures leg under `futuresMarginUsd`, plus the net premium paid. (The public list this API reads holds options only,
 * so a PAPER trade with a futures leg finds no parameters for it and gets no figure; a live one takes the preview's.) No relief is assumed for a bought option on the
 * same side, and the figure has never been compared with what the exchange holds (GAPS #109): it is an estimate.
 * Pure but for `entryMargin`, which reads the source and never throws: a trade is entered whether or not its margin
 * could be estimated.
 */
import { type Underlying, toDecimal } from "@hapiecoin/schema";
import { contractsFor, futuresMarginUsd, shortOptionMarginUsd } from "@hapiecoin/venues";

/** What the venue lists for one contract, keyed by venue symbol in `MarginInputs.params`. */
export interface MarginParams {
  contractValue: string;
  initialMarginPct?: string | undefined;
  initialMarginScalingFactor?: string | undefined;
}

export interface MarginInputs {
  /** The underlying's spot, or null when the venue gave none. */
  spot: number | null;
  /** The live contracts of the underlying that carry margin parameters. */
  params: ReadonlyMap<string, MarginParams>;
}

/**
 * The venue's public margin parameters and spot for an underlying; null for a venue this API does not read or that
 * lists no margin parameters. A caller that already holds the spot passes it: the source then reads no ticker.
 */
export type MarginInputsSource = (asset: Underlying, venue: string, spot?: number) => Promise<MarginInputs | null>;

/** How long an entry waits for the venue before it goes ahead without a figure. */
export const ENTRY_MARGIN_DEADLINE_MS = 3_000;

export interface MarginLeg {
  kind: "call" | "put" | "future";
  side: "buy" | "sell";
  symbol: string;
  lots: number;
  /** The entry price per unit of the underlying, a decimal string. */
  price: string;
}

/**
 * Σ sold-option margins + Σ futures margins + the net premium paid, USD to the cent. Null when the position has
 * nothing margined (only bought options: its capital is the premium, which the card reads from the legs), and null
 * when ANY margined leg cannot be estimated: a figure that covered some of them would read as the whole.
 */
export function marginEstimateOf(legs: readonly MarginLeg[], lotSize: string, inputs: MarginInputs | null): string | null {
  if (inputs === null) return null;
  const size = Number(lotSize);
  if (!(size > 0)) return null;
  let margin = 0;
  let margined = 0;
  let debit = 0;
  for (const l of legs) {
    const price = Number(l.price);
    if (!Number.isFinite(price)) return null;
    if (l.kind !== "future") debit += (l.side === "buy" ? 1 : -1) * price * l.lots * size;
    if (l.kind !== "future" && l.side === "buy") continue;
    const p = inputs.params.get(l.symbol);
    if (!p) return null;
    const contracts = contractsFor(l.lots, lotSize, p.contractValue);
    const est =
      l.kind === "future"
        ? futuresMarginUsd({ contracts, contractValue: p.contractValue, price: l.price, initialMarginPct: p.initialMarginPct, initialMarginScalingFactor: p.initialMarginScalingFactor })
        : shortOptionMarginUsd({ contracts, contractValue: p.contractValue, spot: inputs.spot === null ? null : String(inputs.spot), mark: l.price, initialMarginPct: p.initialMarginPct, initialMarginScalingFactor: p.initialMarginScalingFactor });
    if (est === null) return null;
    margin += Number(est);
    margined += 1;
  }
  if (margined === 0) return null;
  return toDecimal(margin + Math.max(debit, 0), 2);
}

/**
 * The estimate for a trade being entered now. `spot` is the caller's own (Autopilot enters on a snapshot's spot) and
 * spares the source its ticker read. Never throws and never waits past `deadlineMs`: a venue that is slow or does
 * not answer leaves the trade without a figure, which the card says.
 */
export async function entryMargin(source: MarginInputsSource | undefined, asset: Underlying, venue: string, legs: readonly MarginLeg[], lotSize: string, spot?: number, deadlineMs: number = ENTRY_MARGIN_DEADLINE_MS): Promise<string | null> {
  if (!source || !legs.some((l) => l.kind === "future" || l.side === "sell")) return null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const late = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), deadlineMs);
    });
    const read = source(asset, venue, spot).then(
      (inputs) => marginEstimateOf(legs, lotSize, inputs && spot !== undefined ? { ...inputs, spot } : inputs),
      () => null,
    );
    return await Promise.race([read, late]);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
