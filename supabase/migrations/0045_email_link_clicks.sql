-- Click log for tracked links in the boxscore email chrome. Mirrors the
-- shape of support_clicks (0014) but covers the broader set of links
-- we wrap through /r/e/[src]: digest title, Manage Subscriptions, and
-- anything else we add to the email header later. Keeping it a separate
-- table from support_clicks so the per-source query plans stay
-- straightforward and the support_clicks indexes don't have to bear
-- the higher volume of digest clicks.
--
-- `link_target` is the final destination URL the redirect sent the user
-- to. Storing it makes the click log self-describing when we read it
-- back from /admin later — no need to cross-reference templates.

create table if not exists public.email_link_clicks (
  id           bigserial    primary key,
  src          text         not null,
  link_target  text         not null,
  clicked_at   timestamptz  not null default now(),
  user_agent   text,
  referer      text
);

create index if not exists email_link_clicks_clicked_at_desc
  on public.email_link_clicks (clicked_at desc);
create index if not exists email_link_clicks_src_clicked_at
  on public.email_link_clicks (src, clicked_at desc);

alter table public.email_link_clicks enable row level security;
grant select, insert on public.email_link_clicks to service_role;
