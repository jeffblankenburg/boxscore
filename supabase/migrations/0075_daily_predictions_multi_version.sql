-- Let daily_predictions hold multiple model_versions per game.
--
-- daily_predictions started single-version: PK (sport, date, game_pk), one
-- snapshot per game. To run v7 as a live SHADOW of v6 we need a second row
-- per game (model_version = 'v7-run-model') alongside the production v6 row,
-- so the comparator — which already grades every model_version present for a
-- date and upserts prediction_results keyed on (sport,date,game_pk,
-- model_version) — scores both and v7 accrues a graded forward record.
--
-- The model_version column already exists (the snapshot writes it); this
-- just moves it into the primary key. Existing rows are all one version, so
-- no duplicates block the new PK. Callers that must see a single version
-- (odds capture, the public page) filter by model_version explicitly.

alter table public.daily_predictions drop constraint if exists daily_predictions_pkey;
alter table public.daily_predictions add primary key (sport, date, game_pk, model_version);

notify pgrst, 'reload schema';
