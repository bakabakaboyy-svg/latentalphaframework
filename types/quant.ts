// Types for the QUANT tab — read-only view into quant_engine's paper-trading
// data. quant_engine (C:\Users\lando\Documents\GitHub\quant_engine) is a
// deliberately separate Python system; kept out of odds.ts so that boundary
// stays legible. It writes qe_canonical_mappings / qe_paper_trades /
// qe_bankroll_history directly to this project's Supabase (see
// lib/migrations/006_quant_engine.sql) — LAF only reads them here.

export type QuantTradeStatus = "PENDING" | "WON" | "LOST" | "VOID" | "EXECUTED";

export type QuantStrategyType = "PLUS_EV" | "MIDDLE";

// Shape produced by quant_engine's main.py:_evaluate_contract — every field
// is optional since quant_engine's schema doesn't enforce which keys are
// present (it's a JSONB blob quant_engine controls, not LAF).
export interface QuantMarketDetails {
  source?: string; // "kalshi" | "polymarket"
  team?: string;
  sport?: string; // "MLB" | "WNBA"
  matchup?: string; // "Away Team @ Home Team"
}

export interface QuantPaperTrade {
  id: number;
  timestamp: string;
  canonicalId: string;
  strategyType: QuantStrategyType;
  marketDetails: QuantMarketDetails;
  targetPrice: number;
  consensusProb: number;
  calculatedEv: number;
  suggestedStake: number;
  status: QuantTradeStatus;
  settlementDate: string | null;
  actualProfitLoss: number | null;
  notes: string | null;
}

export interface QuantBankroll {
  timestamp: string;
  startingBalance: number;
  currentBalance: number;
  realizedPnl: number;
  unrealizedPnl: number;
  largestWin: number | null;
  largestLoss: number | null;
}

// GET /api/quant response body
export interface QuantResponse {
  bankroll: QuantBankroll | null;
  trades: QuantPaperTrade[];
  error?: string;
}
