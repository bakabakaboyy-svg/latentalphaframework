import { americanToImpliedProb } from "./noVigCalculator";

// Expected value + Kelly sizing for a bet, given your own estimated win
// probability (not derived from the odds — that's the whole point of +EV
// betting: you disagree with the market's price).

// American odds -> net profit per $1 staked if the bet wins (excludes the
// stake itself, i.e. "b" in Kelly's bp - q formula).
function netProfitPerDollar(odds: number): number {
  return odds > 0 ? odds / 100 : 100 / Math.abs(odds);
}

export interface EVResult {
  evPercentage: number; // expected value per $1 staked at entryOdds, as a percentage
  roi: number; // same as evPercentage for a single flat-stake bet
  kellyFraction: number; // full-Kelly fraction of bankroll to stake; 0 if no edge
  marketImpliedProb: number; // closingOdds converted to implied probability, for comparing your estimate against the market's
}

// EV = (win_prob * profit_if_win) - ((1 - win_prob) * stake_if_lose), paid
// out at entryOdds (the price you'd actually be betting at) — matches the
// spec's own worked example, which uses entry odds (-110) for profit_if_win
// despite also taking closingOdds as a parameter. closingOdds is used here
// only to surface the market's own implied probability for comparison, not
// in the EV/Kelly math itself.
// Kelly f* = EV / b, where b is net decimal odds (profit per $1 staked) —
// the standard full-Kelly formula, equivalent to (b*p - q) / b.
export function calculateEV(entryOdds: number, closingOdds: number, winProbability: number): EVResult {
  const b = netProfitPerDollar(entryOdds);
  const ev = winProbability * b - (1 - winProbability) * 1;
  const evPercentage = ev * 100;
  const kellyFraction = Math.max(0, ev / b);

  return {
    evPercentage,
    roi: evPercentage,
    kellyFraction,
    marketImpliedProb: americanToImpliedProb(closingOdds),
  };
}
