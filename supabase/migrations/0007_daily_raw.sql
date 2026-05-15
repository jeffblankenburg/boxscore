-- Raw MLB API payloads, captured per date. The render pipeline now reads
-- from here first; only fetches from MLB if the row is missing. This lets us
-- replay/re-render every day in the season without hitting MLB again.
--
-- payload is a single JSON blob containing every API response loadDailyData
-- needs to produce a DailyData (schedule, standings, wildCard, leaders, and
-- per-game boxscore + playByPlay).

create table if not exists public.daily_raw (
  sport       text         not null,
  date        date         not null,
  payload     jsonb        not null,
  fetched_at  timestamptz  not null default now(),
  primary key (sport, date)
);

create index if not exists daily_raw_sport_date_desc
  on public.daily_raw (sport, date desc);

alter table public.daily_raw enable row level security;

-- No public-read policy: raw is internal. Only the service role touches it.
grant select, insert, update, delete on public.daily_raw to service_role;
