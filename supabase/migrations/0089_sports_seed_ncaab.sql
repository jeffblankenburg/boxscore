-- Seed college basketball (men's + women's) into the sports catalog. Added to
-- the static registry in lib/sports.ts (deploy-time baseline / outage fallback)
-- and their teams/conferences to the registries, but the DB row is what the
-- admin visibility + sends toggles UPDATE by id — without it, "Launch NCAAM"
-- would silently affect zero rows. Same pattern as 0073 (NFL/NCAAF) and 0081
-- (NHL).
--
-- admin_only + sends disabled: behavior-neutral until an admin flips it public.
insert into public.sports (id, name, visibility, sends_enabled) values
  ('ncaam', 'College Basketball (M)', 'admin_only', false),
  ('ncaaw', 'College Basketball (W)', 'admin_only', false)
on conflict (id) do nothing;

notify pgrst, 'reload schema';
