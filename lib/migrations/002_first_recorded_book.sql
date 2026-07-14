-- Session 3 migration — run this once in the Supabase SQL Editor against your
-- existing database. (lib/schema.sql has already been updated so a *fresh*
-- database created from it won't need this — it's only for upgrading a DB
-- that already ran the Session 1 schema.)

ALTER TABLE opening_lines ADD COLUMN first_recorded_book TEXT;

-- One-time backfill for rows that already existed before this column did.
-- opening_lines is append-once (new rows only get first_recorded_book set at
-- insert time, existing rows are never touched), so without this, every game
-- scraped before today would show an empty "Opened: ..." line on the
-- MOVEMENT tab forever. Uses the same preference as the app (a sharp book if
-- one posted a line for that outcome, else whichever book slug sorts first).
WITH candidates AS (
  SELECT ol.game_id, ol.market_type, ol.outcome_name, b.slug, b.is_sharp
  FROM opening_lines ol
  JOIN books b ON b.id = ol.book_id
  WHERE ol.first_recorded_book IS NULL
),
reference AS (
  SELECT DISTINCT ON (game_id, market_type, outcome_name)
    game_id, market_type, outcome_name, slug AS ref_slug
  FROM candidates
  ORDER BY game_id, market_type, outcome_name, is_sharp DESC, slug ASC
)
UPDATE opening_lines ol
SET first_recorded_book = reference.ref_slug
FROM reference
WHERE ol.game_id = reference.game_id
  AND ol.market_type = reference.market_type
  AND ol.outcome_name = reference.outcome_name
  AND ol.first_recorded_book IS NULL;
