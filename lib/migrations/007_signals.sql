-- Session 9: SIGNALS — a second, LAF-native +EV detection engine, fully
-- independent from quant_engine (separate Python repo, surfaced in the
-- QUANT tab). SIGNALS synthesizes its "sharp" baseline from Action Network
-- odds already scraped into this project's own `games`/`odds_snapshots`
-- tables (see lib/adapters/pinnacleAdapter.ts), so — unlike quant_engine's
-- qe_* tables — a real FK into `games` is correct here.
--
-- Phase 1 scope: h2h (moneyline) only, WNBA/MLB only — no `point` column,
-- unlike arbitrage_opportunities' spreads/totals support.

CREATE TABLE IF NOT EXISTS signal_opportunities (
  id BIGSERIAL PRIMARY KEY,
  game_id INTEGER REFERENCES games(id),
  canonical_id TEXT,
  sport TEXT NOT NULL,
  market_type TEXT NOT NULL,
  outcome_name TEXT NOT NULL,         -- the team/outcome this side refers to (e.g. "Yankees") -- not derivable from games, so not just a join target like home_team/away_team
  side TEXT NOT NULL,                 -- 'yes'/'no'/'over'/'under'
  execution_venue TEXT NOT NULL,      -- 'kalshi','polymarket','fanduel',...
  offered_price DECIMAL(10,6) NOT NULL,
  consensus_prob DECIMAL(10,6) NOT NULL,
  per_model_breakdown JSONB NOT NULL,
  ev_percent DECIMAL(10,6) NOT NULL,
  kelly_stake DECIMAL(10,2) NOT NULL,
  expected_profit DECIMAL(10,2),
  is_simulated BOOLEAN DEFAULT TRUE,
  detected_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_signal_opp_ev ON signal_opportunities(ev_percent DESC);
CREATE INDEX IF NOT EXISTS idx_signal_opp_detected ON signal_opportunities(detected_at DESC);
CREATE INDEX IF NOT EXISTS idx_signal_opp_sport ON signal_opportunities(sport);

CREATE TABLE IF NOT EXISTS signal_trades (
  id BIGSERIAL PRIMARY KEY,
  opportunity_id BIGINT REFERENCES signal_opportunities(id),
  canonical_id TEXT,
  execution_venue TEXT NOT NULL,
  side TEXT NOT NULL,
  entry_price DECIMAL(10,6) NOT NULL,
  stake DECIMAL(10,2) NOT NULL,
  consensus_prob DECIMAL(10,6) NOT NULL,
  ev_at_entry DECIMAL(10,6) NOT NULL,
  status TEXT DEFAULT 'open',         -- 'open','settled_win','settled_loss','void'
  closing_prob DECIMAL(10,6),
  clv_percent DECIMAL(10,6),
  is_simulated BOOLEAN DEFAULT TRUE,
  executed_at TIMESTAMPTZ DEFAULT NOW(),
  settled_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_signal_trades_status ON signal_trades(status);
