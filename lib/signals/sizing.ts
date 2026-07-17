// Kelly sizing + EV for a binary prediction-market contract priced in [0,1].
// Same derivation already verified in quant_engine's math_utils.py this
// session, ported to TypeScript for SIGNALS' own use.

// Full-Kelly fraction of bankroll for buying a contract priced at
// contractPrice with true win probability consensusProb.
//   f* = (p - C) / (1 - C)
// Derivation: full Kelly is f* = p - (1-p)/b where b = net decimal odds =
// (1-C)/C. Substituting and simplifying: f* = p - (1-p)*C/(1-C)
//   = [p(1-C) - (1-p)C] / (1-C) = (p-C)/(1-C).
// Can be negative (no edge) — callers should clamp via kellyStake, this
// function alone doesn't decide whether to bet.
export function kellyFraction(consensusProb: number, contractPrice: number): number {
  if (contractPrice <= 0 || contractPrice >= 1) {
    throw new Error(`contractPrice must be in (0, 1), got ${contractPrice}`);
  }
  return (consensusProb - contractPrice) / (1 - contractPrice);
}

// Quarter-Kelly dollar stake, rounded to the nearest dollar. Never negative
// (no edge -> $0, not a short position). Bankroll is a static figure here
// (no compounding) — this phase's sizing is illustrative, not a live
// capital-tracking system.
export function kellyStake(
  consensusProb: number,
  contractPrice: number,
  bankroll = 10000,
  fraction = 0.25
): number {
  const full = Math.max(0, kellyFraction(consensusProb, contractPrice));
  return Math.round(full * fraction * bankroll);
}

// Expected value per $1 staked on a binary contract priced at contractPrice,
// given true win probability consensusProb.
//   payout_if_win = (1 - C) / C   (profit per $1 staked if it resolves YES)
//   EV = p * payout_if_win - (1 - p) * 1
// Returned as a decimal fraction (0.08 = 8%), not a percentage.
export function evPercent(consensusProb: number, contractPrice: number): number {
  if (contractPrice <= 0 || contractPrice >= 1) {
    throw new Error(`contractPrice must be in (0, 1), got ${contractPrice}`);
  }
  const payoutIfWin = (1 - contractPrice) / contractPrice;
  return consensusProb * payoutIfWin - (1 - consensusProb);
}

// Dollar EV of the suggested stake — just evPercent scaled by the stake
// size, kept as its own function since callers want both independently
// (the percentage for filtering/sorting, the dollar figure for display).
export function expectedProfit(stake: number, consensusProb: number, contractPrice: number): number {
  return stake * evPercent(consensusProb, contractPrice);
}

// Illustrative annualized return, NOT a guarantee: assumes this exact edge
// repeats every avgDaysToSettle days for a full year with capital fully
// recycling into the same trade each cycle (365 / avgDaysToSettle cycles),
// compounding. Real markets don't offer the same edge on a fixed cadence,
// and this makes no allowance for variance, drawdowns, or capital
// availability — it's a rough "what if" projection for comparing
// opportunities against each other, not a return forecast.
export function projectedIrr(ev: number, avgDaysToSettle = 3): number {
  const cyclesPerYear = 365 / avgDaysToSettle;
  return (1 + ev) ** cyclesPerYear - 1;
}
