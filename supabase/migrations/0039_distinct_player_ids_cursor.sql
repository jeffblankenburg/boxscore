-- Third try at the player-id extraction. 0037's full-table scan timed
-- out; 0038's range-based chunking timed out on dense ranges (a single
-- 10k game_pk range can hold 7,500+ rows of 50KB jsonb each). This
-- version uses cursor pagination — caller passes the last game_pk seen
-- and a page size; we process exactly page_size rows of jsonb work per
-- call regardless of game_pk density.

drop function if exists public.distinct_historical_player_ids(bigint, bigint);

create or replace function public.distinct_player_ids_page(
  after_game_pk bigint,
  page_size     int
)
returns table(game_pk bigint, mlb_id int)
language sql
stable
as $$
  with page as (
    select hb.game_pk, hb.boxscore_raw
    from public.historical_boxscores hb
    where hb.game_pk > after_game_pk
    order by hb.game_pk
    limit page_size
  )
  select p.game_pk, (substring(k from 3))::int as mlb_id
  from page p,
       lateral jsonb_object_keys(p.boxscore_raw->'teams'->'away'->'players') k
  where k like 'ID%'
  union all
  select p.game_pk, (substring(k from 3))::int
  from page p,
       lateral jsonb_object_keys(p.boxscore_raw->'teams'->'home'->'players') k
  where k like 'ID%';
$$;

grant execute on function public.distinct_player_ids_page(bigint, int) to service_role;
