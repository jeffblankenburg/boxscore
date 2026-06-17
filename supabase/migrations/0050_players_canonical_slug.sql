-- Canonical player IDs, second pass on the players table (#30 in the
-- canonical-migration backlog).
--
-- The shape from 0037 was already half-right: internal `id` bigserial,
-- `mlb_id` as a vendor cross-ref column, `name_slug` for URL routing.
-- This migration extends it so the slug column becomes our canonical
-- URL identifier across vendors:
--
--   1. Reserve cross-ref columns for additional vendors. SDIO is the
--      live second source; sportradar + bref get column stubs so a
--      future migration doesn't have to ALTER TABLE the world.
--
--   2. Preserve the old "{name}-{mlb_id}" slug as `name_slug_legacy` so
--      we can revert without re-deriving from raw data if the new
--      convention turns out wrong.
--
--   3. Recompute `name_slug` per the new convention:
--        unique name     → `aaron-judge`
--        year disambig   → `chris-davis-1976`, `chris-davis-1980`
--        rare 2nd colis. → `john-smith-1954`, `john-smith-1954-2`
--      Deterministic seed order: debut_date ASC, mlb_id ASC. The earlier
--      debut wins the unsuffixed slug; same player always gets the same
--      slug across re-bootstraps.
--
-- This migration adds the columns and copies the legacy slug. The
-- re-slug pass + SDIO backfill ship as a backfill script
-- (scripts/players-reslug-and-link-sdio.ts) so the SQL stays declarative
-- and the heavy logic lives in TypeScript where it's testable.

alter table public.players
  -- Cross-vendor lookups. Unique-when-set so we can ensure-by-vendor-id
  -- without races, nullable because not every player exists in every
  -- vendor's database (minor leaguers / call-ups / historical players).
  add column if not exists sdio_player_id      bigint unique,
  add column if not exists sportradar_id       text   unique,
  add column if not exists bref_id             text   unique,
  -- Old "{name}-{mlb_id}" slug preserved before the new convention
  -- overwrites name_slug. Lets us revert in one UPDATE if needed.
  add column if not exists name_slug_legacy    text;

-- Single-pass copy: old → legacy. Idempotent because the backfill
-- below leaves legacy untouched on re-runs; only the canonical slug
-- gets recomputed.
update public.players
  set name_slug_legacy = name_slug
  where name_slug_legacy is null
    and name_slug is not null;

-- Indexes for the new lookup paths.
create index if not exists players_sdio_lookup on public.players (sdio_player_id) where sdio_player_id is not null;
create index if not exists players_slug_lookup on public.players (name_slug)        where name_slug        is not null;
