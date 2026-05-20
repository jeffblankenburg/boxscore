-- Per-team rendered digest, mirroring daily_digests but keyed on
-- (sport, team_slug, date). The generate cron writes one row per
-- (sport, team_slug, date); the web page at /{sport}/{slug}/{date} and
-- the send-team-email cron both READ from here so nothing re-renders
-- at request time. Stored as two HTML payloads — web (html) and email
-- (email_html) — same as daily_digests, since the email body inlines
-- the CSS and the web body relies on globals.css.

create table if not exists public.team_digests (
  sport         text         not null,
  team_slug     text         not null,
  date          date         not null,
  generated_at  timestamptz  not null default now(),
  -- has_game lets the web page render a "no game" notice or skip the
  -- box-score section without parsing the cached HTML to find out.
  has_game      boolean      not null default false,
  html          text         not null,
  email_html    text         not null,
  primary key (sport, team_slug, date)
);

create index if not exists team_digests_sport_team_date_desc
  on public.team_digests (sport, team_slug, date desc);

alter table public.team_digests enable row level security;

-- Same public-read policy as daily_digests — these pages live on the
-- public web; nothing here is sensitive.
drop policy if exists "anyone can read team digests" on public.team_digests;
create policy "anyone can read team digests"
  on public.team_digests for select
  to anon, authenticated
  using (true);

grant select, insert, update, delete on public.team_digests to service_role;
grant select on public.team_digests to anon, authenticated;
