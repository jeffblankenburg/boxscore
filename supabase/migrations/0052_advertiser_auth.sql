-- Advertiser portal auth. Same shape as admin auth (0009): 6-digit code →
-- session cookie. Identity is an ad_advertisers.email — gate at code-issue
-- time is "row exists with this email and is_admin=false irrelevance". No
-- cross-table FK; lookups are by lowercased email so a future advertiser
-- email-change re-keys cleanly.
--
-- Sessions outlive codes by design (codes expire in 10 min, sessions in 30
-- days). Expired rows linger; small table, no cleanup job yet.

create table if not exists public.advertiser_codes (
  id          uuid         primary key default gen_random_uuid(),
  email       text         not null,
  code_hash   text         not null,
  created_at  timestamptz  not null default now(),
  expires_at  timestamptz  not null,
  used_at     timestamptz
);

create index if not exists advertiser_codes_email_expires
  on public.advertiser_codes (email, expires_at desc);

create table if not exists public.advertiser_sessions (
  id          text         primary key,  -- session token (UUID v4), used directly as the cookie value
  email       text         not null,
  created_at  timestamptz  not null default now(),
  expires_at  timestamptz  not null,
  last_seen   timestamptz  not null default now()
);

create index if not exists advertiser_sessions_expires
  on public.advertiser_sessions (expires_at);

alter table public.advertiser_codes    enable row level security;
alter table public.advertiser_sessions enable row level security;

grant select, insert, update, delete on public.advertiser_codes    to service_role;
grant select, insert, update, delete on public.advertiser_sessions to service_role;
