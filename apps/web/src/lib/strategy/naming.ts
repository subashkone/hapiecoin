// Pre-filled strategy names (ADR-059; HC-TR-155): ASSET-CODE-DDMMMYY-HHMM, the code from the template the legs
// match (or the legs themselves), the date and time from the trader's clock. Kept as typed when the trader edits it.

/** Short codes for the template names in lib/strategy/templates.ts and the names guessTemplateName can return. */
export const TEMPLATE_CODES: Readonly<Record<string, string>> = {
  "Buy Call": "BC",
  "Sell Put": "SP",
  "Bull Call Spread": "BCS",
  "Bull Put Spread": "BUPS",
  "Long Synthetic Future": "LSYN",
  "Buy Put": "BP",
  "Sell Call": "SC",
  "Bear Put Spread": "BPS",
  "Bear Call Spread": "BECS",
  "Short Synthetic Future": "SSYN",
  "Long Straddle": "LSTD",
  "Short Straddle": "SSTD",
  "Long Strangle": "LSTG",
  "Short Strangle": "SSTG",
  "Iron Condor": "IC",
  "Reverse Iron Condor": "RIC",
  "Iron Butterfly": "IBF",
  "Reverse Iron Butterfly": "RIBF",
  "Long Call Butterfly": "LCBF",
  "Long Put Butterfly": "LPBF",
  "Long Call Condor": "LCC",
  "Long Calendar with Calls": "CCAL",
  "Long Calendar with Puts": "PCAL",
  "Long Gut": "GUT",
  Strip: "STRIP",
  Strap: "STRAP",
  "Jade Lizard": "JL",
  "Reverse Jade Lizard": "RJL",
  "Call Spread": "CS",
  "Put Spread": "PS",
  "Condor / Butterfly": "CBF",
  Futures: "FUT",
};

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"] as const;
const pad = (n: number) => String(n).padStart(2, "0");

/** A code from the legs when no template matches: "2C1P", "1C1P1F", "CUSTOM" for nothing. */
export function legsCode(legs: readonly { kind: string }[]): string {
  const n = { call: 0, put: 0, future: 0 };
  for (const l of legs) if (l.kind === "call" || l.kind === "put" || l.kind === "future") n[l.kind] += 1;
  const parts = [n.call ? `${n.call}C` : "", n.put ? `${n.put}P` : "", n.future ? `${n.future}F` : ""].filter(Boolean);
  return parts.length ? parts.join("") : "CUSTOM";
}

export function templateCode(templateName: string, legs: readonly { kind: string }[]): string {
  return TEMPLATE_CODES[templateName] ?? legsCode(legs);
}

export interface SuggestNameInput {
  asset: string;
  templateName: string;
  legs: readonly { kind: string }[];
  /** The trader's clock; local date and time go into the name. */
  now?: Date;
  /** Names already in use: a clash gets "-2", "-3", … */
  taken?: readonly string[];
}

/** "BTC-IBF-11SEP26-1432"; "-2" when the trader already has a strategy of that name. */
export function suggestStrategyName({ asset, templateName, legs, now = new Date(), taken = [] }: SuggestNameInput): string {
  const stamp = `${pad(now.getDate())}${MONTHS[now.getMonth()] ?? "JAN"}${pad(now.getFullYear() % 100)}-${pad(now.getHours())}${pad(now.getMinutes())}`;
  const base = `${asset}-${templateCode(templateName, legs)}-${stamp}`;
  const used = new Set(taken.map((t) => t.trim().toLowerCase()));
  if (!used.has(base.toLowerCase())) return base;
  for (let i = 2; i < 100; i += 1) if (!used.has(`${base}-${i}`.toLowerCase())) return `${base}-${i}`;
  return `${base}-${Date.now().toString(36)}`;
}
