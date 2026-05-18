-- Click log for the Support/Tip Jar links. Each /r/support hit inserts a row
-- before redirecting to Ko-fi, giving us per-source attribution (web-header,
-- web-footer, email-header, email-footer) without depending on Ko-fi's own
-- analytics or on client-side JS firing inside email clients.

create table if not exists public.support_clicks (
  id          bigserial    primary key,
  src         text         not null,
  clicked_at  timestamptz  not null default now(),
  user_agent  text,
  referer     text
);

create index if not exists support_clicks_clicked_at_desc
  on public.support_clicks (clicked_at desc);
create index if not exists support_clicks_src_clicked_at
  on public.support_clicks (src, clicked_at desc);

alter table public.support_clicks enable row level security;
grant select, insert on public.support_clicks to service_role;
