-- Per-subscriber send log. One row per (subscriber, sport, date). Used for
-- idempotency on cron retries: if a row exists with no error, that subscriber
-- already received that day's digest and we skip them. If error is set, we
-- can retry by UPSERT-ing the row.

create table if not exists public.sends (
  id             uuid         primary key default gen_random_uuid(),
  subscriber_id  uuid         not null references public.subscribers(id) on delete cascade,
  digest_sport   text         not null,
  digest_date    date         not null,
  sent_at        timestamptz  not null default now(),
  resend_id      text,
  error          text,
  unique (subscriber_id, digest_sport, digest_date)
);

create index if not exists sends_date_idx on public.sends (digest_date desc);
create index if not exists sends_subscriber_idx on public.sends (subscriber_id);

alter table public.sends enable row level security;
grant select, insert, update on public.sends to service_role;
