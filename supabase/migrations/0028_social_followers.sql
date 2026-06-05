-- Persist Twitter/Bluesky followers for the /admin/followers dashboard so we
-- can track who we follow back, star accounts to follow up with, and keep
-- notes — none of which survive when the page is pure live-fetch.
--
-- Sync model: /admin/followers fetches both platforms, upserts every observed
-- follower (bumping last_seen_at), and marks rows whose last_seen_at is
-- older than the current sync as removed (sets removed_at). That keeps
-- unfollowers visible with state instead of silently disappearing.
--
-- `we_follow` is set by a parallel "who we follow" sync (Twitter `following`,
-- Bluesky getFollows) so the UI can surface "they follow me but I don't
-- follow back" — the main reason for the dashboard in the first place.
--
-- PK is (platform, handle). Handles can change on both platforms but rarely
-- enough that treating handle as stable is acceptable; if it ever burns us,
-- migrate to storing the platform-internal id (twitter user_id / bluesky did)
-- as the real key.

create table if not exists public.social_followers (
  platform        text         not null,        -- 'twitter' | 'bluesky'
  handle          text         not null,        -- @username (twitter) or did:..../handle (bluesky)
  display_name    text         not null,
  avatar_url      text,
  bio             text         not null default '',
  profile_url     text         not null,
  we_follow       boolean      not null default false,
  starred         boolean      not null default false,
  notes           text         not null default '',
  first_seen_at   timestamptz  not null default now(),
  last_seen_at    timestamptz  not null default now(),
  removed_at      timestamptz,                  -- set when a sync no longer sees them
  primary key (platform, handle)
);

create index if not exists social_followers_starred_idx
  on public.social_followers (platform, starred)
  where starred = true;

create index if not exists social_followers_removed_idx
  on public.social_followers (platform, removed_at)
  where removed_at is not null;

-- Last successful sync per platform — UI uses this to short-circuit re-sync
-- when the previous run was recent, and to surface "stale data" when a
-- platform's API is down.
create table if not exists public.social_followers_syncs (
  platform     text         primary key,
  synced_at    timestamptz  not null default now(),
  follower_n   integer      not null default 0,
  error        text
);

alter table public.social_followers       enable row level security;
alter table public.social_followers_syncs enable row level security;
grant select, insert, update on public.social_followers       to service_role;
grant select, insert, update on public.social_followers_syncs to service_role;
