-- Endless-mode Stat Sharks runs (#64). One row per completed run.
-- Drives cross-device best-streak history per subscriber AND the
-- future per-stat leaderboards.
--
-- Daily mode uses puzzle_attempts (one row per subscriber per day);
-- Endless can't reuse that because (a) users play multiple endless
-- runs per day and (b) the picker isn't day-shared. A separate table
-- keeps both query plans simple.
--
-- We don't persist in-flight runs — only completed ones. The client
-- holds in-progress endless state in localStorage and posts the
-- whole row to /persistEndlessRun on the ending tick.

create table public.statsharks_endless_runs (
  id              bigserial    primary key,
  subscriber_id   uuid         not null references public.subscribers(id) on delete cascade,
  stat_key        text         not null,
  streak          int          not null,
  rounds          jsonb        not null default '[]'::jsonb,
  played_on       date         not null,
  started_at      timestamptz  not null default now(),
  ended_at        timestamptz  not null default now()
);

-- "What's my best on HR?"  (subscriber + stat, sorted by streak)
create index statsharks_endless_subscriber_stat
  on public.statsharks_endless_runs (subscriber_id, stat_key, streak desc);

-- "Today's leaderboard for AVG"  (stat + streak + when)
create index statsharks_endless_stat_streak
  on public.statsharks_endless_runs (stat_key, streak desc, ended_at desc);

-- Per-day filtering for daily-history breakdowns.
create index statsharks_endless_played_on
  on public.statsharks_endless_runs (played_on);

alter table public.statsharks_endless_runs enable row level security;
grant select, insert on public.statsharks_endless_runs to service_role;
