-- Demographic columns on subscribers. Drives advertiser rates and lets
-- /admin/analytics break the audience down for the advertiser dashboard
-- (project_ads memory).
--
-- All columns are nullable; the post-confirm welcome page and the
-- /settings demographics card both treat them as optional. No app code
-- should ever assume a value is set. "prefer-not-to-say" is stored as
-- the literal string so we can distinguish "skipped the question" from
-- "declined to answer" — useful when reading completion rates.
--
-- `demographics_completed_at` is set the first time a subscriber saves
-- the form (even if all fields are blank / prefer-not-to-say). Reading
-- the column tells us whether the welcome step has been seen, separate
-- from whether any individual field is populated.
--
-- Format choices:
--   country     : ISO 3166-1 alpha-2 ("US", "CA", "GB"). 2 chars.
--   region      : ISO subdivision suffix without the country prefix
--                 ("OH", "ON"). Stored loose as text so we can support
--                 regions outside our region picker without a migration.
--   age_band    : "18-24" | "25-34" | "35-44" | "45-54" | "55-64" | "65+"
--                 | "prefer-not-to-say"
--   income_band : "<50k" | "50k-100k" | "100k-150k" | "150k-250k" | "250k+"
--                 | "prefer-not-to-say"
--   gender      : "man" | "woman" | "non-binary" | "prefer-not-to-say"

alter table public.subscribers
  add column if not exists country               char(2),
  add column if not exists region                text,
  add column if not exists age_band              text,
  add column if not exists income_band           text,
  add column if not exists gender                text,
  add column if not exists demographics_completed_at  timestamptz;

create index if not exists subscribers_demographics_completed_at
  on public.subscribers (demographics_completed_at);
