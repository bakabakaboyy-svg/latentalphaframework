// Types for SIGNALS — a second, LAF-native +EV detection engine, fully
// independent from quant_engine (separate Python repo, surfaced in the
// QUANT tab). SIGNALS synthesizes its "sharp" baseline from Action Network
// odds LAF already scrapes (see lib/adapters/pinnacleAdapter.ts) rather than
// ingesting real Kalshi/Polymarket data itself.
//
// Phase 1 scope, matching lib/migrations/007_signals.sql: h2h (moneyline)
// markets only, WNBA/MLB only — no `point` tracking, unlike ARB's
// spreads/totals support.

import type { MarketType } from "./odds";

export type SignalSide = "yes" | "no" | "over" | "under";
export type SignalMode = "SIMULATED" | "LIVE";
export type SignalTradeStatus = "open" | "settled_win" | "settled_loss" | "void";

export interface SignalModelBreakdown {
  multiplicative: number;
  additive: number;
  power: number;
  probit: number;
  shin: number;
}

// Keyed by sharp-book name, e.g. { pinnacle: {...}, circa: {...} }
export type SignalPerBookBreakdown = Record<string, SignalModelBreakdown>;

// offeredPrice/consensusProb are always a [0,1] contract-price-equivalent
// probability, regardless of source venue — a traditional sportsbook's
// American odds and a prediction market's native contract price are both
// economically the same thing (implied win probability), so both are
// normalized to this one representation before any EV/Kelly math runs. See
// the detect route for the conversion.
export interface SignalOpportunity {
  id: number;
  gameId: number | null;
  canonicalId: string | null;
  sport: string;
  marketType: MarketType;
  homeTeam: string;
  awayTeam: string;
  outcomeName: string;
  side: SignalSide;
  executionVenue: string;
  offeredPrice: number;
  consensusProb: number;
  perModelBreakdown: SignalPerBookBreakdown;
  worstCaseUsed: Record<string, number>;
  evPercent: number;
  kellyStakeDollars: number;
  expectedProfit: number;
  projectedIrr: number;
  isSimulated: boolean;
  detectedAt: string;
  expiresAt: string | null; // the game's commence_time, used as the settlement proxy
  isUrgent: boolean; // true if expiresAt is within 48h (see lib/signals/velocity.ts)
}

export interface SignalTrade {
  id: number;
  opportunityId: number | null;
  canonicalId: string | null;
  executionVenue: string;
  side: SignalSide;
  entryPrice: number;
  stake: number;
  consensusProb: number;
  evAtEntry: number;
  status: SignalTradeStatus;
  closingProb: number | null;
  clvPercent: number | null;
  isSimulated: boolean;
  executedAt: string;
  settledAt: string | null;
}

// GET /api/signals response body
export interface SignalsResponse {
  mode: SignalMode;
  opportunities: SignalOpportunity[];
  error?: string;
}

// POST /api/signals/detect response body
export interface DetectSignalsResponse {
  opportunitiesFound: number;
  simulated: boolean;
  topEv: number | null;
  error?: string;
}

// POST /api/signals/execute request/response
export interface ExecuteSignalRequest {
  opportunityId: number;
  stakeOverride?: number;
}

export interface ExecuteSignalResponse {
  success: boolean;
  trade?: SignalTrade;
  error?: string;
}
