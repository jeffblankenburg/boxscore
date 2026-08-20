-- Daily puzzle storage for the Teammates game.
--
-- Motivation: puzzles are generated from an ~9 MB player pool. Generating on
-- every page request meant loading/parsing that pool each time. Instead a daily
-- cron (/api/cron/teammates-generate) generates today + a few days ahead once
-- and stores the finished puzzle here (a few KB of JSON), so page requests read
-- one small row and never touch the pool.

create table public.teammates_puzzles (
  puzzle_date  date         primary key,
  data         jsonb        not null,   -- the full TeammatesPuzzle payload
  created_at   timestamptz  not null default now()
);

alter table public.teammates_puzzles enable row level security;
grant select, insert, update on public.teammates_puzzles to service_role;

notify pgrst, 'reload schema';
