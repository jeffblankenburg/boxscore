import { supabaseAdmin } from "./supabase";

// Static registry of every sport the app knows about. Adding a sport is
// a code change: add a row here, ship a deploy. Same for launching a
// sport (flipping admin_only → public).
//
// Why static instead of `select * from sports`: every `/[sport]/*` page
// used to hit Supabase on render for existence + visibility + display
// name. During the 2026-07-02 burst-I/O outage that path was ~50% of
// our DB traffic — page renders blocked behind a lookup that only ever
// returned one of three rows. A constant keeps public surfaces
// rendering even when Supabase is down.
//
// The sports table still exists because `sends_enabled` is a runtime
// kill switch flipped from /admin/[sport] without a redeploy. Read it
// via `getSportRow` below; every other caller uses the sync helpers.

export type SportVisibility = "admin_only" | "public";

export type Sport = {
  id: string;
  name: string;
  visibility: SportVisibility;
};

export const SPORTS: readonly Sport[] = [
  { id: "mlb",  name: "MLB",  visibility: "public" },
  { id: "wnba", name: "WNBA", visibility: "admin_only" },
  { id: "nba",  name: "NBA",  visibility: "admin_only" },
] as const;

const BY_ID = new Map<string, Sport>(SPORTS.map((s) => [s.id, s]));

export function getSportById(id: string): Sport | null {
  return BY_ID.get(id) ?? null;
}

/**
 * Returns sports filtered by visibility. Pass `includeAdminOnly: true` for
 * admin contexts (admin dashboard, admin-authenticated settings page). Pass
 * false (the default) for any UI surface a non-admin user could see.
 */
export function getVisibleSports(
  opts: { includeAdminOnly?: boolean } = {},
): Sport[] {
  return SPORTS.filter((s) => s.visibility === "public" || Boolean(opts.includeAdminOnly));
}

/**
 * Returns every sport regardless of visibility. Use only in admin contexts
 * where the caller needs the full catalog.
 */
export function getAllSports(): Sport[] {
  return [...SPORTS];
}

/**
 * True if the sport exists and is visible to the caller. Centralizes the
 * "is this sport accessible right now" check for route guards.
 */
export function isSportVisible(
  id: string,
  opts: { includeAdminOnly?: boolean } = {},
): boolean {
  const sport = BY_ID.get(id);
  if (!sport) return false;
  if (sport.visibility === "public") return true;
  return Boolean(opts.includeAdminOnly);
}

// -----------------------------------------------------------------------
// Mutable per-sport state — DB-backed. Reserved for callers that actually
// need the runtime kill switch: the send-email crons and the admin
// dashboard. Everything else stays on the static helpers above so a DB
// outage does not stop public pages from rendering.
// -----------------------------------------------------------------------

export type SportRow = Sport & { sends_enabled: boolean };

/**
 * Returns the sport augmented with its current `sends_enabled` value from
 * the sports table. Defaults `sends_enabled` to true if the row is missing
 * so a sport newly added to the static registry starts sending immediately.
 */
export async function getSportRow(id: string): Promise<SportRow | null> {
  const sport = BY_ID.get(id);
  if (!sport) return null;
  const { data, error } = await supabaseAdmin()
    .from("sports")
    .select("sends_enabled")
    .eq("id", id)
    .maybeSingle<{ sends_enabled: boolean }>();
  if (error) throw new Error(`getSportRow: ${error.message}`);
  return { ...sport, sends_enabled: data?.sends_enabled ?? true };
}

/**
 * Admin-only: flip a sport's daily-send state. When false, the send-email
 * and send-team-email crons skip this sport with a recorded "sends_disabled"
 * skip; generate keeps running so the archive/preview pages still cache.
 */
export async function setSportSendsEnabled(id: string, enabled: boolean): Promise<void> {
  const { error } = await supabaseAdmin()
    .from("sports")
    .update({ sends_enabled: enabled, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw new Error(`setSportSendsEnabled: ${error.message}`);
}
