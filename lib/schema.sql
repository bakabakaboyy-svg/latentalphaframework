-- LAF (Latent Alpha Framework) — Supabase schema
-- Paste this entire file into the Supabase SQL Editor and run it once.
-- Every odds snapshot is timestamped and immutable; opening_lines is a
-- denormalized fast-lookup table populated the first time a game/book/market
-- combination is seen.

-- Books/sources master list
CREATE TABLE books (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  type TEXT NOT NULL, -- 'sportsbook', 'prediction_market', 'dfs'
  is_sharp BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Sports and leagues
CREATE TABLE sports (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  active BOOLEAN DEFAULT TRUE
);

-- Games/events
CREATE TABLE games (
  id SERIAL PRIMARY KEY,
  sport_id INTEGER REFERENCES sports(id),
  home_team TEXT NOT NULL,
  away_team TEXT NOT NULL,
  commence_time TIMESTAMPTZ NOT NULL,
  status TEXT DEFAULT 'upcoming', -- 'upcoming', 'live', 'final'
  external_id TEXT UNIQUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Every odds snapshot — this is the core table
CREATE TABLE odds_snapshots (
  id BIGSERIAL PRIMARY KEY,
  game_id INTEGER REFERENCES games(id),
  book_id INTEGER REFERENCES books(id),
  market_type TEXT NOT NULL, -- 'h2h', 'spreads', 'totals'
  outcome_name TEXT NOT NULL,
  price DECIMAL(10,4) NOT NULL, -- American odds as decimal e.g. -110 = -110.0
  point DECIMAL(6,2), -- for spreads and totals
  is_opening BOOLEAN DEFAULT FALSE,
  recorded_at TIMESTAMPTZ DEFAULT NOW()
);

-- Opening lines specifically (denormalized for speed)
CREATE TABLE opening_lines (
  id SERIAL PRIMARY KEY,
  game_id INTEGER REFERENCES games(id),
  book_id INTEGER REFERENCES books(id),
  market_type TEXT NOT NULL,
  outcome_name TEXT NOT NULL,
  price DECIMAL(10,4) NOT NULL,
  point DECIMAL(6,2),
  recorded_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(game_id, book_id, market_type, outcome_name)
);

-- Steam moves detected
CREATE TABLE steam_moves (
  id SERIAL PRIMARY KEY,
  game_id INTEGER REFERENCES games(id),
  market_type TEXT NOT NULL,
  outcome_name TEXT NOT NULL,
  direction TEXT NOT NULL, -- 'up' or 'down'
  trigger_book TEXT,
  price_before DECIMAL(10,4),
  price_after DECIMAL(10,4),
  books_moved INTEGER DEFAULT 1,
  detected_at TIMESTAMPTZ DEFAULT NOW()
);

-- Manual bet entries for CLV tracking
CREATE TABLE bet_entries (
  id SERIAL PRIMARY KEY,
  game_id INTEGER REFERENCES games(id),
  book_id INTEGER REFERENCES books(id),
  market_type TEXT NOT NULL,
  outcome_name TEXT NOT NULL,
  entry_price DECIMAL(10,4) NOT NULL,
  stake DECIMAL(10,2),
  entry_time TIMESTAMPTZ DEFAULT NOW(),
  closing_price DECIMAL(10,4),
  clv_percentage DECIMAL(6,4),
  status TEXT DEFAULT 'open' -- 'open', 'closed', 'graded'
);

-- Seed books
INSERT INTO books (name, slug, type, is_sharp) VALUES
('Pinnacle', 'pinnacle', 'sportsbook', true),
('Circa', 'circa', 'sportsbook', true),
('FanDuel', 'fanduel', 'sportsbook', false),
('DraftKings', 'draftkings', 'sportsbook', false),
('BetMGM', 'betmgm', 'sportsbook', false),
('Action Network', 'action-network', 'sportsbook', false),
('Kalshi', 'kalshi', 'prediction_market', false),
('Polymarket', 'polymarket', 'prediction_market', false),
('Limitless', 'limitless', 'prediction_market', false),
('Coinbase', 'coinbase', 'prediction_market', false),
('Robinhood', 'robinhood', 'prediction_market', false);

-- Seed sports
INSERT INTO sports (name, slug) VALUES
('MLB', 'mlb'),
('WNBA', 'wnba'),
('Tennis', 'tennis'),
('Soccer', 'soccer'),
('CS2', 'cs2');

-- Indexes for performance
CREATE INDEX idx_odds_snapshots_game_id ON odds_snapshots(game_id);
CREATE INDEX idx_odds_snapshots_recorded_at ON odds_snapshots(recorded_at);
CREATE INDEX idx_odds_snapshots_book_id ON odds_snapshots(book_id);
CREATE INDEX idx_steam_moves_detected_at ON steam_moves(detected_at);
CREATE INDEX idx_bet_entries_status ON bet_entries(status);
