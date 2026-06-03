-- Singleton snapshot of the public ad-stats numbers shown on /advertise.
-- A daily cron computes the slow dedup-by-resend_id rolling stats once and
-- writes the result here so the public page can serve sub-millisecond reads
-- instead of materializing tens of thousands of events on every revalidate.
-- See app/api/cron/ad-stats-snapshot/route.ts.
--
-- Single-row table by design: the `id = 1` check + primary key on `id` makes
-- the upsert trivial (insert ... on conflict (id) do update). We don't keep
-- history here — if we ever want a 30-day trend chart we'll add a separate
-- ad_stats_history table.

create table if not exists public.ad_stats_snapshot (
  id                 int          primary key default 1 check (id = 1),
  generated_at       timestamptz  not null,
  sport              text         not null,
  window_days        int          not null,
  active_subscribers int          not null,
  sends              int          not null,
  delivered          int          not null,
  open_rate          numeric      not null,
  click_rate         numeric      not null,
  delivery_rate      numeric      not null,
  engagement_since   date         not null,
  tracked            boolean      not null
);

alter table public.ad_stats_snapshot enable row level security;
grant select         on public.ad_stats_snapshot to anon, authenticated;
grant select, insert, update on public.ad_stats_snapshot to service_role;
