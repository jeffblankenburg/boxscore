-- Rename the game discriminator from 'mlbdle' to 'linescordle' across
-- puzzle_picks and puzzle_attempts. The code rename happened in the
-- linescordle dir migration + the new client now writes 'linescordle'
-- going forward; this migration brings the existing rows into the
-- same naming so historical attempts continue to count toward each
-- subscriber's stats / streaks.
--
-- Driving reason: using "MLB" in the product name risks a trademark
-- problem with Major League Baseball. Linescordle describes the game
-- structurally (line score + Wordle mechanic) without infringing.
--
-- Conflict handling: between rename and apply, the newly-renamed code
-- may have written 'linescordle' rows that collide with the existing
-- 'mlbdle' rows on the unique key (game, puzzle_date) for picks, or
-- (subscriber_id, game, puzzle_date) for attempts. In every observed
-- case the older mlbdle row is what the user actually saw / played,
-- so we delete the duplicate linescordle row first and then rename.

-- 1. Drop any linescordle puzzle_picks that would collide with an
--    existing mlbdle row of the same date. The old mlbdle pick stays
--    (and gets renamed below).
delete from public.puzzle_picks p
 where p.game = 'linescordle'
   and exists (
     select 1 from public.puzzle_picks q
      where q.game = 'mlbdle' and q.puzzle_date = p.puzzle_date
   );

-- 2. Same for attempts.
delete from public.puzzle_attempts a
 where a.game = 'linescordle'
   and exists (
     select 1 from public.puzzle_attempts b
      where b.game = 'mlbdle'
        and b.subscriber_id = a.subscriber_id
        and b.puzzle_date  = a.puzzle_date
   );

-- 3. Rename — collision-free at this point.
update public.puzzle_picks    set game = 'linescordle' where game = 'mlbdle';
update public.puzzle_attempts set game = 'linescordle' where game = 'mlbdle';
