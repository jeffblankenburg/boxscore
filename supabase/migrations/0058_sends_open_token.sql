-- Self-hosted open-tracking pixel. Adds open_token to sends so the digest
-- template can carry a stable, unguessable URL the pixel endpoint can
-- look up when an image fetch lands.
--
-- Why this exists: Resend's open-tracking pixel sits at the end of the
-- email body. Gmail clips messages over ~102 KB at the bottom, hiding
-- Resend's pixel below the clip line. The MLB league digest is routinely
-- 250-305 KB (verified 2026-06-23 via scripts/diag-digest-size.ts), so
-- Gmail's image proxy never fetches Resend's pixel — silently zeroing
-- out open tracking for the ~65% of the list on consumer Gmail.
--
-- Fix: a second pixel under our control, injected near the top of the
-- body where the clip can't hit it. UUID token here is what the pixel
-- URL carries; the endpoint resolves token → send → writes an event row.
--
-- Backfill: existing sends rows stay null. Only forward sends carry the
-- new token. The open-rate read paths union "email.opened" (Resend) with
-- "boxscore.opened" (ours) so historical numbers aren't broken.

alter table public.sends
  add column if not exists open_token uuid;

-- Unique-when-set so we can use the column as a lookup key in the pixel
-- endpoint. Partial because pre-migration rows are null.
create unique index if not exists sends_open_token
  on public.sends (open_token)
  where open_token is not null;
