// No-vig probability math + arbitrage detection for a single market's
// outcomes. Every function here is pure (no I/O) — lib/utils/arbDetection.ts
// is what groups real odds_snapshots rows into the outcome sets these
// functions expect.

// American odds -> implied probability, WITH the book's vig still baked in.
//   -110 -> 110/210 = 0.5238
//   +110 -> 100/210 = 0.4762
export function americanToImpliedProb(odds: number): number {
  if (odds > 0) return 100 / (odds + 100);
  return Math.abs(odds) / (Math.abs(odds) + 100);
}

export interface NoVigResult {
  prob1: number;
  prob2: number;
  vig: number; // overround, e.g. 0.0810 = 8.1% vig
}

// Two-way no-vig: strips the vig from a pair of opposing prices and returns
// true (normalized, sum-to-1) probabilities.
export function removeVig(odds1: number, odds2: number): NoVigResult {
  const prob1 = americanToImpliedProb(odds1);
  const prob2 = americanToImpliedProb(odds2);
  const total = prob1 + prob2;
  const vig = total - 1.0;
  return {
    prob1: prob1 / total,
    prob2: prob2 / total,
    vig,
  };
}

export interface ArbLegInput {
  outcomeName: string;
  odds: number;
  bookSlug: string;
  bookName: string;
}

export interface ArbLegResult extends ArbLegInput {
  impliedProb: number; // raw, vig-included — this is what stake sizing uses
  betSplit: number; // fraction of total stake to place on this leg, sums to 1 across all legs
}

export interface ArbResult {
  legs: ArbLegResult[];
  arbPercentage: number; // (1 - sum of raw implied probs) * 100
}

// Stakes proportional to each leg's raw (vig-included) implied probability —
// this is what actually equalizes payout across every outcome given the real
// prices offered, not the vig-removed "true" probabilities (those sum to 1 by
// construction and would misprice the hedge).
function computeBetSplits(legs: ArbLegInput[]): number[] {
  const probs = legs.map((l) => americanToImpliedProb(l.odds));
  const total = probs.reduce((sum, p) => sum + p, 0);
  return probs.map((p) => p / total);
}

// Two-way arbitrage: true guaranteed profit exists when the best two prices'
// raw implied probabilities sum to less than 1.0.
//
//   Book 1: Yankees -120 (prob 0.5455)
//   Book 2: Red Sox  +130 (prob 0.4348)
//   Total: 0.9803 -> 1.97% guaranteed profit
export function calculateArbitrage(legs: [ArbLegInput, ArbLegInput], minArbPercentage = 0): ArbResult | null {
  const probs = legs.map((l) => americanToImpliedProb(l.odds));
  const total = probs[0] + probs[1];
  const arbPercentage = (1.0 - total) * 100;
  if (arbPercentage < minArbPercentage) return null;

  const splits = computeBetSplits(legs);
  return {
    legs: legs.map((l, i) => ({ ...l, impliedProb: probs[i], betSplit: splits[i] })),
    arbPercentage,
  };
}

// Three-way arbitrage — for genuine 3-outcome markets (soccer moneyline:
// Home / Draw / Away). Same math as the two-way case, extended to 3 legs.
export function detectThreeWayArb(
  legs: [ArbLegInput, ArbLegInput, ArbLegInput],
  minArbPercentage = 0
): ArbResult | null {
  const probs = legs.map((l) => americanToImpliedProb(l.odds));
  const total = probs.reduce((sum, p) => sum + p, 0);
  const arbPercentage = (1.0 - total) * 100;
  if (arbPercentage < minArbPercentage) return null;

  const splits = computeBetSplits(legs);
  return {
    legs: legs.map((l, i) => ({ ...l, impliedProb: probs[i], betSplit: splits[i] })),
    arbPercentage,
  };
}
