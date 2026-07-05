-- CLV (Closing Line Value) measurement infrastructure.
--
-- The predictions engine currently tunes on hit rate against ~40 plays/month.
-- At that sample size, hit rate is noise-dominated — a 55% hit rate over 40
-- plays has a ±15pp CI, so we can't confidently tell which model tweaks
-- actually improved anything. CLV — how much better a price we took vs.
-- what the market closed at — is the standard sharp metric because it's
-- signal per bet, not signal per outcome, and converges 5-10x faster.
--
-- Design shift from the initial plan: `daily_odds` becomes append-only.
-- One capture per (sport, date, game_pk, book) isn't enough because MLB
-- slates run from 1:05 PM ET (getaway days, weekend afternoons) to
-- 10:10 PM ET (West Coast night games), and a single "closing" window
-- would either miss the afternoon slate (still on the board) or write
-- next-day rows for early games (already concluded). Instead we poll
-- odds every 30 min throughout the day and derive both:
--   * "opening" — the FIRST capture per (game, book), which is what a
--     user reading /mlb/predictions in the morning would have seen.
--     Read through the `daily_odds_first` view below.
--   * "closing" — the LATEST capture per (game, book) whose
--     captured_at < that game's scheduled first_pitch. Derived in the
--     predictions-comparator using the schedule payload's gameDate.
--
-- This gives us complete line-movement history as a byproduct, useful
-- for later diagnostics ("which games did the market disagree with us
-- on, and did it move toward or away from our side").

-- Make daily_odds append-only. captured_at becomes part of the PK so
-- every poll appends rather than overwriting. Existing readers switch
-- to the daily_odds_first view (identical shape, one row per game/book).
alter table public.daily_odds drop constraint daily_odds_pkey;
alter table public.daily_odds add primary key (sport, date, game_pk, book, captured_at);

-- Index for "latest capture per game/book" queries — used by the
-- comparator to find the closing line for each game.
create index if not exists daily_odds_latest
  on public.daily_odds (sport, date, game_pk, book, captured_at desc);

-- Opening-price view: one row per (sport, date, game_pk, book) = the
-- earliest capture. Serves readers that used to see "the price for
-- this game" back when the table was upsert-shaped (loadOddsForDate,
-- loadPlayRoi, loadSeasonHistory, backfill scripts). Semantically:
-- the price a subscriber reading /mlb/predictions in the morning
-- would have taken.
create or replace view public.daily_odds_first as
  select distinct on (sport, date, game_pk, book)
    sport, date, game_pk, book, source, captured_at,
    away_ml_odds, home_ml_odds, nrfi_odds, yrfi_odds, raw
  from public.daily_odds
  order by sport, date, game_pk, book, captured_at asc;

grant select on public.daily_odds_first to service_role;

-- CLV inputs on prediction_results. Odds themselves stored (not derived
-- CLV) because the odds → implied probability math is trivial in code
-- and raw American values are what admins recognize. All nullable —
-- capture failures leave the field null and CLV math for that game
-- just doesn't contribute to the rollup.
alter table public.prediction_results
  add column if not exists open_away_ml_odds  int,
  add column if not exists open_home_ml_odds  int,
  add column if not exists open_nrfi_odds     int,
  add column if not exists open_yrfi_odds     int,
  add column if not exists close_away_ml_odds int,
  add column if not exists close_home_ml_odds int,
  add column if not exists close_nrfi_odds    int,
  add column if not exists close_yrfi_odds    int;

notify pgrst, 'reload schema';
