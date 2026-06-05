-- Generic admin-controlled settings table. Use it for boolean kill-switches
-- and other config that admins need to toggle without a deploy. Keyed by
-- text; value is text (parse to boolean / int / json on the consumer side).
-- Seeds whatever bootstrap rows are needed for the application's defaults.
--
-- Created originally for the `ads_enabled` flag so the daily cron's ad
-- splicing can be turned off from the admin UI in seconds without an env
-- var change or redeploy.

create table if not exists public.admin_settings (
  key         text         primary key,
  value       text         not null,
  updated_at  timestamptz  not null default now(),
  updated_by  text
);

-- Bootstrap: ads_enabled defaults to FALSE so deploying the render-with-ads
-- code doesn't immediately start injecting placements. An admin has to
-- explicitly flip it on via /admin/ads after the first smoke test.
insert into public.admin_settings (key, value)
values ('ads_enabled', 'false')
on conflict (key) do nothing;

alter table public.admin_settings enable row level security;
grant select                     on public.admin_settings to anon, authenticated;
grant select, insert, update     on public.admin_settings to service_role;
