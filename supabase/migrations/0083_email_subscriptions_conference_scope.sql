-- Adds a third subscription scope, 'conference', for NCAAF conference digests.
-- The tiers for NCAAF are: 'league' (the Top 25 digest), 'conference' (one of the
-- ten FBS conferences), and 'team' (a single school). 'conference' mirrors 'team'
-- exactly — the target slug ("sec", "big-ten") lives in team_id, one row per
-- (subscriber, sport, conference). This is UI + storage only; the conference
-- send cron is a separate follow-up.

-- Widen the scope value check. The inline check from 0013 carries Postgres'
-- default name (<table>_<column>_check); recreate it to allow 'conference'.
alter table public.email_subscriptions
  drop constraint if exists email_subscriptions_scope_check;
alter table public.email_subscriptions
  add constraint email_subscriptions_scope_check
  check (scope in ('league', 'team', 'conference'));

-- A 'team' or 'conference' row carries a target slug in team_id; 'league' must not.
alter table public.email_subscriptions
  drop constraint if exists email_subscriptions_scope_team_consistency;
alter table public.email_subscriptions
  add constraint email_subscriptions_scope_team_consistency check (
    (scope in ('team', 'conference') and team_id is not null) or
    (scope = 'league' and team_id is null)
  );

-- One conference row per (subscriber, sport, conference-slug). Predicate mirrors
-- the team index so a subscriber can hold league + conference + team rows at once.
create unique index if not exists email_subscriptions_conference_unique
  on public.email_subscriptions (subscriber_id, sport, team_id)
  where scope = 'conference';

notify pgrst, 'reload schema';
