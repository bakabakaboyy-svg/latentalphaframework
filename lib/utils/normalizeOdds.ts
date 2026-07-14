// Converts a prediction-market probability (0–1) into an equivalent American
// odds number, so Kalshi/Polymarket prices can sit in the same price column
// as sportsbook lines. Standard fair-odds conversion — no vig removal, no
// rounding to a particular increment (just the nearest integer), matching
// how sportsbooks quote prices.
//
//   0.50 -> -100   (even money)
//   0.60 -> -150
//   0.65 -> -186
//   0.70 -> -233
//   0.40 -> +150
//   0.30 -> +233
export function convertProbabilityToAmericanOdds(probability: number): number {
  if (!Number.isFinite(probability) || probability <= 0 || probability >= 1) {
    throw new Error(
      `convertProbabilityToAmericanOdds: probability must be between 0 and 1 (exclusive), got ${probability}`
    );
  }

  if (probability >= 0.5) {
    return Math.round((-100 * probability) / (1 - probability));
  }
  return Math.round((100 * (1 - probability)) / probability);
}
