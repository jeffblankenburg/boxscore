-- Per-newsletter opt-in table. Today every active subscriber is implicitly
-- on the MLB league digest; this table makes that explicit so the upcoming
-- /settings UI can flip individual newsletters on/off (and so paid team-level
-- subscriptions have a home alongside league-level ones).
--
-- Two scopes:
--   'league' — one row per (subscriber, sport). Free.
--   'team'   — one row per (subscriber, team). Paid (tier basic/unlimited).
--
-- The send cron still reads subscribers.status='active' as the source of
-- truth for "want emails" — switch is deferred until /settings UI ships,
-- at which point the cron will AND on email_subscriptions.active=true.

create table if not exists public.email_subscriptions (
  id             uuid         primary key default gen_random_uuid(),
  subscriber_id  uuid         not null references public.subscribers(id) on delete cascade,
  sport          text         not null,
  scope          text         not null check (scope in ('league', 'team')),
  team_id        uuid,                                       -- null for scope='league'
  active         boolean      not null default true,
  created_at     timestamptz  not null default now(),
  updated_at     timestamptz  not null default now(),
  -- A 'team' row must carry a team_id; a 'league' row must not.
  constraint email_subscriptions_scope_team_consistency check (
    (scope = 'team'   and team_id is not null) or
    (scope = 'league' and team_id is null)
  )
);

-- Partial unique indexes — one league row per (subscriber, sport), one
-- team row per (subscriber, team). The predicate matters: a subscriber
-- could have BOTH a league row and team rows for the same sport.
create unique index if not exists email_subscriptions_league_unique
  on public.email_subscriptions (subscriber_id, sport)
  where scope = 'league';
create unique index if not exists email_subscriptions_team_unique
  on public.email_subscriptions (subscriber_id, team_id)
  where scope = 'team';

-- Fast lookup of "everyone on the MLB league digest" for the send cron.
create index if not exists email_subscriptions_active_sport_scope
  on public.email_subscriptions (sport, scope)
  where active = true;

alter table public.email_subscriptions enable row level security;
grant select, insert, update, delete on public.email_subscriptions to service_role;

-- Backfill: every currently-active subscriber is opted into the MLB league
-- digest. 'status=active' is the existing "wants emails" signal; matches
-- exactly what the cron sends to today. Idempotent via the partial unique
-- index, so re-running this migration is safe.
insert into public.email_subscriptions (subscriber_id, sport, scope, active)
select id, 'mlb', 'league', true
  from public.subscribers
 where status = 'active'
on conflict do nothing;
