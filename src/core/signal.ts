// Telling a real swing from Monte Carlo noise. A game's swing is the gap between
// the team's title-game odds in the seasons where the home team won it and the
// seasons where the away team did. With a few thousand seasons, a lopsided game's
// upset side holds only a few hundred, so a 1-3 point gap appears by chance about
// one time in five (measured on 2026 non-conference games, whose true swing is 0).
// Requiring the gap to also clear a z-score removes those.

/** z-score of the gap between two sample proportions (successes / trials), smoothed so 0% and 100% don't divide by zero. */
export function swingZ(nA: number, inA: number, nB: number, inB: number): number {
  const pA = (inA + 0.5) / (nA + 1);
  const pB = (inB + 0.5) / (nB + 1);
  const se = Math.sqrt((pA * (1 - pA)) / nA + (pB * (1 - pB)) / nB);
  return Math.abs(inA / nA - inB / nB) / se;
}

/** Overall swing: at least 1 point and z >= 3 (no false positives among 176 null games). */
export const OVERALL = { minSwing: 0.01, minZ: 3 };
/** Any lean at all, however small: only the z-score bar, a little lower. For showing which side helps, not for ranking. */
export const FAINT = { minSwing: 0, minZ: 2.5 };
/** Swing within one of the team's own-result scenarios: many more comparisons, so a stricter bar. */
export const SCENARIO = { minSwing: 0.05, minZ: 4 };

export function isClear(nA: number, inA: number, nB: number, inB: number, bar: { minSwing: number; minZ: number }): boolean {
  if (nA === 0 || nB === 0) return false;
  return Math.abs(inA / nA - inB / nB) >= bar.minSwing && swingZ(nA, inA, nB, inB) >= bar.minZ;
}
