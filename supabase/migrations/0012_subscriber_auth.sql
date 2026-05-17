-- Subscriber-facing magic-link auth.
--
-- Pattern parallels admin_codes / admin_sessions (migration 0009) but with
-- magic LINKS (single-use URL tokens, 256-bit random) instead of 6-digit
-- codes. Tokens are hashed at rest with sha256; the plaintext only ever
-- lives in the email link and the session cookie.
--
-- Magic tokens (15-minute TTL):
--   issue → user clicks link → POST verifies → atomic single-use claim
--   ('UPDATE ... WHERE used_at IS NULL' with rows-affected check)
--
-- Sessions (1-year sliding TTL):
--   created on magic-link verify; cookie value is the 256-bit token plaintext;
--   DB stores sha256(token). Sliding window: every read refreshes expires_at.

create table if not exists public.magic_tokens (
  id              uuid         primary key default gen_random_uuid(),
  subscriber_id   uuid         not null references public.subscribers(id) on delete cascade,
  token_hash      text         not null unique,
  purpose         text         not null default 'login',  -- reserve for future ('reauth', etc.)
  expires_at      timestamptz  not null,
  used_at         timestamptz,
  ip              text,                                    -- for per-IP rate limiting
  created_at      timestamptz  not null default now()
);

create index if not exists magic_tokens_subscriber_created
  on public.magic_tokens (subscriber_id, created_at desc);
create index if not exists magic_tokens_ip_created
  on public.magic_tokens (ip, created_at desc);

create table if not exists public.sessions (
  id              uuid         primary key default gen_random_uuid(),
  subscriber_id   uuid         not null references public.subscribers(id) on delete cascade,
  token_hash      text         not null unique,
  created_at      timestamptz  not null default now(),
  last_seen_at    timestamptz  not null default now(),
  expires_at      timestamptz  not null,
  revoked_at      timestamptz
);

create index if not exists sessions_subscriber
  on public.sessions (subscriber_id);
create index if not exists sessions_expires
  on public.sessions (expires_at);

alter table public.magic_tokens enable row level security;
alter table public.sessions     enable row level security;

-- Internal; service role only — all auth flows go through server-side code.
grant select, insert, update, delete on public.magic_tokens to service_role;
grant select, insert, update, delete on public.sessions     to service_role;
