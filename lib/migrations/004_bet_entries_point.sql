-- Session 6 migration — run this once in the Supabase SQL Editor against your
-- existing database. (lib/schema.sql has already been updated so a *fresh*
-- database created from it won't need this.)
--
-- bet_entries needs a point column to distinguish spread/total bets like
-- "Yankees -1.5" from "Yankees -2.5" — without it, two different lines on
-- the same team would be indistinguishable by outcome_name alone.

ALTER TABLE bet_entries ADD COLUMN point DECIMAL(6,2);
