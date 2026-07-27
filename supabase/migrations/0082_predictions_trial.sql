-- 0082: one-time free-trial eligibility for the paid predictions tier.
--
-- A logged-in subscriber flagged eligible can self-activate a one-time, 3-day
-- free trial — a comp entitlement, no Stripe involved. `eligible_at` is stamped
-- by a snapshot of the CURRENT subscriber base (scripts/seed-predictions-trial.ts);
-- anyone who signs up after that snapshot is never flagged, so they don't see
-- the offer. `activated_at` records the (single) activation so it can't repeat.

alter table subscribers add column if not exists predictions_trial_eligible_at  timestamptz;
alter table subscribers add column if not exists predictions_trial_activated_at timestamptz;

notify pgrst, 'reload schema';
