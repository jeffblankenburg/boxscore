-- Incremental per-team season stat store for football team digests.
--
-- Motivation: the team digest's "Roster Statistics" section (season-to-date
-- Passing/Rushing/Receiving/Defense/Kicking) needs every game a team played.
-- Re-fetching each game's box summary from ESPN at digest-build time doesn't
-- scale — a college Saturday is ~120 teams x their whole season of summaries.
--
-- Instead, each game day the generate cron folds that day's box-score sides
-- (already fetched for the league digest — no extra ESPN calls) into one slim
-- row per (league, season, team, game). Digests and web pages read a team's
-- season rows and aggregate them: one DB query instead of N summary fetches.
-- Upsert by the primary key makes a cron re-run idempotent.

create table if not exists football_team_game_stats (
  league     text not null,          -- 'nfl' | 'ncaaf'
  season     integer not null,       -- ESPN season year
  team_abbr  text not null,          -- uppercase team abbreviation
  game_id    text not null,          -- ESPN event id
  game_date  date not null,          -- game's local date; aggregate games <= as-of
  side       jsonb not null,         -- the team's FootballTeamBox for this game
  updated_at timestamptz not null default now(),
  primary key (league, season, team_abbr, game_id)
);

-- The one read pattern: a team's season rows through an as-of date.
create index if not exists football_team_game_stats_team_idx
  on football_team_game_stats (league, season, team_abbr, game_date);

-- Server-only table (written by the cron, read by digest/page builders via the
-- service role). RLS on with no policies denies anon/authenticated entirely;
-- the service role is granted explicitly. Matches teammates_puzzles/qr_scans.
alter table public.football_team_game_stats enable row level security;
grant select, insert, update, delete on public.football_team_game_stats to service_role;

notify pgrst, 'reload schema';
