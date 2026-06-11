-- Per-line storage for the boxscore.games slate (#56). One row per
-- batter-line and per pitcher-line per game. The unit of selection for
-- Linescordle, Guess the Player, and Higher / Lower — the daily picker
-- (#57) filters this table by feat_score, calendar day, and recency.
--
-- Identity follows the canonical model: player_id is the internal id
-- from the players table (#63), not the vendor mlb_id. game_pk is the
-- MLB Stats API gamePk; FK'd to historical_games which carries the
-- canonical game metadata.
--
-- Both batter and pitcher lines share this table with a line_type
-- discriminator. The non-relevant *_stats column is null. Two flavors
-- in one table keeps the picker queries simple (one filter set, one
-- order column) and matches the MLB API's shape.
--
-- Pure transformation source: historical_boxscores.boxscore_raw. The
-- backfill in scripts/backfill-player-line-feats.ts runs against
-- whatever's currently ingested and is re-runnable with --rescore for
-- tuning passes once weights move.

create table public.historical_player_lines (
  id                 bigserial    primary key,
  game_pk            bigint       not null references public.historical_games(game_pk) on delete cascade,
  -- Denormalized so the picker's calendar-day filter (extract(month/day)
  -- from this row alone) and season slicing don't have to join.
  game_date          date         not null,
  season             int          not null,
  game_type          text,                                          -- 'R' / 'P' / 'F' / 'D' / 'L' / 'W' / etc.
  -- player_id is the internal canonical id (bigserial PK on players).
  -- mlb_id and player_name are denormalized so the leaderboard / share
  -- grid can render without a join to players.
  player_id          int          not null references public.players(id) on delete cascade,
  mlb_id             int          not null,                          -- vendor id, useful for MLB API calls
  player_name        text         not null,
  team_id            int,
  team_abbr          text,
  opp_team_id        int,
  opp_team_abbr      text,
  -- Line type discriminator. The opposite column stays null.
  line_type          text         not null check (line_type in ('batting', 'pitching')),
  batting_stats      jsonb,
  pitching_stats     jsonb,
  -- Computed by lib/historical/feat.ts at backfill time. feat_notes
  -- stores per-signal contributions so the admin viewer can explain
  -- why a line scored what it did.
  feat_score         int          not null default 0,
  feat_notes         jsonb,
  scored_at          timestamptz,
  ingested_at        timestamptz  not null default now()
);

-- Daily picker: top feat-score on a given calendar day across history.
-- The picker queries WHERE extract(month) = X AND extract(day) = Y
-- ORDER BY feat_score DESC LIMIT 1 (plus a recency exclusion). This
-- compound expression index is exactly that shape.
create index historical_player_lines_calendar
  on public.historical_player_lines (
    (extract(month from game_date)),
    (extract(day   from game_date)),
    feat_score desc
  );

-- Player history slicing — every line a single player has produced,
-- sorted by season for player-page-style display.
create index historical_player_lines_player_season
  on public.historical_player_lines (player_id, season);

-- All-time leaderboard.
create index historical_player_lines_feat_score
  on public.historical_player_lines (feat_score desc);

-- One game's full set of lines, used by the historical viewer to show
-- which lines from this game scored high.
create index historical_player_lines_game
  on public.historical_player_lines (game_pk);

alter table public.historical_player_lines enable row level security;
grant select, insert, update on public.historical_player_lines to service_role;
-- Public read so the future /games/lines or leaderboard pages can hit
-- this directly without going through a server action.
grant select on public.historical_player_lines to anon;
