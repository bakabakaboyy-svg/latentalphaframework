// Closing Line Value — how much better (or worse) a price is than another
// reference price, expressed as a percentage of the entry price's magnitude.
// A simplified "cents-based" comparison, not a full no-vig/implied-probability
// CLV calculation — accurate enough for tracking whether a line moved in your
// favor, but treat large swings between very different price ranges (e.g.
// -110 vs. +400) with some caution, since American odds aren't linear.
//
//   entry -110, current -108 -> +1.82%
//   entry +150, current +160 -> +6.67%
//   entry -110, current -115 -> -4.55%
export function calculateClvPercentage(entryPrice: number, referencePrice: number): number {
  return ((referencePrice - entryPrice) / Math.abs(entryPrice)) * 100;
}
