-- Game-level betting odds we record alongside our predictions so we can
-- compute ROI ("if you'd bet $10 on every play, what's the P/L?") instead
-- of just win %. Kept in a separate table from daily_predictions because:
--   - odds are vendor data with their own provenance (book, source, when
--     captured), not model output
--   - we want to be able to record multiple books for the same game later
--     without duplicating the prediction row
--   - model_version churn shouldn't invalidate the odds we've already
--     captured
--
-- Initial source is ESPN's core API which exposes DraftKings ML lines for
-- both current and historical games. NRFI columns are nullable from the
-- start — we have no free NRFI feed yet, but the structure is ready for
-- when we do (paid Odds API props tier, future SDIO add-on, etc.).
--
-- American odds convention:
--   positive integer (e.g. +123): underdog, bet 100 to win 123
--   negative integer (e.g. -148): favorite, bet 148 to win 100
--   null:                         we don't have this odds for this game
--
-- raw is the full vendor payload we used to populate the row, kept for
-- debugging and audit ("what did ESPN actually say?"). Optional.
create table public.daily_odds (
  sport         text         not null,
  date          date         not null,
  game_pk       int          not null,
  book          text         not null,   -- 'DraftKings', 'FanDuel', 'consensus', etc.
  source        text         not null,   -- provenance: 'espn-core', 'odds-api', 'manual'
  captured_at   timestamptz  not null default now(),
  away_ml_odds  int,                     -- American format
  home_ml_odds  int,                     -- American format
  nrfi_odds     int,                     -- American format
  yrfi_odds     int,                     -- American format
  raw           jsonb,
  primary key (sport, date, game_pk, book)
);

create index daily_odds_game on public.daily_odds (sport, date, game_pk);

alter table public.daily_odds enable row level security;
grant select, insert, update on public.daily_odds to service_role;

notify pgrst, 'reload schema';
