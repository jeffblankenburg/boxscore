-- 0077: predictions_entitlements — who can access the paid predictions
-- product, and for which dates.
--
-- Motivation: the paid /mlb/predictions tier (GitHub #109) needs a
-- Stripe-agnostic record of access. An entitlement is a dated window
-- [access_start, access_end] granted to a subscriber, from either a Stripe
-- purchase or an admin comp. The premium view and the picks-email gate read
-- "does subscriber X hold an active entitlement covering date D", so the
-- access check never depends on Stripe being reachable at read time —
-- Stripe webhooks (spec step 3) and the admin-comp tool both just write
-- rows here.
--
-- Windows are ET calendar dates (inclusive) to match the daily edition
-- boundary the rest of the product uses. Rolling weekly/monthly renewals
-- append or extend windows; the season pass is one row; a comp sets its own
-- window. revoked_at soft-cancels a row (Stripe cancel, refund, or admin
-- revoke) without deleting history, so a canceled sub stays attributable.

create table predictions_entitlements (
  id                     uuid primary key default gen_random_uuid(),
  subscriber_id          uuid not null references public.subscribers(id) on delete cascade,
  product                text not null,        -- 'week' | 'month' | 'season' | 'playoffs'
  access_start           date not null,        -- inclusive, ET calendar date
  access_end             date not null,        -- inclusive, last day of access
  source                 text not null,        -- 'stripe' | 'comp'
  stripe_subscription_id text,                 -- set for recurring Stripe subs
  stripe_checkout_id     text,                 -- set for one-time purchases
  granted_by             text,                 -- admin identifier, for comps
  note                   text,
  created_at             timestamptz not null default now(),
  revoked_at             timestamptz,          -- soft cancel; excluded from access checks

  constraint predictions_entitlements_window_ck check (access_end >= access_start)
);

-- Access checks filter by subscriber + non-revoked; the send cron scans by
-- date window. Both are covered here.
create index predictions_entitlements_sub_idx
  on predictions_entitlements (subscriber_id, revoked_at);
create index predictions_entitlements_window_idx
  on predictions_entitlements (access_start, access_end);

notify pgrst, 'reload schema';
