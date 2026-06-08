-- Add web pageview count to the ad-stats snapshot. The /advertise page's
-- "avg daily impressions" formula now sums email opens-per-send + web
-- pageviews-per-day so the stat reflects the total reach of an ad
-- placement (email + web), not just email engagement.
--
-- Pageviews are sourced from public.page_views (populated by the Vercel
-- Web Analytics Drain ingest endpoint). The daily ad-stats cron computes
-- the count over the snapshot's window_days and writes it here.
--
-- Default 0 so the existing snapshot row reads as if there were no web
-- traffic until the next cron run overwrites it with the real number.

alter table public.ad_stats_snapshot
  add column if not exists web_pageviews int not null default 0;
