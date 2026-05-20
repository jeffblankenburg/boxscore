-- Per-newsletter send log expansion: add team_id so the per-team digest
-- pipeline can record its own sends alongside the league digest. NULL for
-- league sends; a team slug like 'cle' for team-scoped sends.
--
-- The original unique constraint (subscriber_id, digest_sport, digest_date)
-- guaranteed one league send per subscriber per date. After adding team_id,
-- a subscriber can legitimately receive a league send AND one or more team
-- sends on the same date — so the constraint needs team_id too.
--
-- NULLS NOT DISTINCT (Postgres 15+) treats two NULL team_id values as equal,
-- which preserves the "one league send per subscriber per date" guarantee
-- while still allowing each team-scoped send (with distinct non-null team_id)
-- to coexist. Without NULLS NOT DISTINCT, multiple NULL rows would collide-
-- proof through the unique constraint and we'd be back to the old problem.

alter table public.sends
  add column if not exists team_id text;

-- Replace the old constraint. The constraint name is the Postgres default
-- generated when 0004 declared `unique (subscriber_id, digest_sport, digest_date)`.
alter table public.sends
  drop constraint if exists sends_subscriber_id_digest_sport_digest_date_key;

alter table public.sends
  add constraint sends_subscriber_sport_date_team_uniq
  unique nulls not distinct (subscriber_id, digest_sport, digest_date, team_id);

-- Speed up "subscribers already sent for this team/date" lookups in the
-- team send cron. The existing sends_date_idx + sends_subscriber_idx still
-- cover league-send queries fine.
create index if not exists sends_team_date_idx
  on public.sends (digest_sport, team_id, digest_date desc)
  where team_id is not null;
