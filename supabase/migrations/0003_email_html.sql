-- The cron writes two flavors of the rendered digest:
--   html       — for the web (CSS grid, columns, modern styles)
--   email_html — for email clients (table-based, inline-styled, single column)
--
-- Both come from the same DailyData; the renderers diverge for layout only.

alter table public.daily_digests
  add column if not exists email_html text;
