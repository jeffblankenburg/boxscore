-- Scan log for physical QR codes (business cards, flyers, stickers). Every
-- printed code points at /r/qr?src=<label>, which logs one row here and then
-- 302s to /subscribe with utm_source=qr so the existing acquisition
-- attribution (migration 0057 columns on subscribers) tags the signup.
--
-- Why a scan log at all when we already capture UTM on subscribers: UTM only
-- sees the people who scan AND finish signing up. At a conference most people
-- scan, get distracted, and never subscribe. This table counts the raw reach
-- (scans); the subscribers table counts conversions. The join key between the
-- two is `src` == subscribers.utm_campaign.
--
-- Mirrors the shape of email_link_clicks (0045) / support_clicks (0014).
-- `src` is a short label — lowercase letters / digits / hyphens only, enforced
-- at the route (SRC_RE) — which keeps a stable group-by key for the admin
-- funnel table.

create table if not exists public.qr_scans (
  id          bigserial    primary key,
  src         text         not null,
  scanned_at  timestamptz  not null default now(),
  user_agent  text,
  referer     text
);

create index if not exists qr_scans_scanned_at_desc
  on public.qr_scans (scanned_at desc);
create index if not exists qr_scans_src_scanned_at
  on public.qr_scans (src, scanned_at desc);

alter table public.qr_scans enable row level security;
grant select, insert on public.qr_scans to service_role;

notify pgrst, 'reload schema';
