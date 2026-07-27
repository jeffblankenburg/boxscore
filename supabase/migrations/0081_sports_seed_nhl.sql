-- Seed NHL into the sports catalog. It was added to the static registry in
-- lib/sports.ts (deploy-time baseline / outage fallback) and its teams to the
-- team registry, but never inserted here — so the admin visibility toggle,
-- which UPDATEs the row by id, would silently affect zero rows for NHL (the
-- "Launch NHL" button would no-op). Same fix as 0073 for NFL/NCAAF.
--
-- admin_only + sends disabled: behavior-neutral until an admin flips it public.
insert into public.sports (id, name, visibility, sends_enabled) values
  ('nhl', 'NHL', 'admin_only', false)
on conflict (id) do nothing;

notify pgrst, 'reload schema';
