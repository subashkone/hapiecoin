// @hapiecoin/pricing — Black-76 pricing, greeks, implied volatility, strategy analytics and chain helpers.
export { erf, erfc, normalCdf, normalPdf } from "./normal.js";
export {
  DAYS_PER_YEAR,
  DEFAULT_SETTLEMENT_HOUR_UTC,
  MS_PER_DAY,
  MS_PER_YEAR,
  daysToExpiry,
  expiryMs,
  yearFraction,
} from "./time.js";
export { black76Greeks, black76Price, impliedVol, intrinsicValue, type Greeks, type ImpliedVolOptions } from "./black76.js";
export {
  MIN_IV,
  analyze,
  breakevens,
  expiryExtremes,
  legValueAtExpiry,
  netPremium,
  payoffAtDate,
  payoffAtExpiry,
  positionGreeksAt,
  probabilityOfProfit,
  rewardRisk,
  scenarioGrid,
  type AnalyzeOptions,
  type AnalyzeResult,
  type NetGreeks,
  type PayoffPoint,
  type ScenarioGrid,
  type ScenarioMode,
  type ScenarioOptions,
  type ValuationOptions,
} from "./strategy.js";
export {
  expectedMove,
  gammaExposure,
  impliedForward,
  maxPain,
  painProfile,
  putCallRatio,
  smile,
  type GammaExposureResult,
  type GexPoint,
  type PainPoint,
  type PutCallBasis,
  type SmilePoint,
} from "./chain.js";
export type { ChainRow, Leg, LegKind, OptionKind, Side } from "./types.js";
export * from "./worker/index.js";
