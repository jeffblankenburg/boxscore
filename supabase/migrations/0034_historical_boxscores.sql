-- Historical box score store for the "On This Day" feature (issue #55).
-- Holds MLB games from 1950 onward. 1950 is the cutoff because that's where
-- the MLB Stats API starts returning play-by-play; pre-1950 box scores exist
-- in the API but the individual-line and play data is sparse enough that we
-- skip them for v1.
--
-- The store is split into a thin summary row (historical_games) that every
-- query touches and a raw payload row (historical_boxscores) that only
-- detail pages and re-scoring jobs touch. This keeps the indexed table small
-- so the daily picker query stays cheap as the table grows past 200k rows.
--
-- The crawler is resumable via backfill_progress, which records the last
-- season + date the worker finished cleanly so a crash resumes mid-walk
-- without re-fetching everything from 1950.
--
-- historical_picks (the "used" log for the daily picker) lands in a separate
-- migration alongside the picker itself.

create table if not exists public.historical_games (
  game_pk             bigint       primary key,                -- MLB stable game id
  game_date           date         not null,                   -- local game date
  season              int          not null,
  game_type           text,                                    -- R / S / E / A / F / D / L / W / P
  away_team_id        int,
  away_team_abbr      text,
  away_score          int,
  home_team_id        int,
  home_team_abbr      text,
  home_score          int,
  innings             int,                                     -- final inning count from linescore
  venue               text,
  excitement_score    int,                                     -- computed; see lib/historical/excitement.ts
  excitement_notes    jsonb,                                   -- per-rule contributions for tuning
  scored_at           timestamptz,                             -- last time excitement was computed
  ingested_at         timestamptz  not null default now()
);

-- Picker query: highest excitement on this calendar day, not used recently.
-- Filter by (month, day) on game_date then sort by excitement_score.
create index if not exists historical_games_calendar
  on public.historical_games (
    (extract(month from game_date)),
    (extract(day   from game_date)),
    excitement_score desc
  );

-- For per-season admin browsing and re-score passes.
create index if not exists historical_games_season
  on public.historical_games (season, game_pk);

create table if not exists public.historical_boxscores (
  game_pk             bigint       primary key references public.historical_games(game_pk) on delete cascade,
  boxscore_raw        jsonb        not null,                   -- /api/v1/game/{gamePk}/boxscore
  linescore_raw       jsonb,                                   -- /api/v1/game/{gamePk}/linescore
  fetched_at          timestamptz  not null default now()
);

-- Resumable checkpoint. The crawler writes one row per (season, batch_date)
-- as it finishes that batch, so a crash mid-season resumes from the next
-- unfinished date. Use the highest finished_at row to find where to pick up.
create table if not exists public.backfill_progress (
  job                 text         not null,                   -- 'historical-boxscores'
  season              int          not null,
  last_date_done      date,                                    -- last YYYY-MM-DD fully ingested
  games_seen          int          not null default 0,
  games_ingested      int          not null default 0,
  failed_game_pks     bigint[]     not null default '{}',
  finished_at         timestamptz  not null default now(),
  primary key (job, season)
);

alter table public.historical_games     enable row level security;
alter table public.historical_boxscores enable row level security;
alter table public.backfill_progress    enable row level security;

grant select, insert, update on public.historical_games     to service_role;
grant select, insert, update on public.historical_boxscores to service_role;
grant select, insert, update, delete on public.backfill_progress to service_role;

-- Public read for the /otd/[gamePk] page. Detail pages read from
-- historical_boxscores via the service role on the server, so anon doesn't
-- need access to the raw payload — only the summary.
grant select on public.historical_games to anon;
