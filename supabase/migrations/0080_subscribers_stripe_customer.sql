-- 0080: link a subscriber to their Stripe Customer.
--
-- Motivation: the paid predictions checkout (GitHub #111, Phase 2) creates a
-- Stripe Subscription per purchase. To avoid minting a new Customer on every
-- checkout — and so /settings (Phase 4) can look up the payment method + next
-- renewal — we persist the Stripe Customer id on the subscriber and reuse it.
-- One customer per subscriber; nullable until their first purchase.

alter table subscribers add column if not exists stripe_customer_id text;

-- At most one subscriber per Stripe customer. Partial (nulls excluded) so the
-- vast majority of subscribers who never buy don't collide on NULL.
create unique index if not exists subscribers_stripe_customer_uq
  on subscribers (stripe_customer_id)
  where stripe_customer_id is not null;

notify pgrst, 'reload schema';
