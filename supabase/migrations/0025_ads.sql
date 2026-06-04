-- Ad pipeline MVP: schema for advertiser-driven placements that the digest
-- renderer can read at send time. Companion ticket to #44.
--
-- Four tables form the chain:
--   ad_advertisers   — who's running the ad (one row per real-world entity)
--   ad_campaigns     — a bookable unit; status + payment lives here
--   ad_creatives     — the rendered ad content, one per format on a campaign
--   ad_placements    — when/where a creative runs (sport, date, slot_index)
--
-- A placement is "live" when its campaign satisfies:
--   status = 'approved' AND paid_at IS NOT NULL
-- Both gates are admin-set; the render path (ticket #45) will join on these.
--
-- v1: MLB league digest only, manual payment tracking, no Stripe.
-- No self-serve booking, no advertiser accounts, no rate-card storage.

create type ad_campaign_status as enum (
  'pending',
  'approved',
  'rejected',
  'cancelled'
);

create type ad_format as enum (
  'sponsor_line',
  'standings_strip',
  'display_box',
  'classified'
);

create table if not exists public.ad_advertisers (
  id          uuid         primary key default gen_random_uuid(),
  email       text         not null,
  name        text         not null,
  notes       text,
  created_at  timestamptz  not null default now()
);

-- Case-insensitive uniqueness on email so the admin can't accidentally create
-- duplicate advertiser rows for "Hello@Greenfield.com" vs "hello@greenfield.com".
create unique index ad_advertisers_email_idx
  on public.ad_advertisers (lower(email));

create table if not exists public.ad_campaigns (
  id                uuid                primary key default gen_random_uuid(),
  advertiser_id     uuid                not null references public.ad_advertisers(id) on delete cascade,
  name              text                not null,
  status            ad_campaign_status  not null default 'pending',
  -- Manual payment tracking. paid_amount_cents is what the advertiser actually
  -- paid for this campaign (locked at booking, doesn't change if the rate card
  -- updates later). paid_method is free-form because v1 covers Stripe links,
  -- Venmo, invoices, and handshake deals all routed through the same form.
  paid_at           timestamptz,
  paid_amount_cents integer,
  paid_method       text,
  notes             text,
  created_at        timestamptz         not null default now()
);

create index ad_campaigns_advertiser_idx
  on public.ad_campaigns (advertiser_id);

-- Partial index for the hot "what's live?" query the render path will run.
create index ad_campaigns_live_idx
  on public.ad_campaigns (id)
  where status = 'approved' and paid_at is not null;

create table if not exists public.ad_creatives (
  id              uuid        primary key default gen_random_uuid(),
  campaign_id     uuid        not null references public.ad_campaigns(id) on delete cascade,
  format          ad_format   not null,
  -- Structured fields per format (advertiser_name, headline, body, cta_text,
  -- cta_url, etc.). MVP admin form accepts raw JSON; per-format structured
  -- inputs come later. Render-side template (#45) interprets payload per format.
  payload         jsonb       not null default '{}'::jsonb,
  -- Display-box only. Image lives in Vercel Blob; we store the public URL +
  -- alt text for accessibility / email-client image-off fallback.
  image_blob_url  text,
  alt_text        text,
  created_at      timestamptz not null default now()
);

create index ad_creatives_campaign_idx
  on public.ad_creatives (campaign_id);

create table if not exists public.ad_placements (
  id          uuid        primary key default gen_random_uuid(),
  creative_id uuid        not null references public.ad_creatives(id) on delete cascade,
  -- Denormalized from creative.format so we can enforce slot uniqueness in a
  -- single index without a join. Kept in sync at insert time by the admin
  -- form; if a creative's format ever changes (rare; usually edited via
  -- delete + recreate) the corresponding placements should be cleared.
  format      ad_format   not null,
  sport       text        not null,
  date        date        not null,
  slot_index  integer     not null,
  created_at  timestamptz not null default now()
);

-- Two campaigns can't claim the same (sport, date, format, slot). Catches the
-- race condition where two admin actions create overlapping placements at
-- once and surfaces a clean error in the admin form.
create unique index ad_placements_slot_uniq
  on public.ad_placements (sport, date, format, slot_index);

-- Hot lookup path: "what's running today for sport=mlb?" — used by #45's
-- getLivePlacements(sport, date).
create index ad_placements_lookup_idx
  on public.ad_placements (sport, date);

alter table public.ad_advertisers enable row level security;
alter table public.ad_campaigns   enable row level security;
alter table public.ad_creatives   enable row level security;
alter table public.ad_placements  enable row level security;

-- All ad-pipeline tables are admin-only for v1. No anon/authenticated grants —
-- service_role (used by /admin/ads + the render path) is the only writer/reader.
grant select, insert, update, delete on public.ad_advertisers to service_role;
grant select, insert, update, delete on public.ad_campaigns   to service_role;
grant select, insert, update, delete on public.ad_creatives   to service_role;
grant select, insert, update, delete on public.ad_placements  to service_role;
