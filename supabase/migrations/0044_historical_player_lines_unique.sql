-- Add UNIQUE (game_pk, player_id, line_type) to historical_player_lines
-- so the feat-backfill can switch from .insert() to .upsert() and be
-- safely resumable.
--
-- Driving reason: the feat-backfill cursor stopped at game_pk 170,533
-- (mid-1976), so 1977-2025 line extraction never finished. Resuming
-- forward without a conflict guard would risk duplicating rows for the
-- handful of post-1976 games that an earlier pass populated.
--
-- A two-way player (Ohtani-style) legitimately produces both a
-- batting line AND a pitching line in the same game, so the uniqueness
-- key must include line_type alongside (game_pk, player_id).
--
-- If this migration fails on existing duplicates, we'll need to dedupe
-- first (keeping the row with the higher feat_score / newer scored_at).
-- A 50-game sample on 2026-06-11 showed zero dirty games but the table
-- has 1.6M rows; the constraint itself is the authoritative check.

alter table public.historical_player_lines
  add constraint historical_player_lines_game_player_line_unique
  unique (game_pk, player_id, line_type);
