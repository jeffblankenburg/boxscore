-- First-party click tracking. Initial scope: ad placements. The schema is
-- general (label/destination columns) so issue #51's broader link tracker
-- can reuse this table for tip-jar links, digest internal links, etc. —
-- just by inserting rows with a different `label` and `placement_id = null`.
--
-- Why `placement_id` separate from `label`: lets us index + query click
-- counts per ad placement without parsing `label`. `ON DELETE SET NULL`
-- so deleting a placement doesn't lose its click history.

create table if not exists public.link_clicks (
  id            uuid          primary key default gen_random_uuid(),
  label         text          not null,
  placement_id  uuid          references public.ad_placements(id) on delete set null,
  destination   text          not null,
  clicked_at    timestamptz   not null default now(),
  user_agent    text,
  is_bot        boolean       not null default false
);

create index if not exists link_clicks_placement_idx
  on public.link_clicks (placement_id, clicked_at desc)
  where placement_id is not null;

create index if not exists link_clicks_label_idx
  on public.link_clicks (label, clicked_at desc);

alter table public.link_clicks enable row level security;
grant select, insert on public.link_clicks to service_role;
