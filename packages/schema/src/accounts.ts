import { z } from "zod";
import {
  Currency,
  DecimalString,
  IsoDateTime,
  PnlBasis,
  Role,
  Underlying,
  Venue,
  isNonNegativeDecimal,
  isPositiveDecimal,
} from "./primitives.js";

const PositiveDecimal = DecimalString.refine(isPositiveDecimal, { message: "must be greater than zero" });
const NonNegativeDecimal = DecimalString.refine(isNonNegativeDecimal, { message: "must not be negative" });

/** Opaque identifier issued by the auth layer / database. */
export const Id = z.string().min(1).max(128);
export type Id = z.infer<typeof Id>;

export const Avatar = z.enum(["rocket", "diamond", "lightning"]);
export type Avatar = z.infer<typeof Avatar>;

/** 10-digit mobile number as collected at sign-up (HC-PB-031). */
export const Mobile = z.string().regex(/^[0-9]{10}$/, "expected a 10-digit mobile number");
export type Mobile = z.infer<typeof Mobile>;

/** Referral codes are short, upper-case alphanumerics so they survive being typed from a screenshot. */
export const ReferralCode = z.string().regex(/^[A-Z0-9]{6,12}$/, "expected 6–12 upper-case letters or digits");
export type ReferralCode = z.infer<typeof ReferralCode>;

export const User = z.strictObject({
  id: Id,
  email: z.email(),
  name: z.string().trim().min(1).max(100),
  mobile: Mobile.optional(),
  role: Role,
  avatar: Avatar,
  referralCode: ReferralCode,
  createdAt: IsoDateTime,
});
export type User = z.infer<typeof User>;

export const Theme = z.enum(["dark", "light"]);
export type Theme = z.infer<typeof Theme>;

export const Density = z.enum(["comfortable", "compact"]);
export type Density = z.infer<typeof Density>;

/** Per-user display and calculation preferences (HC-SH-038..042, HC-SH-044). */
export const UserSettings = z.strictObject({
  currency: Currency,
  /** USD → INR rate applied to every displayed money figure when currency is INR. */
  conversionRate: PositiveDecimal,
  pnlBasis: PnlBasis,
  /** Contracts per lot for each underlying; every underlying must be present. */
  lotSizes: z.record(Underlying, PositiveDecimal),
  theme: Theme,
  density: Density,
});
export type UserSettings = z.infer<typeof UserSettings>;

export const BrokerScope = z.enum(["GLOBAL", "USER"]);
export type BrokerScope = z.infer<typeof BrokerScope>;

/** Exchange fee profile used for paper-trading cost estimates (HC-SH-032, HC-SH-045..048). Percentages are "0.05" = 0.05 %. */
export const Broker = z.strictObject({
  id: Id,
  name: z.string().trim().min(1).max(80),
  feePct: NonNegativeDecimal,
  gstPct: NonNegativeDecimal,
  feeCapPct: NonNegativeDecimal,
  scope: BrokerScope,
  /** The venue the broker's credentials trade on (ADR-065). */
  venue: Venue,
});
export type Broker = z.infer<typeof Broker>;

/** Masked key: four asterisks followed by the last four characters of the real key. */
export const API_KEY_MASKED_RE = /^\*{4}[A-Za-z0-9]{4}$/;
export const ApiKeyMasked = z.string().regex(API_KEY_MASKED_RE, "expected a masked key such as ****ab12");
export type ApiKeyMasked = z.infer<typeof ApiKeyMasked>;

/** Produce the public form of an API key. Keys shorter than four characters are fully masked. */
export function maskApiKey(apiKey: string): ApiKeyMasked {
  const tail = apiKey.slice(-4).replace(/[^A-Za-z0-9]/g, "x");
  return `****${tail.padStart(4, "x")}`;
}

/**
 * What a client may ever learn about stored exchange credentials (HC-SH-031, HC-SH-036).
 * Strict: any extra field, and in particular a secret, fails validation.
 */
export const BrokerCredentialPublic = z.strictObject({
  brokerId: Id,
  apiKeyMasked: ApiKeyMasked,
  connectedAt: IsoDateTime,
  /** Egress IP the user must whitelist at the exchange. */
  whitelistedIp: z.ipv4(),
});
export type BrokerCredentialPublic = z.infer<typeof BrokerCredentialPublic>;
