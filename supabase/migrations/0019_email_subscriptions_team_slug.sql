-- Bugfix: email_subscriptions.team_id was declared as uuid in 0013, but
-- the team identifier throughout the rest of the team pipeline is a slug
-- string ("cle", "nyy") — same as sends.team_id (text, declared in 0017).
-- Calls to setTeamSubscription(...slug...) crashed with
--   invalid input syntax for type uuid: "cle"
-- when /subscribe tried to write picks. Align the column to text.
--
-- No real team subscriber rows exist yet (the bug prevented them from
-- being created), so the type change is non-destructive in practice; we
-- still defensively clear any test/manual rows on this scope before
-- altering the column so the cast doesn't have to think about uuid data.

delete from public.email_subscriptions where scope = 'team';

-- Drop the partial unique index that references team_id — Postgres will
-- rebuild on the new type, but it's cleaner to recreate explicitly.
drop index if exists email_subscriptions_team_unique;

alter table public.email_subscriptions
  alter column team_id type text using null;

create unique index if not exists email_subscriptions_team_unique
  on public.email_subscriptions (subscriber_id, team_id)
  where scope = 'team';
