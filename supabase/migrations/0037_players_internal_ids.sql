-- Redo of #63's players table to use internal canonical IDs instead of
-- the MLB Stats API person id as the primary key. The previous shape
-- (0036) violated the canonical-data-model principle: vendor data should
-- map to source-agnostic types at ingestion. Using mlb_id as PK forced
-- every FK in the system to carry vendor leakage.
--
-- Safe because the 0036 backfill never completed — the players table
-- is empty. We drop and recreate cleanly.
--
-- Internal `id` is what historical_player_lines.player_id (#56) and
-- every future FK will point at. `mlb_id` is purely a vendor lookup
-- column — populated for every MLB player, will be null for future
-- non-MLB players (when an NBA/NFL players module is added we'll add
-- nba_id, nfl_id columns, or extract into a per-sport vendor-id map).
--
-- Also lands a helper RPC `distinct_historical_player_ids()` so the
-- backfill script can extract the full set of MLB ids from
-- historical_boxscores.boxscore_raw in one server-side query instead of
-- paging through ~92k 50KB jsonb rows (the 0036 backfill attempt timed
-- out on Supabase's statement timeout).

drop table if exists public.players cascade;

create table public.players (
  id                 bigserial    primary key,                -- internal canonical id
  full_name          text         not null,
  first_name         text,
  last_name          text,
  middle_name        text,
  -- Short surname for box-score display per feedback #41.
  boxscore_name      text,
  name_slug          text,
  birth_date         date,
  birth_country      text,
  birth_state        text,
  birth_city         text,
  debut_date         date,
  last_game_date     date,                                    -- derived from historical_player_lines once #56 lands
  active             bool,
  primary_position   text,                                    -- 'P' / 'C' / 'SS' / 'RF' / etc.
  primary_number     text,
  bats               text,                                    -- 'L' / 'R' / 'S'
  throws             text,                                    -- 'L' / 'R'
  height_inches      int,
  weight_lbs         int,
  draft_year         int,
  hall_of_fame       bool         not null default false,
  raw_profile        jsonb,                                   -- /people/{id} response cached as-is
  -- Vendor lookup. Nullable so future non-MLB players can live in the
  -- same table; unique-when-set so we can ensure-by-mlb_id without races.
  mlb_id             int          unique,
  fetched_at         timestamptz,
  updated_at         timestamptz  not null default now()
);

-- Autocomplete lookups for Guess the Player (#61). Last name is more
-- selective than first name; index orders that way.
create index players_name_lookup
  on public.players (last_name, first_name);

-- Era + position queries for Higher / Lower (#62) and future
-- leaderboard slicing.
create index players_position_era
  on public.players (primary_position, debut_date);

-- HOF roster for any "all-time greats" filter.
create index players_hof
  on public.players (hall_of_fame)
  where hall_of_fame = true;

alter table public.players enable row level security;
grant select, insert, update on public.players to service_role;
grant select on public.players to anon;

-- ─── helper RPC: distinct MLB person ids across all historical boxscores
--
-- Used by scripts/backfill-player-profiles.ts to enumerate the full
-- player population without dragging boxscore_raw to the client.
-- Returns ~15-20k rows; fast because it's a jsonb_object_keys scan
-- with no payload transfer.

create or replace function public.distinct_historical_player_ids()
returns table(mlb_id int)
language sql
stable
as $$
  select distinct (substring(k from 3))::int as mlb_id
  from public.historical_boxscores,
       lateral jsonb_object_keys(boxscore_raw->'teams'->'away'->'players') k
  where k like 'ID%'
  union
  select distinct (substring(k from 3))::int
  from public.historical_boxscores,
       lateral jsonb_object_keys(boxscore_raw->'teams'->'home'->'players') k
  where k like 'ID%';
$$;

grant execute on function public.distinct_historical_player_ids() to service_role;
