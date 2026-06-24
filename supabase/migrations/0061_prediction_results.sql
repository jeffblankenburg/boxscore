-- Outcome side of the prediction system. For each snapshotted game
-- prediction in daily_predictions, this table records what actually
-- happened plus the derived correctness/Brier metrics.
--
-- Written by /api/cron/predictions-comparator the morning after games
-- finalize. One row per (sport, date, game_pk, model_version) so we
-- can re-score historical predictions when the comparator logic
-- changes (no PK collision per model run).
--
-- Why win_brier separately from win_correct: accuracy alone is an
-- impoverished metric. A 51% pick that flips a coin is "correct" half
-- the time but uninformative. Brier squared-error rewards calibrated
-- confidence (a 90% pick that actually wins beats a 60% pick that
-- wins), and we'll need calibration plots later. Both stored so the
-- calibration view can use either.
--
-- actual_winner: 'away' | 'home' | null. null when status != 'final'
-- (postponed, suspended, tie via doubleheader split, etc.) — these
-- rows still get written so we can count "games we skipped" in the
-- denominator, but win_correct stays NULL.
--
-- actual_nrfi: true iff total first-inning runs == 0. Same null
-- semantics as actual_winner when the game didn't reach the bottom
-- of the 1st.

create table public.prediction_results (
  sport             text         not null,
  date              date         not null,
  game_pk           int          not null,
  model_version     text         not null,

  -- snapshotted predictions (denormalized for fast joins with results)
  away_win_pct      numeric(5,4) not null,
  home_win_pct      numeric(5,4) not null,
  nrfi_pct          numeric(5,4) not null,

  -- actual outcomes from daily_raw.games[gamePk].boxscore
  status            text         not null,         -- 'final', 'postponed', 'suspended', etc.
  away_score        int,
  home_score        int,
  away_first_inning int,                            -- runs scored by away in 1st
  home_first_inning int,                            -- runs scored by home in 1st

  -- derived
  actual_winner     text,                           -- 'away' | 'home' | null
  actual_nrfi       boolean,                        -- true iff (away_first_inning + home_first_inning) == 0
  win_correct       boolean,                        -- did predicted favorite actually win
  nrfi_correct      boolean,                        -- did NRFI prediction match outcome (>= 0.5 = predict YES)
  win_brier         numeric(8,6),                   -- (home_win_pct - (1 if home won else 0))^2
  nrfi_brier        numeric(8,6),                   -- (nrfi_pct - (1 if nrfi else 0))^2

  scored_at         timestamptz  not null default now(),
  primary key (sport, date, game_pk, model_version)
);

create index prediction_results_date
  on public.prediction_results (sport, date);

create index prediction_results_model_date
  on public.prediction_results (sport, model_version, date);

alter table public.prediction_results enable row level security;
grant select, insert, update on public.prediction_results to service_role;
