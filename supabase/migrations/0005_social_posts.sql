-- Per-platform post log. One row per (platform, sport, date). Same idempotency
-- pattern as `sends`: if a row exists with no error, skip; if error is set,
-- the next cron run will UPSERT and retry.

create table if not exists public.social_posts (
  id           uuid         primary key default gen_random_uuid(),
  platform     text         not null,         -- 'twitter' | 'bluesky' | 'facebook' | ...
  sport        text         not null,
  date         date         not null,
  posted_at    timestamptz  not null default now(),
  remote_id    text,                          -- platform-specific post id
  remote_url   text,                          -- public URL of the post
  error        text,
  unique (platform, sport, date)
);

create index if not exists social_posts_date_idx on public.social_posts (date desc);
create index if not exists social_posts_platform_idx on public.social_posts (platform);

alter table public.social_posts enable row level security;
grant select, insert, update on public.social_posts to service_role;
