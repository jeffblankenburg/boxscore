-- Outcome side of the fantasy projection system. Mirrors
-- prediction_results: for each row in daily_fantasy_projections, the
-- comparator computes the actual fantasy score from the player's
-- box-score line and writes one row here.
--
-- Written by /api/cron/fantasy-comparator the morning after games
-- finalize. One row per (sport, date, player_id, model_version) so
-- we can re-score historical projections when the model or scoring
-- rules change without PK collision.
--
-- Why we denormalize identity AND projection inputs: matches the
-- daily_fantasy_projections pattern so a single read from this table
-- can render a projection-vs-actual table without joining back.
--
-- actual_score is the DraftKings-style points the player actually
-- scored in this game, using the same constants the projector uses
-- (lib/sports/mlb/fantasy.ts SCORE_*). Null when the player didn't
-- appear in the box (DNP — bench, scratched, late scratch) — distinct
-- from 0 (played and put up a goose egg).
--
-- delta = actual - proj_score. Sign matters: positive = beat projection.
-- Stored explicitly so the surface query is a single sort instead of
-- a per-row compute.

create table public.daily_fantasy_results (
  sport             text         not null,
  date              date         not null,
  player_id         int          not null,         -- mlb_id
  model_version     text         not null,

  -- denormalized identity (mirrors daily_fantasy_projections)
  full_name         text         not null,
  team_abbr         text         not null,
  opp_abbr          text         not null,
  is_home           boolean      not null,
  category          text         not null,         -- 'SP' | 'C' | '1B' | '2B' | '3B' | 'SS' | 'OF' | 'DH'

  -- snapshotted projection
  proj_score        numeric(8,2) not null,
  batting_order     int,
  lineup_status     text         not null,         -- 'confirmed' | 'projected'

  -- actual outcome
  game_pk           int,                            -- null when no game was played for this player's team
  game_status       text,                           -- 'Final', 'Postponed', etc; null when no game
  played            boolean      not null,         -- true iff player appeared in box
  actual_score      numeric(8,2),                   -- null when played=false
  actual_stats      jsonb        not null,         -- per-category counts (h, hr, rbi, ip, k, er, etc.)

  -- derived
  delta             numeric(8,2),                   -- actual - proj_score; null when actual is null

  scored_at         timestamptz  not null default now(),
  primary key (sport, date, player_id, model_version)
);

-- Recent results for the public /mlb/fantasy "Yesterday" surface.
create index daily_fantasy_results_date
  on public.daily_fantasy_results (sport, date desc);

-- Per-category top performers ("biggest beat / miss of the day").
create index daily_fantasy_results_date_category
  on public.daily_fantasy_results (sport, date desc, category, delta desc);

-- Per-player history ("Aaron Judge projection vs actual over time").
create index daily_fantasy_results_player
  on public.daily_fantasy_results (player_id, date desc);

alter table public.daily_fantasy_results enable row level security;
grant select, insert, update on public.daily_fantasy_results to service_role;
