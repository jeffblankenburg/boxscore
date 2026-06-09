-- Fix the page_views dedupe index so the ingest endpoint's upsert can
-- target it.
--
-- The original index in 0031 used coalesce() expressions on the nullable
-- columns to make a multi-column dedupe key that handled nulls. That
-- works for uniqueness but PostgREST's onConflict parameter — which
-- supabase-js passes as a comma-separated list of column names — can
-- only match unique constraints/indexes by raw column definition, not
-- by expression. As a result, the ingest endpoint's
-- .upsert({...}, { onConflict: "occurred_at,session_id,device_id,path" })
-- call errored on every Drain delivery and the route returned 500.
--
-- Replacement: raw column list with NULLS NOT DISTINCT (Postgres 15+,
-- supported by Supabase). NULLS NOT DISTINCT tells the index to treat
-- two NULL values as equal for uniqueness purposes — the same
-- semantics the coalesce form was emulating.

drop index if exists public.page_views_dedupe;

create unique index if not exists page_views_dedupe
  on public.page_views (occurred_at, session_id, device_id, path)
  nulls not distinct;
