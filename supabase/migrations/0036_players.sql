-- Canonical players table for the boxscore.games slate (#63) and the
-- /mlb/player/[id] page cutover. Replaces the implicit pattern where
-- player data was always fetched live from /api/v1/people/{personId} or
-- pulled denormalized from historical_boxscores.boxscore_raw.
--
-- player_id is the MLB Stats API person id (e.g. 592450 for Aaron Judge).
-- We treat it as the canonical identifier because the public URL surface
-- (/mlb/player/{personId}) already uses it. When NBA / NFL land, they
-- get their own table with the same shape — multi-sport in a single
-- table would force composite keys and indirect joins for no v1 benefit.
--
-- Profile fields only. Career stats (year-by-year, totals) land in a
-- separate historical_player_career cache table per #59 — different
-- shape, different update cadence.

create table if not exists public.players (
  player_id          int          primary key,                -- MLB Stats API person id
  full_name          text         not null,
  first_name         text,
  last_name          text,
  middle_name        text,
  -- "boxscoreName" from the API — short surname used in box scores
  -- ("Judge" / "Vladimir Jr."). Used as the display ground-truth per the
  -- existing project memory feedback_boxscore_name_ground_truth (#41).
  boxscore_name      text,
  name_slug          text,                                    -- "aaron-judge-592450" for SEO routes if we add them
  birth_date         date,
  birth_country      text,
  birth_state        text,
  birth_city         text,
  debut_date         date,                                    -- MLB debut
  last_game_date     date,                                    -- null if active or unknown; derivable from historical_player_lines once #56 lands
  active             bool,                                    -- snapshot at fetch time; refreshed by /refresh runs
  primary_position   text,                                    -- abbreviation: 'P' / 'C' / 'SS' / 'RF' / etc.
  primary_number     text,                                    -- jersey # — text because it may be "00" or include letters historically
  bats               text,                                    -- 'L' / 'R' / 'S'
  throws             text,                                    -- 'L' / 'R'
  height_inches      int,                                     -- parsed from "6' 7\""
  weight_lbs         int,
  draft_year         int,
  hall_of_fame       bool         not null default false,     -- backfilled from a curated list, not the MLB API
  raw_profile        jsonb,                                   -- /people/{id} response cached as-is for any field we didn't promote
  fetched_at         timestamptz,
  updated_at         timestamptz  not null default now()
);

-- Autocomplete lookups for Guess the Player (#61). Most common query
-- shape is "last name starts with X." Compound index puts last_name
-- first because that's the more selective half of the predicate.
create index if not exists players_name_lookup
  on public.players (last_name, first_name);

-- Era + position queries — "all SS who debuted in the 1980s" for the
-- Higher / Lower game (#62) and any future leaderboard slicing.
create index if not exists players_position_era
  on public.players (primary_position, debut_date);

-- HOF roster for any "all-time greats" filter.
create index if not exists players_hof
  on public.players (hall_of_fame)
  where hall_of_fame = true;

alter table public.players enable row level security;

-- Service role writes and reads. Public anon reads so the public
-- /mlb/player/[id] page can hit the table directly without going
-- through a server action.
grant select, insert, update on public.players to service_role;
grant select on public.players to anon;
