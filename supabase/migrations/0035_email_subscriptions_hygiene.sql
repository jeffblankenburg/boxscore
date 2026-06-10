-- One-time data hygiene pass on email_subscriptions.
--
-- The unsubscribe path (lib/subscribers.ts unsubscribeSubscriber +
-- unsubscribeByEmail) only ever updated the subscribers table. The per-
-- newsletter opt-in rows in email_subscriptions were never flipped to
-- active=false, so a subscriber who globally unsubscribed kept their MLB
-- league row in active=true state forever.
--
-- That divergence inflated the rolling-subscribers stat on /advertise —
-- which read email_subscriptions directly — by ~7% relative to the
-- /admin/mlb count, which intersected with subscribers.status='active'.
-- The unsubscribe path has now been fixed (along with the resubscribe
-- path in ensureLeagueSubscription so re-enable still works). This
-- migration cleans up the rows that accumulated under the old behavior.
--
-- Scope:
--   - Any subscriber whose status is not 'active' should have every
--     email_subscriptions.active flipped to false.
--   - This includes status='unsubscribed' AND status='pending'. Pending
--     subscribers shouldn't be counted in "people receiving emails"
--     until they confirm; the confirm path runs ensureLeagueSubscription
--     which re-enables their league row at that point.

update public.email_subscriptions es
   set active = false
  from public.subscribers s
 where es.subscriber_id = s.id
   and es.active = true
   and s.status   <> 'active';
