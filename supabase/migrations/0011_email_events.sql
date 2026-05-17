-- Per-event engagement log. One row per Resend event of interest (currently
-- email.opened and email.clicked). Multiple rows per email are expected — a
-- subscriber can open the same message many times.
--
-- Idempotency across webhook retries is handled separately by webhook_events
-- (keyed on the Svix delivery id). This table is the raw engagement record
-- the dashboard aggregates from.
--
-- `ip` is stored truncated (/24 for IPv4, /48 for IPv6) at the application
-- layer — we never write the full address.

create table if not exists public.email_events (
  id            uuid         primary key default gen_random_uuid(),
  resend_id     text         not null,                 -- matches sends.resend_id
  event_type    text         not null,                 -- "email.opened", "email.clicked", etc.
  event_at      timestamptz  not null default now(),
  user_agent    text,
  ip            text,
  payload       jsonb
);

create index if not exists email_events_resend_type
  on public.email_events (resend_id, event_type);
create index if not exists email_events_type_event_at_desc
  on public.email_events (event_type, event_at desc);

alter table public.email_events enable row level security;
grant select, insert on public.email_events to service_role;
