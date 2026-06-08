-- Discord webhook registry. Each row maps a (sport, scope, team_slug)
-- channel to its Discord-issued webhook URL. The daily post-discord cron
-- looks up the relevant rows when fanning out: the league webhook gets
-- the day's scoreboard image; each team webhook gets the box-score images
-- for games that team played in.
--
-- scope semantics:
--   'league' — sport-wide channel (e.g. #mlb). team_slug is NULL.
--   'team'   — per-team channel (e.g. #arizona-diamondbacks).
--              team_slug references the slug in lib/teams.ts.
--
-- Webhook URLs are sensitive (anyone with one can post). RLS denies
-- anon/authenticated reads; only the service role (used by crons + the
-- admin UI through requireAdmin) can SELECT or write.

create table if not exists public.discord_webhooks (
  id                uuid          primary key default gen_random_uuid(),
  sport             text          not null,
  scope             text          not null check (scope in ('league', 'team')),
  team_slug         text,
  webhook_url       text          not null,
  active            boolean       not null default true,
  -- Health tracking. Cleared on a successful post; incremented on failure.
  -- The admin UI surfaces these so a broken webhook (channel deleted,
  -- token rotated, etc.) is visible without grepping logs.
  failure_count     int           not null default 0,
  last_failure_at   timestamptz,
  last_failure_note text,
  last_success_at   timestamptz,
  created_at        timestamptz   not null default now(),
  updated_at        timestamptz   not null default now(),

  -- league rows must have null team_slug; team rows must have one.
  constraint discord_webhooks_scope_team check (
    (scope = 'league' and team_slug is null) or
    (scope = 'team'   and team_slug is not null)
  )
);

-- One webhook per (sport, scope, team_slug). NULLS NOT DISTINCT treats
-- multiple league rows for the same sport as a conflict (only one league
-- webhook per sport).
create unique index if not exists discord_webhooks_unique
  on public.discord_webhooks (sport, scope, team_slug)
  nulls not distinct;

-- Used by the fan-out path to find every active team webhook for a sport.
create index if not exists discord_webhooks_lookup
  on public.discord_webhooks (sport, scope, active);

alter table public.discord_webhooks enable row level security;
grant select, insert, update, delete on public.discord_webhooks to service_role;

-- Extend the social_posts platform check to accept 'discord' so the
-- existing hasAlreadyPosted / recordPost helpers can dedupe Discord
-- posts the same way Twitter/Bluesky already do. Drops + recreates the
-- constraint since Postgres has no ALTER CONSTRAINT for check exprs.
do $$
begin
  if exists (
    select 1 from pg_constraint
    where conname = 'social_posts_platform_check'
       or conname = 'social_posts_platform_chk'
  ) then
    execute 'alter table public.social_posts drop constraint if exists social_posts_platform_check';
    execute 'alter table public.social_posts drop constraint if exists social_posts_platform_chk';
  end if;
end$$;

alter table public.social_posts
  add constraint social_posts_platform_check
  check (platform in ('twitter', 'bluesky', 'facebook', 'discord'));
