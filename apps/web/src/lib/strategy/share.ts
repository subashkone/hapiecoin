// Shareable strategy links (HC-WS-105, 106): the legs, lots and entry prices are encoded in the URL itself as
// base64url JSON, so nothing is uploaded and no account is needed to open one. `decodeShare` validates every field
// before the legs reach the store; a link that fails validation opens nothing.
import { type Underlying, VENUES, type Venue as VenueId } from "@hapiecoin/schema";
import { DEFAULT_VENUE } from "@hapiecoin/venues/core";
import { type LegKind, type LegSide, MAX_ACTIVE_LEGS, type NewLegInput, type StrategyLeg } from "./legs";

export const SHARE_VERSION = 1;
const ASSETS: readonly Underlying[] = ["BTC", "ETH", "XAUT"];
const KINDS: readonly LegKind[] = ["call", "put", "future"];
const SIDES: readonly LegSide[] = ["buy", "sell"];
const MAX_NAME = 80;

export interface SharedStrategy {
  asset: Underlying;
  /** The venue the legs were built on; links from before ADR-069 are Delta India. */
  venue: VenueId;
  name: string;
  legs: NewLegInput[];
}

/** Compact wire form: `[kind, side, strike, expiry, lots, price, iv?]` per leg; `e` names the venue (absent = Delta India). */
type Wire = { v: number; a: Underlying; e?: string; n?: string; l: (string | number)[][] };

function toBase64Url(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function fromBase64Url(s: string): string | null {
  try {
    const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (s.length % 4)) % 4);
    const bin = atob(b64);
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    return null;
  }
}

export function encodeShare(input: { asset: Underlying; venue?: VenueId | undefined; name?: string | undefined; legs: readonly Pick<StrategyLeg, "kind" | "side" | "strike" | "expiry" | "lots" | "price" | "iv">[] }): string {
  const wire: Wire = {
    v: SHARE_VERSION,
    a: input.asset,
    ...(input.venue && input.venue !== DEFAULT_VENUE ? { e: input.venue } : {}),
    ...(input.name?.trim() ? { n: input.name.trim().slice(0, MAX_NAME) } : {}),
    l: input.legs.map((l) => [l.kind, l.side, l.kind === "future" ? "" : l.strike, l.kind === "future" ? "PERP" : l.expiry, l.lots, l.price, ...(l.iv === undefined ? [] : [Number(l.iv.toFixed(4))])]),
  };
  return toBase64Url(JSON.stringify(wire));
}

const isDecimal = (s: unknown): s is string => typeof s === "string" && /^\d+(\.\d+)?$/.test(s);
const isExpiry = (s: unknown): s is string => typeof s === "string" && (s === "PERP" || /^\d{4}-\d{2}-\d{2}$/.test(s));

/** Null when the code is not a HapieCoin strategy link or any leg fails validation. */
export function decodeShare(code: string): SharedStrategy | null {
  const json = fromBase64Url(code.trim());
  if (json === null) return null;
  let wire: unknown;
  try {
    wire = JSON.parse(json);
  } catch {
    return null;
  }
  if (!wire || typeof wire !== "object") return null;
  const w = wire as Partial<Wire>;
  if (w.v !== SHARE_VERSION || !ASSETS.includes(w.a as Underlying) || !Array.isArray(w.l) || w.l.length === 0 || w.l.length > MAX_ACTIVE_LEGS) return null;
  const legs: NewLegInput[] = [];
  for (const raw of w.l) {
    if (!Array.isArray(raw) || raw.length < 6) return null;
    const [kind, side, strike, expiry, lots, price, iv] = raw;
    if (!KINDS.includes(kind as LegKind) || !SIDES.includes(side as LegSide)) return null;
    if (typeof lots !== "number" || !Number.isInteger(lots) || lots <= 0 || lots > 1000) return null;
    if (!isDecimal(price) || !isExpiry(expiry)) return null;
    if (kind === "future") {
      if (strike !== "" || expiry !== "PERP") return null;
    } else if (!isDecimal(strike) || expiry === "PERP") return null;
    if (iv !== undefined && (typeof iv !== "number" || !Number.isFinite(iv) || iv <= 0 || iv > 10)) return null;
    legs.push({ asset: w.a as Underlying, kind: kind as LegKind, side: side as LegSide, strike: strike, expiry: expiry, lots, price: price, ...(iv === undefined ? {} : { iv: iv }) });
  }
  const name = typeof w.n === "string" ? w.n.trim().slice(0, MAX_NAME) : "";
  if (w.e !== undefined && !(VENUES as readonly string[]).includes(w.e)) return null;
  return { asset: w.a as Underlying, venue: (w.e as VenueId | undefined) ?? DEFAULT_VENUE, name, legs };
}

export const shareUrl = (origin: string, code: string): string => `${origin}/s/${code}`;
