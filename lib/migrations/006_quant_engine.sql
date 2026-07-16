-- Session 8: quant_engine tables (qe_*) — persistence for the separate Python
-- paper-trading engine (repo: quant_engine, C:\Users\lando\Documents\GitHub\quant_engine).
-- LAF only READS these to render the QUANT tab; quant_engine's own database.py
-- is the sole writer. Intentionally standalone: keyed on quant_engine's own
-- canonical_id text, no FK into LAF's games table, so the two systems stay
-- decoupled. Mirrors quant_engine's original SQLite schema 1:1.

CREATE TABLE qe_canonical_mappings (
  id BIGSERIAL PRIMARY KEY,
  canonical_id TEXT UNIQUE NOT NULL,
  sport TEXT NOT NULL,
  pinnacle_market_id TEXT,
  circa_market_id TEXT,
  kalshi_ticker TEXT,
  polymarket_condition_id TEXT,
  last_updated TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE qe_paper_trades (
  id BIGSERIAL PRIMARY KEY,
  timestamp TIMESTAMPTZ DEFAULT NOW(),
  canonical_id TEXT NOT NULL,
  strategy_type TEXT NOT NULL, -- 'PLUS_EV' | 'MIDDLE'
  market_details JSONB NOT NULL,
  target_price DECIMAL(10,4) NOT NULL,
  consensus_prob DECIMAL(10,4) NOT NULL,
  calculated_ev DECIMAL(10,4) NOT NULL,
  suggested_stake DECIMAL(12,2) NOT NULL,
  status TEXT DEFAULT 'PENDING', -- PENDING|WON|LOST|VOID|EXECUTED
  settlement_date TIMESTAMPTZ,
  actual_profit_loss DECIMAL(12,2),
  notes TEXT
);

CREATE TABLE qe_bankroll_history (
  id BIGSERIAL PRIMARY KEY,
  timestamp TIMESTAMPTZ DEFAULT NOW(),
  starting_balance DECIMAL(12,2) NOT NULL,
  current_balance DECIMAL(12,2) NOT NULL,
  realized_pnl DECIMAL(12,2) NOT NULL,
  unrealized_pnl DECIMAL(12,2) NOT NULL,
  largest_win DECIMAL(12,2),
  largest_loss DECIMAL(12,2)
);

CREATE INDEX idx_qe_paper_trades_status ON qe_paper_trades(status);
CREATE INDEX idx_qe_paper_trades_timestamp ON qe_paper_trades(timestamp DESC);
CREATE INDEX idx_qe_canonical_mappings_canonical_id ON qe_canonical_mappings(canonical_id);
CREATE INDEX idx_qe_bankroll_history_timestamp ON qe_bankroll_history(timestamp DESC);
