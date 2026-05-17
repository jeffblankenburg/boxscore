import { supabaseAdmin } from "./supabase";

// Per-newsletter opt-in helpers. Today only used to record the implicit
// "you're on the MLB league digest" relationship at signup-confirm time;
// once /settings ships, the cron will filter sends by these rows.

// Default sport for the v1 product — every confirmed subscriber gets opted
// into this league newsletter automatically. Future signups for other sports
// (NFL, NBA, etc.) will add their own rows here.
export const DEFAULT_SPORT = "mlb";

// Idempotent. The partial unique index on (subscriber_id, sport) where
// scope='league' enforces one-per-subscriber-per-sport; we catch the
// duplicate-key error on retries (e.g. a subscriber re-confirming after
// resubscribing) and treat as success.
export async function ensureLeagueSubscription(
  subscriberId: string,
  sport: string = DEFAULT_SPORT,
): Promise<void> {
  const { error } = await supabaseAdmin()
    .from("email_subscriptions")
    .insert({
      subscriber_id: subscriberId,
      sport,
      scope: "league",
      team_id: null,
      active: true,
    });
  if (!error) return;
  const code = (error as { code?: string }).code;
  if (code === "23505" || /duplicate key/i.test(error.message)) return;
  throw new Error(`ensureLeagueSubscription: ${error.message}`);
}
