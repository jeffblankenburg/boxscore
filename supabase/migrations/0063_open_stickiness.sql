-- Rolling open-stickiness histogram, precomputed once per day per
-- (sport, scope, window_days). Backs the stickiness panel on
-- /admin/metrics/sends, which was the last >3s page after migration
-- 0062 (the per-subscriber-per-day pivot couldn't be served from the
-- per-day totals there).
--
-- Row semantics:
--   date         = inclusive end of the window (ET, since the original
--                  getOpenStickiness keyed on ET dates and we preserve
--                  those labels for the UI)
--   window_days  = length of the rolling window (7 today; column lets
--                  us add 14d/30d windows later without a migration)
--   eligible     = subscribers who received ALL window_days sends in
--                  the window (the denominator of the histogram)
--   histogram    = [count of 0-opens, 1-open, ..., window_days-opens]
--                  jsonb so the array length matches window_days
--                  without a schema change per window length
--
-- Cron writes one row per active (sport, scope, window_days) per day.
-- Page reads the most recent row matching its query.

create table if not exists public.daily_open_stickiness (
  date          date         not null,
  sport         text         not null,
  scope         text         not null,
  window_days   integer      not null,
  eligible      integer      not null,
  histogram     jsonb        not null,
  computed_at   timestamptz  not null default now(),

  primary key (date, sport, scope, window_days),
  constraint daily_open_stickiness_scope_check check (scope in ('league', 'team')),
  constraint daily_open_stickiness_window_check check (window_days between 1 and 60)
);

create index if not exists daily_open_stickiness_lookup
  on public.daily_open_stickiness (sport, scope, window_days, date desc);

alter table public.daily_open_stickiness enable row level security;
grant select on public.daily_open_stickiness to anon, authenticated;
grant select, insert, update, delete on public.daily_open_stickiness to service_role;
