-- 0078: grants + RLS for predictions_entitlements.
--
-- 0077 created the table but omitted the service_role grant and RLS that the
-- other app tables carry (see 0071, 0072). Supabase-js connects as
-- service_role, which bypasses RLS but still needs table-level GRANTs — so
-- every read/write hit "permission denied for table
-- predictions_entitlements". This adds them. Kept as a separate migration
-- because 0077 was already applied; both statements are idempotent, so a
-- fresh rebuild running 0077→0078 lands in the same place.
--
-- RLS on + grant to service_role only: the public API roles (anon,
-- authenticated) get nothing; service_role bypasses RLS and performs all
-- entitlement reads/writes (access checks, Stripe webhooks, admin comps).

alter table public.predictions_entitlements enable row level security;
grant select, insert, update on public.predictions_entitlements to service_role;

notify pgrst, 'reload schema';
