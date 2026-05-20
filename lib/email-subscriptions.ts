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

/**
 * Apply a fresh set of league/team opt-in selections for a subscriber,
 * replacing any prior state. Used by /subscribe to write the picker
 * selections into email_subscriptions at signup time so the row already
 * reflects what the subscriber asked for by the time /c/[token] activates
 * them.
 *
 * Replace semantics: anything in `picks` becomes active=true; anything the
 * subscriber currently has active=true that's NOT in picks gets flipped to
 * active=false. We don't touch rows the subscriber has never seen (active
 * is already absent → effectively false).
 */
export async function applyInitialSubscriptions(
  subscriberId: string,
  picks: {
    leagues: string[];
    teams: Array<{ sport: string; slug: string }>;
  },
): Promise<void> {
  const { data: rows, error } = await supabaseAdmin()
    .from("email_subscriptions")
    .select("sport, scope, team_id, active")
    .eq("subscriber_id", subscriberId);
  if (error) throw new Error(`applyInitialSubscriptions read: ${error.message}`);

  const pickedLeagues = new Set(picks.leagues);
  const pickedTeams = new Set(picks.teams.map((t) => `${t.sport}|${t.slug}`));

  // Activate everything the subscriber picked. Idempotent (insert-then-
  // update fallback inside the helpers handles existing rows).
  for (const sport of picks.leagues) {
    await setLeagueSubscription(subscriberId, sport, true);
  }
  for (const t of picks.teams) {
    await setTeamSubscription(subscriberId, t.sport, t.slug, true);
  }

  // Deactivate any prior opt-ins NOT in the new picks. Skips rows already
  // inactive — re-flipping them is a no-op write we don't need to spend.
  for (const row of (rows ?? []) as Array<{
    sport: string;
    scope: string;
    team_id: string | null;
    active: boolean;
  }>) {
    if (!row.active) continue;
    if (row.scope === "league" && !pickedLeagues.has(row.sport)) {
      await setLeagueSubscription(subscriberId, row.sport, false);
    } else if (row.scope === "team" && row.team_id) {
      const key = `${row.sport}|${row.team_id}`;
      if (!pickedTeams.has(key)) {
        await setTeamSubscription(subscriberId, row.sport, row.team_id, false);
      }
    }
  }
}

/**
 * Total active team-digest opt-ins for a sport — counts only opt-ins
 * whose subscriber account is ALSO subscribers.status='active'. Mirrors
 * what the send cron will actually fan out to; an earlier version of
 * this helper counted raw email_subscriptions rows and over-reported
 * because unsubscribed subscribers' opt-in rows stay active=true (the
 * cron filters them at send time, but the count didn't).
 */
export async function countActiveTeamSubscriptions(sport: string): Promise<number> {
  const db = supabaseAdmin();
  const [{ data: optedIn, error: optErr }, activeIds] = await Promise.all([
    db.from("email_subscriptions")
      .select("subscriber_id")
      .eq("sport", sport)
      .eq("scope", "team")
      .eq("active", true),
    // Paginated — without this the active-subscribers select silently
    // caps at 1000 and the count comes back ~80% too low.
    (await import("./subscribers")).getActiveSubscriberIdSet(),
  ]);
  if (optErr) throw new Error(`countActiveTeamSubscriptions opted: ${optErr.message}`);
  let count = 0;
  for (const r of (optedIn ?? []) as Array<{ subscriber_id: string }>) {
    if (activeIds.has(r.subscriber_id)) count++;
  }
  return count;
}

/**
 * Returns every team that has at least one active=true subscription for the
 * given sport. The team-send cron iterates the result to decide which team
 * digests to fan out — teams with no subscribers don't even get rendered.
 */
export async function getActiveTeamIds(sport: string): Promise<string[]> {
  const { data, error } = await supabaseAdmin()
    .from("email_subscriptions")
    .select("team_id")
    .eq("sport", sport)
    .eq("scope", "team")
    .eq("active", true);
  if (error) throw new Error(`getActiveTeamIds: ${error.message}`);
  const out = new Set<string>();
  for (const row of (data ?? []) as Array<{ team_id: string | null }>) {
    if (row.team_id) out.add(row.team_id);
  }
  return Array.from(out).sort();
}

/**
 * Returns a nested map of sport → team_id → active for this subscriber's
 * team rows. Teams the subscriber has never seen are absent (treat as
 * active=false in UI).
 */
export async function getTeamSubscriptions(
  subscriberId: string,
): Promise<Map<string, Map<string, boolean>>> {
  const { data, error } = await supabaseAdmin()
    .from("email_subscriptions")
    .select("sport, team_id, active")
    .eq("subscriber_id", subscriberId)
    .eq("scope", "team");
  if (error) throw new Error(`getTeamSubscriptions: ${error.message}`);
  const out = new Map<string, Map<string, boolean>>();
  for (const row of (data ?? []) as Array<{ sport: string; team_id: string | null; active: boolean }>) {
    if (!row.team_id) continue;
    if (!out.has(row.sport)) out.set(row.sport, new Map());
    out.get(row.sport)!.set(row.team_id, row.active);
  }
  return out;
}

/**
 * Upsert the team row for (subscriber, sport, team_id). Same insert-then-
 * update dance as setLeagueSubscription because the underlying uniqueness
 * comes from a partial index (scope='team') that .upsert()'s onConflict
 * can't target by column list.
 */
export async function setTeamSubscription(
  subscriberId: string,
  sport: string,
  teamId: string,
  active: boolean,
): Promise<void> {
  const { error: insertErr } = await supabaseAdmin()
    .from("email_subscriptions")
    .insert({
      subscriber_id: subscriberId,
      sport,
      scope: "team",
      team_id: teamId,
      active,
    });
  if (!insertErr) return;
  const code = (insertErr as { code?: string }).code;
  const isDup = code === "23505" || /duplicate key/i.test(insertErr.message);
  if (!isDup) throw new Error(`setTeamSubscription insert: ${insertErr.message}`);

  const { error: updateErr } = await supabaseAdmin()
    .from("email_subscriptions")
    .update({ active, updated_at: new Date().toISOString() })
    .eq("subscriber_id", subscriberId)
    .eq("sport", sport)
    .eq("team_id", teamId)
    .eq("scope", "team");
  if (updateErr) throw new Error(`setTeamSubscription update: ${updateErr.message}`);
}
