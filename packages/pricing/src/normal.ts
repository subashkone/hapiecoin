/**
 * Standard normal distribution helpers built on W. J. Cody's rational Chebyshev approximations of erf/erfc
 * (Math. Comp. 23, 1969; the CALERF algorithm). Absolute error is at the level of double rounding (< 1e-15),
 * far inside the 1e-7 budget; the test suite checks it against an independent series / continued-fraction
 * reference on a dense grid.
 */

const THRESHOLD = 0.46875;
/** Beyond this |x| erfc underflows to 0 in double precision. */
const X_BIG = 26.543;
/** 1 / sqrt(pi). */
const SQRPI = 0.5641895835477563;
const INV_SQRT_2PI = 0.3989422804014327;

// |x| <= 0.46875: erf(x) = x * P(x^2) / Q(x^2)
const A0 = 3.1611237438705655;
const A1 = 113.86415415105016;
const A2 = 377.485237685302;
const A3 = 3209.3775891384694;
const A4 = 0.18577770618460315;
const B0 = 23.601290952344122;
const B1 = 244.02463793444417;
const B2 = 1282.6165260773723;
const B3 = 2844.236833439171;

// 0.46875 < |x| <= 4: erfc(x) = exp(-x^2) * P(x) / Q(x)
const C0 = 0.5641884969886701;
const C1 = 8.883149794388377;
const C2 = 66.11919063714163;
const C3 = 298.6351381974001;
const C4 = 881.952221241769;
const C5 = 1712.0476126340707;
const C6 = 2051.0783778260716;
const C7 = 1230.3393547979972;
const C8 = 2.1531153547440383e-8;
const D0 = 15.744926110709835;
const D1 = 117.6939508913125;
const D2 = 537.1811018620099;
const D3 = 1621.3895745666903;
const D4 = 3290.7992357334597;
const D5 = 4362.619090143247;
const D6 = 3439.3676741437216;
const D7 = 1230.3393548037495;

// |x| > 4: erfc(x) = exp(-x^2) / x * (1/sqrt(pi) - 1/x^2 * P(1/x^2) / Q(1/x^2))
const P0 = 0.30532663496123236;
const P1 = 0.36034489994980445;
const P2 = 0.12578172611122926;
const P3 = 0.016083785148742275;
const P4 = 0.0006587491615298378;
const P5 = 0.016315387137302097;
const Q0 = 2.568520192289822;
const Q1 = 1.8729528499234673;
const Q2 = 0.5279051029514285;
const Q3 = 0.06051834131244132;
const Q4 = 0.0023352049762686918;

/** erf(x) for |x| <= THRESHOLD. */
function erfSmall(x: number): number {
  const z = x * x;
  const num = (((A4 * z + A0) * z + A1) * z + A2) * z + A3;
  const den = (((z + B0) * z + B1) * z + B2) * z + B3;
  return (x * num) / den;
}

/** erfc(y) for y > THRESHOLD. */
function erfcLarge(y: number): number {
  let result: number;
  if (y <= 4) {
    const num = (((((((C8 * y + C0) * y + C1) * y + C2) * y + C3) * y + C4) * y + C5) * y + C6) * y + C7;
    const den = (((((((y + D0) * y + D1) * y + D2) * y + D3) * y + D4) * y + D5) * y + D6) * y + D7;
    result = num / den;
  } else {
    if (y >= X_BIG) return 0;
    const z = 1 / (y * y);
    const num = ((((P5 * z + P0) * z + P1) * z + P2) * z + P3) * z + P4;
    const den = ((((z + Q0) * z + Q1) * z + Q2) * z + Q3) * z + Q4;
    result = (SQRPI - (z * num) / den) / y;
  }
  // exp(-y^2) evaluated as exp(-ysq^2) * exp(-del) to limit the rounding error of y^2 for large y.
  const ysq = Math.trunc(y * 16) / 16;
  const del = (y - ysq) * (y + ysq);
  return Math.exp(-ysq * ysq) * Math.exp(-del) * result;
}

/** Error function. */
export function erf(x: number): number {
  if (Number.isNaN(x)) return NaN;
  const y = Math.abs(x);
  if (y <= THRESHOLD) return erfSmall(x);
  const r = 1 - erfcLarge(y);
  return x < 0 ? -r : r;
}

/** Complementary error function, accurate in the tails (no cancellation against 1). */
export function erfc(x: number): number {
  if (Number.isNaN(x)) return NaN;
  const y = Math.abs(x);
  if (y <= THRESHOLD) return 1 - erfSmall(x);
  const r = erfcLarge(y);
  return x < 0 ? 2 - r : r;
}

/** Standard normal cumulative distribution function N(x). */
export function normalCdf(x: number): number {
  return 0.5 * erfc(-x / Math.SQRT2);
}

/** Standard normal probability density function n(x). */
export function normalPdf(x: number): number {
  return INV_SQRT_2PI * Math.exp(-0.5 * x * x);
}
