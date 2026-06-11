-- Per-subscriber attempt log for the boxscore.games slate. v1 scope is
-- Linescordle only; the `game` column lets every game (Guess the Year,
-- Guess the Player, Higher / Lower) write to the same table when they
-- ship without further migration.
--
-- This is the authenticated-subscriber path only — anonymous device
-- streaks land alongside #57's daily-picker work. For v1, subscriber_id
-- is required; an unauthenticated visitor just doesn't get a row.
--
-- Per #57's spec the daily picker writes puzzle_picks first; this table
-- references that pick via puzzle_subject_id (string-keyed for now;
-- we'll FK to puzzle_picks once that table lands).

create table public.puzzle_attempts (
  id                 bigserial    primary key,
  subscriber_id      uuid         not null references public.subscribers(id) on delete cascade,
  game               text         not null,                -- 'linescordle' / 'year' / 'player' / 'hilo'
  puzzle_date        date         not null,                -- the calendar day the puzzle covers
  puzzle_subject_id  text         not null,                -- stable id for the puzzle subject (player line id, game pk, etc.)
  guesses            jsonb        not null default '[]'::jsonb,   -- per-game shape; Linescordle: [{letters:[], scores:[]}]
  hints              jsonb        not null default '[]'::jsonb,   -- list of which hints were taken, in order
  solved             bool,                                  -- null = in progress, true = won, false = lost
  guess_count        int          not null default 0,
  hint_count         int          not null default 0,
  started_at         timestamptz  not null default now(),
  updated_at         timestamptz  not null default now(),
  completed_at       timestamptz
);

-- One attempt per (subscriber, game, day). The picker guarantees only
-- one puzzle per game per day, so this is the right uniqueness key.
create unique index puzzle_attempts_unique
  on public.puzzle_attempts (subscriber_id, game, puzzle_date);

-- Streak / stats queries look at one subscriber across one game's
-- entire history.
create index puzzle_attempts_streak
  on public.puzzle_attempts (subscriber_id, game, puzzle_date desc);

alter table public.puzzle_attempts enable row level security;
grant select, insert, update on public.puzzle_attempts to service_role;
