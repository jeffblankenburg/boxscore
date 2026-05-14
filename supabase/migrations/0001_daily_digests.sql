-- Per-day rendered digest. The cron writes one row per (sport, date).
-- The HTML stored here is the body content produced by lib/render.ts
-- (no <html>/<head>/<body> wrapper — that comes from app/layout.tsx).

create table if not exists public.daily_digests (
  sport         text         not null,
  date          date         not null,
  generated_at  timestamptz  not null default now(),
  game_count    int          not null default 0,
  html          text         not null,
  primary key (sport, date)
);

create index if not exists daily_digests_sport_date_desc
  on public.daily_digests (sport, date desc);

alter table public.daily_digests enable row level security;

-- Public read: the digest content is meant to be visible on the web.
drop policy if exists "anyone can read digests" on public.daily_digests;
create policy "anyone can read digests"
  on public.daily_digests for select
  to anon, authenticated
  using (true);

-- Grant table-level access. With the new Supabase API key model, raw-SQL
-- created tables don't auto-grant to service_role; do it explicitly.
grant select, insert, update, delete on public.daily_digests to service_role;
grant select on public.daily_digests to anon, authenticated;
