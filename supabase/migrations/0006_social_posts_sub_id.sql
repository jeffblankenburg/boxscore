-- Multiple posts per platform per day: each image gets its own social post,
-- with sub_id ("al-standings", "boxscore-01", etc.) distinguishing them.
-- Old single-post-per-day rows continue working with sub_id = ''.

alter table public.social_posts
  add column if not exists sub_id text not null default '';

alter table public.social_posts
  drop constraint if exists social_posts_platform_sport_date_key;

alter table public.social_posts
  add constraint social_posts_platform_sport_date_sub_id_key
  unique (platform, sport, date, sub_id);

notify pgrst, 'reload schema';
