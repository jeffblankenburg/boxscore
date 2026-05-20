-- One-off announcement banners injected at the top of daily email digests
-- for a specific (sport, date). Used to ship product news (new feature,
-- season-opener notes, planned-downtime notice, etc.) without redeploying
-- template code. The banner appears above the digest body in the league
-- send AND every per-team send for that day.
--
-- One row per (sport, date) max — primary key enforces that. To remove,
-- delete the row. The admin UI on /admin/[sport] is the typical write path.

create table if not exists public.announcements (
  sport       text         not null,
  date        date         not null,
  html        text         not null,
  created_at  timestamptz  not null default now(),
  primary key (sport, date)
);

alter table public.announcements enable row level security;
grant select, insert, update, delete on public.announcements to service_role;
