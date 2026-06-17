-- Per-sport send kill switch.
--
-- Independent of `visibility` (which controls /subscribe listing). A sport
-- can stay public so off-season signups still work while the daily send
-- cron is paused. Examples:
--   - NBA finals end → set sends_enabled = false until pre-season starts
--   - MLB All-Star break days → operator can pause manually if preferred
--
-- The send-email and send-team-email cron routes read this column at the
-- top of every run and short-circuit with a recorded skip when it's false.
-- generate keeps running so the digest cache + archive page still get a
-- row.

alter table public.sports
  add column if not exists sends_enabled boolean not null default true;
