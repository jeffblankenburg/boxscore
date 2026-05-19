import { supabaseAdmin } from "./supabase";

// Per-newsletter opt-in helpers. The send cron filters by these rows
// (getActiveSubscribersForSport) so a subscriber only receives the sports
// they've explicitly opted into.

// Default sport for the v1 product — every confirmed subscriber gets opted
// into this league newsletter automatically. Future signups for other sports
// (NFL, NBA, etc.) are added via /settings toggles, not at confirm time.
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

/**
 * Returns a map of sport → active flag for this subscriber's league rows.
 * Sports the subscriber has never seen are absent from the map (treat as
 * active=false in UI). Used by /settings to render toggle state.
 */
export async function getLeagueSubscriptions(
  subscriberId: string,
): Promise<Map<string, boolean>> {
  const { data, error } = await supabaseAdmin()
    .from("email_subscriptions")
    .select("sport, active")
    .eq("subscriber_id", subscriberId)
    .eq("scope", "league");
  if (error) throw new Error(`getLeagueSubscriptions: ${error.message}`);
  const out = new Map<string, boolean>();
  for (const row of (data ?? []) as Array<{ sport: string; active: boolean }>) {
    out.set(row.sport, row.active);
  }
  return out;
}

/**
 * Upsert the league row for (subscriber, sport) with the given active flag.
 * Inserts on first toggle, updates on subsequent toggles. The partial unique
 * index on (subscriber_id, sport) WHERE scope='league' is what makes the
 * upsert collapse to one row per pair.
 */
export async function setLeagueSubscription(
  subscriberId: string,
  sport: string,
  active: boolean,
): Promise<void> {
  // Try insert first; on unique-violation, fall back to update. Using
  // .upsert() with onConflict requires a named unique constraint and ours
  // is a partial index, so the two-step pattern is more reliable here.
  const { error: insertErr } = await supabaseAdmin()
    .from("email_subscriptions")
    .insert({
      subscriber_id: subscriberId,
      sport,
      scope: "league",
      team_id: null,
      active,
    });
  if (!insertErr) return;
  const code = (insertErr as { code?: string }).code;
  const isDup = code === "23505" || /duplicate key/i.test(insertErr.message);
  if (!isDup) throw new Error(`setLeagueSubscription insert: ${insertErr.message}`);

  const { error: updateErr } = await supabaseAdmin()
    .from("email_subscriptions")
    .update({ active, updated_at: new Date().toISOString() })
    .eq("subscriber_id", subscriberId)
    .eq("sport", sport)
    .eq("scope", "league");
  if (updateErr) throw new Error(`setLeagueSubscription update: ${updateErr.message}`);
}
