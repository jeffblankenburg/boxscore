-- Sport catalog with admin-controlled visibility. Every UI surface that lists
-- available sports (subscribe form, /settings, footer, etc.) reads from this
-- table and filters by visibility. Admins always see everything; users see
-- only 'public' rows.
--
-- This is the launch switch for new sports: the basketball pipeline can run
-- daily in production while NBA/WNBA stay 'admin_only', and we publicize them
-- with a single UPDATE — no deploy required.
--
-- The id column is text (not a foreign key target from other tables) because
-- existing sport-keyed tables (daily_digests, daily_raw, cron_runs,
-- email_subscriptions, sends) store sport as a free-form string. Adding FKs
-- across all of them is more churn than it's worth for v1; this table is the
-- source of truth for "which sports exist" via the seed data and helpers,
-- and the string-keyed tables remain compatible.

create table if not exists public.sports (
  id          text         primary key,
  name        text         not null,
  visibility  text         not null check (visibility in ('admin_only', 'public')),
  created_at  timestamptz  not null default now(),
  updated_at  timestamptz  not null default now()
);

alter table public.sports enable row level security;
grant select, insert, update, delete on public.sports to service_role;

-- Seed: MLB is the live product. NBA + WNBA ship to prod hidden, generating
-- daily but invisible to non-admin users until promoted to 'public'.
-- Idempotent — re-running this migration won't change visibility of sports
-- that have already been flipped to 'public' in production.
insert into public.sports (id, name, visibility) values
  ('mlb',  'MLB',  'public'),
  ('nba',  'NBA',  'admin_only'),
  ('wnba', 'WNBA', 'admin_only')
on conflict (id) do nothing;
