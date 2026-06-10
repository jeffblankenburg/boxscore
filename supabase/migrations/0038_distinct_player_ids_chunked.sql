-- Chunked variant of distinct_historical_player_ids() — the one shipped
-- in 0037 walks all 92k+ historical_boxscores in a single statement and
-- exceeds Supabase's statement timeout. Caller iterates by game_pk
-- range and unions the results client-side.
--
-- Replaces (not adds) — the unparameterized version is removed.

drop function if exists public.distinct_historical_player_ids();

create or replace function public.distinct_historical_player_ids(
  min_game_pk bigint,
  max_game_pk bigint
)
returns table(mlb_id int)
language sql
stable
as $$
  select distinct (substring(k from 3))::int as mlb_id
  from public.historical_boxscores hb,
       lateral jsonb_object_keys(hb.boxscore_raw->'teams'->'away'->'players') k
  where hb.game_pk >= min_game_pk
    and hb.game_pk <  max_game_pk
    and k like 'ID%'
  union
  select distinct (substring(k from 3))::int
  from public.historical_boxscores hb,
       lateral jsonb_object_keys(hb.boxscore_raw->'teams'->'home'->'players') k
  where hb.game_pk >= min_game_pk
    and hb.game_pk <  max_game_pk
    and k like 'ID%';
$$;

grant execute on function public.distinct_historical_player_ids(bigint, bigint) to service_role;
