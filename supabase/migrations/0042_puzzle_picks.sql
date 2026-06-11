-- Daily puzzle picks for the boxscore.games slate (#57). One row per
-- (game, puzzle_date). The picker writes the row the first time a
-- given calendar day is rendered, then re-renders hit the existing
-- row idempotently — every subscriber playing that day gets the same
-- puzzle.
--
-- `subject_ref` is a polymorphic id:
--   For Linescordle / Guess the Player / Higher-Lower: historical_player_lines.id
--   For Guess the Year:                            historical_games.game_pk
-- The picker module for each game owns its resolution rule. The text
-- shape is wide enough to also carry the v0 hardcoded ids
-- ('v0-pedro-1999-09-10' etc) during transition.

create table public.puzzle_picks (
  id              bigserial    primary key,
  game            text         not null,                -- 'linescordle' / 'year' / 'player' / 'hilo'
  puzzle_date     date         not null,                -- the calendar day this pick is the puzzle for
  subject_ref     text         not null,                -- ref to the source row (line id or game_pk)
  notes           jsonb,                                -- per-game payload (precomputed redactions etc.)
  picked_at       timestamptz  not null default now()
);

create unique index puzzle_picks_unique
  on public.puzzle_picks (game, puzzle_date);

-- Recency-exclusion lookups: "has this player been the answer in the
-- last 90 days for game X?" — sorted desc so the LIMIT N query finds
-- the most recent appearances first.
create index puzzle_picks_recent
  on public.puzzle_picks (game, puzzle_date desc);

alter table public.puzzle_picks enable row level security;
grant select, insert on public.puzzle_picks to service_role;
grant select on public.puzzle_picks to anon;
