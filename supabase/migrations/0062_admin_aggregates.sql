-- Per-day aggregate tables that back the slow /admin pages. Each row is a
-- precomputed slice that a cron writes once a day; admin pages SUM rows
-- across the requested window instead of scanning sends+email_events per
-- request.
--
-- Three tables, three audiences:
--   daily_send_stats         → /admin/metrics/sends, /admin/operations/deliverability
--   daily_subscriber_events  → /admin/metrics/subscribers
--   daily_placement_imps     → /admin/ads, /admin/ads/campaigns/[id]
--
-- date semantics:
--   daily_send_stats.date        = SENDS.sent_at::date (UTC) — same column the
--                                  existing `sends` table keys on at write time.
--   daily_subscriber_events.date = calendar date in UTC; one row per day.
--   daily_placement_imps.placement_id is a UUID per ad_placement; placement.date
--                                  already lives on ad_placements, so we don't
--                                  duplicate it here.
--
-- All three tables are 100% derivable from sends + email_events + page_views
-- + link_clicks + subscribers. Truncate-and-rebuild is always safe.

-- ─── daily_send_stats ─────────────────────────────────────────────────────
-- One row per (date, sport, scope). scope='league' covers team_id IS NULL
-- sends; scope='team' aggregates every team-digest send for that sport on
-- that date. Splitting into two scopes lets /admin separate league vs.
-- team performance without storing 30+ team rows per day.

create table if not exists public.daily_send_stats (
  date           date    not null,
  sport          text    not null,
  scope          text    not null,            -- 'league' | 'team'

  -- send pipeline (sends table, keyed by sent_at::date)
  sends          integer not null default 0,
  failed_send    integer not null default 0,  -- sends.error IS NOT NULL

  -- terminal deliverability classification, mutually exclusive priority
  -- delivered > bounced > delayed > pending (matches getDeliverabilityStats)
  delivered      integer not null default 0,
  bounced        integer not null default 0,
  delayed        integer not null default 0,
  pending        integer not null default 0,

  -- non-exclusive (can overlap with delivered)
  complained     integer not null default 0,

  -- engagement, deduped by resend_id over the day's sends
  opens_unique   integer not null default 0,  -- email.opened OR boxscore.opened
  clicks_unique  integer not null default 0,  -- email.clicked

  computed_at    timestamptz not null default now(),

  primary key (date, sport, scope),
  constraint daily_send_stats_scope_check check (scope in ('league', 'team'))
);

create index if not exists daily_send_stats_date_desc
  on public.daily_send_stats (date desc);

alter table public.daily_send_stats enable row level security;
grant select on public.daily_send_stats to anon, authenticated;
grant select, insert, update, delete on public.daily_send_stats to service_role;


-- ─── daily_subscriber_events ─────────────────────────────────────────────
-- One row per calendar date. Captures both the per-day deltas (used for
-- the chart) and the running snapshot (used for "active at start of
-- window" math). active_at_end / pending_at_end are the SNAPSHOT at end
-- of that date — letting the page answer "active at start of window" with
-- a single lookup of (windowStart - 1 day).

create table if not exists public.daily_subscriber_events (
  date              date primary key,

  -- daily deltas (subscribers.confirmed_at / unsubscribed_at / created_at falling on this date)
  new_subs          integer not null default 0,  -- confirmed_at::date = date
  unsubs            integer not null default 0,  -- unsubscribed_at::date = date
  pending_new       integer not null default 0,  -- created_at::date = date (pre-confirm signups)
  pending_resolved  integer not null default 0,  -- confirmed_at::date = date AND created_at < date

  -- end-of-day snapshot
  active_at_end     integer not null default 0,
  pending_at_end    integer not null default 0,

  computed_at       timestamptz not null default now()
);

create index if not exists daily_subscriber_events_date_desc
  on public.daily_subscriber_events (date desc);

alter table public.daily_subscriber_events enable row level security;
grant select on public.daily_subscriber_events to anon, authenticated;
grant select, insert, update, delete on public.daily_subscriber_events to service_role;


-- ─── daily_placement_imps ────────────────────────────────────────────────
-- One row per ad_placements.id. Recomputed for the last 14 days every
-- cron pass (late opens trickle in for up to 3 days; 14d is generous
-- headroom). Older placements are considered stable and not retouched.
--
-- "unique" = deduped by resend_id (one open per recipient regardless of
-- how many times the pixel fires). Web pageviews are not deduped — each
-- pageview is one impression of the rendered ad.

create table if not exists public.daily_placement_imps (
  placement_id        uuid primary key references public.ad_placements(id) on delete cascade,
  email_unique_opens  integer not null default 0,
  web_pageviews       integer not null default 0,
  human_clicks        integer not null default 0,
  bot_clicks          integer not null default 0,
  computed_at         timestamptz not null default now()
);

alter table public.daily_placement_imps enable row level security;
grant select on public.daily_placement_imps to anon, authenticated;
grant select, insert, update, delete on public.daily_placement_imps to service_role;
