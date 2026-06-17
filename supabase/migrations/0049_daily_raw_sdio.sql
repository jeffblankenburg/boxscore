-- Raw SportsDataIO payloads, captured per date. Mirror of public.daily_raw
-- but a separate table so SDIO ingestion can run alongside the production
-- statsapi pull without any chance of cross-contamination. The renderer
-- continues to read daily_raw; only the canonical-preview tool consumes
-- daily_raw_sdio.
--
-- payload is a single JSON blob containing every SDIO endpoint response
-- the canonical adapter needs: GamesByDateFinal, BoxScoresFinal, Standings,
-- season leaders by category, TransactionsByDate, and the teams envelope
-- for id → abbreviation lookups.

create table if not exists public.daily_raw_sdio (
  sport       text         not null,
  date        date         not null,
  payload     jsonb        not null,
  fetched_at  timestamptz  not null default now(),
  primary key (sport, date)
);

create index if not exists daily_raw_sdio_sport_date_desc
  on public.daily_raw_sdio (sport, date desc);

alter table public.daily_raw_sdio enable row level security;

-- No public-read policy: raw is internal. Only the service role touches it.
grant select, insert, update, delete on public.daily_raw_sdio to service_role;
