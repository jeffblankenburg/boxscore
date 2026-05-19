-- Admin identity moves from the ADMIN_EMAIL env var into the subscribers
-- table. Multiple admins supported by design — today all may be the same
-- person's addresses, future delegates land here too. The DB is the only
-- source of truth going forward; the env var is retired in the same
-- change set.
--
-- Uses:
--   • /admin/login gates issuance of a 2FA code by is_admin = true
--   • requireAdmin() returns the admin session's email (already does)
--   • /settings shows the admin link and allows admin-only sport opt-in
--     by checking the signed-in subscriber's is_admin
--   • Cron failure alerts fan out to every is_admin row

alter table public.subscribers
  add column if not exists is_admin boolean not null default false;

-- Partial index: most rows are non-admin, so this stays tiny and makes
-- the "list every admin" fan-out query (for failure alerts) essentially
-- free.
create index if not exists subscribers_is_admin_idx
  on public.subscribers (is_admin)
  where is_admin = true;

-- Seed: the current production admin. No-op if the row doesn't yet exist
-- (e.g. admin never subscribed through the public form); in that case
-- create the subscriber row first, then re-run or UPDATE manually. Add
-- more admins by UPDATE-ing additional rows in the future.
update public.subscribers
   set is_admin = true
 where email = 'boxscore@jeffblankenburg.com';
