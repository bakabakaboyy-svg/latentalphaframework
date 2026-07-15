-- Session 7: arbitrage_opportunities — a historical log of arbs detected by
-- the scraper on every run (same pattern as steam_moves), used to power the
-- ARB tab's "Last 24 Hours" stats card. The live arb *cards* the ARB tab
-- displays are computed fresh from current odds on every request (see
-- lib/utils/arbDetection.ts) rather than read from this table, so a stale
-- row here never shows the user a hedge that's already closed.
--
-- Extends the original 2-leg (outcome_a/b) design with a nullable 3rd leg
-- (outcome_c/odds_c/book_c) to support genuine 3-way markets (soccer
-- moneyline: Home/Draw/Away) — the spec's table only had room for 2 legs.
-- expires_at was dropped: nothing computes it (an arb's real "expiry" is
-- just "no longer detected on the next scrape," which this table doesn't
-- need to predict in advance).
CREATE TABLE arbitrage_opportunities (
  id BIGSERIAL PRIMARY KEY,
  game_id INTEGER REFERENCES games(id),
  market_type TEXT NOT NULL, -- 'h2h', 'spreads', 'totals'
  point DECIMAL(6,2), -- shared line point for spreads/totals groups; null for h2h
  outcome_a TEXT NOT NULL,
  odds_a DECIMAL(10,4) NOT NULL,
  book_a TEXT NOT NULL,
  outcome_b TEXT NOT NULL,
  odds_b DECIMAL(10,4) NOT NULL,
  book_b TEXT NOT NULL,
  outcome_c TEXT,
  odds_c DECIMAL(10,4),
  book_c TEXT,
  is_three_way BOOLEAN DEFAULT FALSE,
  arb_percentage DECIMAL(6,4) NOT NULL,
  detected_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_arbitrage_opportunities_game_id ON arbitrage_opportunities(game_id);
CREATE INDEX idx_arbitrage_opportunities_arb_percentage ON arbitrage_opportunities(arb_percentage DESC);
CREATE INDEX idx_arbitrage_opportunities_detected_at ON arbitrage_opportunities(detected_at DESC);
