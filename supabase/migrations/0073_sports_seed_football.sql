-- Seed NFL and NCAAF into the sports catalog. They were added to the static
-- registry in lib/sports.ts (the deploy-time baseline / outage fallback) but
-- never inserted here, so the admin visibility toggle — which UPDATEs the row
-- by id — would silently affect zero rows for them.
--
-- Visibility defaults to admin_only, matching the static default, so this is
-- behavior-neutral until an admin flips a sport public. sends_enabled uses the
-- column default (true).
insert into public.sports (id, name, visibility) values
  ('nfl',   'NFL',              'admin_only'),
  ('ncaaf', 'College Football', 'admin_only')
on conflict (id) do nothing;

notify pgrst, 'reload schema';
