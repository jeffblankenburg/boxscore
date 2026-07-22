-- Restore daily_odds's append-only primary key.
--
-- Migration 0071 changed daily_odds's PK from (sport, date, game_pk, book)
-- to (sport, date, game_pk, book, captured_at) so the 30-min odds poller
-- can append many captures per game/day. In production that change reverted
-- around 2026-07-08 (most likely a point-in-time restore during one of the
-- July outages rolled the schema back before 0071 — the daily_odds_first
-- view, a separate statement, survived). Symptom: /api/cron/predictions-odds-poll
-- has failed on every run since, e.g.
--   [predictions-odds-poll] FanDuel capture failed: insert: duplicate key
--   value violates unique constraint "daily_odds_pkey"
-- because the 2nd+ capture of a (game, book) each day collides on the old
-- 4-column PK and Postgres rejects the whole insert batch → 0 odds rows/day.
--
-- Re-assert the append-only PK. Idempotent: drop-if-exists then re-add, so
-- it lands in the correct state whether prod currently has the old 4-col PK
-- or (on a machine where 0071 stuck) the 5-col one. No historical odds gap is
-- recoverable — FanDuel's API only serves live games — but this restores
-- capture going forward.

alter table public.daily_odds drop constraint if exists daily_odds_pkey;
alter table public.daily_odds add primary key (sport, date, game_pk, book, captured_at);

notify pgrst, 'reload schema';
