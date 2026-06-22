-- Capture WHERE subscribers came from. Seven nullable columns on subscribers,
-- written once at /subscribe POST from the standard UTM params plus the
-- referrer / landing path captured first-touch in sessionStorage on the
-- client. Backfill for existing rows is impossible — those signups happened
-- before the capture existed — so every pre-migration subscriber has nulls
-- for all seven. Going forward, "null utm_source AND null referrer" means
-- "direct / unknown", which is itself an answer.

alter table public.subscribers
  add column if not exists utm_source   text,
  add column if not exists utm_medium   text,
  add column if not exists utm_campaign text,
  add column if not exists utm_content  text,
  add column if not exists utm_term     text,
  add column if not exists referrer     text,
  add column if not exists landing_path text;

-- The growth dashboard's "subscribers by source" group-by will hit this.
-- Partial index keeps it small — pre-migration rows and direct-traffic
-- signups (no utm_source) stay out of it.
create index if not exists subscribers_utm_source
  on public.subscribers (utm_source)
  where utm_source is not null;
