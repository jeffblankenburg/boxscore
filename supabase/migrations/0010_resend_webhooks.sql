-- Resend webhook plumbing.
--
-- webhook_events: idempotency log so Resend's at-least-once retries don't
-- double-process the same event. We use Svix's message id (delivered as the
-- svix-id header) as the primary key — Resend uses Svix under the hood.
--
-- subscribers.unsubscribe_reason: which path took someone out of the list.
-- Distinguishes user-initiated ("user") from delivery-driven outcomes
-- ("bounce", "complaint", "manual"). Issue #24 will promote this to a full
-- event log; this column is the minimum needed to answer "why did they leave"
-- on the dashboard today.

create table if not exists public.webhook_events (
  id            text         primary key,          -- Svix message id (svix-id header)
  source        text         not null default 'resend',
  event_type    text         not null,             -- e.g. "email.bounced"
  received_at   timestamptz  not null default now(),
  payload       jsonb
);

create index if not exists webhook_events_received_at_desc
  on public.webhook_events (received_at desc);
create index if not exists webhook_events_type_received_at
  on public.webhook_events (event_type, received_at desc);

alter table public.webhook_events enable row level security;
grant select, insert on public.webhook_events to service_role;

alter table public.subscribers
  add column if not exists unsubscribe_reason text;
