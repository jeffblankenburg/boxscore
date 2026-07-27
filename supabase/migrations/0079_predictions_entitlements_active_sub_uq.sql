-- 0079: enforce one active entitlement row per Stripe subscription.
--
-- Motivation: the Stripe webhook (GitHub #111, Phase 1) turns billing events
-- into predictions_entitlements rows. Two different events describe the same
-- coverage — checkout.session.completed and the first invoice.paid both fire
-- for a new subscription, and every renewal invoice.paid extends it. The
-- handler upserts by stripe_subscription_id (extend access_end on renewal)
-- rather than inserting a new row each time. This partial unique index makes
-- that contract enforceable: at most one NON-revoked Stripe row may exist per
-- subscription, so a race between the two creation events can't double-grant —
-- the loser hits a conflict, 500s, and Stripe's retry finds the row and
-- extends it instead. Revoked rows are excluded so a cancel→resubscribe on the
-- same subscription id (rare, but possible) isn't blocked by history.

create unique index predictions_entitlements_active_sub_uq
  on predictions_entitlements (stripe_subscription_id)
  where stripe_subscription_id is not null and revoked_at is null;

notify pgrst, 'reload schema';
