-- Rate-limit and lock-out state for admin code verification. Without this
-- a 6-digit code (1M space) with a 10-minute TTL is brute-forceable — an
-- attacker can fire thousands of `consumeCode` requests against a known
-- admin email. We track failed attempts per email, lock the account after
-- N misses, and invalidate any outstanding codes on lockout so the guess
-- window closes as soon as the attacker has burned their attempts.
--
-- Cleanup is best-effort; consumeCode wipes the row on success and
-- expired rows can be swept periodically.

create table if not exists public.admin_code_attempts (
  email        text         primary key,
  failed_count int          not null default 0,
  locked_until timestamptz,
  updated_at   timestamptz  not null default now()
);

create index if not exists admin_code_attempts_locked
  on public.admin_code_attempts (locked_until);

alter table public.admin_code_attempts enable row level security;
grant select, insert, update, delete on public.admin_code_attempts to service_role;
