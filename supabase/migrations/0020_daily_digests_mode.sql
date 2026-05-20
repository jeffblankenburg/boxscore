-- Store the classified digest mode ('regular' | 'no-games' | 'all-star' |
-- 'postseason' | 'preseason' | 'offseason') so the dateline-arrow bounds
-- check on /[sport]/[date] can hide prev/next when the neighbor is a
-- preseason or offseason placeholder. game_count alone isn't enough —
-- spring-training days have games > 0 too.
--
-- Existing rows are left with mode = NULL; the bounds query treats NULL as
-- "include" so navigation keeps working until the operator runs bulk
-- regenerate to populate mode for past dates.

alter table public.daily_digests
  add column if not exists mode text;
