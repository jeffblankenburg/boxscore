-- Pageview events ingested from Vercel Web Analytics Drain. The Drain pushes
-- event objects (schema "vercel.analytics.v2") to
-- /api/ingest/vercel-analytics; that endpoint upserts them here. The
-- /advertise page reads from this table when computing the rolling
-- impressions number so the public advertiser stat includes both email
-- opens and web pageviews.
--
-- Idempotency: Vercel may retry Drain deliveries on receiver failure. We
-- key uniqueness on the combination Vercel ships per event
-- (occurred_at + session_id + device_id + path) and upsert with
-- ON CONFLICT DO NOTHING so retries absorb cleanly. Vercel doesn't
-- document a stable per-event id field, so this composite is the best
-- dedupe key available from the v2 schema.

create table if not exists public.page_views (
  id                  bigserial    primary key,
  schema_version      text         not null,
  event_type          text         not null,   -- 'pageview' | 'event'
  event_name          text,                    -- populated when event_type='event'
  occurred_at         timestamptz  not null,   -- Vercel timestamp (ms epoch) → tstz
  path                text,
  route               text,                    -- pattern e.g. '/mlb/[date]'
  origin              text,
  country             text,
  device_type         text,
  vercel_environment  text,                    -- 'production' | 'preview' | 'development'
  session_id          bigint,
  device_id           bigint,
  raw                 jsonb,                   -- full event for future querying
  ingested_at         timestamptz  not null default now()
);

-- Dedupe key for Drain retries. Sentinel zeros for null session/device so
-- the composite stays unique-defined even when Vercel omits one of those
-- fields (per the v2 schema, sessionId and deviceId are typed but a
-- defensive system shouldn't assume presence).
create unique index if not exists page_views_dedupe
  on public.page_views (
    occurred_at,
    coalesce(session_id, 0),
    coalesce(device_id, 0),
    coalesce(path, '')
  );

-- The advertiser rollup query in lib/dashboard.ts filters
-- (occurred_at >= since, event_type = 'pageview', vercel_environment =
-- 'production') and counts. This composite index covers that exact filter
-- shape without scanning the whole table.
create index if not exists page_views_rollup
  on public.page_views (event_type, vercel_environment, occurred_at desc);

alter table public.page_views enable row level security;
grant insert, select on public.page_views to service_role;
grant usage, select on sequence public.page_views_id_seq to service_role;
