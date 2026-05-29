-- Per-poll log for the public RSS feed. One row per request that reaches our
-- handler (the route runs uncached now precisely so we can capture these).
--
-- Aggregators like Feedly, Inoreader, NewsBlur, and Feedbin advertise the
-- subscriber count they're polling on behalf of in their User-Agent string:
--   "Feedly/1.0 (+http://www.feedly.com/fetcher.html; 5 subscribers)"
--   "feedbin/2.0 (https://feedbin.com/site/contact; 3 subscribers)"
--   "Inoreader/1.0 (10 subscribers; http://...)"
-- We parse `aggregator` (e.g. "Feedly") and `subscribers` (the integer) at
-- log time so dashboard queries don't have to re-parse the raw UA on every
-- read. Individual feed readers (NetNewsWire on a laptop, etc.) typically
-- don't report a subscriber count — those rows have `subscribers = NULL`
-- and represent one human each.

create table if not exists public.rss_polls (
  id          uuid         primary key default gen_random_uuid(),
  polled_at   timestamptz  not null default now(),
  sport       text         not null,
  user_agent  text,
  aggregator  text,
  subscribers int
);

-- The hot query is "polls in last N days grouped by day", so an index on
-- (sport, polled_at desc) does the right thing for the dashboard card.
create index if not exists rss_polls_sport_polled_at_idx
  on public.rss_polls (sport, polled_at desc);

alter table public.rss_polls enable row level security;
grant select, insert on public.rss_polls to service_role;
