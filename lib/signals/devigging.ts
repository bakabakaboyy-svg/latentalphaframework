// De-vigging math — SIGNALS' own port of the 5 models already researched and
// verified in quant_engine's math_utils.py (Python, separate repo) this
// session, generalized from that file's 2-way functions to the N-way arrays
// this module's callers need (2-way h2h markets, or 3-way soccer). Shin's
// method in particular was checked against the real reference implementation
// (github.com/mberk/shin) rather than derived from memory — ported here
// rather than re-derived, for the same reason.
//
// Every model takes decimal odds (e.g. 1.9091, not -110) for every outcome
// of one market and returns de-vigged true probabilities that sum to ~1.0.

function impliedProbs(decimalOdds: number[]): number[] {
  return decimalOdds.map((o) => 1 / o);
}

// Proportional de-vig: each outcome's raw implied probability divided by the
// total. Assumes the book spreads vig proportionally to each outcome's own
// probability.
export function multiplicativeDevig(decimalOdds: number[]): number[] {
  const raw = impliedProbs(decimalOdds);
  const total = raw.reduce((s, p) => s + p, 0);
  return raw.map((p) => p / total);
}

// Equal-margin de-vig: subtracts an equal ABSOLUTE share of the overround
// from every outcome, rather than dividing proportionally. NOT the same as
// multiplicativeDevig in general — they only coincide when every outcome's
// raw probability is identical (a perfectly symmetric market).
export function additiveDevig(decimalOdds: number[]): number[] {
  const raw = impliedProbs(decimalOdds);
  const overround = raw.reduce((s, p) => s + p, 0) - 1;
  const n = decimalOdds.length;
  return raw.map((p) => p - overround / n);
}

// Favorite-longshot bias correction: solves for an exponent k >= 1 such that
// sum(raw_prob_i ** k) == 1, then returns each outcome raised to that power.
// Books are empirically observed to price longshots with more relative vig
// than favorites; raising to a shared exponent k > 1 shrinks the favorite's
// (larger) probability proportionally LESS than the underdog's (smaller)
// one, which is the correction this model is named for.
//
// total_at(k) is monotonically decreasing in k for probabilities in (0, 1):
// total_at(0) = n (outcome count), and it falls toward 0 as k grows. Real
// vigged markets have total_at(1) = sum(raw probs) > 1, so the root sits
// above k=1. Bounds [1, 10] bracket every realistic single-game market —
// verified against the same bounds used in math_utils.py's already-tested
// Python version, not re-derived here.
export function powerModelDevig(decimalOdds: number[], iterations = 50): number[] {
  const raw = impliedProbs(decimalOdds);
  const totalAt = (k: number) => raw.reduce((s, p) => s + p ** k, 0);

  let lo = 1.0;
  let hi = 10.0;
  if (totalAt(hi) > 1) {
    // Degenerate/near-zero-vig market — k=1 (no-op) is already close enough.
    return raw;
  }
  for (let i = 0; i < iterations; i++) {
    const mid = (lo + hi) / 2;
    if (totalAt(mid) > 1) lo = mid;
    else hi = mid;
  }
  const k = (lo + hi) / 2;
  return raw.map((p) => p ** k);
}

// Abramowitz & Stegun 7.1.26 rational approximation of the error function —
// max absolute error ~1.5e-7, comfortably tighter than this module's own
// bisection tolerances, so it never becomes the limiting source of error.
function erf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;
  const t = 1 / (1 + p * ax);
  const y = 1 - (((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t) * Math.exp(-ax * ax);
  return sign * y;
}

function normalCdf(x: number): number {
  return 0.5 * (1 + erf(x / Math.SQRT2));
}

// Peter Acklam's rational approximation of the inverse standard normal CDF
// (probit function) — the standard closed-form approximation for this,
// accurate to roughly 1.15e-9 relative error without the optional Halley
// refinement step, which isn't needed here given the bisection tolerances
// this is feeding into.
function inverseNormalCdf(p: number): number {
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239e0];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838e0, -2.549732539343734e0, 4.374664141464968e0, 2.938163982698783e0];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996e0, 3.754408661907416e0];

  const pLow = 0.02425;
  const pHigh = 1 - pLow;

  if (p < pLow) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (p <= pHigh) {
    const q = p - 0.5;
    const r = q * q;
    return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
  }
  const q = Math.sqrt(-2 * Math.log(1 - p));
  return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
}

// Maps each outcome's raw implied probability into z-space via the probit
// function, finds a shared shift delta such that shifting every z-score down
// by delta and mapping back through the normal CDF sums to 1, then returns
// the shifted-back probabilities. Treats the vig as an additive shift in
// z-space rather than in probability space directly — a different (and for
// probabilities near the tails, meaningfully different) shrinkage curve than
// the power model's multiplicative-in-probability-space approach.
export function probitDevig(decimalOdds: number[], iterations = 50): number[] {
  const raw = impliedProbs(decimalOdds);
  const z = raw.map(inverseNormalCdf);
  const totalAt = (delta: number) => z.reduce((s, zi) => s + normalCdf(zi - delta), 0);

  let lo = 0.0;
  let hi = 2.0;
  for (let i = 0; i < iterations; i++) {
    const mid = (lo + hi) / 2;
    if (totalAt(mid) > 1) lo = mid;
    else hi = mid;
  }
  const delta = (lo + hi) / 2;
  return z.map((zi) => normalCdf(zi - delta));
}

// General N-outcome (N >= 3) Shin's method, ported faithfully from the
// verified reference implementation (github.com/mberk/shin, src/lib.rs).
// Solves for z (the estimated proportion of "insider" informed trading) via
// fixed-point iteration, then returns each outcome's true probability.
function shinsDevigN(rawProbs: number[], iterations = 100, convergenceThreshold = 1e-12): number[] {
  const n = rawProbs.length;
  const total = rawProbs.reduce((s, p) => s + p, 0);
  const denominator = n - 2;
  let z = 0.0;
  for (let i = 0; i < iterations; i++) {
    const z0 = z;
    const sum = rawProbs.reduce((s, p) => s + Math.sqrt(z ** 2 + 4 * (1 - z) * (p ** 2) / total), 0);
    z = (sum - 2) / denominator;
    if (Math.abs(z - z0) < convergenceThreshold) break;
  }
  z = Math.max(0, Math.min(z, 0.999999)); // z is a proportion; clamp against numerical overshoot
  return rawProbs.map((p) => (Math.sqrt(z ** 2 + 4 * (1 - z) * (p ** 2) / total) - z) / (2 * (1 - z)));
}

// Shin's method. The general N-outcome iteration above is undefined at N=2
// (its denominator is n-2 = 0) — not an implementation gap: the literature
// (Clarke, Kovalchik & Ingram 2017, "Adjusting bookmaker's odds to allow for
// overround", as cited by the reference implementation above) establishes
// that Shin's method reduces to the additive (equal-margin) method exactly
// when there are only two outcomes. Delegates accordingly for N=2, matching
// the already-verified behavior in math_utils.py.
export function shinsDevig(decimalOdds: number[]): number[] {
  if (decimalOdds.length === 2) return additiveDevig(decimalOdds);
  return shinsDevigN(impliedProbs(decimalOdds));
}

export type ConsensusSide = "buy_yes" | "buy_over" | "buy_no" | "buy_under";

export interface ModelBreakdown {
  multiplicative: number;
  additive: number;
  power: number;
  probit: number;
  shin: number;
}

export interface ConsensusDevigResult {
  consensusProb: number;
  perModelBreakdown: Record<string, ModelBreakdown>; // keyed by book name (e.g. "pinnacle", "circa")
  worstCaseUsed: Record<string, number>; // per book, the min/max value actually averaged in
}

// Conservative consensus probability for one outcome (targetIndex) of a
// market, across whichever sharp books are present.
//
// For each book, runs all 5 models against that book's full odds array and
// reads off each model's probability at targetIndex, then takes the
// MINIMUM across the 5 models (buy_yes/buy_over — the most conservative
// estimate that supports buying this side) or the MAXIMUM (buy_no/buy_under
// — the most conservative estimate that supports buying the other side).
// Averages that per-book worst-case across every book present, so one
// book's outlier model can't single-handedly create a phantom edge, while
// the consensus still has to hold up across every model.
//
// targetIndex isn't in the caller-facing "side" concept from the original
// spec on its own — made explicit here (defaulting to 0) rather than
// implied by array ordering, since an implicit "reorder the array to switch
// sides" contract is exactly the kind of thing that's easy to get backwards
// and silently produce a wrong consensus for the wrong outcome.
export function consensusDevig(
  booksOdds: Record<string, number[]>,
  side: ConsensusSide,
  targetIndex = 0
): ConsensusDevigResult {
  const bookNames = Object.keys(booksOdds);
  if (bookNames.length === 0) {
    throw new Error("consensusDevig requires at least one book's odds");
  }

  const takeMin = side === "buy_yes" || side === "buy_over";
  const perModelBreakdown: Record<string, ModelBreakdown> = {};
  const worstCaseUsed: Record<string, number> = {};

  for (const book of bookNames) {
    const odds = booksOdds[book];
    const breakdown: ModelBreakdown = {
      multiplicative: multiplicativeDevig(odds)[targetIndex],
      additive: additiveDevig(odds)[targetIndex],
      power: powerModelDevig(odds)[targetIndex],
      probit: probitDevig(odds)[targetIndex],
      shin: shinsDevig(odds)[targetIndex],
    };
    perModelBreakdown[book] = breakdown;

    const values = Object.values(breakdown);
    worstCaseUsed[book] = takeMin ? Math.min(...values) : Math.max(...values);
  }

  const consensusProb = bookNames.reduce((s, b) => s + worstCaseUsed[b], 0) / bookNames.length;

  return { consensusProb, perModelBreakdown, worstCaseUsed };
}
