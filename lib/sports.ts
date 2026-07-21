import { supabaseAdmin } from "./supabase";

// Static registry of every sport the app knows about. Adding a sport is
// a code change: add a row here, ship a deploy.
//
// The static const is the deploy-time BASELINE and the outage FALLBACK.
// Why it matters: every `/[sport]/*` page checks visibility on render.
// During the 2026-07-02 burst-I/O outage a per-render `select * from sports`
// was ~50% of our DB traffic. So visibility is DB-backed but read through a
// short-TTL in-process cache (at most one DB read every OVERRIDES_TTL_MS per
// instance, not per render), and falls back to this constant whenever the
// read fails — public surfaces keep rendering even when Supabase is down. An
// admin visibility flip writes the row and clears the local cache; other
// instances pick it up within the TTL.
//
// `sends_enabled` is a separate runtime kill switch (getSportRow /
// setSportSendsEnabled), read directly from the DB in cron/admin contexts.

export type SportVisibility = "admin_only" | "public";

export type Sport = {
  id: string;
  name: string;
  visibility: SportVisibility;
};

// Baseline visibility per sport. Overridden at runtime by the sports table.
export const SPORTS: readonly Sport[] = [
  { id: "mlb",   name: "MLB",   visibility: "public" },
  { id: "wnba",  name: "WNBA",  visibility: "admin_only" },
  { id: "nba",   name: "NBA",   visibility: "admin_only" },
  { id: "nfl",   name: "NFL",   visibility: "admin_only" },
  { id: "ncaaf", name: "College Football", visibility: "admin_only" },
] as const;

const BY_ID = new Map<string, Sport>(SPORTS.map((s) => [s.id, s]));

// In-process cache of DB visibility overrides. Short TTL so a per-render read
// never hits the DB; on read failure we return the last good value (or {}),
// so callers fall back to the static baseline — the outage-resilience contract.
const OVERRIDES_TTL_MS = 30_000;
let overridesCache: { at: number; value: Record<string, SportVisibility> } | null = null;

async function readVisibilityOverrides(): Promise<Record<string, SportVisibility>> {
  const now = Date.now();
  if (overridesCache && now - overridesCache.at < OVERRIDES_TTL_MS) return overridesCache.value;
  try {
    const { data, error } = await supabaseAdmin().from("sports").select("id, visibility");
    if (error) return overridesCache?.value ?? {};
    const out: Record<string, SportVisibility> = {};
    for (const r of data ?? []) {
      if (r.visibility === "public" || r.visibility === "admin_only") out[r.id] = r.visibility;
    }
    overridesCache = { at: now, value: out };
    return out;
  } catch {
    return overridesCache?.value ?? {};
  }
}

// Effective visibility = DB override if present/reachable, else the baseline.
async function effectiveVisibility(id: string, baseline: SportVisibility): Promise<SportVisibility> {
  const overrides = await readVisibilityOverrides();
  return overrides[id] ?? baseline;
}

export async function getSportById(id: string): Promise<Sport | null> {
  const sport = BY_ID.get(id);
  if (!sport) return null;
  return { ...sport, visibility: await effectiveVisibility(id, sport.visibility) };
}

/**
 * Returns sports filtered by (effective) visibility. Pass
 * `includeAdminOnly: true` for admin contexts (admin dashboard,
 * admin-authenticated settings page). Pass false (the default) for any UI
 * surface a non-admin user could see.
 */
export async function getVisibleSports(
  opts: { includeAdminOnly?: boolean } = {},
): Promise<Sport[]> {
  const overrides = await readVisibilityOverrides();
  return SPORTS
    .map((s) => ({ ...s, visibility: overrides[s.id] ?? s.visibility }))
    .filter((s) => s.visibility === "public" || Boolean(opts.includeAdminOnly));
}

/**
 * Returns every sport (effective visibility) regardless of filter. Use only
 * in admin contexts where the caller needs the full catalog.
 */
export async function getAllSports(): Promise<Sport[]> {
  const overrides = await readVisibilityOverrides();
  return SPORTS.map((s) => ({ ...s, visibility: overrides[s.id] ?? s.visibility }));
}

/**
 * True if the sport exists and is visible to the caller. Centralizes the
 * "is this sport accessible right now" check for route guards.
 */
export async function isSportVisible(
  id: string,
  opts: { includeAdminOnly?: boolean } = {},
): Promise<boolean> {
  const sport = BY_ID.get(id);
  if (!sport) return false;
  const visibility = await effectiveVisibility(id, sport.visibility);
  if (visibility === "public") return true;
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
    .select("visibility, sends_enabled")
    .eq("id", id)
    .maybeSingle<{ visibility: SportVisibility | null; sends_enabled: boolean }>();
  if (error) throw new Error(`getSportRow: ${error.message}`);
  return {
    ...sport,
    visibility: data?.visibility ?? sport.visibility,
    sends_enabled: data?.sends_enabled ?? true,
  };
}

/**
 * Admin-only: flip a sport's public/admin-only visibility. Writes the row and
 * busts the cache tag so getVisibleSports/isSportVisible pick it up immediately
 * on the next render. Independent of sends_enabled — a sport can be public with
 * sends paused, or admin-only with sends on.
 */
export async function setSportVisibility(id: string, visibility: SportVisibility): Promise<void> {
  const { error } = await supabaseAdmin()
    .from("sports")
    .update({ visibility, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw new Error(`setSportVisibility: ${error.message}`);
  overridesCache = null; // clear local cache so this instance reflects it now
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
