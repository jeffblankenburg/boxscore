-- Persistent log of /advertise inquiry-form submissions. Until this,
-- inquiries were emailed and dropped on the floor — no way to trend
-- over time, segment by source, or reconstruct the visitor's session.
--
-- One row per submission. We keep the form fields verbatim plus the
-- "how did they get here" context the InquiryForm captures from the
-- URL and PostHog (utm_*, referer, landing_path, session_id) so the
-- /admin/leads view can show full attribution per lead.
--
-- enrichment_* columns are populated async by a future enrichment
-- step (Clearbit/Hunter/Apollo) keyed on the email domain. Stored
-- here rather than in a join table because: (a) the per-inquiry
-- snapshot is the right scope (a person at Acme today may be at
-- DifferentCo next year — we want what was true at submission),
-- (b) one inquiry-shaped row keeps /admin/leads a single read.
--
-- notified_at gates the "new inquiry" email — set on first successful
-- notification so the same inquiry doesn't re-notify on retries.

create table public.advertise_inquiries (
  id              uuid          primary key default gen_random_uuid(),
  created_at      timestamptz   not null default now(),

  -- Submitted form fields.
  name            text          not null,
  email           text          not null,
  company         text,
  budget          text,
  formats         text[]        not null default '{}',
  message         text          not null,

  -- Attribution / context captured at submit time.
  utm_source      text,
  utm_medium      text,
  utm_campaign    text,
  utm_term        text,
  utm_content     text,
  referer         text,
  landing_path    text,                       -- the path they landed on before /advertise (if any)
  posthog_session text,                       -- ties the lead to their session in PostHog
  user_agent      text,
  ip_address      inet,

  -- Async enrichment from email-domain lookup. Nullable until populated.
  enrichment_status     text,                 -- 'pending' | 'ok' | 'not_found' | 'error'
  enrichment_company    text,
  enrichment_domain     text,
  enrichment_industry   text,
  enrichment_employees  integer,
  enrichment_linkedin   text,
  enriched_at           timestamptz,

  -- Notification gating.
  notified_at     timestamptz
);

create index advertise_inquiries_created_at_desc
  on public.advertise_inquiries (created_at desc);

-- For repeat-inquiry lookup ("has this email written before?").
create index advertise_inquiries_email
  on public.advertise_inquiries (lower(email));

alter table public.advertise_inquiries enable row level security;
grant select, insert, update on public.advertise_inquiries to service_role;
