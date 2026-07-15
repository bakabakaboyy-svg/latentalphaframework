-- Session 5 migration — run this once in the Supabase SQL Editor against your
-- existing database. (lib/schema.sql has already been updated so a *fresh*
-- database created from it won't need this.)
--
-- The steam_moves table already existed from the Session 1 schema (unused
-- until now) — this just adds the guardrails Session 5's detection logic
-- expects: a uniqueness constraint so re-running detection over the same
-- scrape's data can't insert the same steam event twice, and an index on
-- game_id to match how the STEAM tab queries it.

ALTER TABLE steam_moves ADD CONSTRAINT steam_moves_unique_detection
  UNIQUE (game_id, market_type, outcome_name, detected_at);

CREATE INDEX idx_steam_moves_game_id ON steam_moves(game_id);
