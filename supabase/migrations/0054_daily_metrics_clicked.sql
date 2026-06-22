-- Add per-day clicked count to daily_metrics so the public /advertise rolling
-- stat can sum from this table instead of scanning all email_events on every
-- snapshot run. The events-scan was hitting Postgres's 60s statement timeout
-- as the engagement window grew.
--
-- Click tracking via the in-house first-party tracker is still pending
-- (Resend's click rewrite was disabled to avoid activation-link breakage), so
-- this column will read low for recent days — but it's correct, and the
-- public page already hides click rate behind a "—" until the new tracker
-- catches up.

alter table public.daily_metrics
  add column if not exists clicked integer;
