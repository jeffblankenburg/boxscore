-- Per-IP subscribe rate-limit trail. Without this an attacker can spam
-- /subscribe with arbitrary emails, and because a confirmation email is
-- sent per attempt this doubles as a list-bombing vector: it points our
-- Resend account at targets we didn't choose and torches sender rep.
--
-- One row per accepted subscribe attempt. `countSubscribeAttemptsForIp`
-- rolls it up over a window; we lock further attempts once the count
-- crosses a threshold. Rows older than ~24h are just noise — cleanup
-- can be added later as a cron sweep.

create table if not exists public.subscribe_attempts (
  id           uuid         primary key default gen_random_uuid(),
  ip           text,
  email        text         not null,
  created_at   timestamptz  not null default now()
);

create index if not exists subscribe_attempts_ip_created
  on public.subscribe_attempts (ip, created_at desc);
create index if not exists subscribe_attempts_email_created
  on public.subscribe_attempts (email, created_at desc);

alter table public.subscribe_attempts enable row level security;
grant select, insert, delete on public.subscribe_attempts to service_role;
