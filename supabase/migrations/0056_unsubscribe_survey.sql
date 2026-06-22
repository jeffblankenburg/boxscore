-- Capture WHY a subscriber unsubscribes — adds two nullable columns to
-- subscribers. The existing `unsubscribe_reason` column is a SYSTEM category
-- (user|bounce|complaint|manual) describing who/what caused the unsub. These
-- new columns describe the user's stated motivation.
--
-- Only populated when reason='user' and the subscriber goes through the web
-- /u/[token] form. The mail-client one-click endpoint (/api/u/[token]) has
-- no UI to collect a survey, so those rows stay null.

alter table public.subscribers
  add column if not exists unsubscribe_user_reason text,
  add column if not exists unsubscribe_feedback    text;

-- Cheap index for the per-reason aggregation the admin dashboard will run.
-- Partial: only the small fraction of rows that have a value.
create index if not exists subscribers_unsubscribe_user_reason
  on public.subscribers (unsubscribe_user_reason)
  where unsubscribe_user_reason is not null;
