-- Editable per-team social hashtags. The default rally hashtags ship in code
-- (lib/social-content.ts), researched from each team's official account; this
-- table holds admin overrides + additions so the values can be corrected as
-- they drift season to season without a redeploy. See /admin/hashtags and
-- GH #119.
--
-- team_key is the sport's native caption-lookup key:
--   mlb                -> nickname      ("Yankees")
--   nba / wnba / nfl   -> abbreviation  ("NYY", "LV")
--   ncaaf              -> normalized school name, lowercased alnum ("ohiostate")
-- label is the human display name for the admin table (and the only source of
-- a school name for NCAAF teams the admin adds, which aren't in lib/teams.ts).
-- official is the hashtag WITHOUT the leading '#'; NULL/'' means "no official
-- tag" (an explicit override that suppresses the coded default).

create table if not exists public.team_hashtags (
  sport      text not null,
  team_key   text not null,
  label      text not null,
  official   text,
  updated_at timestamptz not null default now(),
  primary key (sport, team_key)
);

notify pgrst, 'reload schema';
