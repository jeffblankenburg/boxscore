-- Store a compact linescore snapshot alongside each graded game so the
-- Season Picks table on /mlb/predictions can show inning-by-inning +
-- RHE without re-fetching daily_raw payloads at render time.
--
-- Shape:
--   {
--     "innings": [{"a": 1, "h": 1}, ...],
--     "away": {"r": 9, "h": 11, "e": 0},
--     "home": {"r": 3, "h": 9,  "e": 0}
--   }
-- Nulls represent innings not yet played (or intentionally skipped
-- bottom-9 walkoffs). Populated by the predictions-comparator cron
-- from daily_raw's schedule.linescore blob; existing rows backfilled
-- via scripts/backfill-prediction-linescore.ts.

alter table public.prediction_results
  add column linescore jsonb;
