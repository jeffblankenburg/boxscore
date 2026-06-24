-- Snapshot of /mlb/fantasy projections, written by a cron once per day
-- after lineups are mostly locked (5pm ET). Each row is one (date,
-- player, model_version) projection — score + inputs preserved as JSONB
-- so calibration can re-derive or refit without re-running the model.
--
-- Why JSONB inputs: the projection model takes ~15 inputs per player
-- (season rate stats, opposing SP, batting slot, matchup factor). We
-- want all of them recorded so we can later attribute accuracy to
-- specific inputs ("did rolling 30-day form help or hurt?") without
-- rerunning historical statsapi calls.
--
-- player_id is the MLB Stats API id (mlb_id on the canonical players
-- table). Stored that way because the comparator joins to
-- daily_raw.games[gamePk].boxscore.teams.*.players[ID<mlb_id>] for the
-- actual game line — same id space, no extra hop.
--
-- model_version is part of the PK so we can run multiple model versions
-- on the same day for A/B comparison without overwriting each other.

create table public.daily_fantasy_projections (
  sport             text         not null,
  date              date         not null,
  player_id         int          not null,         -- mlb_id, see comment above
  model_version     text         not null,

  -- denormalized identity for fast read queries without joining players
  full_name         text         not null,
  team_abbr         text         not null,
  opp_abbr          text         not null,
  is_home           boolean      not null,
  category          text         not null,         -- 'SP' | 'C' | '1B' | '2B' | '3B' | 'SS' | 'OF' | 'DH'

  -- projection output
  proj_score        numeric(8,2) not null,
  proj_inputs       jsonb        not null,         -- full breakdown: matchup factor, expected stats, season stats used

  -- lineup state at snapshot time
  batting_order     int,                            -- 1-9 if confirmed; null for SP and projected lineups
  lineup_status     text         not null,         -- 'confirmed' | 'projected'

  generated_at      timestamptz  not null default now(),
  primary key (sport, date, player_id, model_version)
);

-- Index supports "top-N by category on date X" (rendering accuracy +
-- backtesting "what was our top SS on every Tuesday?").
create index daily_fantasy_projections_date_category
  on public.daily_fantasy_projections (sport, date, category, proj_score desc);

-- Index supports per-player history queries ("Aaron Judge's projection
-- vs actual over the last 60 days").
create index daily_fantasy_projections_player
  on public.daily_fantasy_projections (player_id, date desc);

alter table public.daily_fantasy_projections enable row level security;
grant select, insert, update on public.daily_fantasy_projections to service_role;
