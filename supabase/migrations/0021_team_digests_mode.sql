-- Mirror of 0020 for team_digests: store the league's classified mode so
-- the team-page dateline arrows can hide prev/next when the neighbor is a
-- preseason or offseason placeholder. has_game alone isn't enough — a
-- spring-training game is "has_game = true" the same way a regular-season
-- game is, and we don't want the prev arrow on a team's opening-day page
-- to link back into March exhibitions.
--
-- Pulled directly from the league DailyData.mode value at generate time
-- (every team digest for a given date inherits the same league mode).
-- Existing rows are left with mode = NULL; the bounds query treats NULL as
-- "include" until they're regenerated.

alter table public.team_digests
  add column if not exists mode text;
