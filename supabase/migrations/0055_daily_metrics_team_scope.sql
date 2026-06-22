-- Add team-digest columns to daily_metrics so the dashboard ticker can
-- show ALL / League / Teams as a breakdown instead of league-only.
--
-- The existing columns (delivered, opened, clicked, web_pageviews,
-- active_subscribers) stay scoped to the league digest — i.e. sends where
-- team_id IS NULL. The new team_* columns aggregate ACROSS every team
-- digest for the sport on that day (Guardians + Yankees + Padres + …).
-- "ALL" is computed in JS at read time by summing the league and team
-- columns together so we don't store derived values.
--
-- Nullable so the backfill stage can write league counts and circle back
-- for team counts later without falsifying a zero.

alter table public.daily_metrics
  add column if not exists team_delivered          integer,
  add column if not exists team_opened             integer,
  add column if not exists team_clicked            integer,
  add column if not exists team_web_pageviews      integer,
  add column if not exists team_active_subscribers integer;
