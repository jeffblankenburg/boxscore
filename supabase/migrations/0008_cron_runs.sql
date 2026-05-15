-- One row per cron execution (scheduled or admin-triggered) so /admin can
-- show a PASS/FAIL history and we can debug failures without diving into
-- Vercel logs. Routes write a "running" row at start, then update it to
-- "ok" or "failed" with an error message at end.

create table if not exists public.cron_runs (
  id            uuid         primary key default gen_random_uuid(),
  route         text         not null,  -- "generate", "send-email", "post-bluesky", etc.
  sport         text,
  date          date,                   -- the digest date being processed
  status        text         not null,  -- "running", "ok", "failed"
  trigger       text         not null,  -- "cron", "manual"
  error         text,
  result        jsonb,                  -- summary returned by the route on success
  started_at    timestamptz  not null default now(),
  finished_at   timestamptz
);

create index if not exists cron_runs_started_at_desc on public.cron_runs (started_at desc);
create index if not exists cron_runs_route_started_at on public.cron_runs (route, started_at desc);

alter table public.cron_runs enable row level security;

-- Internal table; service role only.
grant select, insert, update, delete on public.cron_runs to service_role;
