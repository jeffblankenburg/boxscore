-- Pre-rendered payload for /mlb/predictions, one row per (sport, date).
--
-- The page's data is genuinely once-a-day — it only changes when the
-- predictions-snapshot cron writes today's predictions OR when the
-- predictions-comparator cron grades yesterday's outcomes. Recomputing
-- the model on every page render was costing a 20-second cold-start
-- (loadSeasonAggregates walks ~120 days of daily_raw payloads) for
-- data that doesn't move between crons.
--
-- The blob holds everything the page needs in one shape:
--   - today's slate with calibrated predictions
--   - yesterday's graded outcomes
--   - rolling pick accuracy for 7d, 30d, and season-to-date
-- Stored as JSONB so the renderer can evolve fields without DB
-- migrations; model_version lets us re-cache after recalibration
-- without colliding with stale rows.
--
-- One row per (sport, date) — both crons recompute the blob after
-- they finish. Stale rows for prior days stay around so we can serve
-- /mlb/predictions for any past date instantly too.

create table public.predictions_render_cache (
  sport          text         not null,
  date           date         not null,
  model_version  text         not null,
  payload        jsonb        not null,
  generated_at   timestamptz  not null default now(),
  primary key (sport, date)
);

create index predictions_render_cache_recent
  on public.predictions_render_cache (sport, date desc);

alter table public.predictions_render_cache enable row level security;
grant select, insert, update on public.predictions_render_cache to service_role;
