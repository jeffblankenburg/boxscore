-- Season-level batter and pitcher stats per player. Drives the Hi/Lo
-- daily game (#64): the picker pulls two player-seasons in the day's
-- stat category, the user guesses which has the higher (or lower for
-- ERA/WHIP) value.
--
-- Source: MLB's /api/v1/people/{mlbId}/stats?stats=yearByYear&group=hitting,pitching
-- One yearByYear split per (player, season, group) — for two-way
-- players (Ohtani, Ruth) we collapse both groups onto a single row by
-- writing the hitting block AND the pitching block.
--
-- Eligibility flags decide which side of the game a row can show up
-- on. `batter_eligible` is set when primary_position != 'P' (or the
-- player is in the two-way exception list in
-- lib/games/hilo/eligibility.ts) AND `pa >= 100`. `pitcher_eligible`
-- is the inverse. The thresholds keep September-callup rate-stat
-- outliers (e.g. a 12-PA player hitting .500) out of the pool.
--
-- Indexes are minimal — per-season pools are <1000 rows so in-app
-- sorting handles the picker's ranking queries. Add more if the
-- picker starts running slow at scale.

create table public.player_seasons (
  id                bigserial    primary key,
  player_id         bigint       not null references public.players(id) on delete cascade,
  season            int          not null,
  primary_position  text,                                  -- snapshot from players.primary_position at ingest
  team_abbr         text,                                  -- last team in that season per the MLB API; "MIN" / "—" for traded mid-season
  games_played      int,

  -- Batting block (null for pitcher-only seasons)
  pa                int,
  ab                int,
  h                 int,
  hr                int,
  rbi               int,
  r                 int,
  sb                int,
  bb_bat            int,
  doubles           int,
  triples           int,
  avg               numeric(4,3),
  obp               numeric(4,3),
  slg               numeric(4,3),
  ops               numeric(4,3),

  -- Pitching block (null for non-pitcher seasons). `ip` stored as decimal
  -- after parsing the MLB API's "198.2" baseball-innings convention
  -- (.1 = 1 out = .333; .2 = 2 outs = .667). So "198.2" → 198.667.
  ip                numeric(6,2),
  k                 int,
  w                 int,
  sv                int,
  era               numeric(6,2),
  whip              numeric(5,2),
  hr_allowed        int,
  bb_pitch          int,

  batter_eligible   bool         not null default false,
  pitcher_eligible  bool         not null default false,

  fetched_at        timestamptz  not null default now()
);

create unique index player_seasons_unique
  on public.player_seasons (player_id, season);

create index player_seasons_season_batter
  on public.player_seasons (season) where batter_eligible;
create index player_seasons_season_pitcher
  on public.player_seasons (season) where pitcher_eligible;

alter table public.player_seasons enable row level security;
grant select, insert, update on public.player_seasons to service_role;
