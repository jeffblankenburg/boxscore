// Shared constants for email-event aggregation.
//
// As of 2026-06-23 we count opens from two event-type values:
//   - "email.opened"      — Resend's open-tracking pixel (end of body, sometimes clipped by Gmail)
//   - "boxscore.opened"   — our self-hosted pixel at top of body (see app/api/o/[token])
//
// Counting model: every read path keys aggregations on resend_id and asks
// "did ANY open event arrive for this send?" — so a recipient who fires
// both pixels still counts as one unique open. No double-counting.

export const OPEN_EVENT_TYPES = ["email.opened", "boxscore.opened"] as const;
export type OpenEventType = (typeof OPEN_EVENT_TYPES)[number];

// True iff a per-send event set has at least one open event of any type.
// Used everywhere we previously checked `evts.has("email.opened")`.
export function hasOpen(evts: Set<string>): boolean {
  return evts.has("email.opened") || evts.has("boxscore.opened");
}
