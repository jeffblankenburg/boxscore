-- Subscribers table doubles as the account table for v1.
-- A row is created in 'pending' state on signup; confirmation flips it to 'active'.
-- Unsubscribe flips active → unsubscribed. Tokens are random UUIDs, stable per
-- subscriber across the row's lifetime.

create table if not exists public.subscribers (
  id                  uuid         primary key default gen_random_uuid(),
  email               text         unique not null,
  status              text         not null check (status in ('pending', 'active', 'unsubscribed')),
  created_at          timestamptz  not null default now(),
  confirmed_at        timestamptz,
  unsubscribed_at     timestamptz,
  confirm_token       uuid         not null default gen_random_uuid(),
  unsubscribe_token   uuid         not null default gen_random_uuid()
);

create index if not exists subscribers_confirm_token_idx
  on public.subscribers (confirm_token);
create index if not exists subscribers_unsubscribe_token_idx
  on public.subscribers (unsubscribe_token);
create index if not exists subscribers_status_idx
  on public.subscribers (status);

alter table public.subscribers enable row level security;

-- Subscribers is a private table — no anon/authenticated access.
-- All reads/writes go through service_role from server-side code.
grant select, insert, update on public.subscribers to service_role;
