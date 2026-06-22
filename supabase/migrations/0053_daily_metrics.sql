-- Per-day per-sport history of the headline dashboard metrics. Backs the
-- /admin ticker cards (open rate, reach, subscribers) — each card reads one
-- row per day and computes yesterday/7-day/all-time hi-lo in JS.
--
-- Date semantics: the EDITION date — the morning the email was delivered
-- and the URL `/{sport}/{date}` rendered to web visitors. Matches what an
-- operator types into the admin date pickers and what subscribers see on
-- the masthead. Email send rows (which key on digest_date = edition_date − 1)
-- are joined at compute time; the snapshot row stores the edition-date label.
--
-- All numeric columns are NULLABLE so a partial backfill can fill in
-- email metrics for dates before web-pageview tracking started, or vice
-- versa, without lying about a zero. Cards render `—` for null.
--
-- Singleton `ad_stats_snapshot` (migration 0024) stays in place — it powers
-- the public /advertise page's rolling stat, which is a different shape
-- (one current rolling window, not a history).

create table if not exists public.daily_metrics (
  sport               text         not null,
  date                date         not null,    -- edition date
  delivered           integer,                   -- distinct resend_ids with email.delivered for this edition's sends
  opened              integer,                   -- distinct resend_ids with email.opened
  web_pageviews       integer,                   -- production pageviews on /{sport}/{date} + /{sport} that day
  active_subscribers  integer,                   -- count active at end of edition day
  computed_at         timestamptz  not null default now(),
  primary key (sport, date)
);

-- Read pattern is "give me the whole history for one sport, newest first"
-- (the ticker cards walk every row to find hi/lo). PK already covers
-- (sport, date) but a desc-on-date index keeps the natural query fast.
create index if not exists daily_metrics_sport_date_desc
  on public.daily_metrics (sport, date desc);

alter table public.daily_metrics enable row level security;

grant select on public.daily_metrics to anon, authenticated;
grant select, insert, update, delete on public.daily_metrics to service_role;
