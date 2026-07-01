-- Rollback for `0066_predictions_render_cache.sql` — only run this on the
-- WRONG Supabase project (Golfapalooza) where the migration was applied
-- by mistake. Paste into Project → SQL editor and run.
--
-- `drop table` cascades the primary-key + the predictions_render_cache_recent
-- index automatically, so a single statement is enough. `if exists` keeps
-- this safe to re-run.

drop table if exists public.predictions_render_cache;

-- Tell PostgREST to refresh its schema cache so the table disappears
-- from the project's REST surface immediately.
notify pgrst, 'reload schema';
