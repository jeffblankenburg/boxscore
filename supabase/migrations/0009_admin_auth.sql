-- Email-based 2FA for /admin. Two tables:
--   admin_codes:    short-lived 6-digit codes hashed at rest (10 min)
--   admin_sessions: persistent session tokens (30 days)
-- The /admin/login flow: email → match ADMIN_EMAIL → mint a code, hash it,
-- store in admin_codes, email plaintext via Resend → user enters → we hash
-- the input, look up the row, check expiry+unused, mark used, mint a session
-- token, set as httpOnly cookie.

create table if not exists public.admin_codes (
  id          uuid         primary key default gen_random_uuid(),
  email       text         not null,
  code_hash   text         not null,
  created_at  timestamptz  not null default now(),
  expires_at  timestamptz  not null,
  used_at     timestamptz
);

create index if not exists admin_codes_email_expires
  on public.admin_codes (email, expires_at desc);

create table if not exists public.admin_sessions (
  id          text         primary key,  -- session token (UUID v4), used directly as the cookie value
  email       text         not null,
  created_at  timestamptz  not null default now(),
  expires_at  timestamptz  not null,
  last_seen   timestamptz  not null default now()
);

create index if not exists admin_sessions_expires
  on public.admin_sessions (expires_at);

alter table public.admin_codes enable row level security;
alter table public.admin_sessions enable row level security;

-- Internal; service role only.
grant select, insert, update, delete on public.admin_codes to service_role;
grant select, insert, update, delete on public.admin_sessions to service_role;
