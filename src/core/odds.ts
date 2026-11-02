// Standard deviation of college football final margins around the spread,
// in points. Roughly 15-16 historically.
export const MARGIN_SD = 15.5;

/**
 * Chance the home side wins given a point spread from the home side's view
 * (negative = home favored, e.g. -7). Assumes margins are normal around the line.
 */
export function winProbability(homeSpread: number, sd: number = MARGIN_SD): number {
  if (!Number.isFinite(homeSpread) || !(sd > 0)) {
    throw new RangeError("spread must be finite and sd positive");
  }
  return normalCdf(-homeSpread / sd);
}

// Abramowitz-Stegun 26.2.17, error < 7.5e-8.
export function normalCdf(z: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989422804014327 * Math.exp((-z * z) / 2);
  const p =
    d * t * (0.31938153 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return z >= 0 ? 1 - p : p;
}
